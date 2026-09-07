// The only server code: /api/auth/<github|hf>/config and /api/auth/<github|hf>/token.
//
// A static page can start an OAuth sign-in, but it cannot finish one: the token endpoints need the
// app's client secret, and GitHub's sends no CORS headers. So this Cloudflare Pages Function holds
// the two secrets and does the exchange. It stores nothing.
//
// Secrets on the Pages project:  GITHUB_CLIENT_ID  GITHUB_CLIENT_SECRET  HF_CLIENT_ID  HF_CLIENT_SECRET
// Both OAuth apps must have this site's root URL (with trailing slash) as their callback.

const PROVIDERS = {
  github: {
    id: "GITHUB_CLIENT_ID",
    secret: "GITHUB_CLIENT_SECRET",
    tokenUrl: "https://github.com/login/oauth/access_token",
  },
  hf: {
    id: "HF_CLIENT_ID",
    secret: "HF_CLIENT_SECRET",
    tokenUrl: "https://huggingface.co/oauth/token",
  },
};

export async function onRequest({ request, env, params }) {
  const p = PROVIDERS[params.provider];
  if (!p) return new Response("not found", { status: 404 });
  const clientId = env[p.id];
  const clientSecret = env[p.secret];
  if (!clientId || !clientSecret) return new Response("not configured", { status: 404 });

  if (params.action === "config" && request.method === "GET") {
    return Response.json({ client_id: clientId }, { headers: { "cache-control": "no-store" } });
  }

  if (params.action === "token" && request.method === "POST") {
    const self = new URL(request.url).origin;
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== self) return new Response("forbidden", { status: 403 });
    const body = await request.json().catch(() => null);
    const code = typeof body?.code === "string" ? body.code : "";
    if (!code) return new Response("bad request", { status: 400 });

    const res = await fetch(p.tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({ client_id: clientId, grant_type: "authorization_code", code, redirect_uri: `${self}/` }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      return Response.json({ error: json.error_description || json.error || "exchange_failed" }, { status: 400 });
    }
    return Response.json({ access_token: json.access_token }, { headers: { "cache-control": "no-store" } });
  }

  return new Response("not found", { status: 404 });
}
