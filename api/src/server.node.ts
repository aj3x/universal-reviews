/** Node entry point. Everything Node-specific lives here; a Workers entry would swap these lines for D1/R2 bindings. */
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createGoogleAuth } from "./auth/google.js";
import { openDatabase } from "./db/client.js";
import { createPlacesClient } from "./sources/places.js";
import { createTmdbClient } from "./sources/tmdb.js";

const env = process.env;
const production = env.NODE_ENV === "production";
const port = Number(env.PORT ?? 8080);
const publicUrl = env.PUBLIC_URL ?? `http://localhost:${port}`;

const { db, sqlite } = openDatabase(env.DATABASE_PATH ?? "./data/rating.db");

const google =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? createGoogleAuth(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, `${publicUrl}/api/v1/auth/google/callback`)
    : undefined;

const app = createApp(
  {
    db,
    google,
    places: env.GOOGLE_PLACES_API_KEY ? createPlacesClient(env.GOOGLE_PLACES_API_KEY) : undefined,
    tmdb: env.TMDB_API_KEY ? createTmdbClient(env.TMDB_API_KEY) : undefined,
    allowedEmails: new Set(
      (env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    ),
    devLogin: !production && env.DEV_LOGIN === "1",
    secureCookies: publicUrl.startsWith("https://"),
    appUrl: env.APP_URL ?? publicUrl,
  },
  { log: true },
);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`node api listening on :${info.port}`);
  if (!google) console.warn("GOOGLE_CLIENT_ID/SECRET not set: Google sign-in is off");
});

const shutdown = () => server.close(() => { sqlite.close(); process.exit(0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
