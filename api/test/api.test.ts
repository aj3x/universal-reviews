import { describe, expect, it } from "vitest";
import { items } from "../src/db/schema.js";
import { sampleReview, setup } from "./helpers.js";

describe("auth", () => {
  it("rejects requests without a session", async () => {
    const { app } = setup();
    expect((await app.request("/api/v1/feed")).status).toBe(401);
  });

  it("serves the review model without a session", async () => {
    const { app } = setup();
    const res = await app.request("/api/v1/review-model?kind=movie");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.scoreFields).toEqual(["enjoyment", "impact", "value", "aesthetic"]);
    expect(body.prompts.movie.revisit).toMatch(/rewatch/);
    expect(body.scale.help).toMatch(/1 is the worst of all time/);
  });

  it("reports Google sign-in as unconfigured instead of crashing", async () => {
    const { app } = setup();
    expect((await app.request("/api/v1/auth/google")).status).toBe(503);
  });
});

describe("restaurants from Google Places", () => {
  it("creates once per place id and reuses it after", async () => {
    const { user } = setup();
    const me = await user("alex");
    const first = await me.json("POST", "/items/from-place", { placeId: "ChIJ-fake-1", name: "Ramen Danbo" });
    expect(first.status).toBe(201);
    expect(first.body.details.address).toContain("Vancouver");
    const again = await me.json("POST", "/items/from-place", { placeId: "ChIJ-fake-1", name: "Ramen Danbo" });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it("proxies autocomplete", async () => {
    const { user } = setup();
    const me = await user("alex");
    const res = await me.json("GET", "/places/autocomplete?q=ramen&session=s1");
    expect(res.body.data[0].name).toBe("ramen Noodle Bar");
  });
});

describe("reviews", () => {
  it("creates a review with the six primary answers and optional notes", async () => {
    const { user } = setup();
    const me = await user("alex");
    const item = await me.json("POST", "/items", { kind: "restaurant", title: "Kissa Tanto" });
    const res = await me.json("POST", "/reviews", sampleReview(item.body.id));
    expect(res.status).toBe(201);
    expect(res.body.scores).toEqual({ enjoyment: 8, impact: 6, value: 7, aesthetic: 5 });
    expect(res.body.notes).toBeNull();

    const withNotes = await me.json("POST", "/reviews", sampleReview(item.body.id, { notes: "Get the tajarin." }));
    expect(withNotes.body.notes).toBe("Get the tajarin.");
  });

  it("rejects scores outside 1–10 and unknown answers", async () => {
    const { user } = setup();
    const me = await user("alex");
    const item = await me.json("POST", "/items", { kind: "restaurant", title: "X" });
    const bad = sampleReview(item.body.id, { scores: { enjoyment: 11, impact: 0, value: 5, aesthetic: 5 } });
    expect((await me.json("POST", "/reviews", bad)).status).toBe(400);
    expect((await me.json("POST", "/reviews", sampleReview(item.body.id, { revisit: "sometimes" }))).status).toBe(400);
  });

  it("refuses reviews of kinds that are modelled but not enabled", async () => {
    const { user, db } = setup();
    const me = await user("alex");
    expect((await me.json("POST", "/items", { kind: "movie", title: "Paddington 2" })).status).toBe(400);
    await db.insert(items).values({ id: "movie1", kind: "movie", title: "Paddington 2" });
    const res = await me.json("POST", "/reviews", sampleReview("movie1"));
    expect(res.body.error).toBe("kind_not_enabled");
  });

  it("lets only the author edit or delete", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const sam = await user("sam");
    const item = await alex.json("POST", "/items", { kind: "restaurant", title: "X" });
    const review = await alex.json("POST", "/reviews", sampleReview(item.body.id));
    expect((await sam.json("PATCH", `/reviews/${review.body.id}`, { notes: "hijack" })).status).toBe(404);
    const edited = await alex.json("PATCH", `/reviews/${review.body.id}`, { scores: { enjoyment: 9, impact: 6, value: 7, aesthetic: 5 } });
    expect(edited.body.scores.enjoyment).toBe(9);
    expect((await sam.json("DELETE", `/reviews/${review.body.id}`)).status).toBe(404);
    expect((await alex.json("DELETE", `/reviews/${review.body.id}`)).status).toBe(204);
  });
});

describe("item stats", () => {
  it("averages each score and counts revisit and recommend answers", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const sam = await user("sam");
    const item = await alex.json("POST", "/items", { kind: "restaurant", title: "X" });
    await alex.json("POST", "/reviews", sampleReview(item.body.id));
    await sam.json("POST", "/reviews", sampleReview(item.body.id, {
      scores: { enjoyment: 5, impact: 5, value: 4, aesthetic: 6 }, revisit: "once", recommendTo: "nobody",
    }));
    const { body } = await alex.json("GET", `/items/${item.body.id}`);
    expect(body.stats.reviewCount).toBe(2);
    expect(body.stats.averages).toEqual({ enjoyment: 6.5, impact: 5.5, value: 5.5, aesthetic: 5.5 });
    expect(body.stats.revisit).toEqual({ once: 1, a_few_times: 0, regularly: 1, forever: 0 });
    expect(body.stats.recommendTo).toEqual({ everyone: 0, most: 1, specific_people: 0, nobody: 1 });
  });
});

describe("follows, visibility and feed", () => {
  it("auto-accepts follows of public accounts and shows their reviews in the feed", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const sam = await user("sam");
    const item = await sam.json("POST", "/items", { kind: "restaurant", title: "X" });
    await sam.json("POST", "/reviews", sampleReview(item.body.id));

    expect((await alex.json("GET", "/feed")).body.data).toHaveLength(0);
    expect((await alex.json("POST", `/users/${sam.id}/follow`)).body.status).toBe("accepted");
    const feed = await alex.json("GET", "/feed");
    expect(feed.body.data).toHaveLength(1);
    expect(feed.body.data[0].item.title).toBe("X");
  });

  it("hides a private account's reviews until the follow is approved", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const priv = await user("priv", { isPrivate: true });
    const item = await priv.json("POST", "/items", { kind: "restaurant", title: "Secret spot" });
    await priv.json("POST", "/reviews", sampleReview(item.body.id));

    expect((await alex.json("GET", `/items/${item.body.id}/reviews`)).body.data).toHaveLength(0);
    expect((await alex.json("GET", `/items/${item.body.id}`)).body.stats.reviewCount).toBe(0);
    expect((await alex.json("POST", `/users/${priv.id}/follow`)).body.status).toBe("pending");
    expect((await priv.json("GET", "/me/follow-requests")).body.data[0].id).toBe(alex.id);
    await priv.json("POST", `/me/follow-requests/${alex.id}/accept`);
    expect((await alex.json("GET", `/items/${item.body.id}/reviews`)).body.data).toHaveLength(1);
  });

  it("paginates the feed with a cursor", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const item = await alex.json("POST", "/items", { kind: "restaurant", title: "X" });
    for (let i = 0; i < 5; i++) await alex.json("POST", "/reviews", sampleReview(item.body.id));
    const p1 = await alex.json("GET", "/feed?limit=3");
    expect(p1.body.data).toHaveLength(3);
    const p2 = await alex.json("GET", `/feed?limit=3&cursor=${p1.body.nextCursor}`);
    expect(p2.body.data).toHaveLength(2);
    expect(p2.body.nextCursor).toBeNull();
  });
});

describe("lists", () => {
  it("creates a list, adds and removes items, and keeps it private to the owner", async () => {
    const { user } = setup();
    const alex = await user("alex");
    const sam = await user("sam");
    const item = await alex.json("POST", "/items", { kind: "restaurant", title: "X" });
    const list = await alex.json("POST", "/lists", { name: "Want to try" });
    await alex.json("POST", `/lists/${list.body.id}/items`, { itemId: item.body.id, note: "birthday?" });
    expect((await alex.json("GET", `/lists/${list.body.id}`)).body.items[0].note).toBe("birthday?");
    expect((await sam.json("GET", `/lists/${list.body.id}`)).status).toBe(404);
    await alex.json("DELETE", `/lists/${list.body.id}/items/${item.body.id}`);
    expect((await alex.json("GET", `/lists/${list.body.id}`)).body.items).toHaveLength(0);
  });
});
