# API

JSON over HTTP under `/api/v1`. Sign in with Google; the session is an httpOnly `sid`
cookie (or `Authorization: Bearer <token>` for scripts). Lists are paginated with
`?cursor=<last id>&limit=<1–50>` and return `{ data, nextCursor }`.

**R** marks endpoints the Rust read service also serves, with identical JSON.

## Auth and account

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/auth/google` | Redirects to Google (state + PKCE) |
| GET | `/auth/google/callback` | Creates or updates the user, sets the session, redirects to `APP_URL` |
| POST | `/auth/dev-login` | `{ email }`; only when `DEV_LOGIN=1` and not production |
| POST | `/auth/logout` | |
| GET · PATCH | `/me` | `{ displayName?, isPrivate? }`. Accounts are public by default |
| GET | `/me/reviews` | |
| GET | `/me/followers` · `/me/following` · `/me/follow-requests` | |
| POST | `/me/follow-requests/:userId/accept` · `/decline` | Only matters for private accounts |
| DELETE | `/me/followers/:userId` | Remove a follower |

## People

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users/search?q=` | By name, or exact email |
| GET | `/users/:id` | Profile, counts, your follow status |
| GET | `/users/:id/reviews` | Only what you're allowed to see |
| POST · DELETE | `/users/:id/follow` | Public account: accepted at once. Private: pending |

## Items (restaurants now; movies and books later)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/places/autocomplete?q=&session=&lat=&lng=` | Google Places through the server |
| POST | `/items/from-place` | `{ placeId, name, sessionToken? }`; reuses an existing item for that place |
| POST | `/items` | Manual entry: `{ kind, title, details? }` |
| GET | `/items?q=&kind=` | Title search |
| GET | `/items/:id` **R** | Details + stats: averages per score, revisit and recommend counts |
| GET | `/items/:id/reviews` **R** | |
| PATCH | `/items/:id/details` | `{ cuisine?, priceLevel? }` (your data, not Google's) |

## Reviews

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/review-model?kind=` | Question set and per-kind wording. No sign-in needed |
| POST | `/reviews` | See body below |
| GET · PATCH · DELETE | `/reviews/:id` | Only the author can change or delete |
| GET | `/feed` **R** | You + people you follow, newest first |

```json
POST /api/v1/reviews
{
  "itemId": "01J…",
  "experiencedOn": "2026-10-10",
  "scores": { "enjoyment": 8, "impact": 6, "value": 7, "aesthetic": 5 },
  "revisit": "regularly",
  "recommendTo": "most",
  "notes": "Get the tajarin."
}
```

## Lists

| Method | Path |
| --- | --- |
| GET · POST | `/lists` |
| GET · PATCH · DELETE | `/lists/:id` |
| POST | `/lists/:id/items` `{ itemId, note? }` |
| DELETE | `/lists/:id/items/:itemId` |

## Visibility

You can see a review if you wrote it, its author's account is public, or you follow the
author and they accepted. Item stats only count reviews you can see.
