import { eq, lt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { DB } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import { hashToken, newSessionToken } from "../lib/ids.ts";

export const SESSION_COOKIE = "sid";
const DAY = 24 * 60 * 60 * 1000;
const SESSION_TTL = 30 * DAY;
const REFRESH_WHEN_LEFT = 15 * DAY;

export type SessionUser = typeof users.$inferSelect;

export async function createSession(db: DB, userId: string) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt: expiresAt.toISOString() });
  return { token, expiresAt };
}

/** Returns the signed-in user, sliding the expiry forward when it is more than half used. */
export async function validateSession(db: DB, token: string): Promise<SessionUser | null> {
  const id = hashToken(token);
  const row = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;

  const expires = Date.parse(row.expiresAt);
  if (expires <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (expires - Date.now() < REFRESH_WHEN_LEFT) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL).toISOString() })
      .where(eq(sessions.id, id));
  }
  return row.user;
}

export async function purgeExpiredSessions(db: DB) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString()));
}

export async function invalidateSession(db: DB, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export function setSessionCookie(c: Context, token: string, expiresAt: Date, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export const readSessionCookie = (c: Context) => getCookie(c, SESSION_COOKIE);
