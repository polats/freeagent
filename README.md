---
title: Freeagent Cloud
emoji: 🐑
colorFrom: gray
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# freeagent-cloud

Run terminal coding agents — Claude Code, Codex, OpenCode — on a cloud box and drive them from
your phone. One image: [Herdr](https://herdr.dev) owns the agents' terminals headlessly and
knows which one is blocked on you; [Collie](https://github.com/AltanS/collie) serves the
mobile web UI that shows the herd and turns each agent's prompts into tappable buttons.

Deployable to **GitHub Codespaces**, **Hugging Face Spaces** and **Railway**, and built to be
provisioned by [crux.casa](https://github.com/polats/crux.casa) as a second runtime beside
[opencode-cloud](https://github.com/polats/opencode-cloud). This is Phase 0 of
`freeagent/PLAN.md`: prove the stack in a container. Read [Status](#status) before deploying.

```
phone (PWA / Crux app)
  │ HTTPS
  ▼
collie bridge  0.0.0.0:$PORT   (the only network listener)
  │ Unix socket
  ▼
herdr server   (headless; owns the PTYs)
  ├─ claude
  ├─ codex
  └─ opencode
```

## Status

Phase 1 of `freeagent/PLAN.md`. Collie's fork adds **cloud auth**: `COLLIE_AUTH_TOKEN` is a bearer
secret that every `/api` route requires, reads included, unless the caller is a paired device.
Static assets and `/api/health` stay open. The entrypoint refuses to start without the token on
any platform whose URL is public.

| Platform | Auth | Notes |
| --- | --- | --- |
| GitHub Codespaces | private port (GitHub identity), token optional | `devcontainer.json` pins the port private; set the token too if you want pairing bootstrap via URL. |
| Hugging Face Spaces | `COLLIE_AUTH_TOKEN` required | Set it in the creation request or as a Space secret before first boot. |
| Railway | `COLLIE_AUTH_TOKEN` required | Set it as a service variable. |

The token is a root credential to a shell. Generate 24+ random characters
(`openssl rand -base64 32`), keep it in the platform's secret store, rotate by redeploying.

**Getting a phone in.** Open `https://<host>/#token=<the token>` once. The PWA trades the secret
for a device token of its own before it renders, stores that, and strips the fragment from the URL.
The device then appears under Settings like any paired phone and can be revoked on its own. The
code-based `freeagent-pair` path still works too.

## The template Space and the landing page

`polats/freeagent` on Hugging Face is a public **template** copy of this repo, kept in sync by
`.github/workflows/sync-to-hf-space.yml` after every green CI run. It runs in template mode
(`FREEAGENT_TEMPLATE=1`), serving a notice and starting nothing. To enable the sync on your fork:

```bash
gh secret set HF_TOKEN --repo OWNER/REPO            # a Hugging Face write token
gh variable set HF_SPACE --repo OWNER/REPO --body "hfuser/freeagent"
```

`landing/` is the static page that duplicates the template into a visitor's own account, on
Vercel. See [`landing/README.md`](landing/README.md).

## Run as a GitHub Codespace

```
Code -> Codespaces -> Create codespace on main
```

No secrets are needed. Each agent signs in with **your own account** from inside its pane, the
same way it would on your laptop; see [Signing in](#signing-in).

`postStartCommand` boots both servers on create and after every idle stop; the log is
`/tmp/freeagent.log`. Open the forwarded port 7860 in the browser, install the PWA, then pair
the phone as the write credential:

```bash
gh codespace ssh -c <name> -- freeagent-pair     # prints a code; enter it under Settings on the phone
```

State lives under `/workspaces/.freeagent-state` and survives a stop. A codespace stops after
30 minutes idle by default (240 maximum) and running agents stop with it; Herdr restores the
layout and resumes Claude Code sessions it knows about on the next start.

## Signing in

Agents use your existing subscription, not API keys. A container has no browser, and OAuth
callbacks to `localhost` cannot reach it, so each agent's no-browser fallback is what runs here.
From the phone, tap the sign-in launcher for the agent, then:

| Agent | Launcher runs | What happens |
| --- | --- | --- |
| Claude Code | `claude auth login` | Prints a sign-in URL. Tap it, log in to Claude, copy the code shown, paste it into the pane. |
| Codex | `codex login --device-auth` | Prints a link and a one-time code. Open the link, sign in to ChatGPT, enter the code. |
| OpenCode | `opencode auth login` | Pick the provider (Anthropic → Claude Pro/Max). Tap the URL, then paste the authorization code. |

Collie autolinks URLs in pane output, so the link is one tap. Credentials persist under the
state root (`$STATE_ROOT/claude`, `$STATE_ROOT/codex`, `$STATE_ROOT/share/opencode`) and
survive restarts and idle stops, so this is once per agent per deployment.

API keys still work as an override for CI or for users who prefer them: set `ANTHROPIC_API_KEY`
or `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `OPENCODE_API_KEY` as secrets and the agents
skip the login.

## Run locally

```bash
docker build -t freeagent-cloud .
TOKEN=$(openssl rand -base64 32)
docker run --rm -p 7860:7860 \
  -e FREEAGENT_ALLOW_ANY_HOST=1 -e COLLIE_AUTH_TOKEN="$TOKEN" \
  -v freeagent-data:/data \
  freeagent-cloud
```

Then open `http://localhost:7860/#token=$TOKEN`. `scripts/smoke.sh` builds the image and checks that both
servers come up, the PWA is served, and a launcher row opens a pane; CI runs the same script.

## Deploy on Hugging Face Spaces or Railway

Same recipe as opencode-cloud: Docker Space or `railway up`, a `/data` volume for persistence
(without it every sign-in is lost on restart), and `COLLIE_AUTH_TOKEN` as a secret **before first
boot** (on Hugging Face, in the Space creation request; see [Status](#status)). The public hostname is read from `SPACE_HOST` or `RAILWAY_PUBLIC_DOMAIN`;
set `FREEAGENT_PUBLIC_HOST` if you front it with your own domain.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7860` | Listen port. Railway sets it; HF must match `app_port`. |
| `FREEAGENT_PUBLIC_HOST` | platform-derived | Hostname Collie is served on. Derived from `SPACE_HOST`, `RAILWAY_PUBLIC_DOMAIN`, or `CODESPACE_NAME` + `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`. |
| `FREEAGENT_ALLOW_ANY_HOST` | — | `1` to skip Host validation (local docker only). |
| `COLLIE_AUTH_TOKEN` | — | **Required off-Codespaces.** Root bearer secret; every `/api` route needs it or a paired device's token. |
| `COLLIE_VAPID_PUBLIC` / `COLLIE_VAPID_PRIVATE` | generated | Web Push keys. Generated into the state root on first boot when unset. |
| `FREEAGENT_STATE_ROOT` | `/data` | Writable mount for herdr state, collie state and the workspace. Codespaces sets `/workspaces/.freeagent-state`. |
| `FREEAGENT_WORKSPACE` | `$STATE_ROOT/workspace` | Directory agents start in. |
| `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` | — | Optional. Claude Code skips the in-pane sign-in. |
| `OPENAI_API_KEY` | — | Optional. Codex skips the in-pane sign-in. |
| `OPENCODE_API_KEY`, `GEMINI_API_KEY`, ... | — | Optional. OpenCode providers (models.dev env vars). |

Any `COLLIE_*` variable Collie documents can be set too; the entrypoint only sets the ones the
deployment shape requires. Collie's `launchers.toml` is seeded from `config/launchers.toml` into
the state root on first boot and read live after that.

Build args: `HERDR_VERSION` (+ its two sha256s), `COLLIE_REF`, `BUN_VERSION`,
`CLAUDE_CODE_VERSION`, `CODEX_VERSION`, `OPENCODE_VERSION`.

## Read this before you deploy

- **This is a remote shell.** Every Collie write route types keystrokes into a live terminal as
  the container user, and reads show whatever is on screen. Treat the URL as a root login.
- **Sign-in tokens live in the container.** Whoever can reach the shell can read
  `$STATE_ROOT/claude/.credentials.json`, `$STATE_ROOT/codex/auth.json` and OpenCode's `auth.json`.
  That is the same exposure as a laptop, on a machine you reach over the network.
- **The token is the door.** Anyone holding `COLLIE_AUTH_TOKEN` has the shell. Hand it to a phone
  once via `#token=`, then rely on the device token it minted; rotate the root token by redeploying.

MIT. Herdr is © its authors under Apache-2.0; Collie is © its authors under MIT; this repo is
deployment wrapper code.
