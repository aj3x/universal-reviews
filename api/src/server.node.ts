/** Node entry point. Everything Node-specific lives here; a Workers entry would swap these lines for D1/R2 bindings. */
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { purgeExpiredSessions } from "./auth/session.ts";
import { createGoogleAuth } from "./auth/google.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/client.ts";
import { createPlacesClient } from "./sources/places.ts";
import { createTmdbClient } from "./sources/tmdb.ts";

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

const { db, sqlite } = openDatabase(config.databasePath);

const google =
  config.googleClientId && config.googleClientSecret
    ? createGoogleAuth(config.googleClientId, config.googleClientSecret, `${config.publicUrl}/api/v1/auth/google/callback`)
    : undefined;

const app = createApp(
  {
    db,
    google,
    places: config.placesApiKey ? createPlacesClient(config.placesApiKey) : undefined,
    tmdb: config.tmdbApiKey ? createTmdbClient(config.tmdbApiKey) : undefined,
    allowedEmails: config.allowedEmails,
    devLogin: config.devLogin,
    secureCookies: config.secureCookies,
    appUrl: config.appUrl,
    allowedOrigins: [new URL(config.publicUrl).origin, new URL(config.appUrl).origin],
  },
  { log: true },
);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`node api listening on :${info.port}`);
  if (!google) console.warn("GOOGLE_CLIENT_ID/SECRET not set: Google sign-in is off");
});

// Expired sessions are only deleted when someone presents them, so sweep the rest now and daily.
const sweep = () => purgeExpiredSessions(db).catch((e) => console.error("session sweep failed", e));
void sweep();
const sweeper = setInterval(sweep, 24 * 60 * 60 * 1000);
sweeper.unref();

const shutdown = () => server.close(() => { sqlite.pragma("optimize"); sqlite.close(); process.exit(0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
