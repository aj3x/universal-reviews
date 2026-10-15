import { zValidator } from "@hono/zod-validator";
import { and, eq, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { follows, users } from "../db/schema.js";
import { listUserReviews, pageLimit } from "../lib/queries.js";

const publicUser = { id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl, isPrivate: users.isPrivate };

export const meRoutes = new Hono<AppEnv>()
  .get("/", (c) => {
    const u = c.var.user;
    return c.json({ id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, isPrivate: u.isPrivate });
  })

  .patch(
    "/",
    zValidator("json", z.object({ displayName: z.string().trim().min(1).max(60).optional(), isPrivate: z.boolean().optional() })),
    async (c) => {
      const patch = c.req.valid("json");
      const { db } = c.var.deps;
      await db.update(users).set(patch).where(eq(users.id, c.var.user.id));
      // Going public: approve anyone who was waiting.
      if (patch.isPrivate === false) {
        await db.update(follows).set({ status: "accepted" }).where(eq(follows.followeeId, c.var.user.id));
      }
      return c.body(null, 204);
    },
  )

  .get("/reviews", async (c) => {
    const me = c.var.user.id;
    return c.json(await listUserReviews(c.var.deps.db, me, me, c.req.query("cursor"), pageLimit(c.req.query("limit"))));
  })

  .get("/followers", async (c) => {
    const rows = await c.var.deps.db
      .select(publicUser).from(follows).innerJoin(users, eq(users.id, follows.followerId))
      .where(and(eq(follows.followeeId, c.var.user.id), eq(follows.status, "accepted")));
    return c.json({ data: rows });
  })

  .get("/following", async (c) => {
    const rows = await c.var.deps.db
      .select({ ...publicUser, status: follows.status }).from(follows).innerJoin(users, eq(users.id, follows.followeeId))
      .where(eq(follows.followerId, c.var.user.id));
    return c.json({ data: rows });
  })

  .get("/follow-requests", async (c) => {
    const rows = await c.var.deps.db
      .select(publicUser).from(follows).innerJoin(users, eq(users.id, follows.followerId))
      .where(and(eq(follows.followeeId, c.var.user.id), eq(follows.status, "pending")));
    return c.json({ data: rows });
  })

  .post("/follow-requests/:userId/accept", async (c) => {
    await c.var.deps.db.update(follows).set({ status: "accepted" })
      .where(and(eq(follows.followeeId, c.var.user.id), eq(follows.followerId, c.req.param("userId"))));
    return c.body(null, 204);
  })

  .post("/follow-requests/:userId/decline", async (c) => {
    await c.var.deps.db.delete(follows).where(and(
      eq(follows.followeeId, c.var.user.id), eq(follows.followerId, c.req.param("userId")), eq(follows.status, "pending"),
    ));
    return c.body(null, 204);
  })

  .delete("/followers/:userId", async (c) => {
    await c.var.deps.db.delete(follows)
      .where(and(eq(follows.followeeId, c.var.user.id), eq(follows.followerId, c.req.param("userId"))));
    return c.body(null, 204);
  });

export const userRoutes = new Hono<AppEnv>()
  .get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return c.json({ data: [] });
    const pattern = `%${q.replace(/[%_]/g, "")}%`;
    const rows = await c.var.deps.db.select(publicUser).from(users)
      .where(or(like(users.displayName, pattern), eq(sql`lower(${users.email})`, q.toLowerCase())))
      .limit(20);
    return c.json({ data: rows });
  })

  .get("/:id", async (c) => {
    const { db } = c.var.deps;
    const id = c.req.param("id");
    const user = await db.select(publicUser).from(users).where(eq(users.id, id)).get();
    if (!user) return c.json({ error: "not_found" }, 404);
    const counts = await db.get<{ followers: number; following: number; reviews: number }>(sql`
      SELECT
        (SELECT COUNT(*) FROM follows WHERE followee_id = ${id} AND status = 'accepted') AS followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ${id} AND status = 'accepted') AS following,
        (SELECT COUNT(*) FROM reviews WHERE user_id = ${id}) AS reviews`);
    const mine = await db.select({ status: follows.status }).from(follows)
      .where(and(eq(follows.followerId, c.var.user.id), eq(follows.followeeId, id))).get();
    return c.json({ ...user, ...counts, followStatus: mine?.status ?? "none" });
  })

  .get("/:id/reviews", async (c) => {
    return c.json(await listUserReviews(
      c.var.deps.db, c.var.user.id, c.req.param("id"), c.req.query("cursor"), pageLimit(c.req.query("limit")),
    ));
  })

  .post("/:id/follow", async (c) => {
    const { db } = c.var.deps;
    const target = await db.select().from(users).where(eq(users.id, c.req.param("id"))).get();
    if (!target) return c.json({ error: "not_found" }, 404);
    if (target.id === c.var.user.id) return c.json({ error: "cannot_follow_self" }, 400);
    const status = target.isPrivate ? "pending" : "accepted";
    await db.insert(follows).values({ followerId: c.var.user.id, followeeId: target.id, status }).onConflictDoNothing();
    return c.json({ status });
  })

  .delete("/:id/follow", async (c) => {
    await c.var.deps.db.delete(follows)
      .where(and(eq(follows.followerId, c.var.user.id), eq(follows.followeeId, c.req.param("id"))));
    return c.body(null, 204);
  });
