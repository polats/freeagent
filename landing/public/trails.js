// The drag, done the OGL way (from OGL's polylines example, public domain, and Nathan Gordon's
// Codrops article "Crafting Stylised Mouse Trails"): five screen-space polylines whose head springs
// toward the finger — each with its own stiffness, friction and offset — and whose remaining points
// ease toward the point ahead, so every line lags and overshoots differently and the bundle reads as
// ribbons with weight. WebGL, one draw per line, cheap on a phone. Five greens, on top of the
// star sky; fades in on touch and out on release.
import { Renderer, Transform, Vec3, Color, Polyline } from "./vendor/ogl.js";

const vertex = /* glsl */ `
  precision highp float;
  attribute vec3 position; attribute vec3 next; attribute vec3 prev; attribute vec2 uv; attribute float side;
  uniform vec2 uResolution; uniform float uDPR; uniform float uThickness;
  vec4 getPosition() {
    vec4 current = vec4(position, 1);
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1);
    vec2 nextScreen = next.xy * aspect; vec2 prevScreen = prev.xy * aspect;
    vec2 tangent = normalize(nextScreen - prevScreen);
    vec2 normal = vec2(-tangent.y, tangent.x); normal /= aspect;
    // fat in the middle, skinny at both ends
    normal *= mix(1.0, 0.1, pow(abs(uv.y - 0.5) * 2.0, 2.0));
    float dist = length(nextScreen - prevScreen); normal *= smoothstep(0.0, 0.02, dist);
    float pixelWidthRatio = 1.0 / (uResolution.y / uDPR);
    float pixelWidth = current.w * pixelWidthRatio;
    normal *= pixelWidth * uThickness;
    current.xy -= normal * side;
    return current;
  }
  void main() { gl_Position = getPosition(); }
`;
const fragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColor; uniform float uAlpha;
  void main() { gl_FragColor = vec4(uColor, uAlpha); }
`;

const random = (a, b) => { const t = Math.random(); return a * (1 - t) + b * t; };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer, gl, scene, canvas, lines = [], raf = 0, running = false, alpha = 0, target = 0;
const mouse = new Vec3(), tmp = new Vec3();
let hasMouse = false; // eslint: kept for parity with the example's mouse/touch split

function build(el) {
  canvas = el;
  renderer = new Renderer({ canvas, dpr: Math.min(window.devicePixelRatio || 1, 2), alpha: true, premultipliedAlpha: false, antialias: true });
  gl = renderer.gl; gl.clearColor(0, 0, 0, 0);
  scene = new Transform();
  lines = [];
  // The example's five-colour brush, in greens: deep forest under, the brand's two greens in the
  // middle, mint on top. Thickness is random per line like the original (scaled for a phone), so the
  // bundle is a different brush on every load.
  ["#0f5c2e", "#2eaa4a", "#40ff00", "#baff00", "#a8ffc2"].forEach((color) => {
    // Phone tuning: the example's offsets (0.02) and tail easing (0.9) suit a mouse crossing a big
    // screen; a thumb moves a few centimetres, so the lines fan wider, keep longer tails and stay
    // fatter, or the bundle collapses into one thin trail.
    const thickness = random(22, 52);
    const line = { spring: random(0.03, 0.1), friction: random(0.72, 0.92), tail: random(0.55, 0.75), mouseVelocity: new Vec3(), mouseOffset: new Vec3(random(-1, 1) * 0.07, random(-1, 1) * 0.07, 0), points: [] };
    for (let i = 0; i < 28; i += 1) line.points.push(new Vec3());
    line.polyline = new Polyline(gl, { points: line.points, vertex, fragment, uniforms: { uColor: { value: new Color(color) }, uThickness: { value: thickness }, uAlpha: { value: 0 } } });
    line.polyline.mesh.program.transparent = true; line.polyline.mesh.program.depthTest = false;
    line.polyline.mesh.setParent(scene);
    lines.push(line);
  });
  resize();
}
// The box the brush fills is the canvas's parent (the sign-in screen), not the canvas: OGL writes an
// inline width/height on the canvas itself — 300×150 at construction — which beats the CSS
// percentage, so reading the canvas back would keep it at 300×150 forever (that was the bug).
function box() { return (canvas.parentElement ?? document.documentElement).getBoundingClientRect(); }
function resize() {
  const r = box();
  renderer.setSize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
  for (const l of lines) l.polyline.resize();
}
function setMouse(clientX, clientY) {
  const r = box();
  mouse.set(((clientX - r.left) / r.width) * 2 - 1, ((clientY - r.top) / r.height) * -2 + 1, 0);
}
function snapTo(x, y) { setMouse(x, y); for (const l of lines) { for (const p of l.points) p.copy(mouse); l.mouseVelocity.set(0, 0, 0); } }

function onMove(ev) { if (!running || ev.pointerType !== "mouse") return; hasMouse = true; if (alpha < 0.05) snapTo(ev.clientX, ev.clientY); else setMouse(ev.clientX, ev.clientY); target = 1; }
function onLeave() { target = 0; }
function touchAt(ev) { const t = ev.touches[0] ?? ev.changedTouches[0]; return t ? [t.clientX, t.clientY] : null; }
function onTouchStart(ev) { if (!running) return; const p = touchAt(ev); if (!p) return; if (alpha < 0.05) snapTo(...p); else setMouse(...p); target = 1; }
function onTouchMove(ev) { if (!running) return; const p = touchAt(ev); if (p) { setMouse(...p); target = 1; } }
function onTouchEnd(ev) { if (ev.touches.length === 0) target = 0; }

function frame() {
  if (!running) return;
  alpha += (target - alpha) * (target ? 0.2 : 0.035);
  if (alpha > 0.002) {
    for (const line of lines) {
      for (let i = line.points.length - 1; i >= 0; i -= 1) {
        if (!i) {
          tmp.copy(mouse).add(line.mouseOffset).sub(line.points[i]).multiply(line.spring);
          line.mouseVelocity.add(tmp).multiply(line.friction);
          line.points[i].add(line.mouseVelocity);
        } else {
          line.points[i].lerp(line.points[i - 1], line.tail);
        }
      }
      line.polyline.updateGeometry();
      line.polyline.mesh.program.uniforms.uAlpha.value = alpha;
    }
    renderer.render({ scene });
  } else if (alpha !== 0) { alpha = 0; gl.clear(gl.COLOR_BUFFER_BIT); }
  raf = requestAnimationFrame(frame);
}

const listeners = [["pointermove", onMove], ["touchstart", onTouchStart], ["touchmove", onTouchMove], ["touchend", onTouchEnd], ["touchcancel", onTouchEnd]];
let ro = null;
window.Trails = {
  start(el) {
    if (reduced) return;
    if (running && canvas === el) return;
    this.stop();
    try { if (!renderer || canvas !== el) build(el); else resize(); } catch (e) { console.warn("trails: WebGL unavailable", e); return; }
    for (const [type, fn] of listeners) window.addEventListener(type, fn, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    ro = new ResizeObserver(resize); ro.observe(el.parentElement ?? el);
    running = true; alpha = 0; target = 0; raf = requestAnimationFrame(frame);
  },
  stop() {
    running = false; cancelAnimationFrame(raf);
    for (const [type, fn] of listeners) window.removeEventListener(type, fn);
    document.removeEventListener("pointerleave", onLeave);
    ro?.disconnect(); ro = null;
  },
};
// app.js may have asked before this module finished loading
if (window.__trailsPending) { window.Trails.start(window.__trailsPending); window.__trailsPending = null; }
document.addEventListener("visibilitychange", () => { if (!canvas) return; if (document.hidden) { running = false; cancelAnimationFrame(raf); } else if (!canvas.closest("[hidden]") && !reduced) { running = true; raf = requestAnimationFrame(frame); } });
