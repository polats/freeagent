// GET /api/auth/github/config — whether GitHub sign-in is available on this host, the public client
// id, and the exact redirect_uri to use. The redirect must equal the callback URL registered on the
// GitHub OAuth App; it defaults to this origin's root and can be pinned with GITHUB_CALLBACK_URL
// when the app was registered with another path (any path under this origin works — _redirects
// routes /auth/* back to the page). Absent secrets → 404, and the page hides the GitHub option.
export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return new Response("not configured", { status: 404 });
  const self = new URL(request.url).origin;
  const redirect = env.GITHUB_CALLBACK_URL && env.GITHUB_CALLBACK_URL.startsWith(self) ? env.GITHUB_CALLBACK_URL : `${self}/`;
  return Response.json({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: redirect }, { headers: { "cache-control": "no-store" } });
}
