#!/usr/bin/env bash
# Boot Herdr + Collie inside a GitHub Codespace.
#
# Codespaces secrets are not in postStartCommand's environment: they are written to a JSON file
# and applied to interactive shells only. A server started by the lifecycle hook sees none of
# them, so agent API keys would be missing. Source that file first, then hand off to the
# same entrypoint the other platforms run.
set -euo pipefail

SECRETS="/workspaces/.codespaces/shared/user-secrets-envs.json"

if [ -f "$SECRETS" ]; then
  # A flat { "NAME": "value" } object. Exported only if not already set, so a variable given
  # explicitly by devcontainer.json still wins.
  while IFS='=' read -r name value; do
    [ -n "$name" ] || continue
    if [ -z "${!name:-}" ]; then
      export "$name=$value"
    fi
  done < <(python3 -c '
import json, sys
with open(sys.argv[1]) as handle:
    for name, value in json.load(handle).items():
        if isinstance(value, str) and "\n" not in value:
            print(f"{name}={value}")
' "$SECRETS")
  echo "codespaces: loaded secrets from $(basename "$SECRETS")"
else
  echo "codespaces: no secrets file at $SECRETS"
fi

# entrypoint.sh only uses the state root if it already exists and is writable.
mkdir -p "${FREEAGENT_STATE_ROOT:-/workspaces/.freeagent-state}" 2>/dev/null || true

exec /home/node/entrypoint.sh
