import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { readSessionCookie, validateSession } from "./auth/session.js";
import type { AppDeps, AppEnv } from "./context.js";
import { authRoutes } from "./routes/auth.js";
import { itemRoutes } from "./routes/items.js";
import { moviesRoutes, placesRoutes } from "./routes/search.js";
import { listRoutes } from "./routes/lists.js";
import { feedRoutes, reviewModelRoutes, reviewRoutes } from "./routes/reviews.js";
import { meRoutes, userRoutes } from "./routes/users.js";

/**
 * Runtime-neutral app: no Node APIs in here or in the routes, so a Workers
 * entry file can build it with a D1-backed Drizzle db later.
 */
export function createApp(deps: AppDeps, opts: { log?: boolean } = {}) {
  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const token = readSessionCookie(c) ?? c.req.header("authorization")?.replace(/^Bearer /, "");
    const user = token ? await validateSession(c.var.deps.db, token) : null;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  });

  const api = new Hono<AppEnv>()
    .route("/auth", authRoutes)
    .route("/review-model", reviewModelRoutes)
    .use("/me/*", requireUser).use("/me", requireUser)
    .use("/users/*", requireUser)
    .use("/items/*", requireUser).use("/items", requireUser)
    .use("/places/*", requireUser)
    .use("/movies/*", requireUser)
    .use("/reviews/*", requireUser).use("/reviews", requireUser)
    .use("/feed", requireUser)
    .use("/lists/*", requireUser).use("/lists", requireUser)
    .route("/me", meRoutes)
    .route("/users", userRoutes)
    .route("/items", itemRoutes)
    .route("/places", placesRoutes)
    .route("/movies", moviesRoutes)
    .route("/reviews", reviewRoutes)
    .route("/feed", feedRoutes)
    .route("/lists", listRoutes);

  const app = new Hono<AppEnv>();
  if (opts.log) app.use(logger());
  app.use(secureHeaders());
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, service: "node" }));
  app.route("/api/v1", api);
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}

export type App = ReturnType<typeof createApp>;
