// Render test for the signed-in Accounts sheet: serves landing/public from disk, stubs GitHub (a
// signed-in user, one codespace box, one saved agent secret), opens the sheet and screenshots it.
// Nothing leaves the machine: every request is answered here.
//
//   cd landing/dev && npm i playwright && node accounts-shot.mjs out.png
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [,, out = "accounts.png"] = process.argv;
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
  localStorage.setItem("freeagent:github:scope", "v2");
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
    if (url.pathname === "/user/codespaces/secrets") return json(route, { total_count: 1, secrets: [{ name: "FREEAGENT_CODEX_AUTH" }] });
    return json(route, { message: "Not Found" }, 404);
  }
  return route.fulfill({ status: 404, body: "" });
});

await page.goto("https://landing.test/", { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.screenshot({ path: out.replace(".png", "-home.png") });
await page.click("#accounts-open");
await page.waitForTimeout(800);
await page.screenshot({ path: out });
console.log(logs.slice(0, 12).join("\n") || "(no console output)");
await browser.close();
