import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../context.js";

export type Limit = { max: number; windowMs: number };

/**
 * Fixed-window counter per signed-in user, in memory. Fine for the single Node process
 * this runs as; a Workers deployment should swap it for a platform rate-limit binding.
 * Mount it after the auth middleware so there is a user to key on.
 */
export function rateLimit({ max, windowMs }: Limit, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return createMiddleware<AppEnv>(async (c, next) => {
    const t = now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    const key = c.var.user.id;
    let h = hits.get(key);
    if (!h || h.resetAt <= t) hits.set(key, (h = { count: 0, resetAt: t + windowMs }));
    if (++h.count > max) {
      c.header("Retry-After", String(Math.ceil((h.resetAt - t) / 1000)));
      return c.json({ error: "rate_limited" }, 429);
    }
    await next();
  });
}
