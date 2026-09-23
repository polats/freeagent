// Render test for the signed-in Accounts sheet: serves landing/public from disk, stubs GitHub (a
// signed-in user, one codespace box, one saved agent secret), opens the sheet and screenshots it.
// Nothing leaves the machine: every request is answered here.
//
//   cd landing/dev && npm i playwright && node accounts-shot.mjs out.png [connect]
// With `connect`, ChatGPT starts disconnected, Connect is tapped, and the dialog is shot once the
// (stubbed) sign-in job has published its device code. With `complete`, the stub then delivers a
// result sealed to the page's one-time key, and the run checks that the page re-sealed it to
// "GitHub's" key, saved it scoped to the template repo, and deleted both files. (needs tweetnacl +
// blakejs installed beside playwright.)
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const [,, out = "accounts.png", mode = "sheet"] = process.argv;
let request = null; // the page's request id, captured from its dispatch
let pagePubkey = null;
let resultPolls = 0;
const checks = { saved: null, deleted: [] };
const complete = mode === "complete";
const nacl = complete ? require("tweetnacl") : null;
const blake = complete ? require("blakejs") : null;
const github = complete ? nacl.box.keyPair() : null; // stands in for the user's Codespaces key
const sealTo = (pkB64, text) => {
  const pk = new Uint8Array(Buffer.from(pkB64, "base64")); const e = nacl.box.keyPair();
  const n = new Uint8Array(blake.blake2b(new Uint8Array([...e.publicKey, ...pk]), undefined, 24));
  return Buffer.from([...e.publicKey, ...nacl.box(new Uint8Array(Buffer.from(text)), n, pk, e.secretKey)]).toString("base64");
};
const openWith = (kp, b64) => {
  const b = new Uint8Array(Buffer.from(b64, "base64")); const epk = b.slice(0, 32);
  const n = new Uint8Array(blake.blake2b(new Uint8Array([...epk, ...kp.publicKey]), undefined, 24));
  const p = nacl.box.open(b.slice(32), n, epk, kp.secretKey); return p && Buffer.from(p).toString();
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`PAGEERROR: ${e.message}`));

await ctx.addInitScript(() => {
  localStorage.setItem("freeagent:github", "gho_render_test");
  localStorage.setItem("freeagent:github:scope", "v3");
});
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
await ctx.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.host === "landing.test") {
    if (url.pathname === "/api/auth/github/config") return json(route, { client_id: "x", redirect_uri: "https://landing.test/" });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, body: "" });
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    try {
      return route.fulfill({ status: 200, contentType: TYPES[extname(path)] ?? "application/octet-stream", body: await readFile(join(root, path)) });
    } catch { return route.fulfill({ status: 404, body: "" }); }
  }
  if (url.host === "api.github.com") {
    if (url.pathname === "/user") return json(route, { login: "polats" });
    if (url.pathname === "/user/codespaces") return json(route, { codespaces: [{ id: 1, name: "fa-demo-abc", display_name: "fa-demo", state: "Available", created_at: "2026-09-23T10:00:00Z", repository: { full_name: "polats/freeagent" }, web_url: "https://fa-demo-abc.github.dev" }] });
    if (url.pathname === "/user/codespaces/secrets/public-key") return json(route, { key: Buffer.from(github.publicKey).toString("base64"), key_id: "k9" });
    if (url.pathname === "/repos/polats/freeagent") return json(route, { id: 4242 });
    if (url.pathname === "/user/codespaces/secrets/FREEAGENT_CODEX_AUTH" && route.request().method() === "PUT") {
      const body = JSON.parse(route.request().postData());
      checks.saved = { value: openWith(github, body.encrypted_value), key_id: body.key_id, repos: body.selected_repository_ids };
      return route.fulfill({ status: 201, body: "" });
    }
    if (url.pathname === "/user/codespaces/secrets") return json(route, mode !== "sheet" ? { total_count: 0, secrets: [] } : { total_count: 1, secrets: [{ name: "FREEAGENT_CODEX_AUTH" }] });
    const acct = "/repos/polats/freeagent-account";
    if (url.pathname === `${acct}/contents/.github/workflows/freeagent-connect.yml`) {
      return route.request().method() === "PUT" ? json(route, { content: { sha: "w1" } }, 201) : json(route, { message: "Not Found" }, 404);
    }
    if (url.pathname.endsWith("/dispatches")) { const i = JSON.parse(route.request().postData()).inputs; request = i.request; pagePubkey = i.pubkey; return route.fulfill({ status: 204, body: "" }); }
    if (request && route.request().method() === "DELETE" && url.pathname.startsWith(`${acct}/contents/connect/${request}/`)) { checks.deleted.push(url.pathname.split("/").pop()); return json(route, {}); }
    if (complete && request && url.pathname === `${acct}/contents/connect/${request}/result.json`) {
      resultPolls += 1;
      if (resultPolls < 3) return json(route, { message: "Not Found" }, 404);
      return json(route, { sha: "r1", content: Buffer.from(JSON.stringify({ agent: "codex", secret: "FREEAGENT_CODEX_AUTH", sealed: sealTo(pagePubkey, "Y29kZXgtYXV0aA==") })).toString("base64") });
    }
    if (url.pathname === `${acct}/actions/runs`) return json(route, { workflow_runs: request ? [{ id: 7, display_title: `freeagent connect codex ${request}` }] : [] });
    if (url.pathname === `${acct}/actions/runs/7`) return json(route, { id: 7, status: "in_progress", conclusion: null });
    if (request && url.pathname === `${acct}/contents/connect/${request}/code.json`) {
      return json(route, { sha: "c1", content: Buffer.from(JSON.stringify({ agent: "codex", code: "TLV4-JQXYT", url: "https://auth.openai.com/codex/device" })).toString("base64") });
    }
    return json(route, { message: "Not Found" }, 404);
  }
  return route.fulfill({ status: 404, body: "" });
});

await page.goto("https://landing.test/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.screenshot({ path: out.replace(".png", "-home.png") });
await page.click("#accounts-open");
await page.waitForTimeout(800);
if (mode === "connect" || complete) {
  await page.screenshot({ path: out.replace(".png", "-sheet.png") });
  await page.click("#acct-agent-codex-connect");
  await page.waitForSelector("#agent-connect-code:not([hidden])", { timeout: 20000 });
  await page.waitForTimeout(300);
}
await page.screenshot({ path: out });
if (complete) {
  await page.waitForFunction(() => !document.getElementById("agent-connect").open, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out.replace(".png", "-done.png") });
  console.log("saved:", JSON.stringify(checks.saved), "deleted:", checks.deleted.sort().join(","));
}
console.log(logs.slice(0, 12).join("\n") || "(no console output)");
await browser.close();
