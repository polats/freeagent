# freeagent landing page

The page at https://freeagent.cosmiclabs.org. Your boxes first: each card is a GitHub Codespace or a
Hugging Face Space in **your** account running Herdr, Collie and your agents; tap to open (a stopped
codespace is woken first), or delete from the card's menu. "New box" picks the account, optionally a
GitHub repository to start from, and a name; the box appears as Provisioning and the page polls
until it runs. The flow and copy follow the crux-android deployments screen.

No database, no accounts of ours. Tokens stay in the visitor's browser. The one piece of server code
is a Cloudflare Pages Function that relays the OAuth token requests, because those endpoints send no
CORS headers and Hugging Face's needs the app's client secret.

```
public/index.html                          the page: boxes list, create / accounts / delete dialogs
public/app.js                              sign-in, boxes, connect, create, accounts
public/app.css                             Material 3 palette from crux-android's Theme.kt
public/config.js                           template repo and Space, idle timeout, default name
public/_headers                            security headers, no-cache on the app files
functions/api/auth/[provider]/[action].js  config · token (code exchange, github + hf) · device, poll (github fallback)
wrangler.toml
```

## Host your own

You need a Cloudflare account, a GitHub OAuth App and a Hugging Face OAuth app. Either provider is
optional: the page only offers the ones whose secrets are set.

1. **Fork or copy this directory.** Edit `public/config.js` if your box image lives elsewhere.

2. **GitHub OAuth App** — GitHub → Settings → Developer settings → OAuth Apps → New.
   Authorization callback URL: your site's root URL with a trailing slash, e.g.
   `https://freeagent.example.com/`. Note the client id and generate a client secret. Optionally
   tick **Enable Device Flow**: the page then also offers "sign in with a code", which needs no
   callback and no secret. The page asks for the `codespace` and `repo` scopes in one consent:
   `repo` is what lists private repositories and lets a box clone them.

3. **Hugging Face OAuth app** — huggingface.co → Settings → Developer applications → New.
   Redirect URI: your site's root URL with a trailing slash, e.g. `https://freeagent.example.com/`.
   Scopes: `openid`, `profile`, `manage-repos`. Note the client id and secret.

4. **Deploy to Cloudflare Pages.**

   ```bash
   cd landing
   npx wrangler login                                  # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
   npx wrangler pages project create freeagent --production-branch main
   npx wrangler pages secret put GITHUB_CLIENT_ID     --project-name freeagent
   npx wrangler pages secret put GITHUB_CLIENT_SECRET --project-name freeagent
   npx wrangler pages secret put HF_CLIENT_ID         --project-name freeagent
   npx wrangler pages secret put HF_CLIENT_SECRET     --project-name freeagent
   npx wrangler pages deploy public --project-name freeagent
   ```

   Add your domain under the project's Custom domains, and make sure both OAuth apps' callback URLs
   use that exact domain.

5. **If your domain is proxied by Cloudflare**, add a Cache Rule for the hostname with browser and
   edge TTL set to "respect origin", or visitors may keep an old `app.js` for hours.

`.github/workflows/deploy-landing.yml` redeploys on every push that touches `landing/`, using the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Run locally

```bash
cd landing && npx wrangler pages dev public
```

Use a second pair of OAuth apps with `http://localhost:8788/` as callback for local sign-in.
