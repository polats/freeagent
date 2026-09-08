# freeagent landing page

The page at https://freeagent.cosmiclabs.org. Sign in with GitHub or Hugging Face, and it creates a
box in **your** account — a GitHub Codespace, or a Hugging Face Space duplicated from the freeagent
template — then opens it. It also lists, opens and deletes the boxes you already have.

No database, no accounts of ours. Tokens stay in the visitor's browser. The one piece of server code
is a Cloudflare Pages Function that relays the OAuth token requests, because those endpoints send no
CORS headers and Hugging Face's needs the app's client secret.

```
public/index.html                          the page
public/app.js                              sign-in, list/open/delete, create
public/config.js                           template repo and Space, machine size
public/_headers                            security headers, no-cache on the app files
functions/api/auth/[provider]/[action].js  github device flow (device, poll) · hf code exchange (token) · config
wrangler.toml
```

## Host your own

You need a Cloudflare account, a GitHub OAuth App and a Hugging Face OAuth app. Either provider is
optional: the page only offers the ones whose secrets are set.

1. **Fork or copy this directory.** Edit `public/config.js` if your box image lives elsewhere.

2. **GitHub OAuth App** — GitHub → Settings → Developer settings → OAuth Apps → New. Fill the
   callback URL with your site's root (GitHub requires one) and tick **Enable Device Flow**. The
   page uses the device flow: no redirect to get wrong, and no client secret needed. Note the
   client id.

3. **Hugging Face OAuth app** — huggingface.co → Settings → Developer applications → New.
   Redirect URI: your site's root URL with a trailing slash, e.g. `https://freeagent.example.com/`.
   Scopes: `openid`, `profile`, `manage-repos`. Note the client id and secret.

4. **Deploy to Cloudflare Pages.**

   ```bash
   cd landing
   npx wrangler login                                  # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
   npx wrangler pages project create freeagent --production-branch main
   npx wrangler pages secret put GITHUB_CLIENT_ID --project-name freeagent
   npx wrangler pages secret put HF_CLIENT_ID     --project-name freeagent
   npx wrangler pages secret put HF_CLIENT_SECRET --project-name freeagent
   npx wrangler pages deploy public --project-name freeagent
   ```

   Add your domain under the project's Custom domains, and make sure the Hugging Face app's redirect
   URI uses that exact domain.

5. **If your domain is proxied by Cloudflare**, add a Cache Rule for the hostname with browser and
   edge TTL set to "respect origin", or visitors may keep an old `app.js` for hours.

`.github/workflows/deploy-landing.yml` redeploys on every push that touches `landing/`, using the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## Run locally

```bash
cd landing && npx wrangler pages dev public
```

Add `http://localhost:8788/` to the Hugging Face app's redirect URIs for local sign-in; GitHub's device flow needs nothing.
