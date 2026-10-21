import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.ts";
import { items, reviews, visits } from "../db/schema.ts";
import { latest, today } from "../lib/dates.ts";
import { newId } from "../lib/ids.ts";
import { pageQuery, visitDate } from "../lib/validation.ts";
import { feed, getReview, pageLimit } from "../lib/queries.ts";
import {
  ENABLED_KINDS, ITEM_KINDS, PROMPTS, RECOMMEND_TO, REVISIT, SCALE_HELP, SCORE_FIELDS, SCORE_MAX, SCORE_MIN,
  type ItemKind,
} from "../review-model.ts";

const score = z.number().int().min(SCORE_MIN).max(SCORE_MAX);

const reviewFields = {
  experiencedOn: visitDate.nullish(),
  scores: z.object({ enjoyment: score, impact: score, value: score, aesthetic: score }),
  revisit: z.enum(REVISIT),
  recommendTo: z.enum(RECOMMEND_TO),
  notes: z.string().trim().max(5000).nullish(), // optional today; flip to required here when ready
};

const createReview = z.object({ itemId: z.string().min(1), ...reviewFields });
const updateReview = z.object(reviewFields).partial();

export const reviewRoutes = new Hono<AppEnv>()
  .post("/", zValidator("json", createReview), async (c) => {
    const input = c.req.valid("json");
    const { db } = c.var.deps;
    const item = await db.select({ kind: items.kind }).from(items).where(eq(items.id, input.itemId)).get();
    if (!item) return c.json({ error: "item_not_found" }, 404);
    if (!ENABLED_KINDS.includes(item.kind)) return c.json({ error: "kind_not_enabled", kind: item.kind }, 400);

    // One review per person per item: saving again updates it and logs another visit.
    const visitedOn = input.experiencedOn ?? today();
    const fields = {
      ...input.scores,
      revisit: input.revisit,
      recommendTo: input.recommendTo,
      notes: input.notes || null,
    };
    const before = await db.select({ id: reviews.id, experiencedOn: reviews.experiencedOn }).from(reviews)
      .where(and(eq(reviews.userId, c.var.user.id), eq(reviews.itemId, input.itemId))).get();
    // One statement, so two quick taps can't race into a unique-index error.
    await db.insert(reviews).values({ id: newId(), userId: c.var.user.id, itemId: input.itemId, experiencedOn: visitedOn, ...fields })
      .onConflictDoUpdate({
        target: [reviews.userId, reviews.itemId],
        set: {
          ...fields,
          experiencedOn: latest(before?.experiencedOn, visitedOn),
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        },
      });
    const saved = await db.select({ id: reviews.id }).from(reviews)
      .where(and(eq(reviews.userId, c.var.user.id), eq(reviews.itemId, input.itemId))).get();
    const id = saved!.id;
    await db.insert(visits).values({
      id: newId(), reviewId: id, visitedOn, ...input.scores,
      revisit: input.revisit, recommendTo: input.recommendTo, note: input.notes || null,
    });
    return c.json((await getReview(db, c.var.user.id, id))!, before ? 200 : 201);
  })

  .get("/:id", async (c) => {
    const review = await getReview(c.var.deps.db, c.var.user.id, c.req.param("id"));
    return review ? c.json(review) : c.json({ error: "not_found" }, 404);
  })

  .patch("/:id", zValidator("json", updateReview), async (c) => {
    const { db } = c.var.deps;
    const id = c.req.param("id");
    const own = and(eq(reviews.id, id), eq(reviews.userId, c.var.user.id));
    const existing = await db.select({ id: reviews.id }).from(reviews).where(own).get();
    if (!existing) return c.json({ error: "not_found" }, 404);
    const { scores, notes, ...rest } = c.req.valid("json");
    await db.update(reviews).set({
      ...rest,
      ...scores,
      ...(notes !== undefined ? { notes: notes || null } : {}),
      updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    }).where(own);
    return c.json((await getReview(db, c.var.user.id, id))!);
  })

  .delete("/:id", async (c) => {
    const { db } = c.var.deps;
    const own = and(eq(reviews.id, c.req.param("id")), eq(reviews.userId, c.var.user.id));
    const existing = await db.select({ id: reviews.id }).from(reviews).where(own).get();
    if (!existing) return c.json({ error: "not_found" }, 404);
    await db.delete(reviews).where(own);
    return c.body(null, 204);
  });

export const feedRoutes = new Hono<AppEnv>().get("/", zValidator("query", pageQuery), async (c) => {
  const { cursor, limit } = c.req.valid("query");
  return c.json(await feed(c.var.deps.db, c.var.user.id, cursor, pageLimit(limit)));
});

/** The question set and per-kind wording, so the PWA never hard-codes it. Public. */
export const reviewModelRoutes = new Hono<AppEnv>().get("/", zValidator("query", z.object({ kind: z.string().optional() })), (c) => {
  const kind = c.req.valid("query").kind as ItemKind | undefined;
  const kinds = kind && (ITEM_KINDS as readonly string[]).includes(kind) ? [kind] : ITEM_KINDS;
  return c.json({
    scale: { min: SCORE_MIN, max: SCORE_MAX, help: SCALE_HELP },
    scoreFields: SCORE_FIELDS,
    revisit: REVISIT,
    recommendTo: RECOMMEND_TO,
    enabledKinds: ENABLED_KINDS,
    prompts: Object.fromEntries(kinds.map((k) => [k, PROMPTS[k]])),
  });
});
