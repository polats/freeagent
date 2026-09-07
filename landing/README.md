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

## Layout

```
public/      the page: index.html, app.js, config.js, _headers (CSP)
functions/   Cloudflare Pages Functions: /api/auth/github/{config,token}
wrangler.toml
```

## Two front doors, one set of files

| Where | URL | Sign-in |
| --- | --- | --- |
| Cloudflare Pages (primary) | https://freeagent.cosmiclabs.org | GitHub → Codespace (default; needs the two Pages secrets below), Hugging Face → Space (needs an HF OAuth app for this host, id in `config.js`) |
| Hugging Face static Space | https://polats-freeagent-landing.static.hf.space | Hugging Face only; the client is provisioned by `hf_oauth: true` in this README's front matter |

`.github/workflows/deploy-landing.yml` deploys to Pages on every push that touches `landing/`
(secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). `.github/workflows/sync-landing-space.yml`
publishes `public/` + this README to the Space (`HF_TOKEN`, var `HF_LANDING_SPACE`).

## GitHub sign-in (Codespaces)

GitHub's OAuth token endpoint has no CORS and needs the app secret, so the exchange runs in
`functions/api/auth/github/token.js`. It stores nothing. Configure once:

1. GitHub → Settings → Developer settings → OAuth Apps → New. Callback URL
   `https://freeagent.cosmiclabs.org/`.
2. `wrangler pages secret put GITHUB_CLIENT_ID --project-name freeagent` and the same for
   `GITHUB_CLIENT_SECRET`.

The page shows "Continue with GitHub" only where `/api/auth/github/config` answers.

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
cd landing && npx wrangler pages dev public
```
