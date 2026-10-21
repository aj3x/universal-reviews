import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.ts";

/** Read-only lookups against external catalogues. Nothing here touches our database. */

const opt = z.string().optional();

export const placesRoutes = new Hono<AppEnv>().get(
  "/autocomplete",
  zValidator("query", z.object({ q: opt, session: opt, lat: opt, lng: opt })),
  async (c) => {
    const { places } = c.var.deps;
    if (!places) return c.json({ error: "places_not_configured" }, 503);
    const query = c.req.valid("query");
    const q = (query.q ?? "").trim();
    const session = query.session ?? "";
    if (q.length < 2 || !session) return c.json({ data: [] });
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    const near = query.lat && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
    return c.json({ data: await places.autocomplete(q, session, near) });
  },
);

export const moviesRoutes = new Hono<AppEnv>().get("/search", zValidator("query", z.object({ q: opt })), async (c) => {
  const { tmdb } = c.var.deps;
  if (!tmdb) return c.json({ error: "tmdb_not_configured" }, 503);
  const q = (c.req.valid("query").q ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });
  return c.json({ data: await tmdb.search(q) });
});
