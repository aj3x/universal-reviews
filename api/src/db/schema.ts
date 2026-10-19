import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ITEM_KINDS, RECOMMEND_TO, REVISIT } from "../review-model.js";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

// ── People ────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // ULID
  googleSub: text("google_sub").notNull().unique(), // Google's stable account id
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false), // public by default
  createdAt: text("created_at").notNull().default(now),
});

/** id = SHA-256 hex of the cookie token, so a leaked database can't be replayed as sessions. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const follows = sqliteTable(
  "follows",
  {
    followerId: text("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    followeeId: text("followee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "accepted"] }).notNull().default("accepted"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee_idx").on(t.followeeId, t.status),
    check("follows_no_self", sql`${t.followerId} <> ${t.followeeId}`),
    check("follows_status", sql`${t.status} IN ('pending', 'accepted')`),
  ],
);

// ── Things you review ─────────────────────────────────────────────────────
// One `items` row per reviewable thing, whatever its kind. Kind-specific
// fields live in a 1:1 details table (restaurant_details, movie_details;
// book_details when that kind is switched on).

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ITEM_KINDS }).notNull(),
    title: text("title").notNull(),
    /** Where the record came from: google_places, tmdb; openlibrary later. */
    externalSource: text("external_source"),
    externalId: text("external_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("items_external_idx").on(t.externalSource, t.externalId),
    index("items_kind_title_idx").on(t.kind, t.title),
    check("items_kind", sql`${t.kind} IN (${inList(ITEM_KINDS)})`),
  ],
);

/**
 * Google Places terms: only the place id (items.external_id) may be kept
 * indefinitely. address/lat/lng are a cache, refreshed using cached_at.
 * cuisine and price_level are our own data.
 */
export const restaurantDetails = sqliteTable("restaurant_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  address: text("address"),
  lat: real("lat"),
  lng: real("lng"),
  cuisine: text("cuisine"),
  priceLevel: integer("price_level"),
  cachedAt: text("cached_at"),
});

/**
 * TMDB terms: the tmdb id (items.external_id) is kept indefinitely; year, runtime
 * and director are filled from TMDB (or by hand for manual entries), cached_at marks the fetch.
 */
export const movieDetails = sqliteTable("movie_details", {
  itemId: text("item_id").primaryKey().references(() => items.id, { onDelete: "cascade" }),
  year: integer("year"),
  runtime: integer("runtime"), // minutes
  director: text("director"),
  cachedAt: text("cached_at"),
});

// ── Reviews: the primary question set ─────────────────────────────────────

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(), // ULID, so ordering by id = ordering by creation time
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    experiencedOn: text("experienced_on"), // YYYY-MM-DD: visit, watch or finish date
    enjoyment: integer("enjoyment").notNull(), // did you like it
    impact: integer("impact").notNull(), // did it stay with you
    value: integer("value").notNull(), // was it worth it
    aesthetic: integer("aesthetic").notNull(), // did the look and feel click
    revisit: text("revisit", { enum: REVISIT }).notNull(),
    recommendTo: text("recommend_to", { enum: RECOMMEND_TO }).notNull(),
    notes: text("notes"), // optional for now; may become required
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    index("reviews_item_idx").on(t.itemId, t.id),
    index("reviews_user_idx").on(t.userId, t.id),
    check("reviews_enjoyment", sql`${t.enjoyment} BETWEEN 1 AND 10`),
    check("reviews_impact", sql`${t.impact} BETWEEN 1 AND 10`),
    check("reviews_value", sql`${t.value} BETWEEN 1 AND 10`),
    check("reviews_aesthetic", sql`${t.aesthetic} BETWEEN 1 AND 10`),
    check("reviews_revisit", sql`${t.revisit} IN (${inList(REVISIT)})`),
    check("reviews_recommend_to", sql`${t.recommendTo} IN (${inList(RECOMMEND_TO)})`),
  ],
);

// ── Lists ─────────────────────────────────────────────────────────────────

export const lists = sqliteTable(
  "lists",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("lists_owner_idx").on(t.ownerId)],
);

export const listItems = sqliteTable(
  "list_items",
  {
    listId: text("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    note: text("note"),
    addedAt: text("added_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.listId, t.itemId] })],
);
