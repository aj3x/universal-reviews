import { Hono, type MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { readSessionCookie, validateSession } from "./auth/session.ts";
import type { AppDeps, AppEnv } from "./context.ts";
import { rateLimit, type Limit } from "./lib/rate-limit.ts";
import { authRoutes } from "./routes/auth.ts";
import { itemRoutes } from "./routes/items.ts";
import { moviesRoutes, placesRoutes } from "./routes/search.ts";
import { listRoutes } from "./routes/lists.ts";
import { feedRoutes, reviewModelRoutes, reviewRoutes } from "./routes/reviews.ts";
import { meRoutes, userRoutes } from "./routes/users.ts";
import { UpstreamError } from "./sources/upstream.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_LIMITS = {
  /** Google Places / TMDB proxies: they spend a quota that belongs to the whole deployment. */
  external: { max: 120, windowMs: 60_000 },
  writes: { max: 120, windowMs: 60_000 },
};

type Guards = {
  requireUser: MiddlewareHandler<AppEnv>;
  externalLimit: MiddlewareHandler<AppEnv>;
  limitWrites: MiddlewareHandler<AppEnv>;
};

/**
 * The whole /api/v1 route tree, in its own function so `ApiType` carries every route's request
 * and response types to the web app's typed client (`hc<ApiType>`). Keep it one chain of
 * `.get()/.post()/.route()` calls: a statement that is not chained drops out of the type.
 */
function buildApi({ requireUser, externalLimit, limitWrites }: Guards) {
  return new Hono<AppEnv>()
    .route("/auth", authRoutes)
    .route("/review-model", reviewModelRoutes)
    .use("/me/*", requireUser)
    .use("/users/*", requireUser)
    .use("/items/*", requireUser)
    .use("/places/*", requireUser, externalLimit)
    .use("/movies/*", requireUser, externalLimit)
    .use("/reviews/*", requireUser)
    .use("/feed", requireUser)
    .use("/lists/*", requireUser)
    .use("/me/*", limitWrites).use("/users/*", limitWrites).use("/items/*", limitWrites)
    .use("/reviews/*", limitWrites).use("/lists/*", limitWrites)
    .route("/me", meRoutes)
    .route("/users", userRoutes)
    .route("/items", itemRoutes)
    .route("/places", placesRoutes)
    .route("/movies", moviesRoutes)
    .route("/reviews", reviewRoutes)
    .route("/feed", feedRoutes)
    .route("/lists", listRoutes);
}

export type ApiType = ReturnType<typeof buildApi>;

/**
 * Runtime-neutral app: no Node APIs in here or in the routes, so a Workers
 * entry file can build it with a D1-backed Drizzle db later.
 */
export function createApp(deps: AppDeps, opts: { log?: boolean; limits?: { external?: Limit; writes?: Limit } } = {}) {
  const externalLimit = rateLimit(opts.limits?.external ?? DEFAULT_LIMITS.external);
  const writeLimit = rateLimit(opts.limits?.writes ?? DEFAULT_LIMITS.writes);
  const limitWrites = createMiddleware<AppEnv>((c, next) => (SAFE_METHODS.has(c.req.method) ? next() : writeLimit(c, next)));

  const requireUser = createMiddleware<AppEnv>(async (c, next) => {
    const token = readSessionCookie(c) ?? c.req.header("authorization")?.replace(/^Bearer /, "");
    const user = token ? await validateSession(c.var.deps.db, token) : null;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  });

  const api = buildApi({ requireUser, externalLimit, limitWrites });

  const app = new Hono<AppEnv>();
  if (opts.log) app.use(logger());
  app.use(secureHeaders());
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));
  // Defence in depth on top of SameSite=Lax: a state-changing request that names a foreign Origin is refused.
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (!SAFE_METHODS.has(c.req.method) && origin && origin !== new URL(c.req.url).origin && !deps.allowedOrigins?.includes(origin)) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    await next();
  });
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.get("/health", (c) => c.json({ ok: true, service: "node" }));
  app.route("/api/v1", api);
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    if (err instanceof UpstreamError) {
      console.warn(err.message);
      return c.json({ error: "upstream_unavailable", service: err.service }, 502);
    }
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}

export type App = ReturnType<typeof createApp>;
