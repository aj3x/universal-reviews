#!/usr/bin/env bash
# Seeds a fresh database, starts the Node API and the Rust read service on it,
# and checks they return the same JSON (plus a rough latency comparison).
#   ./scripts/parity.sh                 builds Rust first (so it is never stale)
#   ./scripts/parity.sh path/to/binary  uses a prebuilt Rust binary (relative paths are fine)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
rust_bin="${1:-$root/rust/target/release/rating-read}"

if [[ $# -gt 0 ]]; then
  [[ -x "$rust_bin" ]] || { echo "parity: Rust binary not found or not executable: $rust_bin" >&2; exit 1; }
else
  # Always rebuild (incremental, cheap): a stale binary silently compares against old behaviour.
  (cd "$root/rust" && cargo build --release)
fi
# Absolute path, so it still resolves after the cd below.
rust_bin="$(cd "$(dirname "$rust_bin")" && pwd)/$(basename "$rust_bin")"

work="$(mktemp -d)"
db="$work/parity.db"

cd "$root/api"
seed="$(DATABASE_PATH="$db" node scripts/seed.ts)"
token="$(node -pe 'JSON.parse(process.argv[1]).token' "$seed")"
item="$(node -pe 'JSON.parse(process.argv[1]).sampleItemId' "$seed")"
movie="$(node -pe 'JSON.parse(process.argv[1]).sampleMovieId' "$seed")"
dish="$(node -pe 'JSON.parse(process.argv[1]).sampleDishId' "$seed")"

DATABASE_PATH="$db" PORT=18080 node src/server.node.ts >"$work/node.log" 2>&1 & node_pid=$!
DATABASE_PATH="$db" PORT=18081 "$rust_bin" >"$work/rust.log" 2>&1 & rust_pid=$!
trap 'kill $node_pid $rust_pid 2>/dev/null || true' EXIT

# Fail fast, with the server's own output, if either one never comes up.
wait_for() {
  local name="$1" port="$2"
  for _ in $(seq 50); do
    curl -sf "http://localhost:$port/health" >/dev/null && return 0
    sleep 0.2
  done
  echo "parity: $name did not answer on :$port/health within 10s. Its output:" >&2
  cat "$work/$name.log" >&2
  exit 1
}
wait_for node 18080
wait_for rust 18081

NODE_URL=http://localhost:18080 RUST_URL=http://localhost:18081 TOKEN="$token" ITEM_ID="$item" MOVIE_ID="$movie" DISH_ID="$dish" \
  node scripts/parity.ts
