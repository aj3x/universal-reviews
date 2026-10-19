import { Hono } from "hono";
import type { AppEnv } from "../context.js";

/** Read-only lookups against external catalogues. Nothing here touches our database. */

export const placesRoutes = new Hono<AppEnv>().get("/autocomplete", async (c) => {
  const { places } = c.var.deps;
  if (!places) return c.json({ error: "places_not_configured" }, 503);
  const q = (c.req.query("q") ?? "").trim();
  const session = c.req.query("session") ?? "";
  if (q.length < 2 || !session) return c.json({ data: [] });
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  const near = Number.isFinite(lat) && Number.isFinite(lng) && c.req.query("lat") ? { lat, lng } : undefined;
  return c.json({ data: await places.autocomplete(q, session, near) });
});

export const moviesRoutes = new Hono<AppEnv>().get("/search", async (c) => {
  const { tmdb } = c.var.deps;
  if (!tmdb) return c.json({ error: "tmdb_not_configured" }, 503);
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });
  return c.json({ data: await tmdb.search(q) });
});
