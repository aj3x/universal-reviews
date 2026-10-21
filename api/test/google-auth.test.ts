import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { GoogleAuth } from "../src/auth/google.ts";
import { openDatabase } from "../src/db/client.ts";

const fakeGoogle: GoogleAuth = {
  start: async () => ({
    url: new URL("https://accounts.google.com/o/oauth2/v2/auth?x=1"), state: "st", codeVerifier: "cv", nonce: "n",
  }),
  finish: async (search) => {
    const params = new URLSearchParams(search);
    if (params.get("error")) throw new Error(params.get("error")!);
    const code = params.get("code")!;
    return { sub: `google-${code}`, email: `${code}@gmail.com`, name: code };
  },
};

function app(allowed: string[] = []) {
  const { db } = openDatabase(":memory:");
  return createApp({
    db, google: fakeGoogle, allowedEmails: new Set(allowed), devLogin: false, secureCookies: false, appUrl: "http://app",
  });
}

async function signIn(a: ReturnType<typeof app>, code: string) {
  const start = await a.request("/api/v1/auth/google");
  expect(start.status).toBe(302);
  const oauth = start.headers.get("set-cookie")!.split(";")[0]!;
  return a.request(`/api/v1/auth/google/callback?code=${code}&state=st`, { headers: { cookie: oauth } });
}

describe("Google sign-in", () => {
  it("creates the user, sets a session cookie, and the session works", async () => {
    const a = app();
    const cb = await signIn(a, "alex");
    expect(cb.status).toBe(302);
    const sid = cb.headers.getSetCookie().find((c) => c.startsWith("sid="))!.split(";")[0]!;
    const me = await a.request("/api/v1/me", { headers: { cookie: sid } });
    expect((await me.json()).email).toBe("alex@gmail.com");
  });

  it("rejects a mismatched state", async () => {
    const a = app();
    const start = await a.request("/api/v1/auth/google");
    const oauth = start.headers.get("set-cookie")!.split(";")[0]!;
    const res = await a.request("/api/v1/auth/google/callback?code=x&state=wrong", { headers: { cookie: oauth } });
    expect(res.status).toBe(400);
  });

  it("rejects a missing or malformed login cookie", async () => {
    const a = app();
    const res = await a.request("/api/v1/auth/google/callback?code=x&state=st", { headers: { cookie: "oauth=st.cv" } });
    expect(res.status).toBe(400);
  });

  it("fails cleanly when Google returns an error", async () => {
    const a = app();
    const start = await a.request("/api/v1/auth/google");
    const oauth = start.headers.get("set-cookie")!.split(";")[0]!;
    const res = await a.request("/api/v1/auth/google/callback?error=access_denied&state=st", { headers: { cookie: oauth } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("google_sign_in_failed");
  });

  it("turns away emails outside ALLOWED_EMAILS when it is set", async () => {
    const a = app(["friend@gmail.com"]);
    const cb = await signIn(a, "stranger");
    expect(cb.headers.get("location")).toContain("not_invited");
    expect(cb.headers.getSetCookie().some((c) => c.startsWith("sid="))).toBe(false);
  });
});
