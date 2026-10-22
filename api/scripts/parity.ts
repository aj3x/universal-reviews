/**
 * Compares the Node API and the Rust read service on the endpoints both serve,
 * then times them. Both must be running against the same database.
 *   TOKEN=... ITEM_ID=... npx tsx scripts/parity.ts
 */
import { isDeepStrictEqual } from "node:util";

const NODE = process.env.NODE_URL ?? "http://localhost:8080";
const RUST = process.env.RUST_URL ?? "http://localhost:8081";
const TOKEN = process.env.TOKEN;
const ITEM = process.env.ITEM_ID;
const MOVIE = process.env.MOVIE_ID;
const DISH = process.env.DISH_ID;
const RUNS = Number(process.env.RUNS ?? 300);
if (!TOKEN || !ITEM) throw new Error("Set TOKEN and ITEM_ID (npm run seed prints both)");

const headers = { authorization: `Bearer ${TOKEN}` };
const get = async (base: string, path: string) => {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json() };
};

const feed1 = await get(NODE, "/api/v1/feed?limit=3");
const paths = [
  `/api/v1/items/${ITEM}`,
  `/api/v1/items/${MOVIE}`,
  `/api/v1/items/${DISH}`,
  `/api/v1/items/${ITEM}/reviews`,
  `/api/v1/items/${ITEM}/reviews?limit=2`,
  "/api/v1/feed",
  "/api/v1/feed?limit=3",
  `/api/v1/feed?limit=3&cursor=${feed1.body.nextCursor}`,
  "/api/v1/items/does-not-exist",
];

let failures = 0;
for (const path of paths) {
  const [n, r] = await Promise.all([get(NODE, path), get(RUST, path)]);
  const same = n.status === r.status && isDeepStrictEqual(n.body, r.body);
  if (!same) failures++;
  console.log(`${same ? "same" : "DIFF"}  ${n.status}  ${path}`);
  if (!same) console.log({ node: n, rust: r });
}
const anon = await fetch(`${RUST}/api/v1/feed`);
console.log(`${anon.status === 401 ? "same" : "DIFF"}  401  /api/v1/feed without a session (rust)`);
if (anon.status !== 401) failures++;

async function time(base: string, path: string) {
  for (let i = 0; i < 20; i++) await fetch(base + path, { headers }).then((r) => r.arrayBuffer());
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    await fetch(base + path, { headers }).then((r) => r.arrayBuffer());
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  return { p50: ms[Math.floor(RUNS * 0.5)]!.toFixed(2), p95: ms[Math.floor(RUNS * 0.95)]!.toFixed(2) };
}

console.log(`\nLatency, ${RUNS} sequential requests each (ms):`);
for (const path of [`/api/v1/items/${ITEM}`, "/api/v1/feed"]) {
  const [n, r] = [await time(NODE, path), await time(RUST, path)];
  console.log(`${path}\n  node p50 ${n.p50}  p95 ${n.p95}\n  rust p50 ${r.p50}  p95 ${r.p95}`);
}

process.exit(failures ? 1 : 0);
