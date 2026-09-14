// Is GitHub's named address for a codespace port routing? A browser cannot tell: cross-origin, both
// the healthy answer (302 to GitHub's sign-in) and the broken one (an empty 404 from the tunnel edge)
// are opaque to it. This relay asks once, without following redirects, and answers with the status.
// Only *.app.github.dev port hosts, only /api/health, nothing stored. Seen 2026-09-14: a codespace
// whose named address answered 404 for hours while its tunnel (ssh, the tunnel-id address) was fine.
export async function onRequestGet({ request }) {
  const self = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== self) return new Response("forbidden", { status: 403 });
  const target = new URL(request.url).searchParams.get("host") ?? "";
  if (!/^[a-z0-9-]+-\d{2,5}\.app\.github\.dev$/.test(target)) return new Response("bad host", { status: 400 });
  try {
    const res = await fetch(`https://${target}/api/health`, { redirect: "manual", headers: { "user-agent": "freeagent-probe" }, signal: AbortSignal.timeout(8000) });
    return Response.json({ status: res.status, routing: res.status >= 200 && res.status < 400 }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ status: 0, routing: false, error: String(e) }, { headers: { "cache-control": "no-store" } });
  }
}
