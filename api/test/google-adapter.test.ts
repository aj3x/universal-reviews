import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discovery: vi.fn(),
  authorizationCodeGrant: vi.fn(),
}));

vi.mock("openid-client", () => ({
  discovery: mocks.discovery,
  authorizationCodeGrant: mocks.authorizationCodeGrant,
  randomState: () => "state1",
  randomNonce: () => "nonce1",
  randomPKCECodeVerifier: () => "verifier1",
  calculatePKCECodeChallenge: async () => "challenge1",
  buildAuthorizationUrl: (_cfg: unknown, params: Record<string, string>) =>
    new URL(`https://accounts.google.com/auth?${new URLSearchParams(params)}`),
}));

import { createGoogleAuth } from "../src/auth/google.js";

const redirect = "https://app.example/api/v1/auth/google/callback";
const login = { state: "state1", codeVerifier: "verifier1", nonce: "nonce1" };

beforeEach(() => {
  mocks.discovery.mockReset().mockResolvedValue({});
  mocks.authorizationCodeGrant.mockReset();
});

describe("createGoogleAuth", () => {
  it("does not contact Google until first use", () => {
    createGoogleAuth("id", "secret", redirect);
    expect(mocks.discovery).not.toHaveBeenCalled();
  });

  it("builds a PKCE + nonce authorization URL and discovers once", async () => {
    const auth = createGoogleAuth("id", "secret", redirect);
    const a = await auth.start();
    await auth.start();
    expect(mocks.discovery).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject(login);
    const p = a.url.searchParams;
    expect(p.get("redirect_uri")).toBe(redirect);
    expect(p.get("code_challenge")).toBe("challenge1");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("nonce")).toBe("nonce1");
    expect(p.get("prompt")).toBe("select_account");
  });

  it("retries discovery after a failure", async () => {
    mocks.discovery.mockRejectedValueOnce(new Error("offline"));
    const auth = createGoogleAuth("id", "secret", redirect);
    await expect(auth.start()).rejects.toThrow("offline");
    await expect(auth.start()).resolves.toBeDefined();
    expect(mocks.discovery).toHaveBeenCalledTimes(2);
  });

  it("passes Google's whole query on the registered redirect URI and checks state/nonce/PKCE", async () => {
    mocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: "s1", email: "a@b.c", email_verified: true, name: "A", picture: "p" }),
    });
    const auth = createGoogleAuth("id", "secret", redirect);
    const profile = await auth.finish("?code=c1&state=state1&iss=google", login);
    expect(profile).toEqual({ sub: "s1", email: "a@b.c", name: "A", picture: "p" });
    const [, url, checks] = mocks.authorizationCodeGrant.mock.calls[0]!;
    expect(url.origin + url.pathname).toBe(redirect);
    expect(url.search).toBe("?code=c1&state=state1&iss=google");
    expect(checks).toEqual({ pkceCodeVerifier: "verifier1", expectedState: "state1", expectedNonce: "nonce1" });
  });

  it("rejects unverified emails and missing claims", async () => {
    const auth = createGoogleAuth("id", "secret", redirect);
    mocks.authorizationCodeGrant.mockResolvedValueOnce({
      claims: () => ({ sub: "s1", email: "a@b.c", email_verified: false }),
    });
    await expect(auth.finish("?code=c", login)).rejects.toThrow("not verified");
    mocks.authorizationCodeGrant.mockResolvedValueOnce({ claims: () => undefined });
    await expect(auth.finish("?code=c", login)).rejects.toThrow("missing claims");
  });
});
