// GET /api/auth/hf/config — whether Hugging Face sign-in is configured on THIS host through a
// manually registered HF OAuth application, and its public client id. Absent on the HF static
// Space (which gets its client injected by the platform) and on hosts without the secret.
export async function onRequestGet({ env }) {
  if (!env.HF_CLIENT_ID || !env.HF_CLIENT_SECRET) return new Response("not configured", { status: 404 });
  return Response.json({ client_id: env.HF_CLIENT_ID }, { headers: { "cache-control": "no-store" } });
}
