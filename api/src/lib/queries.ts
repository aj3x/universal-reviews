/**
 * Read paths shared by several routes. Written as plain SQL on purpose: the
 * Rust read service (../../rust) runs the same statements, so both return
 * identical JSON. If you change a query here, change it there too; the parity
 * script (scripts/parity.ts) will catch drift.
 */
import { sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { RECOMMEND_TO, REVISIT } from "../review-model.js";

export const PAGE_DEFAULT = 20;
export const PAGE_MAX = 50;

export function pageLimit(raw: string | undefined) {
  const n = Number(raw ?? PAGE_DEFAULT);
  return Number.isInteger(n) && n > 0 ? Math.min(n, PAGE_MAX) : PAGE_DEFAULT;
}

/** A review is visible if you wrote it, its author is public, or you follow the author. */
const visible = (viewerId: string) => sql`(
  r.user_id = ${viewerId}
  OR u.is_private = 0
  OR EXISTS (SELECT 1 FROM follows f
             WHERE f.follower_id = ${viewerId} AND f.followee_id = r.user_id AND f.status = 'accepted')
)`;

type ReviewRow = {
  id: string; item_id: string; user_id: string; display_name: string; avatar_url: string | null;
  experienced_on: string | null; enjoyment: number; impact: number; value: number; aesthetic: number;
  revisit: string; recommend_to: string; notes: string | null; created_at: string; updated_at: string;
  item_kind?: string; item_title?: string;
};

const REVIEW_COLUMNS = sql`r.id, r.item_id, r.user_id, u.display_name, u.avatar_url, r.experienced_on,
  r.enjoyment, r.impact, r.value, r.aesthetic, r.revisit, r.recommend_to, r.notes, r.created_at, r.updated_at`;

export function toReviewJson(r: ReviewRow) {
  return {
    id: r.id,
    itemId: r.item_id,
    ...(r.item_kind ? { item: { id: r.item_id, kind: r.item_kind, title: r.item_title } } : {}),
    author: { id: r.user_id, displayName: r.display_name, avatarUrl: r.avatar_url },
    experiencedOn: r.experienced_on,
    scores: { enjoyment: r.enjoyment, impact: r.impact, value: r.value, aesthetic: r.aesthetic },
    revisit: r.revisit,
    recommendTo: r.recommend_to,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export type ReviewJson = ReturnType<typeof toReviewJson>;

function page(rows: ReviewRow[], limit: number) {
  const data = rows.slice(0, limit).map(toReviewJson);
  return { data, nextCursor: rows.length > limit ? (data.at(-1)?.id ?? null) : null };
}

const before = (cursor: string | undefined): SQL => (cursor ? sql`AND r.id < ${cursor}` : sql``);

export async function getReview(db: DB, viewerId: string, reviewId: string) {
  const row = await db.get<ReviewRow>(sql`
    SELECT ${REVIEW_COLUMNS} FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.id = ${reviewId} AND ${visible(viewerId)}`);
  return row ? toReviewJson(row) : null;
}

export async function listItemReviews(db: DB, viewerId: string, itemId: string, cursor?: string, limit = PAGE_DEFAULT) {
  const rows = await db.all<ReviewRow>(sql`
    SELECT ${REVIEW_COLUMNS} FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.item_id = ${itemId} AND ${visible(viewerId)} ${before(cursor)}
    ORDER BY r.id DESC LIMIT ${limit + 1}`);
  return page(rows, limit);
}

export async function listUserReviews(db: DB, viewerId: string, userId: string, cursor?: string, limit = PAGE_DEFAULT) {
  const rows = await db.all<ReviewRow>(sql`
    SELECT ${REVIEW_COLUMNS}, i.kind AS item_kind, i.title AS item_title
    FROM reviews r JOIN users u ON u.id = r.user_id JOIN items i ON i.id = r.item_id
    WHERE r.user_id = ${userId} AND ${visible(viewerId)} ${before(cursor)}
    ORDER BY r.id DESC LIMIT ${limit + 1}`);
  return page(rows, limit);
}

/** Your reviews plus those of everyone you follow (accepted), newest first. */
export async function feed(db: DB, viewerId: string, cursor?: string, limit = PAGE_DEFAULT) {
  const rows = await db.all<ReviewRow>(sql`
    SELECT ${REVIEW_COLUMNS}, i.kind AS item_kind, i.title AS item_title
    FROM reviews r JOIN users u ON u.id = r.user_id JOIN items i ON i.id = r.item_id
    WHERE (r.user_id = ${viewerId} OR r.user_id IN (
      SELECT followee_id FROM follows WHERE follower_id = ${viewerId} AND status = 'accepted'))
    ${before(cursor)}
    ORDER BY r.id DESC LIMIT ${limit + 1}`);
  return page(rows, limit);
}

type ItemRow = {
  id: string; kind: string; title: string; external_source: string | null; external_id: string | null;
  address: string | null; lat: number | null; lng: number | null; cuisine: string | null; price_level: number | null;
};

/** One item with its details and aggregate stats over the reviews the viewer can see. */
export async function getItem(db: DB, viewerId: string, itemId: string) {
  const item = await db.get<ItemRow>(sql`
    SELECT i.id, i.kind, i.title, i.external_source, i.external_id,
           d.address, d.lat, d.lng, d.cuisine, d.price_level
    FROM items i LEFT JOIN restaurant_details d ON d.item_id = i.id
    WHERE i.id = ${itemId}`);
  if (!item) return null;

  const agg = await db.get<{
    n: number; enjoyment: number | null; impact: number | null; value: number | null; aesthetic: number | null;
  }>(sql`
    SELECT COUNT(*) AS n,
           ROUND(AVG(r.enjoyment), 1) AS enjoyment, ROUND(AVG(r.impact), 1) AS impact,
           ROUND(AVG(r.value), 1) AS value, ROUND(AVG(r.aesthetic), 1) AS aesthetic
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.item_id = ${itemId} AND ${visible(viewerId)}`);

  const dist = await db.all<{ field: string; answer: string; n: number }>(sql`
    SELECT 'revisit' AS field, r.revisit AS answer, COUNT(*) AS n
      FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.item_id = ${itemId} AND ${visible(viewerId)} GROUP BY r.revisit
    UNION ALL
    SELECT 'recommend_to', r.recommend_to, COUNT(*)
      FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.item_id = ${itemId} AND ${visible(viewerId)} GROUP BY r.recommend_to`);

  const counts = (field: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, dist.find((d) => d.field === field && d.answer === k)?.n ?? 0]));

  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    externalSource: item.external_source,
    externalId: item.external_id,
    details:
      item.kind === "restaurant"
        ? { address: item.address, lat: item.lat, lng: item.lng, cuisine: item.cuisine, priceLevel: item.price_level }
        : null,
    stats: {
      reviewCount: agg?.n ?? 0,
      averages: {
        enjoyment: agg?.enjoyment ?? null,
        impact: agg?.impact ?? null,
        value: agg?.value ?? null,
        aesthetic: agg?.aesthetic ?? null,
      },
      revisit: counts("revisit", REVISIT),
      recommendTo: counts("recommend_to", RECOMMEND_TO),
    },
  };
}
