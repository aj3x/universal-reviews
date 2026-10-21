import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, call, client, SESSION_EXPIRED } from "./api";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Stubs fetch and records what the client asked for. */
function stubFetch(respond: () => Response) {
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return respond();
  });
  return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe("typed client", () => {
  it("builds paths, params and query strings under /api/v1, skipping undefined values", async () => {
    const requests = stubFetch(() => json({ data: [], nextCursor: null }));
    await call(client.items[":id"].reviews.$get({ param: { id: "abc" }, query: { cursor: undefined, limit: "5" } }));
    expect(requests[0]!.url).toBe("/api/v1/items/abc/reviews?limit=5");
  });

  it("sends JSON bodies with a content type", async () => {
    const requests = stubFetch(() => json({ id: "1", kind: "restaurant", title: "X" }, 201));
    await call(client.items.$post({ json: { kind: "restaurant", title: "X" } }));
    expect(requests[0]!.init?.method).toBe("POST");
    expect(requests[0]!.init?.body).toBe(JSON.stringify({ kind: "restaurant", title: "X" }));
    expect(new Headers(requests[0]!.init?.headers).get("content-type")).toContain("application/json");
  });

  it("returns undefined for an empty 204", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(call(client.auth.logout.$post())).resolves.toBeUndefined();
  });
});

describe("call", () => {
  it("turns an error response into an ApiError with the server's code", async () => {
    stubFetch(() => json({ error: "kind_not_enabled", kind: "book" }, 400));
    const err = await call(client.items.$post({ json: { kind: "book", title: "X" } })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "kind_not_enabled" });
  });

  it("falls back to a generic code when the body has none", async () => {
    stubFetch(() => new Response("bad gateway", { status: 502 }));
    await expect(call(client.me.$get())).rejects.toMatchObject({ status: 502, code: "error" });
  });
});

describe("expired sessions", () => {
  it("announces a 401 from any endpoint except the initial /me check", async () => {
    const seen: string[] = [];
    vi.stubGlobal("dispatchEvent", (e: Event) => { seen.push(e.type); return true; });
    stubFetch(() => json({ error: "unauthorized" }, 401));

    await call(client.feed.$get({ query: {} })).catch(() => {});
    expect(seen).toEqual([SESSION_EXPIRED]);

    await call(client.me.$get()).catch(() => {});
    expect(seen).toEqual([SESSION_EXPIRED]); // unchanged: /me is how the app learns it is signed out
  });
});
