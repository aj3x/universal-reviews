# Review model

## The primary question set

Every review, of any kind of thing, answers the same six questions.

| Field | Question | Answer |
| --- | --- | --- |
| `enjoyment` | Did you like it? | 1–10 |
| `impact` | Did it stay with you? | 1–10 |
| `value` | Was it worth it? | 1–10 |
| `aesthetic` | Did the look and feel click? | 1–10 |
| `revisit` | How often would you come back? | `never` · `once_more` · `a_few_times` · `regularly` · `forever` |
| `recommendTo` | Who would you recommend it to? | `everyone` · `most` · `specific_people` · `nobody` |

Plus `notes` (optional text, up to 5,000 characters) and `experiencedOn` (optional date).

**Scale:** 1 is the worst of all time, 5 is average, 10 is the best of all time, relative
to everything of that kind you have ever experienced. Most entries should land between
4 and 7, which keeps 9s and 10s meaningful.

The stored fields never change between media. Only the wording does: `src/review-model.ts`
holds per-kind prompts ("How often would you go back?" for a restaurant, "rewatch" for a
movie, "reread" for a book), and the PWA reads them from `GET /api/v1/review-model`.

### Making notes required later

One line in `api/src/routes/reviews.ts`: change `notes` from `.nullish()` to `.min(1)`.
Existing reviews without notes stay valid in the database; the rule applies to new and
edited reviews. Add a `NOT NULL` migration only once old rows are back-filled, if ever.

### Adding optional properties later

Add a nullable column per property (for a restaurant: `service`, `noise`) in a migration.
Old reviews read as `null`, so nothing breaks. If a property only makes sense for one
medium, put it on that medium's details table or a `restaurant_review_extras` 1:1 table
rather than on `reviews`.

## SQL or document store?

**Decision: stay relational (SQLite now, D1 or Postgres later), with a `kind` column on
`items` and one details table per kind.** This is "class table inheritance".

```
items (id, kind, title, external_source, external_id)       ← every reviewable thing
  ├─ restaurant_details (item_id, address, lat, lng, cuisine, price_level, cached_at)
  ├─ movie_details      (item_id, year, runtime, director, cached_at)        on; tmdb id is items.external_id
  └─ book_details       (item_id, author, year, pages, isbn…)                later
reviews (item_id → items, six answers, notes)                ← identical for every kind
```

Why this over a document model:

- **The review is the same shape for every kind.** The six answers are real typed columns
  with `CHECK` constraints, so averages, filters and "people who rated value ≥ 8" are
  plain indexed SQL. In a document store you'd rebuild those as aggregation pipelines.
- **Kind-specific data is where the variety is, and it's small.** A movie needs a year and
  runtime; a restaurant needs an address. A 1:1 details table per kind holds that with
  proper types. A JSON column would also work here and stays an option if the kinds
  multiply.
- **Your other access patterns are relational:** follows, visibility, feeds, lists and
  per-person taste all join across people, items and reviews.
- **Migration stays cheap.** Every read path is a handful of plain SQL statements in one
  file (`api/src/lib/queries.ts`). Moving to D1 is a driver swap; moving to Postgres
  changes almost nothing in that SQL. If a document store ever made sense, each review
  plus its item maps cleanly to one document, so an export is a single query.

## Adding movies and books

**Movies are switched on** (`ENABLED_KINDS`, `movie_details`, TMDB source: see steps 2 and below). Books are still modelled but off. Adding a kind never moves review data.

1. `items.kind` already allows `movie` and `book` (`CHECK` constraint), and the prompts
   for both already exist.
2. To switch a kind on (done for movies; `src/sources/tmdb.ts` and `/movies/search` + `/items/from-movie` are the template for books): add it to `ENABLED_KINDS` in `src/review-model.ts`, add a
   `movie_details` table in a migration, and add a source (TMDB for movies, Open Library
   for books, both free) the same way Google Places feeds restaurants. Until then the API
   refuses reviews of disabled kinds (`kind_not_enabled`).
3. Movie details come from TMDB's `movie/{id}?append_to_response=credits` once, when the movie is first added (`cached_at` records it); only the tmdb id must be kept long term. Manual movies can supply year, runtime and director themselves. TMDB requires attribution ("This product uses the TMDB API but is not endorsed or certified by TMDB"), which the app does not yet show.
4. Reviews of movies go in the same `reviews` table with the same six answers. Feeds,
   lists, follows, item stats and the Rust read endpoints work unchanged.

Two things to decide when you do it:

- **Compare within a kind, not across.** An 8 for a movie and an 8 for a restaurant are
  each "8 relative to every movie / restaurant you've had". Stats and recommendations
  should group by `kind`; the feed can mix them.
- **Taste profiles per kind.** Your restaurant `value` habits say little about movies, so
  the recommendation job should build one profile per person per kind.
