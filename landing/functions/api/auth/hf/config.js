// GET /api/auth/hf/config — Hugging Face sign-in via a hand-registered (confidential) HF app on this
// host: public client id plus the redirect_uri to use (HF_CALLBACK_URL, default this origin's root).
export async function onRequestGet({ request, env }) {
  if (!env.HF_CLIENT_ID || !env.HF_CLIENT_SECRET) return new Response("not configured", { status: 404 });
  const self = new URL(request.url).origin;
  const redirect = env.HF_CALLBACK_URL && env.HF_CALLBACK_URL.startsWith(self) ? env.HF_CALLBACK_URL : `${self}/`;
  return Response.json({ client_id: env.HF_CLIENT_ID, redirect_uri: redirect }, { headers: { "cache-control": "no-store" } });
}
