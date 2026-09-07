// POST /api/auth/hf/token — code → access token for a Hugging Face OAuth app that was registered
// by hand and therefore has a client secret. The page still does PKCE (the verifier comes along),
// so this function adds only the Basic client authentication HF expects from a confidential app.
// It stores nothing. Same-origin only, like its GitHub twin.
export async function onRequestPost({ request, env }) {
  if (!env.HF_CLIENT_ID || !env.HF_CLIENT_SECRET) return new Response("not configured", { status: 404 });
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
  const verifier = typeof body?.code_verifier === "string" ? body.code_verifier : "";
  const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : "";
  if (!code || !verifier || !redirectUri.startsWith(self)) return new Response("bad request", { status: 400 });

  const res = await fetch("https://huggingface.co/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${env.HF_CLIENT_ID}:${env.HF_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      client_id: env.HF_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    return Response.json({ error: json.error ?? "exchange_failed", error_description: json.error_description ?? "" }, { status: 400 });
  }
  return Response.json({ access_token: json.access_token }, { headers: { "cache-control": "no-store" } });
}
