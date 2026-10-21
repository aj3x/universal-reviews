/**
 * TMDB API v3 (free for non-commercial use; attribution required). Two calls:
 *  - search/movie for the picker
 *  - movie/{id}?append_to_response=credits for runtime and director
 * The API key (v3 key, sent as a query param) stays on the server.
 */

export type MovieSuggestion = { tmdbId: number; title: string; year: number | null };
export type MovieDetails = MovieSuggestion & { runtime: number | null; director: string | null };

export interface TmdbClient {
  search(query: string): Promise<MovieSuggestion[]>;
  details(tmdbId: number): Promise<MovieDetails>;
}

import { UpstreamError, upstreamFetch } from "./upstream.ts";

const BASE = "https://api.themoviedb.org/3";
const yearOf = (date?: string | null) => {
  const y = Number(date?.slice(0, 4));
  return Number.isInteger(y) && y > 0 ? y : null;
};

export function createTmdbClient(apiKey: string, fetchImpl: typeof fetch = fetch): TmdbClient {
  const get = async (path: string, params: Record<string, string>) => {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set("api_key", apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await upstreamFetch("tmdb", fetchImpl, url);
    if (!res.ok) throw new UpstreamError("tmdb", `${path} failed: ${res.status}`);
    return res.json();
  };

  return {
    async search(query) {
      const json = (await get("/search/movie", { query, include_adult: "false" })) as {
        results?: Array<{ id: number; title: string; release_date?: string }>;
      };
      return (json.results ?? []).slice(0, 10).map((m) => ({ tmdbId: m.id, title: m.title, year: yearOf(m.release_date) }));
    },

    async details(tmdbId) {
      const json = (await get(`/movie/${tmdbId}`, { append_to_response: "credits" })) as {
        id: number; title: string; release_date?: string; runtime?: number | null;
        credits?: { crew?: Array<{ job: string; name: string }> };
      };
      return {
        tmdbId: json.id,
        title: json.title,
        year: yearOf(json.release_date),
        runtime: json.runtime || null,
        director: json.credits?.crew?.find((c) => c.job === "Director")?.name ?? null,
      };
    },
  };
}
