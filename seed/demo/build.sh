#!/usr/bin/env bash
# Builds migrations/0006_initial_school_demo.sql (the Demo School) from the app's own rules:
# a throwaway local database gets the real migrations 0001-0005, the demo school and its
# students, then fees and receipts are entered through the API exactly as at the counter,
# and the result is exported with ids replaced by lookups. Run from the repository root.
set -euo pipefail
DB_DIR=$(mktemp -d)
PORT=8799
run() { npx wrangler d1 execute DB --local --persist-to "$DB_DIR" --file "$1" > /dev/null; }
for f in migrations/000[1-5]_*.sql; do run "$f"; done
# Locally the admin keeps admin@123, so the fee script can sign in.
npx wrangler d1 execute DB --local --persist-to "$DB_DIR" \
  --command "UPDATE users SET must_change_password = 0 WHERE username = 'admin@sps.com'" > /dev/null
run seed/demo/header.sql
node seed/demo/students.mjs
run seed/demo/.students.sql
npm run build > /dev/null
npx wrangler dev --port "$PORT" --persist-to "$DB_DIR" > "$DB_DIR/dev.log" 2>&1 &
DEV=$!
trap 'kill $DEV 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/bootstrap" > /dev/null && break; sleep 1; done
SEED_URL="http://localhost:$PORT" SEED_SCHOOL="Demo School" node seed/seed-fees.mjs
kill $DEV; wait $DEV 2>/dev/null || true
node seed/demo/export.mjs "$DB_DIR"
