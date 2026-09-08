# freeagent

Run Claude Code, Codex and OpenCode on a box you own and drive them from your phone.

Open **https://freeagent.cosmiclabs.org**, sign in with GitHub or Hugging Face, and a box is
created in your own account: a GitHub Codespace, or a Hugging Face Space. You land in a phone UI
that shows every agent, floats the one that needs you to the top, and lets you answer with a tap.
Agents sign in with your own subscriptions. Nothing of ours holds your data.

## How it works

Two pieces, both in this repo.

**The box** is a Docker image. [Herdr](https://herdr.dev) runs headless and owns the agents'
terminals: it knows which pane is working, idle or blocked on you. [Collie](https://github.com/polats/collie)
(a fork of [AltanS/collie](https://github.com/AltanS/collie) with cloud auth) is the only network
listener: it serves the mobile PWA and turns each agent's prompts into tappable buttons.

```
phone (PWA)
  │ HTTPS
  ▼
collie   0.0.0.0:$PORT   the only network listener
  │ Unix socket
  ▼
herdr    headless        owns the terminals
  ├─ claude
  ├─ codex
  └─ opencode
```

**The landing page** is a static site on Cloudflare Pages with one small function for OAuth. It
creates boxes through the providers' own APIs and lists, opens and deletes the ones you have. See
[`landing/README.md`](landing/README.md) to host your own.

## Where a box can run

| Platform | Created by | What keeps strangers out | Persistence |
| --- | --- | --- | --- |
| GitHub Codespaces (default) | the landing page, via GitHub's API | the forwarded port is private to your GitHub account | disk survives idle stops (1 h idle timeout, free plan 120 core-hours/month) |
| Hugging Face Spaces | the landing page, by duplicating the template Space `polats/freeagent` | `COLLIE_AUTH_TOKEN`, a secret set at creation; the page hands it to your phone once | none on the free tier: a restart forgets agent sign-ins unless you add paid storage |
| Railway, or any Docker host | you | `COLLIE_AUTH_TOKEN` | attach a volume at `/data` |

The token is a root credential to a shell. The entrypoint refuses to start without one on any
platform whose URL is public; Codespaces are the exception because the port is already private.

## Starting from a repository

Pick a repository when creating a box and the box clones it before you arrive. A Hugging Face Space
gets `FREEAGENT_REPO` as a variable (and, for a private repository, `GITHUB_TOKEN` as a secret) and
clones at boot. A codespace has no per-box variables, so the landing page passes `#repo=owner/name`
to Collie, which runs `freeagent-clone` in a pane you can watch. Either way the Launch buttons then
open agents inside the checkout, and a credential helper lets them push.

## Signing in to the agents

Agents use your existing subscription, not API keys. A container has no browser, so each agent's
no-browser sign-in runs in its pane; Collie makes the link tappable. Once per agent per box:

| Agent | Launcher | What happens |
| --- | --- | --- |
| Claude Code | `claude auth login` | Tap the URL, log in to Claude, paste the code back. |
| Codex | `codex login --device-auth` | Open the link, sign in to ChatGPT, enter the one-time code. |
| OpenCode | `opencode auth login` | Pick a provider, tap the URL, paste the authorization code. |

API keys work as an override: set `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`),
`OPENAI_API_KEY` or `OPENCODE_API_KEY` as secrets and that agent skips the sign-in.

## Repository layout

```
Dockerfile, entrypoint.sh   the box image: herdr + collie + agents, one entrypoint for every platform
.devcontainer/              the same image as a GitHub Codespace (port 7860, private)
config/launchers.toml       the phone's Launch buttons (agents, sign-ins, shell)
bin/freeagent-pair          issue a Collie pairing code from inside the box
bin/freeagent-clone         clone owner/name into the workspace and point the launchers at it
template/                   the notice the template Space serves (FREEAGENT_TEMPLATE=1)
hf-space/README.md          the template Space's own README and configuration
landing/                    the landing page (Cloudflare Pages)
scripts/smoke.sh            build the image and prove both servers come up; CI runs it
```

CI: `verify.yml` builds and smoke-tests the image on every push; `sync-to-hf-space.yml` then
republishes the template Space (secret `HF_TOKEN`, variable `HF_SPACE`); `deploy-landing.yml`
deploys the landing page when it changes (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).

## Run the box yourself

```bash
docker build -t freeagent .
TOKEN=$(openssl rand -base64 32)
docker run --rm -p 7860:7860 -e FREEAGENT_ALLOW_ANY_HOST=1 -e COLLIE_AUTH_TOKEN="$TOKEN" -v freeagent-data:/data freeagent
```

Then open `http://localhost:7860/#token=$TOKEN`. On Railway or a Space, set `COLLIE_AUTH_TOKEN`
as a secret before the first boot and mount a volume at `/data`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7860` | Listen port. Railway sets it; a Space must match `app_port`. |
| `COLLIE_AUTH_TOKEN` | — | Root bearer secret. Required unless running as a Codespace. |
| `FREEAGENT_PUBLIC_HOST` | platform-derived | Hostname Collie is served on, from `SPACE_HOST`, `RAILWAY_PUBLIC_DOMAIN` or the Codespace name. |
| `FREEAGENT_ALLOW_ANY_HOST` | — | `1` to skip Host validation (local docker only). |
| `FREEAGENT_STATE_ROOT` | `/data` | Writable mount for herdr, collie, agent sign-ins and the workspace. |
| `FREEAGENT_REPO` | — | `owner/name` to clone at boot; `GITHUB_TOKEN` alongside it for a private repository. |
| `FREEAGENT_TEMPLATE` | — | `1` serves the template notice and starts nothing. |

Build args pin versions: `HERDR_VERSION` (+ sha256s), `COLLIE_REF`, `BUN_VERSION`,
`CLAUDE_CODE_VERSION`, `CODEX_VERSION`, `OPENCODE_VERSION`.

## Read this before you deploy

- **A box is a remote shell.** Collie's write routes type into a live terminal as the container
  user. Treat its URL and token as a root login.
- **Agent sign-ins live on the box**, under the state root. Anyone with the shell can read them,
  exactly as on a laptop.
- **Pair your phone** and rely on device tokens; rotate the root token by redeploying.

MIT. Herdr is © its authors under Apache-2.0; Collie is © its authors under MIT; this repo is
deployment wrapper code.
