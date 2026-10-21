/**
 * Typed client for the API. Every request and response type here is derived from the server's
 * routes (`ApiType`), so there is nothing to keep in sync by hand: change a route and the
 * compiler points at every screen that needs updating.
 *
 * Only types cross from `api/`; the `import type` lines are erased, so no server code reaches
 * the browser bundle.
 */
import { DetailedError, hc, parseResponse, type ClientResponse, type InferResponseType } from "hono/client";
import type { ApiType } from "../../../api/src/app.ts";
import type { ItemKind, ScoreField as ApiScoreField } from "../../../api/src/review-model.ts";

export const SESSION_EXPIRED = "session-expired";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** fetch, plus: a 401 anywhere but the initial "who am I?" check means the session ended. */
const apiFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (res.status === 401 && new URL(url, "http://localhost").pathname !== "/api/v1/me") dispatchEvent(new Event(SESSION_EXPIRED));
  return res;
};

export const client = hc<ApiType>("/api/v1", { fetch: apiFetch });

/**
 * Awaits a client call and returns its parsed success body (typed from the route's 2xx
 * responses). Any other status throws an ApiError carrying the server's `error` code.
 */
export async function call<R extends ClientResponse<any>>(res: R | Promise<R>) {
  try {
    return await parseResponse(res);
  } catch (e) {
    if (e instanceof DetailedError) {
      const body = e.detail?.data as { error?: string } | undefined;
      throw new ApiError(e.statusCode ?? 0, body?.error ?? "error");
    }
    throw e;
  }
}

type Ok<T extends (...args: never[]) => unknown> = InferResponseType<T, 200>;

export type Kind = ItemKind;
export type ScoreField = ApiScoreField;
export type Scores = Record<ScoreField, number>;

export type ReviewModel = Ok<(typeof client)["review-model"]["$get"]>;
export type Revisit = ReviewModel["revisit"][number];
export type RecommendTo = ReviewModel["recommendTo"][number];

export type Me = Ok<typeof client.me.$get>;
export type Page = Ok<typeof client.feed.$get>;
export type Review = Page["data"][number];
export type ItemDetail = Ok<(typeof client.items)[":id"]["$get"]>;
export type ItemRow = Ok<typeof client.items.$get>["data"][number];
export type MyReview = Ok<(typeof client.items)[":id"]["my-review"]["$get"]>;
export type MyReviewSummary = NonNullable<ItemRow["myReview"]>;
export type PlaceSuggestion = Ok<typeof client.places.autocomplete.$get>["data"][number];
export type MovieSuggestion = Ok<typeof client.movies.search.$get>["data"][number];

export const label = (s: string) => s.replace(/_/g, " ");
