"use strict";
// The landing's accent field, drawn on a canvas behind the mark, in one of four moods chosen by ui.json
// (components.site.field, or ?field=… to try one): "seats" (small cubes drifting and bouncing off each other, never
// joining), "shapes" (Swiss forms floating and bouncing softly), "bubbles"
// (blobs that merge and part), "cubes" (cubes that take in smaller ones and, once big, shed little cubes that do the
// same). The pointer pushes things around and the mark tilts toward it; a pointer that rests lets them drift back. Bodies
// bounce off the mark, also while it spins. With reduced motion the field is one still frame; without this script the
// panel is plain accent.
(() => {
  // "What you'll see" opens its dialog; without this script the link leads to the list on About
  const features = document.getElementById("features");
  document.querySelector("[data-features]")?.addEventListener("click", (ev) => {
    if (!features?.showModal) return;
    ev.preventDefault(); features.showModal();
  });
  features?.addEventListener("click", (ev) => { if (ev.target === features) features.close(); });  // the backdrop

  const plan = document.querySelector(".landing-plan");
  if (!plan) return;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const asked = new URLSearchParams(location.search).get("field");
  const field = ["seats", "shapes", "bubbles", "cubes"].find((f) => f === asked || (!asked && f === getComputedStyle(plan).getPropertyValue("--c-site-field").trim())) || "seats";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  plan.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const rand = (a, b) => a + Math.random() * (b - a);
  let W = 0, H = 0, ink = "17, 20, 23", pointer = null, frame = 0, last = 0;
  const PAPER = "255, 255, 255";

  function readColour() {  // the text colour on the accent, as r, g, b for the canvas
    const probe = document.createElement("i");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(--on-accent)";
    plan.append(probe);
    const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g);
    probe.remove();
    if (m) ink = m.slice(0, 3).join(", ");
  }

  // ---------- bodies shared by shapes and cubes: drift, soft elastic collisions, walls, the pointer ----------
  // Smooth cruising: each body keeps a speed and a heading that turns slowly along a sine, and its velocity eases
  // toward that course; a collision or a push sets the new heading, so nothing tugs back. No per-frame noise.
  let clock = 0;
  function move(bodies, dt, {cap = .05, push = 140} = {}) {
    clock += dt;
    for (const b of bodies) {
      if (b.heading === undefined) {
        b.heading = Math.atan2(b.vy, b.vx) || rand(0, Math.PI * 2);
        b.cruise = cap * rand(.35, .7); b.turn = rand(.00012, .00028) * (Math.random() < .5 ? -1 : 1);
        b.freq = rand(.00015, .0004); b.phase = rand(0, Math.PI * 2);
      }
      b.heading += Math.sin(clock * b.freq + b.phase) * b.turn * dt;
      let tx = Math.cos(b.heading) * b.cruise, ty = Math.sin(b.heading) * b.cruise;
      // a soft field around the pointer: stronger near, gone at the edge of its reach; it fades while the pointer rests
      const boost = pointer ? (pointer.boost || 1) * pointer.fade + pointer.burst * 2 : 0;
      if (boost > .02) {
        const dx = b.x - pointer.x, dy = b.y - pointer.y, d = Math.hypot(dx, dy) || 1, reach = push * 1.3 * boost + b.r;
        if (d < reach) {
          const f = (1 - d / reach) ** 2 * cap * 7 * boost;
          tx += dx / d * f; ty += dy / d * f;
        }
      }
      const ease = 1 - Math.exp(-dt / 420);  // about half a second to settle on the new course
      b.vx += (tx - b.vx) * ease; b.vy += (ty - b.vy) * ease;
      b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;
      let bounced = false;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); bounced = true; }
      if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx); bounced = true; }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); bounced = true; }
      if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy); bounced = true; }
      if (bounced) b.heading = Math.atan2(b.vy, b.vx);
    }
  }
  function collide(bodies, onTouch) {
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || .01, gap = a.r + b.r - d;
      if (gap <= 0) continue;
      if (onTouch && onTouch(a, b, i, j)) continue;
      const nx = dx / d, ny = dy / d, ma = a.r * a.r, mb = b.r * b.r;
      const soft = gap * .5;  // overlaps resolve over a few frames, not in one jump
      a.x -= nx * soft * mb / (ma + mb); a.y -= ny * soft * mb / (ma + mb);
      b.x += nx * soft * ma / (ma + mb); b.y += ny * soft * ma / (ma + mb);
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {  // elastic, a little soft
        const k = 1.9 * rel / (ma + mb);
        a.vx += k * mb * nx; a.vy += k * mb * ny; b.vx -= k * ma * nx; b.vy -= k * ma * ny;
        a.heading = Math.atan2(a.vy, a.vx); b.heading = Math.atan2(b.vy, b.vx);
      }
      for (const o of [a, b]) {  // a push from a neighbour never takes anyone through a wall
        o.x = Math.min(Math.max(o.x, o.r), W - o.r); o.y = Math.min(Math.max(o.y, o.r), H - o.r);
      }
    }
  }

  // ---------- the mark as an obstacle: a rounded square at the centre, turned by the spin ----------
  // Each body is a circle; the mark's corners sweep while it spins, so its surface speed kicks what it touches.
  const solid = {x: 0, y: 0, half: 0, round: 0, angle: 0, spin: 0};
  function measureMark() {
    if (!mark) return;
    const r = mark.getBoundingClientRect(), p = plan.getBoundingClientRect(), side = parseFloat(getComputedStyle(mark).width) || 0;
    solid.x = r.left + r.width / 2 - p.left; solid.y = r.top + r.height / 2 - p.top;
    solid.half = side / 2; solid.round = side * 6 / 32;  // the tile's rx in its 32-unit viewBox
  }
  function turnMark(dt) {
    const a = mark?.classList.contains("spin") ? (parseFloat(getComputedStyle(mark).rotate) || 0) * Math.PI / 180 : 0;
    const da = Math.atan2(Math.sin(a - solid.angle), Math.cos(a - solid.angle));  // 360° → 0° at the end is no turn
    solid.spin = dt ? da / dt : 0; solid.angle = a;
  }
  function hitMark(bodies) {
    if (!solid.half) return;
    const cos = Math.cos(solid.angle), sin = Math.sin(solid.angle), inner = solid.half - solid.round;
    for (const b of bodies) {
      if (!b) continue;
      const wx = b.x - solid.x, wy = b.y - solid.y;
      const lx = wx * cos + wy * sin, ly = -wx * sin + wy * cos;  // the body in the mark's own frame
      const cx = Math.max(-inner, Math.min(inner, lx)), cy = Math.max(-inner, Math.min(inner, ly));
      let nx = lx - cx, ny = ly - cy, d = Math.hypot(nx, ny);
      const reach = b.r + solid.round;
      if (d >= reach) continue;
      if (d < 1e-6) {  // the centre is inside the square's core: out along the nearest side
        const ex = inner - Math.abs(lx), ey = inner - Math.abs(ly);
        [nx, ny] = ex < ey ? [Math.sign(lx) || 1, 0] : [0, Math.sign(ly) || 1];
        d = 0;
      } else { nx /= d; ny /= d; }
      const push = reach - d, gx = nx * cos - ny * sin, gy = nx * sin + ny * cos;  // the normal back in the plan's frame
      b.x += gx * push; b.y += gy * push;
      // the surface under the body moves with the spin: ω × r
      const sx = -solid.spin * (b.y - solid.y), sy = solid.spin * (b.x - solid.x);
      const rel = (b.vx - sx) * gx + (b.vy - sy) * gy;
      if (rel < 0) { b.vx -= 1.8 * rel * gx; b.vy -= 1.8 * rel * gy; b.heading = Math.atan2(b.vy, b.vx); }
      b.x = Math.min(Math.max(b.x, b.r), W - b.r); b.y = Math.min(Math.max(b.y, b.r), H - b.r);
    }
  }

  // ---------- seats: small cubes that drift, turn a little and bounce off each other, never joining ----------
  const seats = {
    items: [],
    init() {
      const n = Math.max(24, Math.min(90, Math.round(W * H / 4200)));
      this.items = Array.from({length: n}, () => ({r: rand(9, 14), x: rand(0, W), y: rand(0, H), vx: rand(-.04, .04), vy: rand(-.04, .04),
                                                   a: rand(0, Math.PI), va: rand(-.0006, .0006), alpha: rand(.16, .32)}));
    },
    step(dt) { move(this.items, dt, {cap: .06, push: 110}); collide(this.items); hitMark(this.items); },
    draw() {
      for (const s of this.items) {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
        ctx.fillStyle = `rgba(${ink}, ${s.alpha.toFixed(3)})`;
        ctx.beginPath(); roundRect(-s.r * .68, -s.r * .68, s.r * 1.36, s.r * 1.36, 3); ctx.fill();  // its diagonal stays inside r: never clipped by a wall
        ctx.restore();
      }
    },
  };

  // ---------- shapes: circles, half circles, bars and squares in ink and paper ----------
  const shapes = {
    items: [],
    init() {
      const n = Math.max(8, Math.min(18, Math.round(W * H / 26000)));
      const unit = Math.min(W, H) / 9;
      this.items = Array.from({length: n}, (_, i) => ({
        kind: ["circle", "half", "bar", "square"][i % 4], r: rand(.5, 1.25) * unit, x: rand(0, W), y: rand(0, H),
        vx: rand(-.03, .03), vy: rand(-.03, .03), a: rand(0, Math.PI * 2), va: rand(-.00025, .00025),
        tone: Math.random() < .62 ? ink : PAPER, alpha: rand(.12, .3)}));
    },
    step(dt) { move(this.items, dt); collide(this.items); hitMark(this.items); },
    draw() {
      for (const s of this.items) {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a);
        ctx.fillStyle = `rgba(${s.tone}, ${s.alpha.toFixed(3)})`;
        ctx.beginPath();
        if (s.kind === "circle") ctx.arc(0, 0, s.r * .92, 0, Math.PI * 2);
        else if (s.kind === "half") { ctx.arc(0, s.r * .25, s.r * .95, Math.PI, 0); ctx.closePath(); }
        else if (s.kind === "bar") roundRect(-s.r, -s.r * .2, s.r * 2, s.r * .4, s.r * .2);
        else roundRect(-s.r * .68, -s.r * .68, s.r * 1.36, s.r * 1.36, 6);
        ctx.fill(); ctx.restore();
      }
    },
  };

  // ---------- bubbles: a field of blobs, thresholded so they merge and part; the pointer is one more blob ----------
  const bubbles = {
    items: [], scale: 4, img: null, off: null,
    init() {
      const n = Math.max(6, Math.min(12, Math.round(W * H / 40000)));
      const unit = Math.min(W, H) / 13;
      this.items = Array.from({length: n}, () => ({r: rand(.7, 1.4) * unit, x: rand(0, W), y: rand(0, H), vx: rand(-.03, .03), vy: rand(-.03, .03), a: 0, va: 0}));
      this.off = document.createElement("canvas");
      this.off.width = Math.ceil(W / this.scale); this.off.height = Math.ceil(H / this.scale);
      this.img = this.off.getContext("2d").createImageData(this.off.width, this.off.height);
    },
    step(dt) {
      if (pointer) for (const b of this.items) {  // the pointer pulls blobs a little, so they stretch toward it
        const dx = pointer.x - b.x, dy = pointer.y - b.y, d = Math.hypot(dx, dy) || 1;
        if (d < 220) { b.vx += dx / d * .0009 * dt; b.vy += dy / d * .0009 * dt; }
      }
      const saved = pointer; pointer = null; move(this.items, dt, {cap: .04}); pointer = saved;
    },
    draw() {
      const {width: w, height: h} = this.off, data = this.img.data, s = this.scale;
      const [r, g, b] = ink.split(",").map(Number);
      const balls = this.items.map((o) => [o.x / s, o.y / s, (o.r / s) ** 2]);
      if (pointer) balls.push([pointer.x / s, pointer.y / s, (Math.min(W, H) / 16 / s) ** 2]);
      for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p += 4) {
        let f = 0;
        for (const [bx, by, rr] of balls) f += rr / ((x - bx) ** 2 + (y - by) ** 2 + 1);
        const t = Math.min(1, Math.max(0, (f - .85) / .3)), edge = t * t * (3 - 2 * t);  // smoothstep
        data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = edge * 72;
      }
      this.off.getContext("2d").putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.off, 0, 0, W, H);
    },
  };

  // ---------- cubes: a cube takes in smaller ones it meets; past a size it sheds little cubes that do the same ----------
  const cubes = {
    items: [], min: 6, max: 0,
    init() {
      this.max = Math.min(W, H) / 7;
      const n = Math.max(10, Math.min(26, Math.round(W * H / 16000)));
      this.items = Array.from({length: n}, () => this.cube(rand(0, W), rand(0, H), rand(this.min, this.max * .6)));
    },
    cube(x, y, r, vx = rand(-.03, .03), vy = rand(-.03, .03)) {
      return {x, y, r, target: r, vx, vy, a: rand(0, Math.PI), va: rand(-.0004, .0004), calm: 900};
    },
    step(dt) {
      for (const c of this.items) { c.r += (c.target - c.r) * Math.min(1, dt / 220); if (c.calm > 0) c.calm -= dt; }
      move(this.items, dt, {cap: .045});
      const out = [];
      collide(this.items, (a, b, i, j) => {  // the bigger one takes the smaller in, keeping the area
        if (a.calm > 0 || b.calm > 0) return false;
        const [big, small, k] = a.r >= b.r ? [a, b, j] : [b, a, i];
        if (small.r > big.r * .7) return false;
        big.target = Math.sqrt(big.target ** 2 + small.target ** 2);
        this.items[k] = null;
        return true;
      });
      for (const c of this.items) {
        if (!c) continue;
        if (c.target > this.max) {  // shed: two to four little cubes fly off, the rest stays
          const k = 2 + Math.floor(Math.random() * 3), piece = c.target / Math.sqrt(k + 2);
          for (let n = 0; n < k; n++) {
            const ang = rand(0, Math.PI * 2), sp = rand(.05, .09);
            out.push(this.cube(c.x + Math.cos(ang) * c.r, c.y + Math.sin(ang) * c.r, piece * .4, Math.cos(ang) * sp, Math.sin(ang) * sp));
            out[out.length - 1].target = piece;
          }
          c.target = Math.sqrt(Math.max(this.min ** 2, c.target ** 2 - k * piece ** 2)); c.calm = 1400;
        }
        out.push(c);
      }
      this.items = out.slice(0, 60);
      hitMark(this.items);
    },
    draw() {
      for (const c of this.items) {
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
        ctx.fillStyle = `rgba(${ink}, ${Math.min(.34, .12 + c.r / this.max * .2).toFixed(3)})`;
        ctx.beginPath(); roundRect(-c.r * .68, -c.r * .68, c.r * 1.36, c.r * 1.36, Math.max(2, c.r * .18)); ctx.fill();
        ctx.restore();
      }
    },
  };

  function roundRect(x, y, w, h, r) {
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  const mode = {seats, shapes, bubbles, cubes}[field];
  const mark = plan.querySelector(".mark");

  function resize() {
    const r = plan.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (Math.abs(r.width - W) < 1 && Math.abs(r.height - H) < 1) return;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measureMark();
    mode.init();
    if (still) { ctx.clearRect(0, 0, W, H); mode.draw(); }
  }

  function loop(now) {
    const dt = Math.min(48, now - (last || now)); last = now;  // milliseconds, capped after a hidden tab
    if (pointer) { pointer.fade = Math.exp(-(now - pointer.at) / 1200); pointer.burst *= Math.exp(-(dt || 16) / 450); }
    turnMark(dt);
    mode.step(dt || 16);
    ctx.clearRect(0, 0, W, H); mode.draw();
    frame = requestAnimationFrame(loop);
  }

  readColour();
  resize();
  new ResizeObserver(resize).observe(plan);
  if (still) return;
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColour);
  frame = requestAnimationFrame(loop);
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(frame); last = 0;
    if (!document.hidden) frame = requestAnimationFrame(loop);
  });

  plan.addEventListener("pointermove", (ev) => {
    const r = plan.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    // over the mark the field reacts twice as hard
    const m = mark?.getBoundingClientRect(), over = m && ev.clientX > m.left && ev.clientX < m.right && ev.clientY > m.top && ev.clientY < m.bottom;
    pointer = {x, y, boost: over ? 2 : 1, at: performance.now(), fade: 1, burst: pointer?.burst || 0};
    const tilt = over ? 40 : 30;
    plan.style.setProperty("--ty", `${((x / r.width - .5) * tilt).toFixed(1)}deg`);
    plan.style.setProperty("--tx", `${((.5 - y / r.height) * tilt).toFixed(1)}deg`);
  });
  // a click spins the mark once; it overshoots and settles back
  mark?.addEventListener("click", () => {
    mark.classList.remove("spin"); void mark.getBoundingClientRect(); mark.classList.add("spin");
    if (pointer) pointer.burst = 1;  // a strong push that dies out: resting on the mark lets everything drift back
  });
  mark?.addEventListener("animationend", (ev) => { if (ev.animationName === "mark-spin") mark.classList.remove("spin"); });
  plan.addEventListener("pointerleave", () => {
    pointer = null;
    ["--tx", "--ty"].forEach((k) => plan.style.setProperty(k, "0deg"));
  });
})();
