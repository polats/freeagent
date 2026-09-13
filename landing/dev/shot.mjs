// Real-time render test: open a page in the installed Chrome, drag a real pointer, screenshot.
import { chromium } from "playwright";
const [,, url, out, mode = "touch"] = process.argv;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: mode === "touch", isMobile: mode === "touch" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`PAGEERROR: ${e.message}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
// an S-curve swipe over ~1.5 s
const W = 390, H = 844; const pts = [];
for (let i = 0; i <= 60; i += 1) { const t = i / 60; pts.push([W * (0.15 + 0.7 * t), H * (0.5 + 0.22 * Math.cos(t * 6))]); }
if (mode === "touch") {
  const cdp = await ctx.newCDPSession(page);
  const tp = (x, y) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp(...pts[0])] });
  for (const [x, y] of pts) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [tp(x, y)] }); await page.waitForTimeout(25); }
  await page.screenshot({ path: out.replace(".png", "-mid.png") });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
} else {
  await page.mouse.move(...pts[0]);
  for (const [x, y] of pts) { await page.mouse.move(x, y); await page.waitForTimeout(25); }
  await page.screenshot({ path: out.replace(".png", "-mid.png") });
}
await page.waitForTimeout(300);
await page.screenshot({ path: out });
console.log(logs.filter((l) => !/GL Driver/.test(l)).slice(0, 12).join("\n") || "(no console output)");
await browser.close();
