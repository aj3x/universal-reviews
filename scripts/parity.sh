#!/usr/bin/env bash
# Seeds a fresh database, starts the Node API and the Rust read service on it,
# and checks they return the same JSON (plus a rough latency comparison).
#   ./scripts/parity.sh                 builds Rust if needed
#   ./scripts/parity.sh path/to/binary  uses a prebuilt Rust binary
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
rust_bin="${1:-$root/rust/target/release/rating-read}"
db="$(mktemp -d)/parity.db"

if [[ ! -x "$rust_bin" ]]; then (cd "$root/rust" && cargo build --release); fi

cd "$root/api"
seed="$(DATABASE_PATH="$db" npx tsx scripts/seed.ts)"
token="$(node -pe 'JSON.parse(process.argv[1]).token' "$seed")"
item="$(node -pe 'JSON.parse(process.argv[1]).sampleItemId' "$seed")"

DATABASE_PATH="$db" PORT=18080 node --import tsx src/server.node.ts >/dev/null 2>&1 & node_pid=$!
DATABASE_PATH="$db" PORT=18081 "$rust_bin" >/dev/null 2>&1 & rust_pid=$!
trap 'kill $node_pid $rust_pid 2>/dev/null || true' EXIT

for port in 18080 18081; do
  for _ in $(seq 50); do curl -sf "http://localhost:$port/health" >/dev/null && break; sleep 0.2; done
done

NODE_URL=http://localhost:18080 RUST_URL=http://localhost:18081 TOKEN="$token" ITEM_ID="$item" \
  npx tsx scripts/parity.ts
