import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { items, movieDetails, restaurantDetails } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import { getItem, listItemReviews, pageLimit } from "../lib/queries.js";
import { ENABLED_KINDS, ITEM_KINDS } from "../review-model.js";

const restaurantDetailsInput = z.object({
  address: z.string().max(300).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  cuisine: z.string().trim().max(60).nullish(),
  priceLevel: z.number().int().min(1).max(4).nullish(),
});

const movieDetailsInput = z.object({
  year: z.number().int().min(1870).max(2200).nullish(),
  runtime: z.number().int().min(1).max(1000).nullish(),
  director: z.string().trim().max(200).nullish(),
});

const createItemInput = z.object({
  kind: z.enum(ITEM_KINDS),
  title: z.string().trim().min(1).max(200),
  /** Shape depends on kind; validated below. */
  details: z.record(z.string(), z.unknown()).optional(),
});

export const itemRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const q = (c.req.query("q") ?? "").trim().replace(/[%_]/g, "");
    const kind = c.req.query("kind");
    const filters = [];
    if (q) filters.push(like(items.title, `%${q}%`));
    if (kind && (ITEM_KINDS as readonly string[]).includes(kind)) filters.push(eq(items.kind, kind as (typeof ITEM_KINDS)[number]));
    const rows = await c.var.deps.db
      .select({ id: items.id, kind: items.kind, title: items.title, address: restaurantDetails.address, year: movieDetails.year })
      .from(items).leftJoin(restaurantDetails, eq(restaurantDetails.itemId, items.id))
      .leftJoin(movieDetails, eq(movieDetails.itemId, items.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(items.id)).limit(pageLimit(c.req.query("limit")));
    return c.json({ data: rows });
  })

  /** Manual entry (no Google match, or a kind without an external catalogue yet). */
  .post("/", zValidator("json", createItemInput), async (c) => {
    const input = c.req.valid("json");
    if (!ENABLED_KINDS.includes(input.kind)) return c.json({ error: "kind_not_enabled", kind: input.kind }, 400);
    const { db } = c.var.deps;
    const schema = input.kind === "movie" ? movieDetailsInput : restaurantDetailsInput;
    const details = schema.safeParse(input.details ?? {});
    if (!details.success) return c.json({ error: "invalid_details" }, 400);
    const id = newId();
    await db.insert(items).values({ id, kind: input.kind, title: input.title, createdBy: c.var.user.id });
    if (input.kind === "restaurant") await db.insert(restaurantDetails).values({ itemId: id, ...details.data });
    if (input.kind === "movie") await db.insert(movieDetails).values({ itemId: id, ...details.data });
    return c.json(await getItem(db, c.var.user.id, id), 201);
  })

  /** Add (or find) a restaurant from a Google place picked in autocomplete. */
  .post(
    "/from-place",
    zValidator("json", z.object({
      placeId: z.string().min(1).max(300),
      name: z.string().trim().min(1).max(200),
      sessionToken: z.string().max(100).optional(),
    })),
    async (c) => {
      const { db, places } = c.var.deps;
      const { placeId, name, sessionToken } = c.req.valid("json");
      const existing = await db.select({ id: items.id }).from(items)
        .where(and(eq(items.externalSource, "google_places"), eq(items.externalId, placeId))).get();
      if (existing) return c.json(await getItem(db, c.var.user.id, existing.id));
      if (!places) return c.json({ error: "places_not_configured" }, 503);

      const place = await places.details(placeId, sessionToken);
      const id = newId();
      await db.insert(items).values({
        id, kind: "restaurant", title: name, externalSource: "google_places", externalId: place.placeId, createdBy: c.var.user.id,
      });
      await db.insert(restaurantDetails).values({
        itemId: id, address: place.address, lat: place.lat, lng: place.lng, cachedAt: new Date().toISOString(),
      });
      return c.json(await getItem(db, c.var.user.id, id), 201);
    },
  )

  /** Add (or find) a movie from a TMDB search result. */
  .post(
    "/from-movie",
    zValidator("json", z.object({ tmdbId: z.number().int().positive(), title: z.string().trim().min(1).max(200) })),
    async (c) => {
      const { db, tmdb } = c.var.deps;
      const { tmdbId, title } = c.req.valid("json");
      const existing = await db.select({ id: items.id }).from(items)
        .where(and(eq(items.externalSource, "tmdb"), eq(items.externalId, String(tmdbId)))).get();
      if (existing) return c.json(await getItem(db, c.var.user.id, existing.id));
      if (!tmdb) return c.json({ error: "tmdb_not_configured" }, 503);

      const movie = await tmdb.details(tmdbId);
      const id = newId();
      await db.insert(items).values({
        id, kind: "movie", title: movie.title || title, externalSource: "tmdb", externalId: String(movie.tmdbId), createdBy: c.var.user.id,
      });
      await db.insert(movieDetails).values({
        itemId: id, year: movie.year, runtime: movie.runtime, director: movie.director, cachedAt: new Date().toISOString(),
      });
      return c.json(await getItem(db, c.var.user.id, id), 201);
    },
  )

  .get("/:id", async (c) => {
    const item = await getItem(c.var.deps.db, c.var.user.id, c.req.param("id"));
    return item ? c.json(item) : c.json({ error: "not_found" }, 404);
  })

  .get("/:id/reviews", async (c) => {
    return c.json(await listItemReviews(
      c.var.deps.db, c.var.user.id, c.req.param("id"), c.req.query("cursor"), pageLimit(c.req.query("limit")),
    ));
  })

  /** Our own restaurant fields. Google-sourced fields are refreshed by a job, not edited. */
  .patch(
    "/:id/details",
    zValidator("json", restaurantDetailsInput.pick({ cuisine: true, priceLevel: true })),
    async (c) => {
      const { db } = c.var.deps;
      const id = c.req.param("id");
      const exists = await db.select({ id: restaurantDetails.itemId }).from(restaurantDetails)
        .where(eq(restaurantDetails.itemId, id)).get();
      if (!exists) return c.json({ error: "not_found" }, 404);
      await db.update(restaurantDetails).set(c.req.valid("json")).where(eq(restaurantDetails.itemId, id));
      return c.json(await getItem(db, c.var.user.id, id));
    },
  );
