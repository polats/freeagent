// The only server code, under /api/auth/<provider>/<action>. A static page can start a sign-in but
// cannot finish one: the token endpoints send no CORS headers, and Hugging Face's needs the app's
// client secret. This Cloudflare Pages Function fills that gap and stores nothing.
//
//   GitHub — authorization code (callback = this site's root URL) with the device flow as a fallback:
//     POST /api/auth/github/token {code}      → { access_token }                       (needs GITHUB_CLIENT_SECRET)
//     POST /api/auth/github/device            → { user_code, verification_uri, device_code, interval, expires_in }
//     POST /api/auth/github/poll {device_code} → { access_token } | { error: "authorization_pending" | … }
//   Hugging Face — authorization code with the app secret; callback = this site's root URL:
//     POST /api/auth/hf/token {code}          → { access_token }
//   Either — GET /api/auth/<provider>/config  → { client_id } when configured, else 404.
//
// Secrets on the Pages project: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, HF_CLIENT_ID, HF_CLIENT_SECRET.

const GH = "https://github.com";
const HF = "https://huggingface.co";
const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export async function onRequest({ request, env, params }) {
  const { provider, action } = params;
  const self = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (request.method === "POST" && origin !== null && origin !== self) return new Response("forbidden", { status: 403 });
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (provider === "github") {
    if (!env.GITHUB_CLIENT_ID) return new Response("not configured", { status: 404 });
    if (action === "config" && request.method === "GET") {
      return json({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${self}/`, redirect: Boolean(env.GITHUB_CLIENT_SECRET) });
    }
    if (action === "token" && request.method === "POST" && typeof body.code === "string" && env.GITHUB_CLIENT_SECRET) {
      return forward(`${GH}/login/oauth/access_token`, {
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: body.code,
        redirect_uri: `${self}/`,
      });
    }
    if (action === "device" && request.method === "POST") {
      return forward(`${GH}/login/device/code`, { client_id: env.GITHUB_CLIENT_ID, scope: "codespace repo" });
    }
    if (action === "poll" && request.method === "POST" && typeof body.device_code === "string") {
      return forward(`${GH}/login/oauth/access_token`, {
        client_id: env.GITHUB_CLIENT_ID,
        device_code: body.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
    }
  }

  if (provider === "hf") {
    if (!env.HF_CLIENT_ID || !env.HF_CLIENT_SECRET) return new Response("not configured", { status: 404 });
    if (action === "config" && request.method === "GET") return json({ client_id: env.HF_CLIENT_ID });
    if (action === "token" && request.method === "POST" && typeof body.code === "string") {
      return forward(`${HF}/oauth/token`, { grant_type: "authorization_code", code: body.code, redirect_uri: `${self}/` }, {
        authorization: `Basic ${btoa(`${env.HF_CLIENT_ID}:${env.HF_CLIENT_SECRET}`)}`,
      });
    }
  }

  return new Response("not found", { status: 404 });
}

// Forward one form POST and hand the JSON reply back, whatever it says (the page reads `error`).
async function forward(url, form, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(form),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return json(data, res.ok ? 200 : 400);
}
