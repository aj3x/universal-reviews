//! Read-only Rust service for the most-used read endpoints.
//!
//! It opens the same SQLite file as the Node API (read-only, WAL mode lets it
//! read while Node writes) and runs the same SQL as `api/src/lib/queries.ts`,
//! so responses are identical. Node owns the schema, migrations and all writes.
//!
//! Endpoints (all need a session cookie `sid` or `Authorization: Bearer`):
//!   GET /api/v1/items/{id}           item + details + stats
//!   GET /api/v1/items/{id}/reviews   paginated reviews you can see
//!   GET /api/v1/feed                 you + people you follow, newest first

use std::{cell::RefCell, env, net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Row, params};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PAGE_DEFAULT: i64 = 20;
const PAGE_MAX: i64 = 50;
const REVISIT: [&str; 5] = ["never", "once_more", "a_few_times", "regularly", "forever"];
const RECOMMEND_TO: [&str; 4] = ["everyone", "most", "specific_people", "nobody"];

/// Same visibility rule as Node: you wrote it, the author is public, or you follow them.
const VISIBLE: &str = "(r.user_id = ?1 OR u.is_private = 0 OR EXISTS (SELECT 1 FROM follows f
    WHERE f.follower_id = ?1 AND f.followee_id = r.user_id AND f.status = 'accepted'))";

const REVIEW_COLUMNS: &str = "r.id, r.item_id, r.user_id, u.display_name, u.avatar_url, r.experienced_on,
    r.enjoyment, r.impact, r.value, r.aesthetic, r.revisit, r.recommend_to, r.notes, r.created_at, r.updated_at";

struct AppState {
    db_path: String,
}

thread_local! {
    // One read-only connection per blocking thread, reused across requests.
    static CONN: RefCell<Option<Connection>> = const { RefCell::new(None) };
}

enum ApiError {
    Unauthorized,
    NotFound,
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::Internal(msg) => {
                eprintln!("error: {msg}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
        };
        (status, Json(json!({ "error": code }))).into_response()
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        ApiError::Internal(e.to_string())
    }
}

type ApiResult = Result<Json<Value>, ApiError>;

/// Runs `f` with this thread's connection on tokio's blocking pool.
async fn with_db<T: Send + 'static>(
    state: &Arc<AppState>,
    f: impl FnOnce(&Connection) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let path = state.db_path.clone();
    tokio::task::spawn_blocking(move || {
        CONN.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.is_none() {
                let conn = Connection::open_with_flags(
                    &path,
                    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                )?;
                conn.busy_timeout(std::time::Duration::from_secs(5))?;
                *slot = Some(conn);
            }
            f(slot.as_ref().unwrap())
        })
    })
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
}

fn session_token(headers: &HeaderMap) -> Option<String> {
    let from_cookie = headers.get_all(header::COOKIE).iter().find_map(|v| {
        v.to_str().ok()?.split(';').find_map(|pair| {
            let (k, v) = pair.trim().split_once('=')?;
            (k == "sid").then(|| v.to_string())
        })
    });
    from_cookie.or_else(|| {
        headers
            .get(header::AUTHORIZATION)?
            .to_str()
            .ok()?
            .strip_prefix("Bearer ")
            .map(str::to_string)
    })
}

/// Validates the session against the `sessions` table (id = SHA-256 hex of the token).
/// Read-only, so unlike Node it never slides the expiry forward.
fn viewer_id(conn: &Connection, token: Option<String>) -> Result<String, ApiError> {
    let token = token.ok_or(ApiError::Unauthorized)?;
    let id = hex::encode(Sha256::digest(token.as_bytes()));
    conn.query_row(
        "SELECT user_id FROM sessions WHERE id = ?1 AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![id],
        |r| r.get::<_, String>(0),
    )
    .optional()?
    .ok_or(ApiError::Unauthorized)
}

fn review_json(r: &Row, with_item: bool) -> rusqlite::Result<Value> {
    let item_id: String = r.get("item_id")?;
    let mut v = json!({
        "id": r.get::<_, String>("id")?,
        "itemId": item_id,
        "author": {
            "id": r.get::<_, String>("user_id")?,
            "displayName": r.get::<_, String>("display_name")?,
            "avatarUrl": r.get::<_, Option<String>>("avatar_url")?,
        },
        "experiencedOn": r.get::<_, Option<String>>("experienced_on")?,
        "scores": {
            "enjoyment": r.get::<_, i64>("enjoyment")?,
            "impact": r.get::<_, i64>("impact")?,
            "value": r.get::<_, i64>("value")?,
            "aesthetic": r.get::<_, i64>("aesthetic")?,
        },
        "revisit": r.get::<_, String>("revisit")?,
        "recommendTo": r.get::<_, String>("recommend_to")?,
        "notes": r.get::<_, Option<String>>("notes")?,
        "createdAt": r.get::<_, String>("created_at")?,
        "updatedAt": r.get::<_, String>("updated_at")?,
    });
    if with_item {
        v["item"] = json!({
            "id": item_id,
            "kind": r.get::<_, String>("item_kind")?,
            "title": r.get::<_, String>("item_title")?,
        });
    }
    Ok(v)
}

#[derive(Deserialize)]
struct PageQuery {
    cursor: Option<String>,
    limit: Option<String>,
}

impl PageQuery {
    fn limit(&self) -> i64 {
        match self.limit.as_deref().map(str::parse::<i64>) {
            Some(Ok(n)) if n > 0 => n.min(PAGE_MAX),
            _ => PAGE_DEFAULT,
        }
    }
}

/// Runs a review query (params: ?1 viewer, ?2 subject id, ?3 cursor or NULL, ?4 limit+1) into a page.
fn review_page(conn: &Connection, sql: &str, viewer: &str, subject: &str, q: &PageQuery, with_item: bool) -> ApiResult {
    let limit = q.limit();
    let mut stmt = conn.prepare_cached(sql)?;
    let rows = stmt
        .query_map(params![viewer, subject, q.cursor, limit + 1], |r| review_json(r, with_item))?
        .collect::<Result<Vec<_>, _>>()?;
    let has_more = rows.len() as i64 > limit;
    let data: Vec<Value> = rows.into_iter().take(limit as usize).collect();
    let next = if has_more { data.last().map(|v| v["id"].clone()) } else { None };
    Ok(Json(json!({ "data": data, "nextCursor": next })))
}

async fn item_reviews(State(s): State<Arc<AppState>>, Path(id): Path<String>, Query(q): Query<PageQuery>, h: HeaderMap) -> ApiResult {
    let token = session_token(&h);
    with_db(&s, move |c| {
        let viewer = viewer_id(c, token)?;
        let sql = format!(
            "SELECT {REVIEW_COLUMNS} FROM reviews r JOIN users u ON u.id = r.user_id
             WHERE r.item_id = ?2 AND {VISIBLE} AND (?3 IS NULL OR r.id < ?3)
             ORDER BY r.id DESC LIMIT ?4"
        );
        review_page(c, &sql, &viewer, &id, &q, false)
    })
    .await
}

async fn feed(State(s): State<Arc<AppState>>, Query(q): Query<PageQuery>, h: HeaderMap) -> ApiResult {
    let token = session_token(&h);
    with_db(&s, move |c| {
        let viewer = viewer_id(c, token)?;
        let sql = format!(
            "SELECT {REVIEW_COLUMNS}, i.kind AS item_kind, i.title AS item_title
             FROM reviews r JOIN users u ON u.id = r.user_id JOIN items i ON i.id = r.item_id
             WHERE (r.user_id = ?1 OR r.user_id IN (
               SELECT followee_id FROM follows WHERE follower_id = ?1 AND status = 'accepted'))
             AND ?2 = ?2 AND (?3 IS NULL OR r.id < ?3)
             ORDER BY r.id DESC LIMIT ?4"
        );
        review_page(c, &sql, &viewer, "", &q, true)
    })
    .await
}

async fn item(State(s): State<Arc<AppState>>, Path(id): Path<String>, h: HeaderMap) -> ApiResult {
    let token = session_token(&h);
    with_db(&s, move |c| {
        let viewer = viewer_id(c, token)?;
        let item = c
            .query_row(
                "SELECT i.id, i.kind, i.title, i.external_source, i.external_id,
                        d.address, d.lat, d.lng, d.cuisine, d.price_level,
                        m.year, m.runtime, m.director
                 FROM items i LEFT JOIN restaurant_details d ON d.item_id = i.id
                              LEFT JOIN movie_details m ON m.item_id = i.id
                 WHERE i.id = ?1",
                params![id],
                |r| {
                    let kind: String = r.get("kind")?;
                    let details = if kind == "restaurant" {
                        json!({
                            "address": r.get::<_, Option<String>>("address")?,
                            "lat": r.get::<_, Option<f64>>("lat")?,
                            "lng": r.get::<_, Option<f64>>("lng")?,
                            "cuisine": r.get::<_, Option<String>>("cuisine")?,
                            "priceLevel": r.get::<_, Option<i64>>("price_level")?,
                        })
                    } else if kind == "movie" {
                        json!({
                            "year": r.get::<_, Option<i64>>("year")?,
                            "runtime": r.get::<_, Option<i64>>("runtime")?,
                            "director": r.get::<_, Option<String>>("director")?,
                        })
                    } else {
                        Value::Null
                    };
                    Ok(json!({
                        "id": r.get::<_, String>("id")?,
                        "kind": kind,
                        "title": r.get::<_, String>("title")?,
                        "externalSource": r.get::<_, Option<String>>("external_source")?,
                        "externalId": r.get::<_, Option<String>>("external_id")?,
                        "details": details,
                    }))
                },
            )
            .optional()?
            .ok_or(ApiError::NotFound)?;

        let (count, averages) = c.query_row(
            &format!(
                "SELECT COUNT(*), ROUND(AVG(r.enjoyment), 1), ROUND(AVG(r.impact), 1),
                        ROUND(AVG(r.value), 1), ROUND(AVG(r.aesthetic), 1)
                 FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.item_id = ?2 AND {VISIBLE}"
            ),
            params![viewer, id],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    json!({
                        "enjoyment": r.get::<_, Option<f64>>(1)?,
                        "impact": r.get::<_, Option<f64>>(2)?,
                        "value": r.get::<_, Option<f64>>(3)?,
                        "aesthetic": r.get::<_, Option<f64>>(4)?,
                    }),
                ))
            },
        )?;

        let mut stmt = c.prepare_cached(&format!(
            "SELECT 'revisit', r.revisit, COUNT(*) FROM reviews r JOIN users u ON u.id = r.user_id
               WHERE r.item_id = ?2 AND {VISIBLE} GROUP BY r.revisit
             UNION ALL
             SELECT 'recommend_to', r.recommend_to, COUNT(*) FROM reviews r JOIN users u ON u.id = r.user_id
               WHERE r.item_id = ?2 AND {VISIBLE} GROUP BY r.recommend_to"
        ))?;
        let dist: Vec<(String, String, i64)> = stmt
            .query_map(params![viewer, id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?;
        let counts = |field: &str, keys: &[&str]| -> Value {
            keys.iter()
                .map(|k| {
                    let n = dist.iter().find(|(f, a, _)| f == field && a == k).map_or(0, |d| d.2);
                    (k.to_string(), json!(n))
                })
                .collect::<serde_json::Map<_, _>>()
                .into()
        };

        let mut out = item;
        out["stats"] = json!({
            "reviewCount": count,
            "averages": averages,
            "revisit": counts("revisit", &REVISIT),
            "recommendTo": counts("recommend_to", &RECOMMEND_TO),
        });
        Ok(Json(out))
    })
    .await
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "rust" }))
}

#[tokio::main]
async fn main() {
    let db_path = env::var("DATABASE_PATH").unwrap_or_else(|_| "../api/data/rating.db".into());
    let port: u16 = env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8081);
    let state = Arc::new(AppState { db_path: db_path.clone() });

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/items/{id}", get(item))
        .route("/api/v1/items/{id}/reviews", get(item_reviews))
        .route("/api/v1/feed", get(feed))
        .fallback(|| async { ApiError::NotFound })
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    println!("rust read service listening on :{port} (db: {db_path})");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .expect("server");
}
