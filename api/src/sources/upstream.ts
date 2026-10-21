/** An external catalogue (Google, TMDB) failed or timed out. Mapped to 502, not a 500 bug. */
export class UpstreamError extends Error {
  service: string;
  constructor(service: string, detail: string) {
    super(`${service}: ${detail}`);
    this.service = service;
  }
}

const TIMEOUT_MS = 5000;

/** fetch with a hard timeout; network failures and timeouts become UpstreamError. */
export async function upstreamFetch(service: string, fetchImpl: typeof fetch, input: string | URL, init: RequestInit = {}) {
  try {
    return await fetchImpl(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new UpstreamError(service, e instanceof Error ? e.message : "request failed");
  }
}
