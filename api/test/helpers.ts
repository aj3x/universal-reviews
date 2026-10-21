import { createApp } from "../src/app.ts";
import { createSession } from "../src/auth/session.ts";
import { openDatabase } from "../src/db/client.ts";
import { users } from "../src/db/schema.ts";
import type { PlacesClient } from "../src/sources/places.ts";
import type { TmdbClient } from "../src/sources/tmdb.ts";
import { newId } from "../src/lib/ids.ts";

export const fakePlaces: PlacesClient = {
  async autocomplete(input) {
    return [{ placeId: "ChIJ-fake-1", name: `${input} Noodle Bar`, secondary: "Main St, Vancouver", types: ["restaurant"] }];
  },
  async details(placeId) {
    return { placeId, address: "123 Main St, Vancouver, BC", lat: 49.28, lng: -123.12 };
  },
};

export const fakeTmdb: TmdbClient = {
  async search(query) {
    return [{ tmdbId: 346698, title: `${query} (Movie)`, year: 2023 }];
  },
  async details(tmdbId) {
    return { tmdbId, title: "Barbie", year: 2023, runtime: 114, director: "Greta Gerwig" };
  },
};

export function setup(opts: { limits?: Parameters<typeof createApp>[1] extends infer O ? (O extends { limits?: infer L } ? L : never) : never; places?: PlacesClient; allowedOrigins?: string[] } = {}) {
  const { db, sqlite } = openDatabase(":memory:");
  const app = createApp({
    db, places: opts.places ?? fakePlaces, tmdb: fakeTmdb, allowedEmails: new Set(), devLogin: false, secureCookies: false, appUrl: "http://localhost",
    allowedOrigins: opts.allowedOrigins,
  }, { limits: opts.limits });

  async function user(name: string, userOpts: { isPrivate?: boolean } = {}) {
    const id = newId();
    await db.insert(users).values({
      id, googleSub: `sub-${name}`, email: `${name}@example.com`, displayName: name, isPrivate: userOpts.isPrivate ?? false,
    });
    const { token } = await createSession(db, id);
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      app.request(`/api/v1${path}`, {
        method,
        headers: { cookie: `sid=${token}`, ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    return { id, token, call, json: async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
      const res = await call(method, path, body, headers);
      return { status: res.status, body: res.status === 204 ? null : await res.json() } as { status: number; body: any };
    } };
  }

  return { db, sqlite, app, user };
}

export const sampleReview = (itemId: string, overrides: Record<string, unknown> = {}) => ({
  itemId,
  experiencedOn: "2026-10-10",
  scores: { enjoyment: 8, impact: 6, value: 7, aesthetic: 5 },
  revisit: "regularly",
  recommendTo: "most",
  ...overrides,
});
