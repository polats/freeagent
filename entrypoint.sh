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
  export COLLIE_PUBLIC_URL="https://${PUBLIC_HOST}"   # lets `collie pair` print a QR for the phone
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

# --- template mode --------------------------------------------------------------------------
# The public template Space that the landing page duplicates from has no COLLIE_AUTH_TOKEN of its
# own and must never run agents. With FREEAGENT_TEMPLATE=1 (a Space *variable*, so it is copied
# nowhere: duplicates get secrets and variables of their own) it serves one static page saying so,
# stays healthy for Hugging Face, and exits the moment anything else is asked of it.
if [ "${FREEAGENT_TEMPLATE:-0}" = "1" ]; then
  log "template mode: serving the template notice on :$PORT — nothing else starts"
  mkdir -p /tmp/template && cp /opt/freeagent/template/index.html /tmp/template/index.html
  cd /tmp/template && exec python3 -m http.server "$PORT" --bind 0.0.0.0
fi

# --- refuse to run unprotected -------------------------------------------------------------
# Collie's first factor here is COLLIE_AUTH_TOKEN (its "Variant F"): every /api route, reads
# included, needs the token or a paired device's token; static assets and /api/health stay open.
# On a public URL (Hugging Face, Railway) that token is the only thing between the internet and a
# shell, so refuse to start without one. A Codespace forwards its port privately — every request
# already carries the owner's GitHub identity — so there the token is optional (and still honoured).
if [ -z "${COLLIE_AUTH_TOKEN:-}" ]; then
  if [ "${CODESPACES:-}" = "true" ]; then
    log "auth: no COLLIE_AUTH_TOKEN — relying on the codespace's private port (GitHub identity) alone"
  else
    die "COLLIE_AUTH_TOKEN is not set.

  Every Collie route can type into a shell on this container. On a public URL the token is the
  only thing in front of that, so this image refuses to start without one. Generate 24+ random
  characters (e.g. openssl rand -base64 32), set it as a secret on the platform, and redeploy:

    Hugging Face  Settings -> Variables and secrets -> New secret
    Railway       Variables -> New Variable

  Then open the URL with #token=<the token> once, or pair with: freeagent-pair"
  fi
elif [ "${#COLLIE_AUTH_TOKEN}" -lt 24 ]; then
  log "auth: WARNING — COLLIE_AUTH_TOKEN is only ${#COLLIE_AUTH_TOKEN} characters; use 24 or more"
else
  log "auth: COLLIE_AUTH_TOKEN set (${#COLLIE_AUTH_TOKEN} chars) — every /api route requires it or a paired device"
fi
export COLLIE_AUTH_TOKEN="${COLLIE_AUTH_TOKEN:-}"

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
  # Agent homes too: this is where each agent keeps the login it does in its pane (Claude Code
  # .credentials.json, Codex auth.json; OpenCode's auth.json is under XDG_DATA_HOME above). Both
  # variables are honoured by the agents and by herdr's integration installer.
  export CLAUDE_CONFIG_DIR="$STATE_ROOT/claude"
  export CODEX_HOME="$STATE_ROOT/codex"
  WORKSPACE="${FREEAGENT_WORKSPACE:-$STATE_ROOT/workspace}"
  log "persistence: $STATE_ROOT (herdr sessions, agent logins, collie pairing and code survive restarts)"
else
  export XDG_CONFIG_HOME="$HOME/.config"
  export XDG_STATE_HOME="$HOME/.local/state"
  export XDG_DATA_HOME="$HOME/.local/share"
  export XDG_CACHE_HOME="$HOME/.cache"
  export COLLIE_STATE_DIR="$HOME/.local/state/collie"
  export HERDR_PLUGIN_CONFIG_DIR="$HOME/.config/collie"
  export CLAUDE_CONFIG_DIR="$HOME/.claude"
  export CODEX_HOME="$HOME/.codex"
  WORKSPACE="${FREEAGENT_WORKSPACE:-$HOME/workspace}"
  log "persistence: NONE — $STATE_ROOT is not a writable mount."
  log "             Sessions, agent logins, pairings and uncommitted code are lost on restart."
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
# Herdr writes the OpenCode plugin to ~/.config/opencode (HOME-relative, ignoring XDG), while
# OpenCode itself reads $XDG_CONFIG_HOME/opencode — which the persistence block may have moved to
# the state root. Point the former at the latter so both see one directory, carrying over anything
# the build installed.
if [ "$XDG_CONFIG_HOME" != "$HOME/.config" ] && [ ! -L "$HOME/.config/opencode" ]; then
  mkdir -p "$XDG_CONFIG_HOME/opencode" "$HOME/.config"
  if [ -d "$HOME/.config/opencode" ]; then
    cp -rn "$HOME/.config/opencode/." "$XDG_CONFIG_HOME/opencode/" 2>/dev/null || true
    rm -rf "$HOME/.config/opencode"
  fi
  ln -s "$XDG_CONFIG_HOME/opencode" "$HOME/.config/opencode"
fi
# The agent homes are created empty and herdr installs its hooks into them below. Do NOT seed
# them from the build-time copies under $HOME: those hooks point at $HOME paths, and herdr then
# adds a second entry for the real path, so Codex asked to trust three hooks instead of two and
# every session ran the state hook twice.
mkdir -p "$CLAUDE_CONFIG_DIR" "$CODEX_HOME"
for agent in claude codex opencode; do
  herdr integration install "$agent" >/dev/null 2>&1 \
    || log "warning: herdr integration install $agent failed — $agent state will fall back to screen detection"
done

# --- agent sign-in -------------------------------------------------------------------------
# The intended path is the same as on a laptop: launch the agent from the phone and sign in with
# your own account inside its pane. Browser callbacks to localhost cannot reach a container, so
# each agent's "paste the code" fallback is what runs here — Claude Code (/login, Claude
# subscription), Codex (`codex login --device-auth`), OpenCode (`opencode auth login`, Anthropic
# Claude Pro/Max) all have one. Collie autolinks the URL the agent prints, so it is one tap on
# the phone, and the resulting credentials persist under the state root above. API keys still
# work when set, for CI and for users who prefer them.
have_cred=0
for v in ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN OPENAI_API_KEY OPENCODE_API_KEY GEMINI_API_KEY; do
  if [ -n "${!v:-}" ]; then have_cred=1; log "credentials: $v set (API key mode)"; fi
done
if [ "$have_cred" = 0 ]; then
  signed=""
  [ -f "$CLAUDE_CONFIG_DIR/.credentials.json" ] && signed="$signed claude"
  [ -f "$CODEX_HOME/auth.json" ] && signed="$signed codex"
  [ -f "$XDG_DATA_HOME/opencode/auth.json" ] && signed="$signed opencode"
  if [ -n "$signed" ]; then
    log "credentials: signed in:$signed (stored under the state root)"
  else
    log "credentials: none yet — launch an agent from the phone and sign in with your account in its pane."
  fi
fi

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

# --- web push keys ---------------------------------------------------------------------------
# Collie's push is standard Web Push with per-install VAPID keys. Generate them once into the state
# dir so notifications work from the first boot and survive restarts; an operator-supplied pair
# in the environment wins. Needs the optional `web-push` dependency Collie installs at build time.
if [ -z "${COLLIE_VAPID_PUBLIC:-}" ] && [ -z "${COLLIE_VAPID_PRIVATE:-}" ]; then
  VAPID_FILE="$COLLIE_STATE_DIR/vapid.json"
  if [ ! -f "$VAPID_FILE" ]; then
    if ( cd /opt/collie && bun -e 'const w=require("web-push");process.stdout.write(JSON.stringify(w.generateVAPIDKeys()))' > "$VAPID_FILE.tmp" 2>/dev/null ); then
      mv "$VAPID_FILE.tmp" "$VAPID_FILE"; chmod 600 "$VAPID_FILE"
      log "push: generated VAPID keys into $VAPID_FILE"
    else
      rm -f "$VAPID_FILE.tmp"; log "push: could not generate VAPID keys (web-push missing?) — push disabled"
    fi
  fi
  if [ -f "$VAPID_FILE" ]; then
    export COLLIE_VAPID_PUBLIC="$(jq -r .publicKey "$VAPID_FILE")"
    export COLLIE_VAPID_PRIVATE="$(jq -r .privateKey "$VAPID_FILE")"
    export COLLIE_VAPID_SUBJECT="${COLLIE_VAPID_SUBJECT:-https://${PUBLIC_HOST:-localhost}}"
  fi
fi

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
           COLLIE_SKIP_SERVE COLLIE_PUBLIC_HOSTS COLLIE_ALLOWED_ORIGINS COLLIE_PUBLIC_URL COLLIE_ALLOW_ANY_HOST COLLIE_AUTH_TOKEN; do
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
