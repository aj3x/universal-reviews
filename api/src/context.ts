import type { GoogleAuth } from "./auth/google.js";
import type { SessionUser } from "./auth/session.js";
import type { DB } from "./db/client.js";
import type { PlacesClient } from "./sources/places.js";
import type { TmdbClient } from "./sources/tmdb.js";

export type AppDeps = {
  db: DB;
  /** Google sign-in. Undefined when GOOGLE_CLIENT_ID is not configured. */
  google?: GoogleAuth;
  /** Google Places. Undefined when GOOGLE_PLACES_API_KEY is not configured. */
  places?: PlacesClient;
  /** TMDB movie search. Undefined when TMDB_API_KEY is not configured. */
  tmdb?: TmdbClient;
  /** Lowercased emails allowed to sign up. Empty = anyone with a Google account. */
  allowedEmails: Set<string>;
  /** POST /auth/dev-login, for local work without Google. Never on in production. */
  devLogin: boolean;
  secureCookies: boolean;
  /** Where to send the browser after sign-in. */
  appUrl: string;
};

export type AppEnv = {
  Variables: {
    deps: AppDeps;
    user: SessionUser;
  };
};
