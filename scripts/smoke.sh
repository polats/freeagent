#!/usr/bin/env bash
# Build the image and prove the two servers come up and talk to each other. Used by CI and by hand:
#   scripts/smoke.sh            # builds freeagent-cloud:ci, runs the checks, cleans up
#   IMAGE=... scripts/smoke.sh  # skip the build, test an existing image
set -euo pipefail

IMAGE="${IMAGE:-}"
NAME="freeagent-smoke-$$"
PORT="${PORT:-7860}"

if [ -z "$IMAGE" ]; then
  IMAGE=freeagent-cloud:ci
  docker build -t "$IMAGE" "$(dirname "$0")/.."
fi

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; echo "--- container log ---" >&2; docker logs "$NAME" >&2 || true; exit 1; }

TOKEN="ci-token-$(date +%s)-0123456789abcdef"

echo "== refuses to start without COLLIE_AUTH_TOKEN off-Codespaces"
if docker run --rm --name "$NAME" -e FREEAGENT_ALLOW_ANY_HOST=1 "$IMAGE"; then
  echo "FAIL: container started with no COLLIE_AUTH_TOKEN" >&2; exit 1
fi
cleanup
echo "OK"

echo "== refuses to start on an unknown public host"
if docker run --rm --name "$NAME" -e COLLIE_AUTH_TOKEN="$TOKEN" "$IMAGE"; then
  echo "FAIL: container started with no public host" >&2; exit 1
fi
cleanup
echo "OK"

echo "== the tools are installed"
docker run --rm "$IMAGE" bash -c 'herdr --version && bun --version && claude --version && codex --version && opencode --version' || fail "a tool is missing"
echo "OK"

echo "== herdr integrations were installed at build time"
docker run --rm "$IMAGE" bash -c 'test -f ~/.claude/settings.json && grep -q herdr ~/.claude/settings.json' || fail "claude hooks not installed"
echo "OK"

echo "== boots with the token and serves the API and the PWA"
docker run -d --name "$NAME" -p "$PORT:7860" \
  -e FREEAGENT_ALLOW_ANY_HOST=1 -e COLLIE_AUTH_TOKEN="$TOKEN" "$IMAGE" >/dev/null
AUTH="Authorization: Bearer $TOKEN"

code=""
for _ in $(seq 1 60); do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" || true)
  [ "$code" = "200" ] && break
  sleep 2
done
[ "$code" = "200" ] || fail "/api/health never returned 200 (last: ${code:-none})"
echo "OK: /api/health 200"

code=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/snapshot")
[ "$code" = "403" ] || fail "/api/snapshot without a credential returned $code, expected 403"
echo "OK: /api/snapshot refuses an uncredentialed read (403)"
snap=$(curl -s -m 10 -H "$AUTH" "http://127.0.0.1:$PORT/api/snapshot") || fail "/api/snapshot request failed"
echo "$snap" | jq -e . >/dev/null 2>&1 || fail "/api/snapshot is not JSON: $snap"
echo "OK: /api/snapshot with the token is JSON ($(echo "$snap" | wc -c) bytes)"

echo "== the token mints a device token, which then reads on its own"
dev=$(curl -s -m 10 -X POST -H "$AUTH" -H "Content-Type: application/json" -d '{"label":"ci phone"}' "http://127.0.0.1:$PORT/api/pair/token") || fail "/api/pair/token request failed"
devtok=$(echo "$dev" | jq -r '.token // empty'); [ -n "$devtok" ] || fail "/api/pair/token returned: $dev"
code=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $devtok" "http://127.0.0.1:$PORT/api/snapshot")
[ "$code" = "200" ] || fail "paired device read returned $code"
code=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"label":"x"}' "http://127.0.0.1:$PORT/api/pair/token")
[ "$code" = "403" ] || fail "/api/pair/token without the root token returned $code, expected 403"
echo "OK"

curl -s -m 10 "http://127.0.0.1:$PORT/" | grep -q "<title>" || fail "PWA not served on /"
echo "OK: PWA served on /"

echo "== herdr answers on its socket inside the container"
docker exec "$NAME" bash -c 'source /tmp/freeagent.env && herdr api snapshot' >/dev/null || fail "herdr api snapshot failed"
echo "OK"

echo "== a launcher row opens a pane"
resp=$(curl -s -m 30 -X POST -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"command":"bash"}' -w '\n%{http_code}' "http://127.0.0.1:$PORT/api/launch") || fail "/api/launch request failed"
status=${resp##*$'\n'}; body=${resp%$'\n'*}
echo "launch -> HTTP $status: $body"
[ "$status" = "200" ] || fail "/api/launch returned $status"
panes=0
for _ in $(seq 1 15); do
  panes=$(docker exec "$NAME" bash -c 'source /tmp/freeagent.env && herdr api snapshot | jq ".result.snapshot.panes | length"' 2>/dev/null || echo 0)
  [ "${panes:-0}" -gt 0 ] && break
  sleep 1
done
if [ "${panes:-0}" -le 0 ]; then
  echo "--- herdr snapshot ---"; docker exec "$NAME" bash -c 'source /tmp/freeagent.env && herdr api snapshot' || true
  echo "--- herdr server log ---"; docker exec "$NAME" bash -c 'source /tmp/freeagent.env && tail -50 "$XDG_CONFIG_HOME/herdr/herdr-server.log"' || true
  fail "no pane after launch"
fi
echo "OK: $panes pane(s)"

echo "--- container log ---"
docker logs "$NAME"
echo "ALL OK"
