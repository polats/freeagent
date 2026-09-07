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

echo "== refuses to start on an unknown public host without acknowledgement"
if docker run --rm --name "$NAME" "$IMAGE"; then
  echo "FAIL: container started with no public host and no acknowledgement" >&2; exit 1
fi
cleanup
echo "OK"

echo "== the tools are installed"
docker run --rm "$IMAGE" bash -c 'herdr --version && bun --version && claude --version && codex --version && opencode --version' || fail "a tool is missing"
echo "OK"

echo "== herdr integrations were installed at build time"
docker run --rm "$IMAGE" bash -c 'test -f ~/.claude/settings.json && grep -q herdr ~/.claude/settings.json' || fail "claude hooks not installed"
echo "OK"

echo "== boots and serves the API and the PWA"
docker run -d --name "$NAME" -p "$PORT:7860" \
  -e FREEAGENT_ALLOW_ANY_HOST=1 -e FREEAGENT_ACKNOWLEDGE_NO_AUTH=1 "$IMAGE" >/dev/null

code=""
for _ in $(seq 1 60); do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" || true)
  [ "$code" = "200" ] && break
  sleep 2
done
[ "$code" = "200" ] || fail "/api/health never returned 200 (last: ${code:-none})"
echo "OK: /api/health 200"

snap=$(curl -s -m 10 -H "Origin: http://127.0.0.1:$PORT" "http://127.0.0.1:$PORT/api/snapshot") || fail "/api/snapshot request failed"
echo "$snap" | jq -e . >/dev/null 2>&1 || fail "/api/snapshot is not JSON: $snap"
echo "OK: /api/snapshot is JSON ($(echo "$snap" | wc -c) bytes)"

curl -s -m 10 "http://127.0.0.1:$PORT/" | grep -q "<title>" || fail "PWA not served on /"
echo "OK: PWA served on /"

echo "== herdr answers on its socket inside the container"
docker exec "$NAME" bash -c 'source /tmp/freeagent.env && herdr api snapshot' >/dev/null || fail "herdr api snapshot failed"
echo "OK"

echo "== a launcher row opens a pane"
launch=$(curl -s -m 20 -X POST -H "Content-Type: application/json" -H "Origin: http://127.0.0.1:$PORT" \
  -d '{"command":"bash"}' "http://127.0.0.1:$PORT/api/launch") || fail "/api/launch request failed"
echo "$launch" | jq -e . >/dev/null 2>&1 || fail "/api/launch did not return JSON: $launch"
sleep 3
docker exec "$NAME" bash -c 'source /tmp/freeagent.env && herdr api snapshot | jq -e ".panes | length > 0"' >/dev/null || fail "no pane after launch"
echo "OK: $launch"

echo "--- container log ---"
docker logs "$NAME"
echo "ALL OK"
