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
| GET · PATCH | `/me` | PATCH `{ displayName?, isPrivate? }`. Accounts are public by default. GET adds `createdAt` and counts: `reviews, followers, following, requests` (pending follow requests) |
| DELETE | `/me/sessions` | Sign out everywhere: ends all of your sessions and clears the cookie |
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

## Items (restaurants and movies; books later)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/places/autocomplete?q=&session=&lat=&lng=` | Google Places through the server |
| GET | `/movies/search?q=` | TMDB through the server: `{ data: [{ tmdbId, title, year }] }`. `503 tmdb_not_configured` without `TMDB_API_KEY` |
| POST | `/items/from-movie` | `{ tmdbId, title }`; reuses the existing item for that TMDB id (200), else fetches year, runtime and director and creates it (201). `503 tmdb_not_configured` if it must fetch and no key is set |
| POST | `/items/from-place` | `{ placeId, name, sessionToken? }`; reuses an existing item for that place |
| POST | `/items` | Manual entry: `{ kind, title, details? }` (restaurant or movie; dishes go through `/items/:id/dishes`). Restaurant details: `address, lat, lng, cuisine, priceLevel`. Movie details: `{ year?, runtime? (minutes), director? }` |
| GET | `/items?q=&kind=&reviewedByMe=1` | Title search (dishes excluded); `reviewedByMe=1` limits to items you have reviewed. Rows carry `externalSource`/`externalId`, plus `address` (restaurants) or `year` (movies), and `myReview` (`{ id, overall, revisit, recommendTo, visitCount }` or `null`) |
| GET | `/items/:id/dishes` | Dishes under a restaurant, A to Z: `{ id, title, reviewCount, overall, myOverall }`. 404 if the item isn't a restaurant |
| POST | `/items/:id/dishes` | `{ title }`; reuses the restaurant's dish with that name, ignoring case (200), else creates it (201). Returns the dish item, with `restaurant: { id, title }` |
| GET | `/items/:id/my-review` | Your review of the item with its visit history (newest first). 404 if you haven't reviewed it |
| POST | `/items/:id/visits` | "Went again, nothing changed": logs a visit that snapshots your current review. Body `{ visitedOn? }` (defaults to today) |
| GET | `/items/:id` **R** | `details` is restaurant `{ address, lat, lng, cuisine, priceLevel }`, movie `{ year, runtime, director }`, or null. Plus stats: averages per score, revisit and recommend counts |
| GET | `/items/:id/reviews` **R** | |
| PATCH | `/items/:id/details` | `{ cuisine?, priceLevel? }` (your data, not Google's) |

## Reviews

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/review-model?kind=` | Question set and per-kind wording. No sign-in needed |
| POST | `/reviews` | Save your review of an item. **Upsert**: there is one review per user per item, so a second save updates it (200) and logs another visit; the first creates it (201). See body below |
| GET · PATCH · DELETE | `/reviews/:id` | Only the author can change or delete |
| GET | `/feed` **R** | You + people you follow, newest first |

```json
POST /api/v1/reviews
{
  "itemId": "01J…",
  "experiencedOn": "2026-10-10",   // the visit date; defaults to today
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
