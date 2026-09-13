// The sign-in sky. Several hundred stars in three depths — a third of them lime — that drift,
// twinkle and answer the hand: a swipe draws a lime comet trail, throws sparks and stirs the stars
// along, heating the touched ones lime; a tap fires a shockwave ring, a burst of sparks and sends
// the nearby stars streaking outward; the whole field leans a little toward the finger for depth. Built the way the fast ones are built —
// struct-of-arrays in Float32Arrays, one canvas, pre-rendered glow sprites drawn additively, pixel
// ratio capped, the loop stopped when the screen is hidden — so it holds 60fps on a phone.
(() => {
  const LIME = "#baff00";
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let canvas, ctx, w = 0, h = 0, N = 0, raf = 0, running = false, last = 0, ro = null;
  // struct of arrays
  let X, Y, Z, VX, VY, HX, HY, HEAT, PH, TW, PX, PY, LIMEY, OX, OY;
  // short-lived things: sparks thrown by the hand, shockwave rings from a tap, the comet trail
  const SPARKS = 320; const sx = new Float32Array(SPARKS), sy = new Float32Array(SPARKS), svx = new Float32Array(SPARKS), svy = new Float32Array(SPARKS), sl = new Float32Array(SPARKS), ss = new Float32Array(SPARKS); let sparkNext = 0;
  const rings = [];
  // The ribbon: a chain of nodes on springs, each following the one before it (Codrops' "stylised
  // mouse trails" recipe — springs instead of linear easing). It lags and overshoots like something
  // with mass, and when the finger lifts it catches up with itself and folds away.
  const CHAIN = 22; const cx = new Float32Array(CHAIN), cy = new Float32Array(CHAIN), cvx = new Float32Array(CHAIN), cvy = new Float32Array(CHAIN);
  let ribbon = 0; // 0..1 visibility, eased
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
    N = Math.max(220, Math.min(720, Math.round((w * h) / 1500)));
    X = new Float32Array(N); Y = new Float32Array(N); Z = new Float32Array(N);
    VX = new Float32Array(N); VY = new Float32Array(N); HX = new Float32Array(N); HY = new Float32Array(N);
    HEAT = new Float32Array(N); PH = new Float32Array(N); TW = new Float32Array(N); PX = new Float32Array(N); PY = new Float32Array(N); LIMEY = new Float32Array(N); OX = new Float32Array(N); OY = new Float32Array(N);
    for (let i = 0; i < N; i += 1) {
      X[i] = PX[i] = OX[i] = Math.random() * w; Y[i] = PY[i] = OY[i] = Math.random() * h;
      Z[i] = 0.25 + Math.random() ** 2 * 0.75;              // most stars far and small
      const a = Math.random() * Math.PI * 2, sp = 2 + Z[i] * 6; // slow home drift, faster when near
      HX[i] = Math.cos(a) * sp; HY[i] = Math.sin(a) * sp;
      PH[i] = Math.random() * Math.PI * 2; TW[i] = 0.5 + Math.random() * 1.5;
      LIMEY[i] = Math.random() < 0.34 ? 0.55 + Math.random() * 0.45 : 0; // a third of the sky is lime at rest
    }
    sl.fill(0); rings.length = 0; ribbon = 0;
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
      // the home drifts slowly and wraps; the star is a damped spring on it, so whatever the hand
      // does, the star is back within a second or so and the sky never goes dark around the finger
      OX[i] += HX[i] * dt; OY[i] += HY[i] * dt;
      if (OX[i] < -20) { OX[i] += w + 40; X[i] += w + 40; PX[i] = X[i]; } else if (OX[i] > w + 20) { OX[i] -= w + 40; X[i] -= w + 40; PX[i] = X[i]; }
      if (OY[i] < -20) { OY[i] += h + 40; Y[i] += h + 40; PY[i] = Y[i]; } else if (OY[i] > h + 20) { OY[i] -= h + 40; Y[i] -= h + 40; PY[i] = Y[i]; }
      let ax = (OX[i] - X[i]) * 4 - VX[i] * 2.2, ay = (OY[i] - Y[i]) * 4 - VY[i] * 2.2;
      if (hand.active) {
        const dx = X[i] - hand.x, dy = Y[i] - hand.y, d2 = dx * dx + dy * dy;
        if (d2 < REACH2) {
          const d = Math.sqrt(d2) + 4, k = (1 - d / REACH), z = Z[i];
          // stirred along with the finger, eased aside a little, and curled around it (a tangential
          // push that turns the wake into a slow vortex); the spring brings every star back
          const tx_ = -dy / d, ty_ = dx / d;
          ax += hvx * k * 9 * z + (dx / d) * k * 55 * z + tx_ * k * hspeed * 0.9 * z;
          ay += hvy * k * 9 * z + (dy / d) * k * 55 * z + ty_ * k * hspeed * 0.9 * z;
          if (hspeed > 40 || hand.down) HEAT[i] = Math.min(1, HEAT[i] + k * dt * (hand.down ? 6 : 3));
        }
      }
      VX[i] += ax * dt; VY[i] += ay * dt;
      const cap = 160 + Z[i] * 420, v = Math.hypot(VX[i], VY[i]);
      if (v > cap) { VX[i] *= cap / v; VY[i] *= cap / v; }
      X[i] += VX[i] * dt; Y[i] += VY[i] * dt;
      HEAT[i] = Math.max(0, HEAT[i] - dt * 0.9);
      // wrap, and forget the previous position across the seam so no streak spans the screen
      if (X[i] < -20) { X[i] += w + 40; OX[i] += w + 40; PX[i] = X[i]; } else if (X[i] > w + 20) { X[i] -= w + 40; OX[i] -= w + 40; PX[i] = X[i]; }
      if (Y[i] < -20) { Y[i] += h + 40; OY[i] += h + 40; PY[i] = Y[i]; } else if (Y[i] > h + 20) { Y[i] -= h + 40; OY[i] -= h + 40; PY[i] = Y[i]; }
    }
    // the finger's velocity decays between events, so a still finger stops stirring
    hand.vx *= Math.max(0, 1 - dt * 8); hand.vy *= Math.max(0, 1 - dt * 8);
    // sparks fly, slow and die
    for (let i = 0; i < SPARKS; i += 1) {
      if (sl[i] <= 0) continue;
      svy[i] += 90 * dt; // a little gravity: they arc and settle instead of shooting straight
      sx[i] += svx[i] * dt; sy[i] += svy[i] * dt; svx[i] *= 1 - dt * 1.6; svy[i] *= 1 - dt * 1.6; sl[i] -= dt * 1.1;
    }
    for (let i = rings.length - 1; i >= 0; i -= 1) { const r = rings[i]; r.r += (420 - r.r * 0.6) * dt; r.life -= dt * 1.4; if (r.life <= 0) rings.splice(i, 1); }
    // ribbon: the head eases to the finger, every other node springs to the one ahead
    const target = hand.active ? 1 : 0; ribbon += (target - ribbon) * Math.min(1, dt * (target ? 10 : 3));
    const k = 260, damp = 0.78;
    for (let i = 0; i < CHAIN; i += 1) {
      const gx = i === 0 ? hand.x : cx[i - 1], gy = i === 0 ? hand.y : cy[i - 1];
      cvx[i] = (cvx[i] + (gx - cx[i]) * k * dt) * damp; cvy[i] = (cvy[i] + (gy - cy[i]) * k * dt) * damp;
      cx[i] += cvx[i] * dt * 6; cy[i] += cvy[i] * dt * 6;
    }
  }

  function spark(x, y, vx, vy, size) {
    const i = sparkNext; sparkNext = (sparkNext + 1) % SPARKS;
    sx[i] = x; sy[i] = y; svx[i] = vx; svy[i] = vy; sl[i] = 1; ss[i] = size;
  }

  function burst(x, y) {
    rings.push({ x, y, r: 6, life: 1 });
    for (let k = 0; k < 44; k += 1) { const a = Math.random() * Math.PI * 2, v = 160 + Math.random() * 420; spark(x, y, Math.cos(a) * v, Math.sin(a) * v, 1.5 + Math.random() * 2.5); }
    for (let i = 0; i < N; i += 1) {
      const dx = X[i] - x, dy = Y[i] - y, d2 = dx * dx + dy * dy;
      if (d2 < 190 * 190) {
        const d = Math.sqrt(d2) + 6, k = 1 - d / 190;
        VX[i] += (dx / d) * k * (300 + 380 * Z[i]); VY[i] += (dy / d) * k * (300 + 380 * Z[i]);
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
      if (sp > 2.5 && heat > 0.05) {
        ctx.globalAlpha = Math.min(0.9, alpha) * Math.min(1, sp / 14);
        ctx.strokeStyle = heat > 0.15 ? LIME : "rgb(232 236 255)"; ctx.lineWidth = Math.max(1, size * 0.28); ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(PX[i] + ox - sx * 2.5, PY[i] + oy - sy * 2.5); ctx.lineTo(X[i] + ox, Y[i] + oy); ctx.stroke();
      }
      const lime = Math.max(heat, LIMEY[i]);
      ctx.globalAlpha = alpha * (1 - lime);
      ctx.drawImage(sprites.white, X[i] + ox - size, Y[i] + oy - size, size * 2, size * 2);
      if (lime > 0.02) { ctx.globalAlpha = alpha * lime; ctx.drawImage(sprites.lime, X[i] + ox - size, Y[i] + oy - size, size * 2, size * 2); }
    }
    // the ribbon: a tapered lime stroke with a soft halo and a thin white core, head to tail
    if (ribbon > 0.02) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let pass = 0; pass < 3; pass += 1) {
        for (let i = 1; i < CHAIN; i += 1) {
          const f = 1 - i / CHAIN; // 1 at the head, 0 at the tail
          if (pass === 0) { ctx.strokeStyle = LIME; ctx.globalAlpha = ribbon * f * 0.16; ctx.lineWidth = 34 * f + 6; }
          else if (pass === 1) { ctx.strokeStyle = LIME; ctx.globalAlpha = ribbon * f * 0.7; ctx.lineWidth = 11 * f + 1; }
          else { ctx.strokeStyle = "rgb(244 255 214)"; ctx.globalAlpha = ribbon * f * f * 0.8; ctx.lineWidth = 3 * f + 0.5; }
          ctx.beginPath(); ctx.moveTo(cx[i - 1], cy[i - 1]); ctx.lineTo(cx[i], cy[i]); ctx.stroke();
        }
      }
      // the head: a bright bead where the finger is
      const hs = 10 + Math.min(14, hspeedNow() * 0.03);
      ctx.globalAlpha = ribbon * 0.9; ctx.drawImage(sprites.lime, cx[0] - hs, cy[0] - hs, hs * 2, hs * 2);
      ctx.globalAlpha = ribbon * 0.9; ctx.drawImage(sprites.white, cx[0] - hs * 0.5, cy[0] - hs * 0.5, hs, hs);
    }
    for (let i = 0; i < SPARKS; i += 1) {
      if (sl[i] <= 0) continue;
      const size = ss[i] * (0.6 + sl[i]);
      ctx.globalAlpha = sl[i];
      ctx.drawImage(sprites.lime, sx[i] - size * 2, sy[i] - size * 2, size * 4, size * 4);
    }
    for (const r of rings) {
      ctx.globalAlpha = r.life * 0.9; ctx.strokeStyle = LIME; ctx.lineWidth = 1.5 + r.life * 4;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = r.life * 0.25; ctx.lineWidth = 18; ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }

  function hspeedNow() { return Math.hypot(hand.vx, hand.vy); }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    step(dt, now); draw(now);
    raf = requestAnimationFrame(frame);
  }

  // ---- the hand ------------------------------------------------------------------------------------
  function at(ev) { const r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function onDown(ev) {
    const p = at(ev); hand.x = hand.downX = p.x; hand.y = hand.downY = p.y; hand.vx = hand.vy = 0; hand.moved = 0; hand.downAt = performance.now(); hand.down = true; hand.active = true;
    canvas.setPointerCapture?.(ev.pointerId);
    rings.push({ x: p.x, y: p.y, r: 4, life: 0.6 }); // the finger lands: a small ring, at once
    if (ribbon < 0.05) { cx.fill(p.x); cy.fill(p.y); cvx.fill(0); cvy.fill(0); } // start the ribbon where the finger is
  }
  function onMove(ev) {
    const p = at(ev);
    if (hand.active) {
      const dx = p.x - hand.x, dy = p.y - hand.y, d = Math.hypot(dx, dy);
      hand.vx = hand.vx * 0.5 + dx * 30; hand.vy = hand.vy * 0.5 + dy * 30; hand.moved += d;
      if (hand.down || ev.pointerType === "mouse") {
        // a few embers peel off behind the head and drift, more the faster it goes
        const n = Math.min(3, Math.round(d / 10));
        for (let k = 0; k < n; k += 1) { const f = k / Math.max(1, n); spark(hand.x + dx * f, hand.y + dy * f, -dx * 3 + (Math.random() - 0.5) * 90, -dy * 3 + (Math.random() - 0.5) * 90 - 20, 0.8 + Math.random() * 1.6); }
      }
    }
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
