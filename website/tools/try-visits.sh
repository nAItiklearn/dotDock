#!/usr/bin/env bash
# Tries the visit counter end to end on this machine: a fake Upstash REST server, the preview server with the
# credentials set (increment, read, wrong method) and a second one without them (200, available: false). Run after `pnpm build`.
set -u
cd "$(dirname "$0")/.."
node tools/fake-upstash.mjs 8799 &
FAKE=$!
KV_REST_API_URL=http://127.0.0.1:8799 KV_REST_API_TOKEN=local node tools/preview.mjs 4331 &
WITH=$!
node tools/preview.mjs 4332 &
WITHOUT=$!
trap 'kill $FAKE $WITH $WITHOUT 2>/dev/null' EXIT
sleep 2
echo "--- with credentials (KV_REST_API_URL / KV_REST_API_TOKEN):"
for method in GET POST POST POST GET DELETE; do
  printf '%-7s' "$method"
  curl -s -m 5 -X "$method" -w '  -> %{http_code}\n' http://127.0.0.1:4331/api/visits
done
echo "--- without credentials:"
for method in GET POST; do
  printf '%-7s' "$method"
  curl -s -m 5 -X "$method" -w '  -> %{http_code}\n' http://127.0.0.1:4332/api/visits
done
