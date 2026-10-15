import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { GoogleProfile } from "../auth/google.js";
import {
  clearSessionCookie,
  createSession,
  invalidateSession,
  readSessionCookie,
  setSessionCookie,
} from "../auth/session.js";
import type { AppDeps, AppEnv } from "../context.js";
import { users } from "../db/schema.js";
import { newId } from "../lib/ids.js";

const OAUTH_COOKIE = "oauth";

/** Find the user by Google's stable id, refresh their profile, or create them. */
async function upsertGoogleUser(deps: AppDeps, p: GoogleProfile) {
  const existing = await deps.db.select().from(users).where(eq(users.googleSub, p.sub)).get();
  if (existing) {
    await deps.db
      .update(users)
      .set({ email: p.email, avatarUrl: p.picture ?? existing.avatarUrl })
      .where(eq(users.id, existing.id));
    return existing.id;
  }
  if (deps.allowedEmails.size > 0 && !deps.allowedEmails.has(p.email.toLowerCase())) return null;
  const id = newId();
  await deps.db.insert(users).values({
    id,
    googleSub: p.sub,
    email: p.email,
    displayName: p.name,
    avatarUrl: p.picture ?? null,
  });
  return id;
}

export const authRoutes = new Hono<AppEnv>()
  .get("/google", (c) => {
    const { google, secureCookies } = c.var.deps;
    if (!google) return c.json({ error: "google_sign_in_not_configured" }, 503);
    const { url, state, codeVerifier } = google.start();
    setCookie(c, OAUTH_COOKIE, `${state}.${codeVerifier}`, {
      httpOnly: true, secure: secureCookies, sameSite: "Lax", path: "/", maxAge: 600,
    });
    return c.redirect(url.toString());
  })

  .get("/google/callback", async (c) => {
    const deps = c.var.deps;
    if (!deps.google) return c.json({ error: "google_sign_in_not_configured" }, 503);
    const [state, codeVerifier] = (getCookie(c, OAUTH_COOKIE) ?? "").split(".");
    deleteCookie(c, OAUTH_COOKIE, { path: "/" });
    const code = c.req.query("code");
    if (!code || !state || !codeVerifier || c.req.query("state") !== state) {
      return c.json({ error: "invalid_oauth_state" }, 400);
    }
    let profile: GoogleProfile;
    try {
      profile = await deps.google.finish(code, codeVerifier);
    } catch {
      return c.json({ error: "google_sign_in_failed" }, 400);
    }
    const userId = await upsertGoogleUser(deps, profile);
    if (!userId) return c.redirect(`${deps.appUrl}/?signin=not_invited`);
    const { token, expiresAt } = await createSession(deps.db, userId);
    setSessionCookie(c, token, expiresAt, deps.secureCookies);
    return c.redirect(deps.appUrl);
  })

  .post("/dev-login", async (c) => {
    const deps = c.var.deps;
    if (!deps.devLogin) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ email?: string; name?: string }>().catch(() => ({}) as { email?: string; name?: string });
    if (!body.email) return c.json({ error: "email_required" }, 400);
    const userId = await upsertGoogleUser(
      { ...deps, allowedEmails: new Set() },
      { sub: `dev:${body.email}`, email: body.email, name: body.name ?? body.email.split("@")[0]! },
    );
    const { token, expiresAt } = await createSession(deps.db, userId!);
    setSessionCookie(c, token, expiresAt, deps.secureCookies);
    return c.json({ userId, token });
  })

  .post("/logout", async (c) => {
    const token = readSessionCookie(c);
    if (token) await invalidateSession(c.var.deps.db, token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });
