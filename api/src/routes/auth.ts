import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { GoogleProfile, OAuthLogin } from "../auth/google.ts";
import {
  clearSessionCookie,
  createSession,
  invalidateSession,
  readSessionCookie,
  setSessionCookie,
} from "../auth/session.ts";
import type { AppDeps, AppEnv } from "../context.ts";
import { users } from "../db/schema.ts";
import { newId } from "../lib/ids.ts";

const OAUTH_COOKIE = "oauth";

function parseLogin(raw: string | undefined): OAuthLogin | null {
  try {
    const v = JSON.parse(raw ?? "");
    return typeof v?.state === "string" && typeof v.codeVerifier === "string" && typeof v.nonce === "string" ? v : null;
  } catch {
    return null;
  }
}

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
  .get("/google", async (c) => {
    const { google, secureCookies } = c.var.deps;
    if (!google) return c.json({ error: "google_sign_in_not_configured" }, 503);
    let started;
    try {
      started = await google.start();
    } catch {
      return c.json({ error: "google_sign_in_unavailable" }, 503);
    }
    const { url, ...login } = started;
    setCookie(c, OAUTH_COOKIE, JSON.stringify(login), {
      httpOnly: true, secure: secureCookies, sameSite: "Lax", path: "/", maxAge: 600,
    });
    return c.redirect(url.toString());
  })

  .get("/google/callback", async (c) => {
    const deps = c.var.deps;
    if (!deps.google) return c.json({ error: "google_sign_in_not_configured" }, 503);
    const login = parseLogin(getCookie(c, OAUTH_COOKIE));
    deleteCookie(c, OAUTH_COOKIE, { path: "/" });
    if (!login || c.req.query("state") !== login.state) {
      return c.json({ error: "invalid_oauth_state" }, 400);
    }
    let profile: GoogleProfile;
    try {
      profile = await deps.google.finish(new URL(c.req.url).search, login);
    } catch {
      return c.json({ error: "google_sign_in_failed" }, 400);
    }
    const userId = await upsertGoogleUser(deps, profile);
    if (!userId) return c.redirect(`${deps.appUrl}/?signin=not_invited`);
    const { token, expiresAt } = await createSession(deps.db, userId);
    setSessionCookie(c, token, expiresAt, deps.secureCookies);
    return c.redirect(deps.appUrl);
  })

  .post(
    "/dev-login",
    // Before the validator, so a production server answers 404 whatever the body is.
    (c, next) => (c.var.deps.devLogin ? next() : c.json({ error: "not_found" }, 404)),
    zValidator("json", z.object({ email: z.string().trim().min(1), name: z.string().optional() })),
    async (c) => {
      const deps = c.var.deps;
      const body = c.req.valid("json");
      const userId = await upsertGoogleUser(
        { ...deps, allowedEmails: new Set() },
        { sub: `dev:${body.email}`, email: body.email, name: body.name ?? body.email.split("@")[0]! },
      );
      const { token, expiresAt } = await createSession(deps.db, userId!);
      setSessionCookie(c, token, expiresAt, deps.secureCookies);
      return c.json({ userId, token });
    },
  )

  .post("/logout", async (c) => {
    const token = readSessionCookie(c);
    if (token) await invalidateSession(c.var.deps.db, token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });
