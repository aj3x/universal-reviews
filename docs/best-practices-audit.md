# Best-practices audit

Reviewed 2026-10-21 across `api/`, `web/`, `rust/`, CI, Docker and ops. The project is in the
prototyping phase (see `CLAUDE.md`), so the bar was "what would hurt the first real users",
not "what would a mature product have".

**Status key:** ✅ fixed in this pass · 🟡 recommended, not done · ❓ needs your decision

## Already good (leave alone)

- Strict TypeScript with `noUncheckedIndexedAccess`; Rust built with `clippy -D warnings`.
- Sessions: random 32-byte tokens, only the SHA-256 is stored, `HttpOnly` + `SameSite=Lax`,
  sliding expiry. Google sign-in uses PKCE, state and nonce.
- Input validated with zod at every route; SQL is parameterised (Drizzle or bound `sql` params).
- SQLite set up properly: WAL, `foreign_keys=ON`, `busy_timeout`, CHECK constraints that
  mirror the enums, indexes that match the read paths.
- Privacy rule (`visible()`) lives in one place and the Rust service reuses the same SQL;
  `parity.sh` in CI proves they agree.
- Secrets stay on the server (Places and TMDB keys), `.env` is git-ignored, `npm audit`
  was clean on both projects.
- Mobile-first UI with 44px targets, `prefers-color-scheme`, focus rings, `prefers-reduced-motion`.

## Findings

### Security

| # | Finding | Why it matters | Status |
| --- | --- | --- | --- |
| S1 | No cross-site request check beyond `SameSite=Lax` | One misconfigured cookie setting away from CSRF on every write | ✅ Writes carrying a foreign `Origin` get 403. Own origin plus `PUBLIC_URL`/`APP_URL` are allowed. |
| S2 | No rate limiting; `/places` and `/movies` spend a quota shared by everyone | One signed-in user (or a bug in a retry loop) could exhaust the free Google tier | ✅ Per-user limits: 120/min on the catalogue proxies, 120/min on writes. Returns 429 with `Retry-After`. |
| S3 | No request body size limit | Large payloads are parsed fully into memory | ✅ 64 KB cap, 413 above it. |
| S4 | Outbound `fetch` to Google/TMDB had no timeout | A slow upstream ties up requests indefinitely | ✅ 5 s timeout via `upstreamFetch`. |
| S5 | Upstream failures surfaced as `500 internal_error` | Looks like our bug, pages whoever is on call | ✅ Now `502 upstream_unavailable` with the service name. |
| S6 | Expired sessions were only deleted when someone presented them | `sessions` grows forever | ✅ Swept at startup and daily. |
| S7 | Environment read ad hoc; a bad deploy (missing `PUBLIC_URL`, http in production) silently produced broken OAuth redirects and non-secure cookies | The failure shows up as "login is broken", far from the cause | ✅ `config.ts` validates once and refuses to start with a readable list of problems. Dev login can never be enabled in production. |
| S8 | `GET /users/search` matches by exact email, so any signed-in user can confirm whether an address has an account and get that user's id | Account enumeration | ❓ Fine for a friends-only invite list (`ALLOWED_EMAILS`). If sign-up opens up, search by display name only or require a mutual follow. |
| S9 | `GET /users/:id` returns `reviews`/`followers` counts even for private accounts | Leaks activity levels | ❓ Probably wanted ("they have 40 reviews, follow to see them"). Say if you want counts hidden. |
| S10 | Session cookie is named `sid`, not `__Host-sid` | `__Host-` stops subdomain cookie injection | 🟡 Needs HTTPS everywhere including local dev; do it when you deploy behind a real domain. |
| S11 | TMDB key is sent as a `?api_key=` query parameter | Query strings end up in proxy and error logs | 🟡 TMDB also accepts a Bearer read token; switch when convenient. Errors here never include the URL, so nothing leaks today. |
| S12 | No Content-Security-Policy for the web app | Defence in depth against XSS (React already escapes output) | 🟡 Set at the static host (for example Cloudflare Pages `_headers`) once the deployment target is chosen; the API's own `secureHeaders()` is already on. |

### Correctness

| # | Finding | Status |
| --- | --- | --- |
| C1 | `PATCH /me` with `{}` crashed with a 500 (Drizzle rejects an empty `SET`) | ✅ No-op 204, with a test. |
| C2 | `PATCH`/`DELETE /lists/:id` returned 204 for lists that do not exist or are not yours | ✅ 404, with tests. |
| C3 | Double-tapping "Save review" could race two inserts into the new unique index and 500 | ✅ Review save is a single `INSERT … ON CONFLICT DO UPDATE`, with a concurrency test. |
| C4 | Visit dates in the future were accepted | ✅ Rejected (one day of slack for time zones), on both review save and "went again". |
| C5 | Multi-statement writes are not atomic (review + visit; item + details rows). A crash between statements leaves a review with no visit, or an item with no details | 🟡 Accepted for now. `better-sqlite3` transactions are synchronous and D1 has no transactions, so the clean fix depends on which runtime wins. Decide before adding dishes (more child rows). |
| C6 | `PATCH /reviews/:id` edits the review but not the matching visit snapshot, so history and current opinion can diverge | 🟡 Either drop `PATCH` in favour of `POST /reviews`, or have it update the latest visit. |

### Web

| # | Finding | Status |
| --- | --- | --- |
| W1 | A session that expires mid-use left every screen showing "couldn't load" | ✅ Any 401 returns to the sign-in screen. |
| W2 | Search results from a slower, older request could overwrite newer ones | ✅ Stale responses are ignored. |
| W3 | Changing pages kept the previous list on screen until the new one arrived, and a slow old response could replace the new list | ✅ `usePaged` resets and ignores stale responses. |
| W4 | No skip link, `main` not focusable on navigation, search results not announced | ✅ Skip link, focusable `main`, polite live region with the match count. |
| W5 | README calls it a PWA but there was no manifest or icon | ✅ Manifest, SVG icon, theme colour. No service worker yet, so it is installable but not offline. |
| W6 | No web tests at all | ✅ Vitest wired into CI with tests for the formatting helpers. 🟡 Component tests (the review form's dirty/clean logic is the best candidate) need `@testing-library/react`. |
| W7 | `noUnusedLocals`/`noUnusedParameters` were off | ✅ On; nothing needed fixing. |
| W8 | API types in `web/src/lib/api.ts` were hand-copied from the server and had already needed manual edits twice | ✅ The web app uses Hono's typed client; every request and response type is derived from the routes. Doing it exposed loose server types (`kind: string`), now typed as the real unions. No server code reaches the bundle. |
| W9 | Hash routing and no per-route `document.title` | 🟡 Cosmetic; set the title per route when it starts to matter for history/bookmarks. |

### Delivery, CI and ops

| # | Finding | Status |
| --- | --- | --- |
| D1 | CI workflow had default (write) token permissions, no timeouts, no cancellation of superseded runs | ✅ `permissions: contents: read`, per-job timeouts, concurrency group. |
| D2 | CI did not run web tests, `cargo fmt`, or dependency audits | ✅ Added (`npm audit --audit-level=high` for both projects). Rust is now formatted. |
| D3 | Node version hard-coded in three places | ✅ `.nvmrc` is the single source. |
| D4 | No automated dependency updates | ✅ Dependabot for npm, cargo, Docker and Actions, grouped weekly. |
| D5 | No `.dockerignore`; `rust/target` (large) and `node_modules` were sent as build context | ✅ Added for `api/` and `rust/`. |
| D6 | Compose started Rust, Litestream and cloudflared as soon as the API container existed, before the database did | ✅ They wait for the API's health check. |
| D7 | No `.editorconfig` | ✅ Added. |
| D8 | `cloudflared:latest` is unpinned | 🟡 Pin to a release tag so a tunnel upgrade is a deliberate change (Dependabot will then track it). |
| D9 | The API image ran TypeScript through `tsx` at runtime | ✅ `tsx` is gone. Node 22.18+ strips the types itself (`.ts` import extensions, `erasableSyntaxOnly`), so there is no build step and one fewer production dependency. |
| D13 | **The API Docker image did not build.** `npm ci` tried to compile `better-sqlite3` (the lockfile still marks it as having an install script) and the slim image has no Python or compiler | ✅ `npm ci --ignore-scripts` uses the prebuilt binaries bundled in the package. Both images now build and the API container answers its health check. |
| D14 | `parity.sh` only built the Rust binary when none existed, so a stale binary silently compared against old behaviour | ✅ It always rebuilds (incremental). |
| D10 | No linter or formatter for TypeScript | 🟡 Biome or ESLint plus Prettier. Check TypeScript 7 support first; the repo is on `typescript@7`. |
| D11 | No `LICENSE` | ❓ Your call. |
| D12 | Litestream restores are documented in a comment but never rehearsed | 🟡 Do one restore drill into a scratch directory before you rely on the backup. |

## What changed in this pass

API: `config.ts`, `lib/rate-limit.ts`, `lib/validation.ts`, `lib/dates.ts`, `sources/upstream.ts`;
`app.ts` (origin guard, body limit, limits, 502 mapping); `server.node.ts` (validated config,
session sweep); route fixes for C1–C4. Web: 401 handling, race fixes, accessibility, manifest,
tests. Repo: CI, Dependabot, `.nvmrc`, `.editorconfig`, `.dockerignore`s, compose, `.env.example`.
New tests are in `api/test/hardening.test.ts` and `web/src/lib/places.test.ts`.

## How this was checked

API: `tsc`, 50 tests. Web: `tsc` (stricter, including the API's source), 9 tests, production build, and a scan of the bundle for server code. Rust: `fmt`, `clippy`.
`scripts/parity.sh` (Node and Rust return identical JSON on a freshly seeded database),
`docker compose config`, a real boot of the server (health check, the origin guard, and
a refused production config), and a build and run of both Docker images.

**Not verified:** the GitHub Actions workflow itself (it has not run), and the web UI in a
browser. The accessibility and race fixes are by code reading and unit
logic, not a screen reader or a throttled network.
