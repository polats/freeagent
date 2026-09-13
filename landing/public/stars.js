// The sign-in sky. A few hundred stars in three depths that drift, twinkle and answer the hand:
// dragging stirs them along with the finger, with the ones you touch lighting up lime and cooling
// back to white; a tap sends the nearby stars streaking outward like shooting stars; the whole
// field leans a little toward the finger for depth. Built the way the fast ones are built —
// struct-of-arrays in Float32Arrays, one canvas, pre-rendered glow sprites drawn additively, pixel
// ratio capped, the loop stopped when the screen is hidden — so it holds 60fps on a phone.
(() => {
  const LIME = "#baff00";
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let canvas, ctx, w = 0, h = 0, N = 0, raf = 0, running = false, last = 0, ro = null;
  // struct of arrays
  let X, Y, Z, VX, VY, HX, HY, HEAT, PH, TW, PX, PY;
  // the hand
  const hand = { x: -1e4, y: -1e4, vx: 0, vy: 0, down: false, active: false, downX: 0, downY: 0, downAt: 0, moved: 0 };
  const lean = { x: 0, y: 0 }; // parallax offset, eased toward the finger

  // ---- sprites: a soft disc with a hot core, in white and in lime, drawn once ---------------------
  const sprites = {};
  function makeSprite(color, core) {
    const R = 24, c = document.createElement("canvas"); c.width = c.height = R * 2;
    const g = c.getContext("2d"), grad = g.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, core); grad.addColorStop(0.18, color); grad.addColorStop(0.45, color.replace(")", " / 35%)")); grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad; g.fillRect(0, 0, R * 2, R * 2);
    return c;
  }
  function buildSprites() {
    sprites.white = makeSprite("rgb(232 236 255)", "#ffffff");
    sprites.lime = makeSprite("rgb(186 255 0)", "#f4ffd6");
  }

  // ---- field -------------------------------------------------------------------------------------
  function seed() {
    N = Math.max(140, Math.min(420, Math.round((w * h) / 2600)));
    X = new Float32Array(N); Y = new Float32Array(N); Z = new Float32Array(N);
    VX = new Float32Array(N); VY = new Float32Array(N); HX = new Float32Array(N); HY = new Float32Array(N);
    HEAT = new Float32Array(N); PH = new Float32Array(N); TW = new Float32Array(N); PX = new Float32Array(N); PY = new Float32Array(N);
    for (let i = 0; i < N; i += 1) {
      X[i] = PX[i] = Math.random() * w; Y[i] = PY[i] = Math.random() * h;
      Z[i] = 0.25 + Math.random() ** 2 * 0.75;              // most stars far and small
      const a = Math.random() * Math.PI * 2, sp = 2 + Z[i] * 6; // slow home drift, faster when near
      HX[i] = Math.cos(a) * sp; HY[i] = Math.sin(a) * sp;
      PH[i] = Math.random() * Math.PI * 2; TW[i] = 0.5 + Math.random() * 1.5;
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
    if (reduced) draw(0);
  }

  // ---- physics -----------------------------------------------------------------------------------
  const REACH = 150, REACH2 = REACH * REACH;
  function step(dt, t) {
    // the field leans toward the finger — the near stars most — so the sky has depth under the hand
    const tx = hand.active ? ((hand.x - w / 2) / w) * 26 : 0, ty = hand.active ? ((hand.y - h / 2) / h) * 26 : 0;
    lean.x += (tx - lean.x) * Math.min(1, dt * 3); lean.y += (ty - lean.y) * Math.min(1, dt * 3);
    const hvx = hand.vx, hvy = hand.vy, hspeed = Math.hypot(hvx, hvy);
    for (let i = 0; i < N; i += 1) {
      PX[i] = X[i]; PY[i] = Y[i];
      let ax = (HX[i] - VX[i]) * 1.2, ay = (HY[i] - VY[i]) * 1.2; // ease back to the drift
      if (hand.active) {
        const dx = X[i] - hand.x, dy = Y[i] - hand.y, d2 = dx * dx + dy * dy;
        if (d2 < REACH2) {
          const d = Math.sqrt(d2) + 4, k = (1 - d / REACH), z = Z[i];
          // stirred along with the finger (its velocity), and pushed gently aside so it parts around it
          ax += hvx * k * 9 * z + (dx / d) * k * 160 * z;
          ay += hvy * k * 9 * z + (dy / d) * k * 160 * z;
          if (hspeed > 40 || hand.down) HEAT[i] = Math.min(1, HEAT[i] + k * dt * (hand.down ? 6 : 3));
        }
      }
      VX[i] += ax * dt; VY[i] += ay * dt;
      const cap = 160 + Z[i] * 420, v = Math.hypot(VX[i], VY[i]);
      if (v > cap) { VX[i] *= cap / v; VY[i] *= cap / v; }
      X[i] += VX[i] * dt; Y[i] += VY[i] * dt;
      HEAT[i] = Math.max(0, HEAT[i] - dt * 0.9);
      // wrap, and forget the previous position across the seam so no streak spans the screen
      if (X[i] < -20) { X[i] += w + 40; PX[i] = X[i]; } else if (X[i] > w + 20) { X[i] -= w + 40; PX[i] = X[i]; }
      if (Y[i] < -20) { Y[i] += h + 40; PY[i] = Y[i]; } else if (Y[i] > h + 20) { Y[i] -= h + 40; PY[i] = Y[i]; }
    }
    // the finger's velocity decays between events, so a still finger stops stirring
    hand.vx *= Math.max(0, 1 - dt * 8); hand.vy *= Math.max(0, 1 - dt * 8);
  }

  function burst(x, y) {
    for (let i = 0; i < N; i += 1) {
      const dx = X[i] - x, dy = Y[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < 190 * 190) {
        const d = Math.sqrt(d2) + 6, k = 1 - d / 190;
        VX[i] += (dx / d) * k * (380 + 420 * Z[i]); VY[i] += (dy / d) * k * (380 + 420 * Z[i]);
        HEAT[i] = 1;
      }
    }
  }

  // ---- draw --------------------------------------------------------------------------------------
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < N; i += 1) {
      const z = Z[i], heat = HEAT[i];
      const tw = 0.6 + 0.4 * Math.sin(t * 0.001 * TW[i] + PH[i]);
      const alpha = (0.28 + 0.72 * z) * tw * (0.7 + 0.3 * heat) ;
      const size = (2.2 + z * 7) * (1 + heat * 0.6);
      const ox = lean.x * z, oy = lean.y * z;
      // a fast star leaves a streak behind it
      const sx = X[i] - PX[i], sy = Y[i] - PY[i], sp = Math.hypot(sx, sy);
      if (sp > 2.5) {
        ctx.globalAlpha = Math.min(0.9, alpha) * Math.min(1, sp / 14);
        ctx.strokeStyle = heat > 0.15 ? LIME : "rgb(232 236 255)"; ctx.lineWidth = Math.max(1, size * 0.28); ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(PX[i] + ox - sx * 2.5, PY[i] + oy - sy * 2.5); ctx.lineTo(X[i] + ox, Y[i] + oy); ctx.stroke();
      }
      ctx.globalAlpha = alpha * (1 - heat);
      ctx.drawImage(sprites.white, X[i] + ox - size, Y[i] + oy - size, size * 2, size * 2);
      if (heat > 0.02) { ctx.globalAlpha = alpha * heat; ctx.drawImage(sprites.lime, X[i] + ox - size, Y[i] + oy - size, size * 2, size * 2); }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    step(dt, now); draw(now);
    raf = requestAnimationFrame(frame);
  }

  // ---- the hand ------------------------------------------------------------------------------------
  function at(ev) { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function onDown(ev) { const p = at(ev); hand.x = hand.downX = p.x; hand.y = hand.downY = p.y; hand.vx = hand.vy = 0; hand.moved = 0; hand.downAt = performance.now(); hand.down = true; hand.active = true; canvas.setPointerCapture?.(ev.pointerId); }
  function onMove(ev) {
    const p = at(ev);
    if (hand.active) { hand.vx = hand.vx * 0.5 + (p.x - hand.x) * 30; hand.vy = hand.vy * 0.5 + (p.y - hand.y) * 30; hand.moved += Math.hypot(p.x - hand.x, p.y - hand.y); }
    hand.x = p.x; hand.y = p.y; hand.active = true;
  }
  function onUp(ev) {
    if (hand.down && hand.moved < 10 && performance.now() - hand.downAt < 400) burst(hand.downX, hand.downY); // a tap
    hand.down = false;
    if (ev.pointerType !== "mouse") hand.active = false; // a lifted finger is gone; a mouse stays
  }
  function onLeave() { hand.active = false; hand.down = false; }
  const listeners = [["pointerdown", onDown], ["pointermove", onMove], ["pointerup", onUp], ["pointercancel", onUp], ["pointerleave", onLeave]];

  window.Sky = {
    start(el) {
      if (canvas === el && running) return;
      this.stop();
      canvas = el; ctx = canvas.getContext("2d", { alpha: true });
      buildSprites(); resize();
      for (const [type, fn] of listeners) canvas.addEventListener(type, fn, { passive: true });
      ro = new ResizeObserver(resize); ro.observe(canvas);
      if (reduced) return;
      running = true; last = performance.now(); raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false; cancelAnimationFrame(raf);
      if (!canvas) return;
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      ro?.disconnect(); ro = null;
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (!canvas) return;
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!reduced && !canvas.closest("[hidden]")) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  });
})();
