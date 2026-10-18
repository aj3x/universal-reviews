import * as client from "openid-client";

export type GoogleProfile = { sub: string; email: string; name: string; picture?: string };

/** Per-login values the callback must see again; kept in a short-lived cookie. */
export type OAuthLogin = { state: string; codeVerifier: string; nonce: string };

/** The slice of Google sign-in the app uses; tests swap in a fake. */
export interface GoogleAuth {
  start(): Promise<{ url: URL } & OAuthLogin>;
  /** `search` is the callback request's raw query string, including any error params. */
  finish(search: string, login: OAuthLogin): Promise<GoogleProfile>;
}

export function createGoogleAuth(clientId: string, clientSecret: string, redirectUri: string): GoogleAuth {
  let discovered: Promise<client.Configuration> | undefined;
  // Lazy so Google being unreachable at boot does not stop the server; a failed attempt is retried.
  const getConfig = () => {
    discovered ??= client
      .discovery(new URL("https://accounts.google.com"), clientId, clientSecret)
      .catch((err) => {
        discovered = undefined;
        throw err;
      });
    return discovered;
  };
  return {
    async start() {
      const config = await getConfig();
      const state = client.randomState();
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: "openid profile email",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
        nonce,
        prompt: "select_account",
      });
      return { url, state, codeVerifier, nonce };
    },
    async finish(search, { state, codeVerifier, nonce }) {
      const config = await getConfig();
      // The registered redirect URI plus Google's query: the request URL itself may be a proxy's internal one.
      const callbackUrl = new URL(redirectUri);
      callbackUrl.search = search;
      const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
        expectedNonce: nonce,
      });
      const claims = tokens.claims();
      if (!claims) {
        throw new Error("Google ID token is missing claims");
      }
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
