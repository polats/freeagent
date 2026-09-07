---
title: freeagent
emoji: 🐑
colorFrom: yellow
colorTo: gray
sdk: static
app_file: index.html
pinned: false
license: mit
hf_oauth: true
# Only needed for the length of the flow: duplicate a Space, poll it, redirect.
hf_oauth_expiration_minutes: 60
# openid + profile are always included; manage-repos is what duplicating a Space needs.
hf_oauth_scopes:
  - manage-repos
---

# freeagent landing page

A static page, no build step, no server. It signs the visitor in with Hugging Face (OAuth +
PKCE from the browser), duplicates the `polats/freeagent` template Space into their account with
a fresh `COLLIE_AUTH_TOKEN` secret, waits for it to run, and redirects to the new box with the
token in the URL fragment. The Collie PWA trades that for a device token before it renders.

## Two front doors, one set of files

| Where | URL | OAuth client |
| --- | --- | --- |
| Hugging Face static Space (primary) | https://polats-freeagent-landing.static.hf.space | provisioned by `hf_oauth: true` in this README's front matter; injected as `window.huggingface.variables` |
| Vercel (custom-domain home later) | https://freeagent-navy.vercel.app | manual app in HF settings, id in `config.js` |

`.github/workflows/sync-landing-space.yml` publishes this directory to the Space
`polats/freeagent-landing` on every push that touches `landing/` (gated on the repo variable
`HF_LANDING_SPACE`; uses the `HF_TOKEN` secret).

## Deploy on Vercel

1. Vercel → Add New Project → import `polats/freeagent`.
2. **Root Directory: `landing`**. Framework preset: Other. No build command, no output directory.
3. Deploy. Note the URL (e.g. `https://freeagent-navy.vercel.app`).

## Create the Hugging Face OAuth application

1. huggingface.co → Settings → **Developer applications** → New.
2. Redirect URI: the Vercel URL, with a trailing slash, exactly as the page will be served
   (e.g. `https://freeagent-navy.vercel.app/`). Add a second one for the preview or custom domain if
   you use them.
3. Scopes: `openid`, `profile`, `manage-repos`.
4. Copy the **client id** into `config.js` → `HF_CLIENT_ID`. There is no client secret in this flow.

Push, and Vercel redeploys.

## Run locally

Any static server works, but the OAuth redirect must match a registered URI, so add
`http://localhost:3000/` to the application's redirect URIs for local testing:

```bash
npx serve landing -l 3000
```
