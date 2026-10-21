import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { items, listItems, lists } from "../db/schema.js";
import { newId } from "../lib/ids.js";

const name = z.object({ name: z.string().trim().min(1).max(100) });

export const listRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await c.var.deps.db.select().from(lists)
      .where(eq(lists.ownerId, c.var.user.id)).orderBy(desc(lists.id));
    return c.json({ data: rows });
  })

  .post("/", zValidator("json", name), async (c) => {
    const id = newId();
    await c.var.deps.db.insert(lists).values({ id, ownerId: c.var.user.id, name: c.req.valid("json").name });
    return c.json({ id, name: c.req.valid("json").name }, 201);
  })

  .get("/:id", async (c) => {
    const { db } = c.var.deps;
    const list = await db.select().from(lists)
      .where(and(eq(lists.id, c.req.param("id")), eq(lists.ownerId, c.var.user.id))).get();
    if (!list) return c.json({ error: "not_found" }, 404);
    const entries = await db
      .select({ id: items.id, kind: items.kind, title: items.title, note: listItems.note, addedAt: listItems.addedAt })
      .from(listItems).innerJoin(items, eq(items.id, listItems.itemId))
      .where(eq(listItems.listId, list.id)).orderBy(desc(listItems.addedAt));
    return c.json({ ...list, items: entries });
  })

  .patch("/:id", zValidator("json", name), async (c) => {
    const own = and(eq(lists.id, c.req.param("id")), eq(lists.ownerId, c.var.user.id));
    const res = await c.var.deps.db.update(lists).set({ name: c.req.valid("json").name }).where(own).returning({ id: lists.id });
    return res.length ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
  })

  .delete("/:id", async (c) => {
    const own = and(eq(lists.id, c.req.param("id")), eq(lists.ownerId, c.var.user.id));
    const res = await c.var.deps.db.delete(lists).where(own).returning({ id: lists.id });
    return res.length ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
  })

  .post(
    "/:id/items",
    zValidator("json", z.object({ itemId: z.string().min(1), note: z.string().trim().max(500).optional() })),
    async (c) => {
      const { db } = c.var.deps;
      const list = await db.select({ id: lists.id }).from(lists)
        .where(and(eq(lists.id, c.req.param("id")), eq(lists.ownerId, c.var.user.id))).get();
      if (!list) return c.json({ error: "not_found" }, 404);
      const { itemId, note } = c.req.valid("json");
      const item = await db.select({ id: items.id }).from(items).where(eq(items.id, itemId)).get();
      if (!item) return c.json({ error: "item_not_found" }, 404);
      await db.insert(listItems).values({ listId: list.id, itemId, note: note ?? null }).onConflictDoNothing();
      return c.body(null, 204);
    },
  )

  .delete("/:id/items/:itemId", async (c) => {
    const { db } = c.var.deps;
    const list = await db.select({ id: lists.id }).from(lists)
      .where(and(eq(lists.id, c.req.param("id")), eq(lists.ownerId, c.var.user.id))).get();
    if (!list) return c.json({ error: "not_found" }, 404);
    await db.delete(listItems).where(and(eq(listItems.listId, list.id), eq(listItems.itemId, c.req.param("itemId"))));
    return c.body(null, 204);
  });
