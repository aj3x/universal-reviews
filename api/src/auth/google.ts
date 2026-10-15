import { decodeIdToken, generateCodeVerifier, generateState, Google } from "arctic";

export type GoogleProfile = { sub: string; email: string; name: string; picture?: string };

/** The slice of Google sign-in the app uses; tests swap in a fake. */
export interface GoogleAuth {
  start(): { url: URL; state: string; codeVerifier: string };
  finish(code: string, codeVerifier: string): Promise<GoogleProfile>;
}

export function createGoogleAuth(clientId: string, clientSecret: string, redirectUri: string): GoogleAuth {
  const google = new Google(clientId, clientSecret, redirectUri);
  return {
    start() {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);
      url.searchParams.set("prompt", "select_account");
      return { url, state, codeVerifier };
    },
    async finish(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
      if (typeof claims.sub !== "string" || typeof claims.email !== "string") {
        throw new Error("Google ID token is missing sub or email");
      }
      if (claims.email_verified === false) throw new Error("Google email is not verified");
      return {
        sub: claims.sub,
        email: claims.email,
        name: typeof claims.name === "string" ? claims.name : claims.email,
        picture: typeof claims.picture === "string" ? claims.picture : undefined,
      };
    },
  };
}
