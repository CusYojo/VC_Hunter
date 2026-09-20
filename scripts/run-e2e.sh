#!/usr/bin/env bash
set -euo pipefail

health_url="http://127.0.0.1:3000/api/v1/projects"
e2e_directory="$(mktemp -d)"
e2e_database="$e2e_directory/vc-hunter.db"
export VC_HUNTER_DB_PATH="$e2e_database"
npm run db:seed >/dev/null
# The demo Playwright suite intentionally exercises the no-auth local workspace.
# Production-mode authentication has its own isolated suite in scripts/auth-e2e.ts.
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  rm -rf -- "$e2e_directory"
}
trap cleanup EXIT INT TERM

for _ in {1..80}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "Next.js server exited before becoming ready." >&2
    exit 1
  fi
  if curl --fail --silent --show-error --max-time 2 "$health_url" >/dev/null; then
    npx playwright test "$@"
    exit $?
  fi
  sleep 0.25
done

echo "Timed out waiting for the production server." >&2
exit 1
