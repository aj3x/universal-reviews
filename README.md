# Custom Rating

A universal personal rating system: restaurants and movies today, built so books can join
later on the same six questions. Small, cheap, self-hosted; portable to Cloudflare Workers.

```
api/      Node.js API — Hono + Drizzle + SQLite. Owns the schema, migrations and all writes.
rust/     Optional Rust read service (Axum + rusqlite) for the busiest read endpoints.
docs/     review-model.md (the question set, SQL design, adding media) · api.md (endpoints)
ops/      Litestream and Cloudflare Tunnel config
scripts/  parity.sh — proves Node and Rust return identical JSON, and times them
```

## The review

Every review answers the same six questions; only the wording changes per medium.

| | Question | Answer |
| --- | --- | --- |
| Enjoyment | Did you like it? | 1–10 |
| Impact | Did it stay with you? | 1–10 |
| Value | Was it worth it? | 1–10 |
| Aesthetic | Did the look and feel click? | 1–10 |
| Revisit | | once · a few times · regularly · forever |
| Recommend to | | everyone · most · specific people · nobody |

**1 is the worst of all time, 5 is average, 10 is the best of all time.** Notes are
optional for now. Details and the design reasoning: [docs/review-model.md](docs/review-model.md).

## Run it locally

Needs Node 22+.

```bash
cd api
npm install
npm test                         # in-memory SQLite, fake Places and TMDB
npm run seed                     # sample data in ./data/rating.db; prints a session token
DEV_LOGIN=1 npm run dev          # http://localhost:8080
```

Try it with the printed token:

```bash
curl -H "Authorization: Bearer $TOKEN" localhost:8080/api/v1/feed
```

Or sign in without Google while developing:

```bash
curl -c jar -X POST localhost:8080/api/v1/auth/dev-login \
  -H 'content-type: application/json' -d '{"email":"me@example.com"}'
curl -b jar localhost:8080/api/v1/me
```

## Google setup

1. Google Cloud project → **OAuth consent screen** (External, your email as a test user is fine).
2. **Credentials → OAuth client ID (Web)**, redirect URI `$PUBLIC_URL/api/v1/auth/google/callback`.
3. Enable **Places API (New)**, create an API key restricted to it, then in **Quotas** cap
   Autocomplete and Place Details at the free monthly amounts and add a $1 budget alert.
4. Movies: create a free TMDB account, copy the v3 API key into `TMDB_API_KEY`. Without it, movie search returns `tmdb_not_configured` and movies can still be added by hand.
5. Copy `.env.example` to `.env` and fill in the IDs and key.

Anyone with a Google account can sign up. To make it invite-only, list emails in
`ALLOWED_EMAILS`. Accounts are public by default; users can go private in `PATCH /me`.

## Deploy on your own hardware

```bash
cp .env.example .env                       # fill it in
docker compose up -d                       # Node API only
docker compose --profile backup --profile tunnel up -d   # + Litestream to R2 + Cloudflare Tunnel
```

## The Rust experiment

`rust/` serves three read endpoints — `GET /items/:id` (restaurant and movie details), `GET /items/:id/reviews`,
`GET /feed` — from the same SQLite file, read-only, with the same SQL as
`api/src/lib/queries.ts`. Node still does everything else, including all writes.

```bash
./scripts/parity.sh        # seeds a DB, runs both, diffs every response, times them
```

On a seeded database, Rust answered in roughly 0.6–1.0 ms at the median versus
1.3–2.0 ms for Node. Both are far below anything a person notices, so this is for
learning Rust, not a need.

It's opt-in and costs little to keep: `docker compose --profile rust up -d`, then route
those paths to it with [ops/cloudflared-ingress.example.yml](ops/cloudflared-ingress.example.yml).
Delete the `rust/` folder and the profile to drop it. If you change one of those queries in
Node, change it in Rust too; CI's parity job fails if they drift.

## Moving to Cloudflare Workers later

`api/src/app.ts` and the routes use no Node APIs. A Workers entry file would build the app
with `drizzle(env.DB)` (D1) instead of `openDatabase()`, and the same migrations in
`api/drizzle/` apply to D1. The Rust service would stay on a server or be dropped.
