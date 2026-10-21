# Repository structure

Rules this layout follows, in order of priority:

1. **Find things by what they do, not by what they are.** A new contributor looking for
   "how does a movie get added" should land in one or two places, not seven.
2. **One reason to change per file.** Split a file when it holds two unrelated jobs, not
   because it is long.
3. **The boundary that matters is the contract, not the language.** Node owns writes and the
   schema; Rust and the web app only read what the API contract (`docs/api.md`) says.
4. **No structure ahead of need.** No shared packages, workspaces or monorepo tooling until
   two consumers actually share code.

## Top level

```
api/       Node API. Owns the schema, migrations and every write.
rust/      Optional read service. Same SQL, same JSON as the Node reads.
web/       Frontend (Vite + React + TypeScript). Talks to /api/v1 only.
docs/      Decisions and contracts: api.md, review-model.md, structure.md.
ops/       Deployment config (Litestream, Cloudflare Tunnel).
scripts/   Cross-service checks (parity.sh).
```

Each of `api/` and `web/` is its own npm project with its own lockfile. They do not share
code. The frontend's types in `web/src/lib/api.ts` mirror `docs/api.md`; if they ever drift
enough to hurt, generate them from the API, not from a shared package.

## api/

```
src/
  app.ts, context.ts, server.node.ts   Wiring. Runtime-neutral except server.node.ts.
  config.ts                            Validates the environment once at startup; fails fast.
  review-model.ts                      The six questions, kinds, and per-kind wording.
  db/                                  Schema, client, migrations runner.
  auth/                                Sessions and Google OIDC.
  routes/                              HTTP only: parse, call, shape the response.
  lib/                                 Plain SQL read paths (queries.ts), ids, dates, validation,
                                       rate-limit middleware.
  sources/                             External catalogues: places.ts (Google), tmdb.ts;
                                       upstream.ts (timeout + UpstreamError, mapped to 502).
drizzle/                               Generated migrations. Edit only to add data steps drizzle
                                       cannot generate (see 0002, 0003), and test them on old rows.
scripts/                               seed.ts, parity.ts.
test/                                  Integration tests over the in-memory app.
```

- `sources/` holds one file per external catalogue, each exposing an interface that
  `AppDeps` injects. Tests fake the interface; production wires the real client in
  `server.node.ts`. A new medium's catalogue (Open Library for books) goes here.
- `routes/search.ts` holds the read-only catalogue lookups (`/places`, `/movies`), kept
  apart from `routes/items.ts`, which owns items stored in our database.

## web/

```
src/
  main.tsx, App.tsx, styles.css   Entry, shell + routing, tokens and components.
  lib/                            api.ts (client + types), usePaged.ts, route.ts.
  features/
    auth/      Login
    feed/      Feed, ReviewList, ReviewCard (also used by account and item)
    item/      ItemView
    review/    NewReview (pick an item, then answer the questions)
    account/   Mine
```

- A **feature** folder owns its screens and anything only it uses. Move code to `lib/` only
  when a second feature needs it.
- Per-kind behaviour (which catalogue to search, which details to show) lives in the review
  and item features and is driven by the `kind` and `/review-model`, so a new medium adds a
  branch in the picker rather than a new screen.
- Styling is one `styles.css` with tokens at the top. Split it only when it stops being
  readable in one sitting.

## Adding a kind (movies and books are the template)

1. `api/src/review-model.ts`: add to `ENABLED_KINDS`.
2. `api/src/db/schema.ts` + `npm run db:generate`: `<kind>_details` table.
3. `api/src/sources/<catalogue>.ts`, `AppDeps`, `server.node.ts`: external lookup.
4. `api/src/routes/search.ts` and `items.ts`: search and from-catalogue endpoints.
5. `api/src/lib/queries.ts` and `rust/src/main.rs`: details in `getItem`; run `scripts/parity.sh`.
6. `web/src/features/review/`: a branch in the item picker; `features/item/` for details.
7. `docs/api.md`, `docs/review-model.md`.

## CI

`api` (typecheck, tests, migration check), `rust` (clippy, build), `web` (typecheck, build),
then `parity` once `api` and `rust` pass.
