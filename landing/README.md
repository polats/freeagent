# freeagent landing page

The page at https://freeagent.cosmiclabs.org. Sign in with GitHub or Hugging Face, and it creates a
box in **your** account — a GitHub Codespace, or a Hugging Face Space duplicated from the freeagent
template — then opens it. It also lists, opens and deletes the boxes you already have.

No database, no accounts of ours. Tokens stay in the visitor's browser. The one piece of server code
is a Cloudflare Pages Function that swaps an OAuth code for a token, because that step needs the
OAuth app's client secret.

```
public/index.html                          the page
public/app.js                              sign-in, list/open/delete, create
public/config.js                           template repo and Space, machine size
public/_headers                            security headers, no-cache on the app files
functions/api/auth/[provider]/[action].js  GET …/config and POST …/token for github and hf
wrangler.toml
```

## Host your own

You need a Cloudflare account, a GitHub OAuth App and a Hugging Face OAuth app. Either provider is
optional: the page only offers the ones whose secrets are set.

1. **Fork or copy this directory.** Edit `public/config.js` if your box image lives elsewhere.

2. **GitHub OAuth App** — GitHub → Settings → Developer settings → OAuth Apps → New.
   Authorization callback URL: your site's root URL with a trailing slash, e.g.
   `https://freeagent.example.com/`. Note the client id and generate a client secret.

3. **Hugging Face OAuth app** — huggingface.co → Settings → Developer applications → New.
   Redirect URI: the same root URL. Scopes: `openid`, `profile`, `manage-repos`. Note the client id
   and secret.

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

   Add your domain under the project's Custom domains, and make sure the OAuth apps' callback URLs
   use that exact domain.

5. **If your domain is proxied by Cloudflare**, add a Cache Rule for the hostname with browser and
   edge TTL set to "respect origin", or visitors may keep an old `app.js` for hours.

`.github/workflows/deploy-landing.yml` redeploys on every push that touches `landing/`, using the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Run locally

```bash
cd landing && npx wrangler pages dev public
```

Point a second OAuth app (or extra callback URIs) at `http://localhost:8788/` for local sign-in.
