// Cosmic Labs star field for the sign-in screen. Eight-point stars (the ✦ from the COSMIC✦LABS
// lockup) in the brand's neon green on black, in three depths. They drift and twinkle on their own;
// a finger or pointer becomes a gravity well they fall toward and orbit, and letting go releases
// them; a tap sends a ripple out. No library, one canvas, sprites pre-rendered per size so the glow
// costs nothing per frame. Reduced motion: one still frame, still drawn in the brand.
(() => {
  const GREEN = "#40ff00";
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let canvas, ctx, stars = [], w = 0, h = 0, raf = 0, running = false, last = 0;
  const pointer = { x: 0, y: 0, down: false, active: false };
  const pulses = []; // taps: { x, y, r, life }

  // ---- sprites: one glowing star per (size, depth) bucket, drawn once --------------------------
  const sprites = new Map();
  function sprite(size, depth) {
    const key = `${size}|${depth}`;
    if (sprites.has(key)) return sprites.get(key);
    const glow = size * (1.6 + depth * 0.8);
    const pad = Math.ceil(size + glow);
    const c = document.createElement("canvas");
    c.width = c.height = pad * 2 * DPR;
    const g = c.getContext("2d");
    g.scale(DPR, DPR);
    g.translate(pad, pad);
    g.shadowColor = GREEN;
    g.shadowBlur = glow;
    g.fillStyle = GREEN;
    g.globalAlpha = 0.35 + depth * 0.65;
    starPath(g, size, size * 0.42);
    g.fill();
    // a hot core so the near stars read as sharp points, not blobs
    if (depth > 0.6) { g.shadowBlur = 0; g.fillStyle = "#eaffe0"; g.globalAlpha = 0.9; starPath(g, size * 0.55, size * 0.2); g.fill(); }
    sprites.set(key, { c, pad });
    return sprites.get(key);
  }
  // Four long spikes on the axes, four short ones on the diagonals — the lockup's ✦.
  function starPath(g, R, r) {
    g.beginPath();
    for (let i = 0; i < 16; i += 1) {
      const a = (i * Math.PI) / 8;
      const isLong = i % 4 === 0, isShort = i % 4 === 2;
      const rad = isLong ? R : isShort ? R * 0.62 : r * 0.55;
      g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
  }

  // ---- field ---------------------------------------------------------------------------------------
  function seed() {
    stars = [];
    const count = Math.round((w * h) / 9000); // ~75 on a phone, ~200 on a laptop
    for (let i = 0; i < count; i += 1) {
      const depth = Math.random() ** 1.6; // most stars far and small
      stars.push({
        x: Math.random() * w, y: Math.random() * h,
        hx: 0, hy: 0, // home drift, set below
        vx: 0, vy: 0,
        depth,
        size: Math.round(2 + depth * 12),
        rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.4 * (0.3 + depth),
        phase: Math.random() * Math.PI * 2, twinkle: 0.6 + Math.random() * 1.8,
      });
    }
    for (const s of stars) { const a = Math.random() * Math.PI * 2; const sp = 3 + s.depth * 12; s.hx = Math.cos(a) * sp; s.hy = Math.sin(a) * sp; }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width)); h = Math.max(1, Math.round(rect.height));
    canvas.width = w * DPR; canvas.height = h * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    sprites.clear();
    seed();
    if (reduced) draw(0);
  }

  function step(dt) {
    const t = performance.now() / 1000;
    for (const s of stars) {
      // drift home velocity, eased back toward it when nothing is pulling
      let ax = (s.hx - s.vx) * 0.8, ay = (s.hy - s.vy) * 0.8;
      if (pointer.active) {
        const dx = pointer.x - s.x, dy = pointer.y - s.y;
        const d2 = dx * dx + dy * dy + 400;
        const reach = pointer.down ? 260 : 170;
        if (d2 < reach * reach) {
          const d = Math.sqrt(d2);
          const pull = (pointer.down ? 5200 : 2600) * (0.4 + s.depth) / d2; // near stars feel it most
          ax += (dx / d) * pull * 60; ay += (dy / d) * pull * 60;
          // a touch of tangential velocity so they swirl rather than pile up
          ax += (-dy / d) * pull * 18; ay += (dx / d) * pull * 18;
        }
      }
      for (const p of pulses) {
        const dx = s.x - p.x, dy = s.y - p.y, d = Math.hypot(dx, dy) + 1;
        const band = Math.abs(d - p.r);
        if (band < 40) { const k = (1 - band / 40) * 900 * (0.3 + s.depth); ax += (dx / d) * k; ay += (dy / d) * k; }
      }
      s.vx += ax * dt; s.vy += ay * dt;
      const cap = 90 + s.depth * 260; const v = Math.hypot(s.vx, s.vy);
      if (v > cap) { s.vx *= cap / v; s.vy *= cap / v; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.rot += s.spin * dt;
      // wrap
      const m = 30;
      if (s.x < -m) s.x += w + 2 * m; else if (s.x > w + m) s.x -= w + 2 * m;
      if (s.y < -m) s.y += h + 2 * m; else if (s.y > h + m) s.y -= h + 2 * m;
      s.alpha = 0.55 + 0.45 * Math.sin(t * s.twinkle + s.phase);
    }
    for (let i = pulses.length - 1; i >= 0; i -= 1) { const p = pulses[i]; p.r += 520 * dt; p.life -= dt; if (p.life <= 0) pulses.splice(i, 1); }
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const sp = sprite(s.size, +s.depth.toFixed(1));
      ctx.globalAlpha = s.alpha ?? 0.8;
      ctx.translate(s.x, s.y); ctx.rotate(s.rot);
      ctx.drawImage(sp.c, -sp.pad, -sp.pad, sp.pad * 2, sp.pad * 2);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    ctx.globalAlpha = 1;
    for (const p of pulses) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.strokeStyle = GREEN; ctx.globalAlpha = Math.max(0, p.life) * 0.35; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    step(dt); draw(now);
    raf = requestAnimationFrame(frame);
  }

  // ---- input -------------------------------------------------------------------------------------
  function at(ev) { const r = canvas.getBoundingClientRect(); const p = ev.touches ? ev.touches[0] : ev; return p ? { x: p.clientX - r.left, y: p.clientY - r.top } : null; }
  function onMove(ev) { const p = at(ev); if (!p) return; pointer.x = p.x; pointer.y = p.y; pointer.active = true; }
  function onDown(ev) { const p = at(ev); if (!p) return; pointer.x = p.x; pointer.y = p.y; pointer.active = true; pointer.down = true; }
  function onUp(ev) { pointer.down = false; if (ev.type.startsWith("touch")) pointer.active = false; }
  function onTap(ev) { const p = at(ev); if (p) pulses.push({ x: p.x, y: p.y, r: 0, life: 1 }); }
  function onLeave() { pointer.active = false; pointer.down = false; }

  const listeners = [
    ["pointermove", onMove], ["pointerdown", onDown], ["pointerup", onUp], ["pointercancel", onUp], ["pointerleave", onLeave], ["click", onTap],
  ];

  window.Stars = {
    start(el) {
      if (running && canvas === el) return;
      this.stop();
      canvas = el; ctx = canvas.getContext("2d");
      resize();
      for (const [type, fn] of listeners) canvas.addEventListener(type, fn, { passive: true });
      window.addEventListener("resize", resize);
      if (reduced) return;
      running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false; cancelAnimationFrame(raf);
      if (!canvas) return;
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      window.removeEventListener("resize", resize);
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (!canvas) return;
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!reduced && !canvas.closest("[hidden]")) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  });
})();
