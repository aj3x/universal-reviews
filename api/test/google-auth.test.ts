import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { GoogleAuth } from "../src/auth/google.js";
import { openDatabase } from "../src/db/client.js";

const fakeGoogle: GoogleAuth = {
  start: () => ({ url: new URL("https://accounts.google.com/o/oauth2/v2/auth?x=1"), state: "st", codeVerifier: "cv" }),
  finish: async (code) => ({ sub: `google-${code}`, email: `${code}@gmail.com`, name: code }),
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
    const res = await a.request("/api/v1/auth/google/callback?code=x&state=wrong", { headers: { cookie: "oauth=st.cv" } });
    expect(res.status).toBe(400);
  });

  it("turns away emails outside ALLOWED_EMAILS when it is set", async () => {
    const a = app(["friend@gmail.com"]);
    const cb = await signIn(a, "stranger");
    expect(cb.headers.get("location")).toContain("not_invited");
    expect(cb.headers.getSetCookie().some((c) => c.startsWith("sid="))).toBe(false);
  });
});
