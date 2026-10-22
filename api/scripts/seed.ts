/**
 * Fills a database with sample people, restaurants, follows and reviews, and
 * prints a session token you can use as `Authorization: Bearer <token>`.
 *   DATABASE_PATH=./data/rating.db npm run seed
 */
import { createSession } from "../src/auth/session.ts";
import { openDatabase } from "../src/db/client.ts";
import { follows, items, movieDetails, restaurantDetails, reviews, users, visits } from "../src/db/schema.ts";
import { newId } from "../src/lib/ids.ts";
import { RECOMMEND_TO, REVISIT } from "../src/review-model.ts";

const { db, sqlite } = openDatabase(process.env.DATABASE_PATH ?? "./data/rating.db");

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const score = () => Math.max(1, Math.min(10, Math.round(5.5 + (rand() - 0.5) * 6)));

const people = [
  { name: "Alex", isPrivate: false },
  { name: "Jordan", isPrivate: false },
  { name: "Sam", isPrivate: false },
  { name: "Riley", isPrivate: true },
].map((p) => ({ ...p, id: newId() }));

for (const p of people) {
  await db.insert(users).values({
    id: p.id, googleSub: `seed-${p.name}`, email: `${p.name.toLowerCase()}@example.com`, displayName: p.name, isPrivate: p.isPrivate,
  });
}

const places = ["Kissa Tanto", "Published on Main", "Ramen Danbo", "Phnom Penh", "Anh and Chi", "St. Lawrence", "Bao Bei", "Nightingale"];
const itemIds: string[] = [];
for (const [i, title] of places.entries()) {
  const id = newId();
  itemIds.push(id);
  await db.insert(items).values({ id, kind: "restaurant", title, externalSource: "google_places", externalId: `seed-place-${i}`, createdBy: people[0]!.id });
  await db.insert(restaurantDetails).values({
    itemId: id, address: `${100 + i} Main St, Vancouver, BC`, lat: 49.26 + i / 100, lng: -123.1 - i / 100,
    cuisine: pick(["Japanese", "Italian", "Vietnamese", "Cambodian", "French"]), priceLevel: 1 + Math.floor(rand() * 4),
    cachedAt: new Date().toISOString(),
  });
}

const dishId = newId();
await db.insert(items).values({ id: dishId, kind: "dish", title: "Tonkotsu Ramen", parentId: itemIds[2]!, createdBy: people[0]!.id });

const movieId = newId();
await db.insert(items).values({ id: movieId, kind: "movie", title: "Paddington 2", externalSource: "tmdb", externalId: "346648", createdBy: people[0]!.id });
await db.insert(movieDetails).values({ itemId: movieId, year: 2017, runtime: 103, director: "Paul King", cachedAt: new Date().toISOString() });

const [alex, jordan, sam, riley] = people as [typeof people[0], typeof people[0], typeof people[0], typeof people[0]];
await db.insert(follows).values([
  { followerId: alex.id, followeeId: jordan.id, status: "accepted" },
  { followerId: alex.id, followeeId: sam.id, status: "accepted" },
  { followerId: jordan.id, followeeId: alex.id, status: "accepted" },
  { followerId: sam.id, followeeId: riley.id, status: "accepted" },
  { followerId: alex.id, followeeId: riley.id, status: "pending" },
]);

let count = 0;
for (const p of people) {
  for (const itemId of itemIds) {
    if (rand() < 0.35) continue;
    const review = {
      id: newId(), userId: p.id, itemId,
      experiencedOn: `2026-${String(1 + Math.floor(rand() * 9)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
      enjoyment: score(), impact: score(), value: score(), aesthetic: score(),
      revisit: pick(REVISIT), recommendTo: pick(RECOMMEND_TO),
      notes: rand() < 0.5 ? "Would order the same thing again." : null,
    };
    await db.insert(reviews).values(review);
    await db.insert(visits).values({
      id: newId(), reviewId: review.id, visitedOn: review.experiencedOn, enjoyment: review.enjoyment, impact: review.impact,
      value: review.value, aesthetic: review.aesthetic, revisit: review.revisit, recommendTo: review.recommendTo, note: review.notes,
    });
    count++;
  }
}

const dishReviewId = newId();
await db.insert(reviews).values({
  id: dishReviewId, userId: people[0]!.id, itemId: dishId, experiencedOn: "2026-09-02",
  enjoyment: 9, impact: 8, value: 7, aesthetic: 8, revisit: "regularly", recommendTo: "everyone", notes: null,
});
await db.insert(visits).values({
  id: newId(), reviewId: dishReviewId, visitedOn: "2026-09-02",
  enjoyment: 9, impact: 8, value: 7, aesthetic: 8, revisit: "regularly", recommendTo: "everyone",
});
count++;

const movieReviewId = newId();
await db.insert(reviews).values({
  id: movieReviewId, userId: people[0]!.id, itemId: movieId, experiencedOn: "2026-09-01",
  enjoyment: 9, impact: 7, value: 8, aesthetic: 7, revisit: "regularly", recommendTo: "everyone", notes: null,
});
await db.insert(visits).values({
  id: newId(), reviewId: movieReviewId, visitedOn: "2026-09-01",
  enjoyment: 9, impact: 7, value: 8, aesthetic: 7, revisit: "regularly", recommendTo: "everyone",
});
count++;

const { token } = await createSession(db, alex.id);
console.log(JSON.stringify({ users: people.length, items: itemIds.length, reviews: count, viewer: "Alex", token, sampleItemId: itemIds[0], sampleMovieId: movieId, sampleDishId: dishId }, null, 2));
sqlite.close();
