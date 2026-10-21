import { describe, expect, it } from "vitest";
import { purgeExpiredSessions } from "../src/auth/session.js";
import { loadConfig } from "../src/config.js";
import { sessions } from "../src/db/schema.js";
import { UpstreamError, upstreamFetch } from "../src/sources/upstream.js";
import { sampleReview, setup } from "./helpers.js";

describe("config", () => {
  it("applies defaults for local development", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ port: 8080, publicUrl: "http://localhost:8080", production: false, secureCookies: false, devLogin: false });
  });

  it("rejects an unsafe production setup, listing every problem", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/PUBLIC_URL: required in production/);
    expect(() => loadConfig({ NODE_ENV: "production", PUBLIC_URL: "http://rate.example.com" })).toThrow(/must be https/);
    expect(() => loadConfig({ GOOGLE_CLIENT_ID: "id" })).toThrow(/together/);
    expect(() => loadConfig({ PORT: "99999" })).toThrow(/PORT/);
  });

  it("accepts production behind https, or on localhost, and never enables dev login there", () => {
    const c = loadConfig({ NODE_ENV: "production", PUBLIC_URL: "https://rate.example.com", DEV_LOGIN: "1", ALLOWED_EMAILS: " A@x.com, b@x.com " });
    expect(c).toMatchObject({ secureCookies: true, devLogin: false });
    expect([...c.allowedEmails]).toEqual(["a@x.com", "b@x.com"]);
    expect(() => loadConfig({ NODE_ENV: "production", PUBLIC_URL: "http://localhost:8080" })).not.toThrow();
  });
});

describe("request guards", () => {
  it("refuses state-changing requests from a foreign Origin, allows own and configured ones", async () => {
    const { user } = setup({ allowedOrigins: ["http://localhost:5173"] });
    const alex = await user("alex");
    const body = { kind: "restaurant", title: "X" };
    expect((await alex.json("POST", "/items", body, { origin: "https://evil.example" })).status).toBe(403);
    expect((await alex.json("POST", "/items", body, { origin: "http://localhost:5173" })).status).toBe(201);
    expect((await alex.json("POST", "/items", body, { origin: "http://localhost" })).status).toBe(201); // same origin as the test host
    expect((await alex.json("GET", "/items", undefined, { origin: "https://evil.example" })).status).toBe(200); // reads are not state-changing
  });

  it("rejects oversized bodies", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const res = await alex.json("POST", "/items", { kind: "restaurant", title: "X", details: { pad: "x".repeat(70_000) } });
    expect(res.status).toBe(413);
  });

  it("rate-limits the external catalogue proxies per user", async () => {
    const { user } = setup({ limits: { external: { max: 2, windowMs: 60_000 } } });
    const alex = await user("alex");
    const sam = await user("sam");
    const get = (u: typeof alex) => u.call("GET", "/places/autocomplete?q=ra&session=s");
    expect((await get(alex)).status).toBe(200);
    expect((await get(alex)).status).toBe(200);
    const limited = await get(alex);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await get(sam)).status).toBe(200);
  });

  it("rate-limits writes but never reads", async () => {
    const { user } = setup({ limits: { writes: { max: 2, windowMs: 60_000 } } });
    const alex = await user("alex");
    for (let i = 0; i < 2; i++) expect((await alex.json("POST", "/items", { kind: "restaurant", title: `X${i}` })).status).toBe(201);
    expect((await alex.json("POST", "/items", { kind: "restaurant", title: "X3" })).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await alex.json("GET", "/items")).status).toBe(200);
  });
});

describe("upstream failures", () => {
  it("answers 502, not 500, when an external catalogue is down", async () => {
    const { user } = setup({ places: {
      autocomplete: async () => { throw new UpstreamError("places", "autocomplete failed: 503"); },
      details: async () => { throw new UpstreamError("places", "details failed: 503"); },
    } });
    const alex = await user("alex");
    const res = await alex.json("GET", "/places/autocomplete?q=ra&session=s");
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream_unavailable", service: "places" });
  });

  it("turns network failures into UpstreamError", async () => {
    const down: typeof fetch = async () => { throw new TypeError("fetch failed"); };
    await expect(upstreamFetch("tmdb", down, "https://example.test")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("input edge cases", () => {
  it("treats an empty profile patch as a no-op instead of a 500", async () => {
    const { user } = setup();
    const alex = await user("alex");
    expect((await alex.json("PATCH", "/me", {})).status).toBe(204);
  });

  it("404s when changing a list that is not yours", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const sam = await user("sam");
    const list = await alex.json("POST", "/lists", { name: "Faves" });
    expect((await sam.json("PATCH", `/lists/${list.body.id}`, { name: "Mine now" })).status).toBe(404);
    expect((await sam.json("DELETE", `/lists/${list.body.id}`)).status).toBe(404);
    expect((await alex.json("PATCH", `/lists/${list.body.id}`, { name: "Best" })).status).toBe(204);
    expect((await alex.json("DELETE", `/lists/${list.body.id}`)).status).toBe(204);
  });

  it("refuses visit dates in the future", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const item = await alex.json("POST", "/items", { kind: "restaurant", title: "Ramen" });
    expect((await alex.json("POST", "/reviews", sampleReview(item.body.id, { experiencedOn: "2999-01-01" }))).status).toBe(400);
    await alex.json("POST", "/reviews", sampleReview(item.body.id));
    expect((await alex.json("POST", `/items/${item.body.id}/visits`, { visitedOn: "2999-01-01" })).status).toBe(400);
  });

  it("survives a double-submit: both saves succeed and there is still one review", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const item = await alex.json("POST", "/items", { kind: "restaurant", title: "Ramen" });
    const [a, b] = await Promise.all([
      alex.json("POST", "/reviews", sampleReview(item.body.id)),
      alex.json("POST", "/reviews", sampleReview(item.body.id)),
    ]);
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
    expect((await alex.json("GET", "/me/reviews")).body.data).toHaveLength(1);
  });
});

describe("sessions", () => {
  it("sweeps expired sessions and keeps live ones", async () => {
    const { db, user } = setup();
    const alex = await user("alex");
    await db.insert(sessions).values({ id: "old", userId: alex.id, expiresAt: "2020-01-01T00:00:00.000Z" });
    await purgeExpiredSessions(db);
    const ids = (await db.select({ id: sessions.id }).from(sessions)).map((r) => r.id);
    expect(ids).not.toContain("old");
    expect(ids).toHaveLength(1);
  });
});
