// GET /api/auth/github/config — tells the page whether GitHub sign-in is available here and with
// which public client id. A Cloudflare Pages Function: runs only where the landing page is
// deployed on Pages with GITHUB_CLIENT_ID set. On other hosts (the HF static Space, Vercel) this
// path is a 404 and the page hides the GitHub option — feature detection, not configuration.
export async function onRequestGet({ env }) {
  if (!env.GITHUB_CLIENT_ID) return new Response("not configured", { status: 404 });
  return Response.json({ client_id: env.GITHUB_CLIENT_ID }, { headers: { "cache-control": "no-store" } });
}
