#!/usr/bin/env bash
# Boot Herdr (headless) and Collie (phone UI) for a PaaS: Hugging Face Spaces, Railway, Codespaces.
#
# Two processes, one container. Herdr owns the agents' terminals and exposes a Unix socket; Collie
# is the only thing that talks to that socket and the only thing listening on the network port.
# If either dies the container exits so the platform restarts it.
set -euo pipefail

# Allow `docker run <image> bash` etc. to override for debugging. PaaS hosts pass no arguments.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

log() { echo "[freeagent] $*"; }
die() { echo "[freeagent] FATAL: $*" >&2; exit 1; }

# --- port --------------------------------------------------------------------------------
# Railway injects $PORT. HF Spaces does not; 7860 must match app_port in README.md.
PORT="${PORT:-7860}"

# --- public host -------------------------------------------------------------------------
# Collie validates the Host header fail-closed and enforces same-origin, so it must know the URL
# it is served on. Each platform names it differently; FREEAGENT_PUBLIC_HOST overrides all.
PUBLIC_HOST="${FREEAGENT_PUBLIC_HOST:-}"
if [ -z "$PUBLIC_HOST" ] && [ -n "${SPACE_HOST:-}" ]; then
  PUBLIC_HOST="$SPACE_HOST"                                   # Hugging Face Spaces
elif [ -z "$PUBLIC_HOST" ] && [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then
  PUBLIC_HOST="$RAILWAY_PUBLIC_DOMAIN"                        # Railway
elif [ -z "$PUBLIC_HOST" ] && [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
  PUBLIC_HOST="${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"   # Codespaces
fi

if [ -n "$PUBLIC_HOST" ]; then
  export COLLIE_PUBLIC_HOSTS="$PUBLIC_HOST"
  export COLLIE_ALLOWED_ORIGINS="https://${PUBLIC_HOST}"
  log "public host: https://${PUBLIC_HOST}"
elif [ "${FREEAGENT_ALLOW_ANY_HOST:-0}" = "1" ]; then
  export COLLIE_ALLOW_ANY_HOST=1
  log "public host: unknown — COLLIE_ALLOW_ANY_HOST=1 (FREEAGENT_ALLOW_ANY_HOST=1 was set)"
else
  die "cannot determine the public hostname.
  Set FREEAGENT_PUBLIC_HOST=<host> to the domain this container is served on, or
  FREEAGENT_ALLOW_ANY_HOST=1 for a local docker run. Collie refuses requests whose Host
  header it does not recognise, so without one of these every request would be rejected."
fi

# --- refuse to run unprotected -------------------------------------------------------------
# Phase 0 status: Collie's first factor is still Tailscale or a reverse proxy, neither of which
# exists on a public PaaS URL. Its device pairing gates WRITES once a device is paired, but reads
# (agent output, source, secrets on screen) are open to anyone who can reach the port.
#
# A Codespace forwards ports privately: every request must carry the owner's GitHub identity
# (browser session or X-Github-Token), so that is the one platform that is safe as-is.
# Everywhere else, refuse unless the operator says they understand. Phase 1 of PLAN.md replaces
# this with COLLIE_AUTH_TOKEN.
if [ "${CODESPACES:-}" != "true" ] && [ "${FREEAGENT_ACKNOWLEDGE_NO_AUTH:-0}" != "1" ]; then
  die "no authentication in front of Collie on this platform.

  This image (Phase 0) has no first-factor auth of its own. On a public URL anyone who can
  reach it can read every agent's screen, and until a device is paired, type into it.
  Codespaces are exempt because their forwarded ports are private to the GitHub account.

  Set FREEAGENT_ACKNOWLEDGE_NO_AUTH=1 to start anyway (local docker run, or a URL you have
  otherwise protected). Then pair your phone immediately: freeagent-pair"
fi

# --- persistence -------------------------------------------------------------------------
# Herdr keeps config and session state under the XDG dirs; Collie keeps pairing, uploads, audit
# and the journal under COLLIE_STATE_DIR and its operator TOML files under HERDR_PLUGIN_CONFIG_DIR.
#   HF Spaces  persistent storage is mounted at /data (paid add-on)
#   Railway    attach a volume with mount path /data
#   Codespaces /workspaces survives stop/start; devcontainer.json points here
STATE_ROOT="${FREEAGENT_STATE_ROOT:-/data}"

if [ -d "$STATE_ROOT" ] && [ -w "$STATE_ROOT" ]; then
  export XDG_CONFIG_HOME="$STATE_ROOT/config"
  export XDG_STATE_HOME="$STATE_ROOT/state"
  export XDG_DATA_HOME="$STATE_ROOT/share"
  export XDG_CACHE_HOME="$STATE_ROOT/cache"
  export COLLIE_STATE_DIR="$STATE_ROOT/collie/state"
  export HERDR_PLUGIN_CONFIG_DIR="$STATE_ROOT/collie/config"
  WORKSPACE="${FREEAGENT_WORKSPACE:-$STATE_ROOT/workspace}"
  log "persistence: $STATE_ROOT (herdr sessions, collie pairing and code survive restarts)"
else
  export XDG_CONFIG_HOME="$HOME/.config"
  export XDG_STATE_HOME="$HOME/.local/state"
  export XDG_DATA_HOME="$HOME/.local/share"
  export XDG_CACHE_HOME="$HOME/.cache"
  export COLLIE_STATE_DIR="$HOME/.local/state/collie"
  export HERDR_PLUGIN_CONFIG_DIR="$HOME/.config/collie"
  WORKSPACE="${FREEAGENT_WORKSPACE:-$HOME/workspace}"
  log "persistence: NONE — $STATE_ROOT is not a writable mount."
  log "             Sessions, pairings and uncommitted code are lost on restart."
  log "             Push to git before you walk away, or attach a volume at $STATE_ROOT."
fi

mkdir -p "$XDG_CONFIG_HOME/herdr" "$XDG_STATE_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" \
         "$COLLIE_STATE_DIR" "$HERDR_PLUGIN_CONFIG_DIR" "$WORKSPACE"
cd "$WORKSPACE"

# Volumes routinely carry a different owner than uid 1000; trust what we already control.
git config --global --add safe.directory '*' 2>/dev/null || true

# Seed Collie's launcher rows (the phone's Launch buttons: claude, codex, opencode) once.
# Operators can edit the copy under the state root; edits are picked up live.
if [ ! -f "$HERDR_PLUGIN_CONFIG_DIR/launchers.toml" ]; then
  cp /opt/freeagent/config/launchers.toml "$HERDR_PLUGIN_CONFIG_DIR/launchers.toml"
fi

# --- herdr agent integrations -------------------------------------------------------------
# Installed at build time under $HOME, but the OpenCode plugin lives under the XDG config dir,
# which the persistence block above may have moved to the state root. Re-running is idempotent
# and cheap, and it keeps every agent's hooks pointing at this boot's paths.
for agent in claude codex opencode; do
  herdr integration install "$agent" >/dev/null 2>&1 \
    || log "warning: herdr integration install $agent failed — $agent state will fall back to screen detection"
done

# --- agent credentials --------------------------------------------------------------------
# Browser OAuth flows cannot complete inside a headless container; agents need keys or tokens.
have_cred=0
for v in ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY OPENCODE_API_KEY GEMINI_API_KEY; do
  if [ -n "${!v:-}" ]; then have_cred=1; log "credentials: $v set"; fi
done
[ "$have_cred" = 1 ] || log "credentials: none set — agents will start but cannot call a model.
             Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (claude setup-token), OPENAI_API_KEY, OPENCODE_API_KEY."

# --- herdr -------------------------------------------------------------------------------
# One explicit socket path, exported so herdr, its hooks inside panes, Collie and the pairing
# helper all agree. The client socket is derived by herdr as herdr-client.sock beside it.
export HERDR_SOCKET_PATH="$XDG_CONFIG_HOME/herdr/herdr.sock"
rm -f "$HERDR_SOCKET_PATH"   # a stale socket from an unclean stop would make herdr refuse to bind

log "herdr $(herdr --version 2>/dev/null | head -1) starting headless (socket: $HERDR_SOCKET_PATH)"
herdr server &
HERDR_PID=$!

for _ in $(seq 1 60); do
  if [ -S "$HERDR_SOCKET_PATH" ] && herdr api snapshot >/dev/null 2>&1; then break; fi
  if ! kill -0 "$HERDR_PID" 2>/dev/null; then die "herdr server exited during startup"; fi
  sleep 0.5
done
herdr api snapshot >/dev/null 2>&1 || die "herdr server did not answer on $HERDR_SOCKET_PATH within 30s"
log "herdr: ready"

# --- collie ------------------------------------------------------------------------------
# Variant "public PaaS": no tailscale serve, bind every interface, Host/Origin pinned above.
export COLLIE_MUX=herdr
export COLLIE_HOST=0.0.0.0
export COLLIE_ALLOW_NON_LOOPBACK_BIND=1
export COLLIE_PORT="$PORT"
export COLLIE_SKIP_SERVE=1
export COLLIE_TRUSTED_USER_OPTIONAL=1

# The pairing helper and any debugging shell need the same resolved environment as the bridge.
{
  for v in HERDR_SOCKET_PATH XDG_CONFIG_HOME XDG_STATE_HOME XDG_DATA_HOME XDG_CACHE_HOME \
           COLLIE_STATE_DIR HERDR_PLUGIN_CONFIG_DIR COLLIE_MUX COLLIE_HOST COLLIE_PORT \
           COLLIE_SKIP_SERVE COLLIE_PUBLIC_HOSTS COLLIE_ALLOWED_ORIGINS COLLIE_ALLOW_ANY_HOST; do
    [ -n "${!v:-}" ] && printf 'export %s=%q\n' "$v" "${!v}"
  done
} > /tmp/freeagent.env

log "collie starting on 0.0.0.0:$PORT (workspace: $WORKSPACE)"
( cd /opt/collie && exec bun run bridge/index.ts ) &
COLLIE_PID=$!

# --- supervise ---------------------------------------------------------------------------
# Whichever exits first takes the container down; the platform's restart policy brings it back.
shutdown() {
  log "shutting down"
  kill "$COLLIE_PID" "$HERDR_PID" 2>/dev/null || true
  wait "$COLLIE_PID" 2>/dev/null || true
  herdr server stop >/dev/null 2>&1 || true
  wait "$HERDR_PID" 2>/dev/null || true
}
trap 'shutdown; exit 0' TERM INT

set +e
wait -n "$HERDR_PID" "$COLLIE_PID"
code=$?
set -e
if kill -0 "$HERDR_PID" 2>/dev/null; then
  log "collie exited ($code)"
else
  log "herdr exited ($code)"
fi
shutdown
exit "${code:-1}"
