import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { items, reviews } from "../db/schema.js";
import { newId } from "../lib/ids.js";
import { feed, getReview, pageLimit } from "../lib/queries.js";
import {
  ENABLED_KINDS, ITEM_KINDS, PROMPTS, RECOMMEND_TO, REVISIT, SCALE_HELP, SCORE_FIELDS, SCORE_MAX, SCORE_MIN,
  type ItemKind,
} from "../review-model.js";

const score = z.number().int().min(SCORE_MIN).max(SCORE_MAX);

const reviewFields = {
  experiencedOn: z.iso.date().nullish(),
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

    const id = newId();
    await db.insert(reviews).values({
      id,
      userId: c.var.user.id,
      itemId: input.itemId,
      experiencedOn: input.experiencedOn ?? null,
      ...input.scores,
      revisit: input.revisit,
      recommendTo: input.recommendTo,
      notes: input.notes || null,
    });
    return c.json(await getReview(db, c.var.user.id, id), 201);
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
    return c.json(await getReview(db, c.var.user.id, id));
  })

  .delete("/:id", async (c) => {
    const { db } = c.var.deps;
    const own = and(eq(reviews.id, c.req.param("id")), eq(reviews.userId, c.var.user.id));
    const existing = await db.select({ id: reviews.id }).from(reviews).where(own).get();
    if (!existing) return c.json({ error: "not_found" }, 404);
    await db.delete(reviews).where(own);
    return c.body(null, 204);
  });

export const feedRoutes = new Hono<AppEnv>().get("/", async (c) =>
  c.json(await feed(c.var.deps.db, c.var.user.id, c.req.query("cursor"), pageLimit(c.req.query("limit")))),
);

/** The question set and per-kind wording, so the PWA never hard-codes it. Public. */
export const reviewModelRoutes = new Hono<AppEnv>().get("/", (c) => {
  const kind = c.req.query("kind") as ItemKind | undefined;
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
