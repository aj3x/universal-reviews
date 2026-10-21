import { createApp } from "../src/app.js";
import { createSession } from "../src/auth/session.js";
import { openDatabase } from "../src/db/client.js";
import { users } from "../src/db/schema.js";
import type { PlacesClient } from "../src/sources/places.js";
import type { TmdbClient } from "../src/sources/tmdb.js";
import { newId } from "../src/lib/ids.js";

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

export function setup() {
  const { db, sqlite } = openDatabase(":memory:");
  const app = createApp({
    db, places: fakePlaces, tmdb: fakeTmdb, allowedEmails: new Set(), devLogin: false, secureCookies: false, appUrl: "http://localhost",
  });

  async function user(name: string, opts: { isPrivate?: boolean } = {}) {
    const id = newId();
    await db.insert(users).values({
      id, googleSub: `sub-${name}`, email: `${name}@example.com`, displayName: name, isPrivate: opts.isPrivate ?? false,
    });
    const { token } = await createSession(db, id);
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`/api/v1${path}`, {
        method,
        headers: { cookie: `sid=${token}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    return { id, token, call, json: async (method: string, path: string, body?: unknown) => {
      const res = await call(method, path, body);
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
