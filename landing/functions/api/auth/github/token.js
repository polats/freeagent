// POST /api/auth/github/token — the one thing a static page cannot do itself: exchange a GitHub
// OAuth code for a token, because GitHub's token endpoint sends no CORS headers and the exchange
// needs the app's client secret. This function holds that secret (a Pages secret, never in the
// repo), forwards the exchange, and returns the token to the same-origin page. It stores nothing
// and logs nothing. The token then lives only in the visitor's sessionStorage for the length of
// the flow.
export async function onRequestPost({ request, env }) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return new Response("not configured", { status: 404 });
  // Same-origin only: the page posts JSON with fetch; a cross-site form cannot set this content type
  // without a preflight we never answer, and we also refuse a foreign Origin outright.
  const origin = request.headers.get("origin");
  const self = new URL(request.url).origin;
  if (origin !== null && origin !== self) return new Response("forbidden", { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const code = typeof body?.code === "string" ? body.code : "";
  const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : "";
  if (!code || !redirectUri.startsWith(self)) return new Response("bad request", { status: 400 });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    return Response.json({ error: json.error ?? "exchange_failed", error_description: json.error_description ?? "" }, { status: 400 });
  }
  return Response.json({ access_token: json.access_token, scope: json.scope ?? "" }, { headers: { "cache-control": "no-store" } });
}
