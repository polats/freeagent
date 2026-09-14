// The galaxy in the middle of the sign-in sky. Painted once into four offscreen rings — thousands
// of faint points on spiral arms, dust, a pale core — and drawn each frame as four images turning
// at different speeds, inner faster than outer, so the arms wind and shear like a real disc. Plus a
// breathing core. Cost on a phone: four drawImage calls. The live stars that sit on the arms and
// answer the hand live in stars.js and follow the same rotation through spin(t).
(() => {
  const LIME = [186, 255, 0], DEEP = [70, 120, 20], WHITE = [236, 244, 255], PALE = [222, 255, 170];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  // Deterministic randomness so the disc looks the same on every load (and in every screenshot).
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  /**
   * Paint a disc of radius R (CSS px) into a new canvas. `look` tunes the shape:
   *  arms      number of spiral arms
   *  wind      how tightly the arms wind (radians of turn from core to rim)
   *  spread    how far points scatter off the arm centreline (fraction of R)
   *  tilt      squash of the disc (1 = face-on, 0.5 = quite oblique)
   */
  function paint(R, look, dpr, band) {
    const { arms = 2, wind = 4.0, spread = 0.3, tilt = 0.66, count = 16000, seed = 7 } = look;
    // band = [t0, t1]: this ring keeps points with t inside, feathered at both edges so neighbouring
    // rings cross-fade and the seams do not show when they turn at different speeds
    const [b0, b1] = band ?? [0, 1];
    const feather = 0.08;
    const weight = (t) => Math.min(1, Math.max(0, (t - b0 + feather) / feather)) * Math.min(1, Math.max(0, (b1 + feather - t) / feather));
    const pad = Math.ceil(R * 1.15);
    const c = document.createElement("canvas"); c.width = c.height = pad * 2 * dpr;
    const g = c.getContext("2d"); g.scale(dpr, dpr); g.translate(pad, pad);
    g.globalCompositeOperation = "lighter";
    const rand = rng(seed);
    const gauss = () => (rand() + rand() + rand() - 1.5) * 1.15;

    // dust: soft dark-violet haze along the arms, drawn first so points sit on top
    g.globalCompositeOperation = "source-over";
    for (let i = 0; i < count / 8; i += 1) {
      const t = Math.pow(rand(), 0.7), arm = Math.floor(rand() * arms);
      const a = t * wind + (arm / arms) * Math.PI * 2 + gauss() * spread * (1 + t);
      const r = (0.1 + t * 0.9) * R;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const s = 8 + rand() * 14;
      g.globalAlpha = 0.04 * (1 - t * 0.6) * weight(t);
      if (g.globalAlpha < 0.002) continue;
      g.fillStyle = rgba(DEEP, 1);
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = "lighter";

    // arm stars: many, tiny, lime-tinted toward the rim, whiter toward the core
    for (let i = 0; i < count; i += 1) {
      const t = Math.pow(rand(), 0.55);                        // 0 core → 1 rim, denser inward
      const arm = Math.floor(rand() * arms);
      const off = gauss() * spread * (0.5 + 1.3 * t);          // arms are tight inside, loose outside
      const a = t * wind + (arm / arms) * Math.PI * 2 + off;
      const r = (0.04 + t * 0.96) * R * (1 + gauss() * 0.05);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const fringe = Math.abs(off) / (spread * (0.5 + 1.3 * t) + 1e-6);   // how far off the arm's spine
      // white-hot spine near the core, lime taking over along and around the arms
      const limeness = Math.min(1, 0.25 + t * 0.9) * (0.45 + 0.55 * Math.min(1, fringe));
      const col = mix(WHITE, LIME, limeness);
      const s = 0.35 + rand() * (0.8 + t * 0.6);
      g.globalAlpha = (0.08 + rand() * 0.22) * (1 - t * 0.6) * weight(t);
      if (g.globalAlpha < 0.002) continue;
      g.fillStyle = rgba(col, 1);
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
    // a scatter of halo stars off the arms so the disc has a body
    for (let i = 0; i < count / 2; i += 1) {
      const t = Math.pow(rand(), 0.45), a = rand() * Math.PI * 2, r = t * R * 1.05;
      g.globalAlpha = 0.14 * (1 - t * 0.85) * weight(t);
      if (g.globalAlpha < 0.002) continue;
      g.fillStyle = rgba(mix(PALE, LIME, rand() * 0.6), 1);
      g.beginPath(); g.arc(Math.cos(a) * r, Math.sin(a) * r, 0.4 + rand() * 0.9, 0, Math.PI * 2); g.fill();
    }
    // the core: layered soft glows, white-hot centre with a faint lime rim
    const core = (rad, col, alpha) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad); gr.addColorStop(0, rgba(col, alpha)); gr.addColorStop(0.5, rgba(col, alpha * 0.35)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.globalAlpha = 1; g.save(); g.scale(1, tilt); g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.fill(); g.restore(); };
    if (!band) { core(R * 1.0, LIME, 0.06); core(R * 0.6, LIME, 0.1); core(R * 0.34, PALE, 0.4); core(R * 0.14, WHITE, 0.9); }
    g.globalCompositeOperation = "source-over";
    return { c, pad };
  }
  function paintCore(R, look, dpr) {
    const { tilt = 0.66 } = look;
    const pad = Math.ceil(R * 1.15);
    const c = document.createElement("canvas"); c.width = c.height = pad * 2 * dpr;
    const g = c.getContext("2d"); g.scale(dpr, dpr); g.translate(pad, pad); g.globalCompositeOperation = "lighter";
    const core = (rad, col, alpha) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad); gr.addColorStop(0, rgba(col, alpha)); gr.addColorStop(0.5, rgba(col, alpha * 0.35)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.save(); g.scale(1, tilt); g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.fill(); g.restore(); };
    core(R * 1.0, LIME, 0.06); core(R * 0.6, LIME, 0.1); core(R * 0.34, PALE, 0.4); core(R * 0.14, WHITE, 0.9);
    return { c, pad };
  }

  let canvas, ctx, rings = [], coreDisc, R = 0, cx = 0, cy = 0, time = 0, raf = 0, running = false, last = 0, flare = 0, tilt = 0.66, wind = 4.0, arms = 2, spread = 0.3;
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Four rings, inner to outer, and how fast each turns. A real disc rotates differentially — the
  // inside laps the outside — so the arms visibly wind and shear rather than the whole thing spinning
  // like a plate. Outer ring: one turn in ~80 s; inner: ~30 s.
  const BANDS = [[0, 0.3], [0.24, 0.52], [0.46, 0.76], [0.7, 1.0]];
  const midT = (b) => (b[0] + b[1]) / 2;
  const omega = (t) => (Math.PI * 2) / 80 * (1.0 / (0.3 + t * 0.7)) * 0.72; // rad/s at radius t
  /** Current rotation of the disc at normalised radius t. */
  const spin = (t) => time * omega(t);

  function layout(look) {
    const r = canvas.getBoundingClientRect();
    R = Math.min(r.width * 0.38, r.height * 0.23);
    cx = r.width / 2; cy = r.height * 0.4; // above the middle, clear of the copy at the foot
    ({ tilt = 0.66, wind = 4.0, arms = 2, spread = 0.3 } = look);
    rings = BANDS.map((b) => ({ band: b, t: midT(b), img: paint(R, look, DPR, b) }));
    coreDisc = paintCore(R, look, DPR);
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);
    ctx.globalCompositeOperation = "lighter";
    for (const ring of rings) {
      // squash AFTER the spin: the disc turns in its own plane and its outline stays where it is
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, tilt); ctx.rotate(spin(ring.t));
      ctx.globalAlpha = 1; ctx.drawImage(ring.img.c, -ring.img.pad, -ring.img.pad, ring.img.pad * 2, ring.img.pad * 2);
      ctx.restore();
    }
    // the core breathes: a slow swell in brightness, plus the tap flare
    ctx.globalAlpha = 0.86 + 0.14 * Math.sin(time * 1.4);
    ctx.drawImage(coreDisc.c, cx - coreDisc.pad, cy - coreDisc.pad, coreDisc.pad * 2, coreDisc.pad * 2);
    if (flare > 0.01) { const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5); gr.addColorStop(0, `rgba(236,240,255,${0.55 * flare})`); gr.addColorStop(1, "rgba(236,240,255,0)"); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalCompositeOperation = "source-over";
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    time += dt; flare = Math.max(0, flare - dt * 1.5);
    draw(); raf = requestAnimationFrame(frame);
  }
  window.Galaxy = {
    look: {},
    start(el, look = {}) {
      this.stop(); canvas = el; ctx = canvas.getContext("2d"); this.look = look;
      const r = canvas.getBoundingClientRect(); canvas.width = Math.round(r.width * DPR); canvas.height = Math.round(r.height * DPR); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      layout(look); draw();
      if (reduced) return;
      running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    /** A tap inside the core: a brief flare. Returns true when the point was in the core. */
    tap(x, y) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy < (R * 0.35) ** 2) { flare = 1; return true; } return false; },
    center() { return { x: cx, y: cy, R }; },
    /** Where the disc is right now, for stars.js to put live stars on the arms. */
    state() { return rings.length ? { cx, cy, R, tilt, wind, arms, spread, spin } : null; },
  };
})();
