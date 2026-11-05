// Canvas 2D renderer for the 2.5D stadium.

import { Camera, RAIL_H, RAIL_T, TOKEN_H } from './camera.js';
import { buildArena, buildBallTile, buildVignette, shade, rgba, APRON } from './art.js';
import { P, B, PHASE, PU, PU_INFO, PU_TUNE } from '../../shared/constants.js';

const TAU = Math.PI * 2;
const LIME = '#b6ff3b';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cam = new Camera();
    this.dpr = 1;
    this.W = 1;
    this.H = 1;
    this.quality = 'high';
    this.arena = null;
    this.arenaKey = '';
    this.ballTile = buildBallTile();
    this.ballPattern = this.ctx.createPattern(this.ballTile, 'repeat');
    this.vignette = null;
    this.time = 0;
    this.roll = { x: 0, y: 0 };
    this.lastBall = null;
    this.trail = [];
    this.labelCache = new Map();
    this.ledMessages = ['FUTBOL ARENA', 'GERÇEK ZAMANLI 4v4', 'PAS VER, ŞUTU ÇEK', 'FAIR PLAY'];
    this.minimap = null;
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this.arenaKey = '';
    this.resize();
  }

  resize() {
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    const maxDpr = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.cam.resize(W, H);
    this.vignette = buildVignette(Math.round(W / 2), Math.round(H / 2));
  }

  prepare(field, kits) {
    const key = `${field.key}|${kits.map((k) => k.id).join(',')}|${this.quality}`;
    if (key === this.arenaKey) return;
    this.arenaKey = key;
    this.arena = buildArena(field, kits, this.quality);
    this.trail.length = 0;
    this.lastBall = null;
    this.cam.snap();
  }

  setLedMessages(list) {
    this.ledMessages = list;
  }

  // ---------------------------------------------------------------------------

  draw(view, fx, dt, opts) {
    const { ctx, cam, dpr } = this;
    const f = view.field;
    this.time += dt;
    cam.topPad = opts.topPad ?? 70;
    if (opts.tilt && Math.abs(opts.tilt - cam.tilt) > 0.001) cam.setTilt(opts.tilt);
    cam.update(dt, f, opts.focus, view.ball, opts.cameraMode || 'auto', opts.zoomBoost || 1, opts.shift || null);
    const sh = fx.shake;
    cam.shakeX = sh ? (Math.random() - 0.5) * sh : 0;
    cam.shakeY = sh ? (Math.random() - 0.5) * sh : 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, this.W, this.H);

    // Ground
    cam.groundTransform(ctx, dpr);
    const a = this.arena;
    if (a) {
      ctx.drawImage(a.base, a.ox, a.oy, a.w, a.h);
      if (a.alt && fx.excite > 0.04 && Math.floor(this.time * 7) % 2 === 0) ctx.drawImage(a.alt, a.ox, a.oy, a.w, a.h);
    }
    this.drawGround(view, fx);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawRails(f, fx, 'far');
    this.drawGoal(f, -1, 'back', fx);
    this.drawGoal(f, 1, 'back', fx);

    const ents = [];
    for (const p of view.players) ents.push({ y: p.y, k: 0, o: p });
    ents.push({ y: view.ball.y, k: 1, o: view.ball });
    for (const u of view.pu || []) ents.push({ y: u.y, k: 3, o: u });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) ents.push({ y: sy * f.gh, k: 2, o: { sx, sy } });
    ents.sort((u, v) => u.y - v.y);
    for (const e of ents) {
      if (e.k === 0) this.drawPlayer(e.o, view);
      else if (e.k === 1) this.drawBall(e.o, view);
      else if (e.k === 3) this.drawPowerUp(e.o);
      else this.drawPost(f, e.o.sx, e.o.sy);
    }

    this.drawGoal(f, -1, 'front', fx);
    this.drawGoal(f, 1, 'front', fx);
    this.drawRails(f, fx, 'near');
    this.drawParticles(fx);
    if (opts.showNames !== false) this.drawLabels(view);
    this.drawBallIndicator(view);
    this.drawScreenFx(fx, view, opts);
  }

  // ---------------------------------------------------------------------------
  // Ground pass (world coordinates, tilted transform)

  drawGround(view, fx) {
    const { ctx } = this;
    const f = view.field;
    const hq = this.quality !== 'low';
    this.drawCornerGround(f);

    if (view.phase === PHASE.KICKOFF && view.kits) {
      const col = view.kits[view.ko].primary;
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
      ctx.strokeStyle = rgba(col, 0.25 + pulse * 0.35);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, f.cr, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = rgba(col, 0.06 + pulse * 0.05);
      ctx.fill();
    }

    for (const r of fx.rings) {
      const t = r.t / r.max;
      ctx.strokeStyle = r.color.replace(/[\d.]+\)$/, `${(1 - t) * 0.8})`);
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * t, 0, TAU);
      ctx.stroke();
    }

    // Shadows
    for (const p of view.players) {
      if (hq) {
        ctx.fillStyle = 'rgba(0,0,0,0.09)';
        for (const [ox, oy] of [[-9, -7], [9, -7], [-9, 8], [9, 8]]) {
          ctx.beginPath();
          ctx.arc(p.x + ox, p.y + oy, (p.r || P.R) * 1.08, 0, TAU);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.arc(p.x + 1.5, p.y + 2.5, (p.r || P.R) * 1.04, 0, TAU);
      ctx.fill();
    }
    const b = view.ball;
    const hz = Math.min(b.z / 140, 0.55);
    ctx.fillStyle = `rgba(0,0,0,${0.42 * (1 - Math.min(b.z / 160, 0.7))})`;
    ctx.beginPath();
    ctx.arc(b.x + b.z * 0.08, b.y + b.z * 0.1 + 1.5, B.R * (1.05 - hz), 0, TAU);
    ctx.fill();

    // Power-up spots on the ground
    for (const u of view.pu || []) {
      const info = PU_INFO[u.k];
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5 + u.id);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(u.x, u.y, 10, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(info.color, 0.35 + pulse * 0.4);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 18 + pulse * 6, 0, TAU);
      ctx.stroke();
    }

    // Power-up auras
    for (const p of view.players) {
      const R = p.r || P.R;
      if (p.sl > 0) {
        ctx.fillStyle = 'rgba(120,220,255,0.18)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, R + 8, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(170,235,255,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, R + 8, this.time * 2, this.time * 2 + TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (p.eff) {
        const info = PU_INFO[p.eff];
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
        ctx.fillStyle = rgba(info.color, 0.12 + pulse * 0.1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, R + 11, 0, TAU);
        ctx.fill();
        // Remaining time arc
        const left = Math.max(0, p.et / info.ticks);
        ctx.strokeStyle = info.color;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R + 11, -Math.PI / 2, -Math.PI / 2 + left * TAU);
        ctx.stroke();
      }
    }

    // Rings under players
    for (const p of view.players) {
      const kit = view.kits[p.team];
      if (p.me) {
        const pr = (p.r || P.R) + 6 + Math.sin(this.time * 5) * 1.5;
        ctx.fillStyle = 'rgba(182,255,59,0.10)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, pr + 4, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = LIME;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pr, 0, TAU);
        ctx.stroke();
      } else {
        ctx.strokeStyle = rgba(kit.primary, 0.55);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.r || P.R) + 3.5, 0, TAU);
        ctx.stroke();
      }
      if (p.ct) {
        // Kick armed: bright pulsing ring.
        const pulse = 0.75 + 0.25 * Math.sin(this.time * 18);
        ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.r || P.R) + 5, 0, TAU);
        ctx.stroke();
      }
    }

    // Kick direction hint for the local player: the ball always flies from body to ball.
    const me = view.players.find((p) => p.me);
    if (me && view.phase !== PHASE.GOAL) {
      const dx = b.x - me.x;
      const dy = b.y - me.y;
      const d = Math.hypot(dx, dy);
      const near = (me.r || P.R) + B.R + 34;
      if (d < near && d > 1) {
        const ux = dx / d;
        const uy = dy / d;
        const fade = 1 - Math.max(0, d - ((me.r || P.R) + B.R + 6)) / 28;
        const a = (me.ct ? 0.85 : 0.45) * Math.max(0, Math.min(1, fade));
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const k = B.R + 10 + i * 11;
          const cx = b.x + ux * k;
          const cy = b.y + uy * k;
          ctx.globalAlpha = 1 - i * 0.28;
          ctx.beginPath();
          ctx.moveTo(cx - ux * 4 - uy * 4.5, cy - uy * 4 + ux * 4.5);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx - ux * 4 + uy * 4.5, cy - uy * 4 - ux * 4.5);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = 'butt';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Boards

  quad(pts) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  box(x0, x1, y0, y1, h, top, front, led, alpha = 1) {
    const { ctx, cam } = this;
    const pr = (x, y, z) => cam.project(x, y, z);
    ctx.globalAlpha = alpha;
    const fr = [pr(x0, y1, 0), pr(x1, y1, 0), pr(x1, y1, h), pr(x0, y1, h)];
    this.quad(fr);
    ctx.fillStyle = front;
    ctx.fill();
    if (led) this.led(fr, led);
    const tp = [pr(x0, y0, h), pr(x1, y0, h), pr(x1, y1, h), pr(x0, y1, h)];
    this.quad(tp);
    ctx.fillStyle = top;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(fr[3][0], fr[3][1]);
    ctx.lineTo(fr[2][0], fr[2][1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  led(fr, { fx, offset }) {
    const { ctx } = this;
    const top = Math.min(fr[2][1], fr[3][1]);
    const bottom = Math.max(fr[0][1], fr[1][1]);
    const left = Math.min(fr[0][0], fr[3][0]);
    const right = Math.max(fr[1][0], fr[2][0]);
    const h = bottom - top;
    if (h < 3 || right < 0 || left > this.W) return;
    ctx.save();
    this.quad(fr);
    ctx.clip();
    const flash = fx.ledFlash;
    if (flash) {
      const on = Math.floor(flash.t * 6) % 2 === 0;
      ctx.fillStyle = on ? flash.color : '#0b0f18';
      ctx.fillRect(left, top, right - left, h);
    } else {
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, '#111a2c');
      g.addColorStop(1, '#070b14');
      ctx.fillStyle = g;
      ctx.fillRect(left, top, right - left, h);
    }
    const size = Math.max(6, h * 0.66);
    ctx.font = `${size}px "Russo One", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const msg = flash ? `  ${flash.text}  ✦` : `  ${this.ledMessages.join('   ✦   ')}   ✦`;
    const tw = Math.max(40, ctx.measureText(msg).width);
    const speed = flash ? 160 : 55;
    let x = left - ((this.time * speed + offset) % tw);
    ctx.fillStyle = flash ? (Math.floor(flash.t * 6) % 2 === 0 ? '#0b0f18' : flash.color) : '#c9f76b';
    const midY = (top + bottom) / 2 + 0.5;
    while (x < right) {
      ctx.fillText(msg, x, midY);
      x += tw;
    }
    // Pixel grid sheen
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let yy = top; yy < bottom; yy += 2) ctx.fillRect(left, yy, right - left, 1);
    ctx.restore();
  }

  drawRails(f, fx, which) {
    const { hw, hh, gh } = f;
    const T = RAIL_T;
    const top = '#1b2232';
    if (which === 'far') {
      this.box(-hw - T, hw + T, -hh - T, -hh, RAIL_H, top, '#0b101b', { fx, offset: 0 });
      // Side boards (tops only matter)
      for (const s of [-1, 1]) {
        const x0 = s > 0 ? hw : -hw - T;
        this.box(x0, x0 + T, -hh, -gh, RAIL_H, top, '#0b101b', null);
        this.box(x0, x0 + T, gh, hh, RAIL_H, top, '#0b101b', null);
      }
      this.drawCorner(f, -1, -1, 1);
      this.drawCorner(f, 1, -1, 1);
    } else {
      this.box(-hw - T, hw + T, hh, hh + T, RAIL_H, top, '#0b101b', { fx, offset: 400 }, 0.55);
      this.drawCorner(f, -1, 1, 0.55);
      this.drawCorner(f, 1, 1, 0.55);
    }
  }

  /** Points of a rounded corner cushion (world), from the side wall to the end wall. */
  cornerArc(f, sx, sy, n = 12) {
    const cx = sx * (f.hw - f.rc);
    const cy = sy * (f.hh - f.rc);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * (Math.PI / 2);
      pts.push([cx + sx * f.rc * Math.cos(t), cy + sy * f.rc * Math.sin(t)]);
    }
    return pts;
  }

  /** Ground part of the corner cushions, drawn under everything (world transform). */
  drawCornerGround(f) {
    const { ctx } = this;
    if (!f.rc) return;
    ctx.fillStyle = '#0b101b';
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const pts = this.cornerArc(f, sx, sy);
        ctx.beginPath();
        ctx.moveTo(sx * f.hw, sy * f.hh);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** Raised cushion in a corner: front face (far side only) and top. */
  drawCorner(f, sx, sy, alpha) {
    if (!f.rc) return;
    const { ctx, cam } = this;
    const arc = this.cornerArc(f, sx, sy);
    const low = arc.map(([x, y]) => cam.project(x, y, 0));
    const high = arc.map(([x, y]) => cam.project(x, y, RAIL_H));
    ctx.globalAlpha = alpha;
    if (sy < 0) {
      ctx.beginPath();
      low.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (let i = high.length - 1; i >= 0; i--) ctx.lineTo(high[i][0], high[i][1]);
      ctx.closePath();
      ctx.fillStyle = '#0d1424';
      ctx.fill();
    }
    const corner = cam.project(sx * (f.hw + RAIL_T), sy * (f.hh + RAIL_T), RAIL_H);
    ctx.beginPath();
    high.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineTo(corner[0], corner[1]);
    ctx.closePath();
    ctx.fillStyle = '#1b2232';
    ctx.fill();
    // Cushion edge highlight
    ctx.strokeStyle = 'rgba(201,247,107,0.55)';
    ctx.lineWidth = Math.max(1, cam.zoom * 1.6);
    ctx.beginPath();
    high.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Goals

  netLines(fn, nu, nv) {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const [x, y] = fn(i / nu, j / nv);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const [x, y] = fn(i / nu, j / nv);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  drawGoal(f, side, part, fx) {
    const { ctx, cam } = this;
    const x0 = side * f.hw;
    const x1 = side * (f.hw + f.gd);
    const gh = f.gh;
    const bar = f.bar;
    const pr = (x, y, z) => cam.project(x, y, z);
    const lw = Math.max(0.6, cam.zoom * 0.9);
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(232,238,250,0.33)';
    const ripple = (y, z) => fx.netOffset(side, y, z);
    const nY = Math.max(6, Math.round((gh * 2) / 11));
    if (part === 'back') {
      // Back net (x1 plane), with ripple
      const backFn = (u, v) => {
        const y = -gh + u * gh * 2;
        const z = v * bar;
        return pr(x1 + side * ripple(y, z), y, z);
      };
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      this.quad([pr(x1, -gh, 0), pr(x1, gh, 0), pr(x1, gh, bar), pr(x1, -gh, bar)]);
      ctx.fill();
      this.netLines(backFn, nY, 5);
      // Far side net (y = -gh)
      this.netLines((u, v) => pr(x0 + (x1 - x0) * u, -gh, v * bar), 4, 5);
      // Back stanchions
      ctx.strokeStyle = 'rgba(200,210,225,0.7)';
      ctx.lineWidth = lw * 2;
      ctx.beginPath();
      const a0 = pr(x1, -gh, 0);
      const a1 = pr(x1, -gh, bar);
      const b0 = pr(x1, gh, 0);
      const b1 = pr(x1, gh, bar);
      ctx.moveTo(a0[0], a0[1]);
      ctx.lineTo(a1[0], a1[1]);
      ctx.lineTo(b1[0], b1[1]);
      ctx.lineTo(b0[0], b0[1]);
      ctx.stroke();
    } else {
      // Roof (z = bar)
      ctx.strokeStyle = 'rgba(232,238,250,0.3)';
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      this.quad([pr(x0, -gh, bar), pr(x1, -gh, bar), pr(x1, gh, bar), pr(x0, gh, bar)]);
      ctx.fill();
      this.netLines((u, v) => {
        const y = -gh + v * gh * 2;
        return pr(x0 + (x1 - x0) * u + side * ripple(y, bar) * u * 0.6, y, bar);
      }, 4, nY);
      // Near side net (y = +gh)
      ctx.strokeStyle = 'rgba(232,238,250,0.3)';
      this.netLines((u, v) => pr(x0 + (x1 - x0) * u, gh, v * bar), 4, 5);
      // Top frame (crossbar + roof edges)
      const c0 = pr(x0, -gh, bar);
      const c1 = pr(x0, gh, bar);
      const pw = Math.max(2.5, 2 * 3.4 * cam.zoom);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = pw + 2;
      ctx.beginPath();
      ctx.moveTo(c0[0], c0[1] + 1);
      ctx.lineTo(c1[0], c1[1] + 1);
      ctx.stroke();
      ctx.strokeStyle = '#f3f6fb';
      ctx.lineWidth = pw;
      ctx.beginPath();
      ctx.moveTo(c0[0], c0[1]);
      ctx.lineTo(c1[0], c1[1]);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(200,210,225,0.75)';
      ctx.lineWidth = lw * 2;
      ctx.beginPath();
      const r0 = pr(x1, -gh, bar);
      const r1 = pr(x1, gh, bar);
      ctx.moveTo(c0[0], c0[1]);
      ctx.lineTo(r0[0], r0[1]);
      ctx.moveTo(c1[0], c1[1]);
      ctx.lineTo(r1[0], r1[1]);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  drawPost(f, sx, sy) {
    const { ctx, cam } = this;
    const x = sx * f.hw;
    const y = sy * f.gh;
    const g = cam.project(x, y, 0);
    const t = cam.project(x, y, f.bar);
    const pw = Math.max(2.5, 2 * 3.4 * cam.zoom);
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = pw + 2;
    ctx.beginPath();
    ctx.moveTo(g[0] + 1, g[1]);
    ctx.lineTo(t[0] + 1, t[1]);
    ctx.stroke();
    ctx.strokeStyle = '#f3f6fb';
    ctx.lineWidth = pw;
    ctx.beginPath();
    ctx.moveTo(g[0], g[1]);
    ctx.lineTo(t[0], t[1]);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = pw * 0.3;
    ctx.beginPath();
    ctx.moveTo(g[0] - pw * 0.2, g[1]);
    ctx.lineTo(t[0] - pw * 0.2, t[1]);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // ---------------------------------------------------------------------------
  // Players & ball

  drawPlayer(p, view) {
    const { ctx, cam } = this;
    const kit = view.kits[p.team];
    const z = cam.zoom;
    const [gx, gy] = cam.project(p.x, p.y, 0);
    const [tx, ty, s] = cam.project(p.x, p.y, TOKEN_H);
    const R = p.r || P.R;
    const rx = R * z;
    const ry = R * z * cam.tilt;
    const rxt = rx * s;
    const ryt = ry * s;
    if (gx < -60 || gx > this.W + 60 || gy < -80 || gy > this.H + 60) return;

    // Motion ghosts while sliding / sprinting fast
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 4.3) {
      for (let i = 1; i <= 2; i++) {
        const [hx, hy] = cam.project(p.x - p.vx * i * 2.2, p.y - p.vy * i * 2.2, TOKEN_H * 0.5);
        ctx.fillStyle = rgba(kit.primary, 0.16 / i);
        ctx.beginPath();
        ctx.ellipse(hx, hy, rxt, ryt, 0, 0, TAU);
        ctx.fill();
      }
    }

    // Side band (cylinder)
    const band = ctx.createLinearGradient(gx - rx, 0, gx + rx, 0);
    band.addColorStop(0, shade(kit.secondary, -0.6));
    band.addColorStop(0.35, shade(kit.secondary, -0.12));
    band.addColorStop(0.62, shade(kit.secondary, -0.28));
    band.addColorStop(1, shade(kit.secondary, -0.65));
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.ellipse(gx, gy, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(tx - rxt, ty);
    ctx.lineTo(tx + rxt, ty);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(gx, gy, rx, ry, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();

    // Top face, rotated with facing
    const r = R * z * s;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(1, cam.tilt);
    ctx.rotate(p.facing);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = kit.primary;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.fillStyle = kit.secondary;
    switch (kit.pattern) {
      case 'stripes':
        for (const k of [-0.62, 0, 0.62]) ctx.fillRect(-r, k * r - r * 0.13, r * 2, r * 0.26);
        break;
      case 'hoops':
        ctx.strokeStyle = kit.secondary;
        ctx.lineWidth = r * 0.24;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.66, 0, TAU);
        ctx.stroke();
        break;
      case 'sash':
        ctx.save();
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-r, -r * 0.2, r * 2, r * 0.4);
        ctx.restore();
        break;
      case 'half':
        ctx.fillRect(-r, 0, r * 2, r);
        break;
      default:
        ctx.strokeStyle = kit.secondary;
        ctx.lineWidth = r * 0.16;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.92, 0, TAU);
        ctx.stroke();
        break;
    }
    // Front notch shows facing
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.moveTo(r * 1.02, 0);
    ctx.lineTo(r * 0.6, -r * 0.26);
    ctx.lineTo(r * 0.6, r * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Lighting
    const hl = ctx.createRadialGradient(tx - rxt * 0.4, ty - ryt * 0.55, 0, tx, ty, rxt * 1.05);
    hl.addColorStop(0, 'rgba(255,255,255,0.42)');
    hl.addColorStop(0.45, 'rgba(255,255,255,0.06)');
    hl.addColorStop(0.8, 'rgba(0,0,0,0.05)');
    hl.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(tx, ty, rxt, ryt, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = p.me ? LIME : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = p.me ? 2 : 1.2;
    ctx.stroke();

    // Number
    ctx.save();
    ctx.translate(tx, ty + 0.5);
    ctx.scale(1, cam.tilt);
    ctx.font = `${Math.round(r * 0.92)}px "Russo One", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.strokeText(String(p.number), 0, 1);
    ctx.fillStyle = kit.text;
    ctx.fillText(String(p.number), 0, 1);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawBall(b, view) {
    const { ctx, cam } = this;
    // Roll the surface pattern with movement
    if (this.lastBall) {
      const dx = b.x - this.lastBall.x;
      const dy = b.y - this.lastBall.y;
      if (Math.abs(dx) < 60 && Math.abs(dy) < 60) {
        const k = 64 / (2.2 * B.R);
        this.roll.x = (this.roll.x + dx * k) % 64;
        this.roll.y = (this.roll.y + dy * k * cam.tilt) % 64;
      } else this.trail.length = 0;
    }
    this.lastBall = { x: b.x, y: b.y };

    const speed = b.speed || 0;
    const tr = this.trail;
    if (speed > 5.5) {
      tr.push({ x: b.x, y: b.y, z: b.z });
      if (tr.length > 16) tr.shift();
    } else if (tr.length) tr.shift();

    const [cx, cy, s] = cam.project(b.x, b.y, b.z + B.R);
    const r = B.R * cam.zoom * s;

    if (tr.length > 1 && this.quality !== 'low') {
      const hot = speed > 12.2 || b.fire > 0;
      ctx.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        const t = i / tr.length;
        const [ax, ay] = cam.project(tr[i - 1].x, tr[i - 1].y, tr[i - 1].z + B.R);
        const [bx, by] = cam.project(tr[i].x, tr[i].y, tr[i].z + B.R);
        ctx.strokeStyle = hot ? `rgba(255,${150 + t * 80},60,${0.5 * t})` : `rgba(255,255,255,${0.3 * t})`;
        ctx.lineWidth = r * 1.7 * t;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }

    if (speed > 12.2 || b.fire > 0) {
      const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.4);
      glow.addColorStop(0, 'rgba(255,190,90,0.45)');
      glow.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.4, 0, TAU);
      ctx.fill();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#f7f7f4';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const sc = (r * 2.2) / 64;
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    ctx.translate(this.roll.x, this.roll.y);
    ctx.fillStyle = this.ballPattern;
    ctx.fillRect(-160, -160, 320, 320);
    ctx.restore();

    const sh = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    sh.addColorStop(0, 'rgba(255,255,255,0.65)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (b.rub > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 12);
      ctx.strokeStyle = `rgba(255,79,163,${0.55 + pulse * 0.4})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3 + pulse * 2, 0, TAU);
      ctx.stroke();
    }
    void view;
  }

  /** Floating power-up badge. */
  drawPowerUp(u) {
    const { ctx, cam } = this;
    const info = PU_INFO[u.k];
    const bob = Math.sin(this.time * 3 + u.id) * 3;
    const [x, y, s] = cam.project(u.x, u.y, 20 + bob);
    const r = 12 * cam.zoom * s;
    // Blink during the last two seconds
    if (u.t > PU_TUNE.LIFE - 120 && Math.floor(this.time * 8) % 2 === 0) return;
    const pop = Math.min(1, u.t / 12);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    const glow = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.4);
    glow.addColorStop(0, rgba(info.color, 0.55));
    glow.addColorStop(1, rgba(info.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, TAU);
    ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, shade(info.color, 0.45));
    g.addColorStop(1, shade(info.color, -0.25));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.stroke();
    ctx.rotate(Math.sin(this.time * 2 + u.id) * 0.15);
    this.puIcon(u.k, r * 0.62);
    ctx.restore();
  }

  /** White vector glyph for a power-up kind, centred at the origin. */
  puIcon(k, s) {
    const { ctx } = this;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (k === PU.FIRE) {
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.95, -s * 0.15, s * 0.9, s * 0.85, 0, s * 0.9);
      ctx.bezierCurveTo(-s * 0.9, s * 0.85, -s * 0.95, -s * 0.15, 0, -s);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,140,40,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.2);
      ctx.bezierCurveTo(s * 0.45, s * 0.25, s * 0.4, s * 0.75, 0, s * 0.75);
      ctx.bezierCurveTo(-s * 0.4, s * 0.75, -s * 0.45, s * 0.25, 0, -s * 0.2);
      ctx.fill();
    } else if (k === PU.GIANT) {
      ctx.lineWidth = s * 0.32;
      ctx.moveTo(-s * 0.7, -s * 0.05);
      ctx.lineTo(0, -s * 0.75);
      ctx.lineTo(s * 0.7, -s * 0.05);
      ctx.moveTo(-s * 0.7, s * 0.7);
      ctx.lineTo(0, 0);
      ctx.lineTo(s * 0.7, s * 0.7);
      ctx.stroke();
    } else if (k === PU.SPEED) {
      ctx.moveTo(s * 0.2, -s);
      ctx.lineTo(-s * 0.6, s * 0.15);
      ctx.lineTo(-s * 0.02, s * 0.15);
      ctx.lineTo(-s * 0.25, s);
      ctx.lineTo(s * 0.62, -s * 0.18);
      ctx.lineTo(s * 0.05, -s * 0.18);
      ctx.closePath();
      ctx.fill();
    } else if (k === PU.ICE) {
      ctx.lineWidth = s * 0.2;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        const cx = Math.cos(a) * s;
        const cy = Math.sin(a) * s;
        ctx.moveTo(-cx, -cy);
        ctx.lineTo(cx, cy);
        for (const sg of [-1, 1]) {
          const bx = cx * 0.6 * sg;
          const by = cy * 0.6 * sg;
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a + 2.4) * s * 0.3 * sg, by + Math.sin(a + 2.4) * s * 0.3 * sg);
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a - 2.4) * s * 0.3 * sg, by + Math.sin(a - 2.4) * s * 0.3 * sg);
        }
      }
      ctx.stroke();
    } else {
      ctx.arc(-s * 0.15, s * 0.2, s * 0.5, 0, TAU);
      ctx.fill();
      ctx.lineWidth = s * 0.18;
      ctx.beginPath();
      ctx.arc(-s * 0.15, s * 0.2, s * 0.95, -1.35, -0.25);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.15, s * 0.2, s * 1.35, -1.25, -0.4);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  // ---------------------------------------------------------------------------

  drawParticles(fx) {
    const { ctx, cam } = this;
    const z = cam.zoom;
    for (const p of fx.particles) {
      const [sx, sy] = cam.project(p.x, p.y, p.z);
      const t = p.life / p.max;
      if (p.k === 'dust') {
        ctx.fillStyle = `${p.c}${0.35 * (1 - t)})`;
        ctx.beginPath();
        ctx.ellipse(sx, sy, p.size * z, p.size * z * cam.tilt, 0, 0, TAU);
        ctx.fill();
      } else if (p.k === 'flame') {
        // Normal blending: additive turns orange into lime on top of the green grass.
        const r = p.size * z * (1 - t * 0.4);
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, `rgba(255,236,150,${0.95 * (1 - t)})`);
        g.addColorStop(0.45, `rgba(${p.c},${0.8 * (1 - t)})`);
        g.addColorStop(1, `rgba(${p.c},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, TAU);
        ctx.fill();
      } else if (p.k === 'star') {
        ctx.fillStyle = p.c;
        ctx.globalAlpha = 1 - t;
        this.star(sx, sy, p.size * z, this.time * 6);
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 1 - t * t;
        ctx.fillStyle = p.c;
        ctx.fillRect(sx - p.size * z * 0.5, sy - p.size * z * 0.5, p.size * z, p.size * z);
        ctx.globalAlpha = 1;
      }
    }
  }

  star(x, y, r, rot) {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  labelWidth(text, font) {
    const key = `${font}|${text}`;
    let w = this.labelCache.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.labelCache.set(key, w);
      if (this.labelCache.size > 400) this.labelCache.clear();
    }
    return w;
  }

  drawLabels(view) {
    const { ctx, cam } = this;
    const font = '600 11px Inter, system-ui, sans-serif';
    for (const p of view.players) {
      const [gx, gy] = cam.project(p.x, p.y, 0);
      const [tx, ty, s] = cam.project(p.x, p.y, TOKEN_H);
      if (gx < -80 || gx > this.W + 80 || gy < -100 || gy > this.H + 60) continue;
      const kit = view.kits[p.team];
      const ryt = (p.r || P.R) * cam.zoom * cam.tilt * s;
      const rxt = (p.r || P.R) * cam.zoom * s;
      let y = ty - ryt - 12;

      const name = p.name || '';
      const w = this.labelWidth(name, font) + 14;
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(6,10,18,0.62)';
      ctx.beginPath();
      ctx.roundRect(tx - w / 2, y - 8, w, 16, 8);
      ctx.fill();
      ctx.fillStyle = p.me ? LIME : kit.primary === '#f2f5fa' ? '#cfd6e3' : kit.primary;
      ctx.beginPath();
      ctx.arc(tx - w / 2 + 6, y, 2.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.me ? LIME : '#eef2f8';
      ctx.fillText(name, tx + 3, y + 0.5);

      if (p.me) {
        const bob = Math.sin(this.time * 6) * 2;
        ctx.fillStyle = LIME;
        ctx.beginPath();
        ctx.moveTo(tx - 5, y - 15 + bob);
        ctx.lineTo(tx + 5, y - 15 + bob);
        ctx.lineTo(tx, y - 10 + bob);
        ctx.closePath();
        ctx.fill();
      }

      if (p.emote) {
        const age = p.emote.age;
        const alpha = age < 0.15 ? age / 0.15 : age > 2 ? Math.max(0, 1 - (age - 2) / 0.4) : 1;
        if (alpha > 0) {
          const ef = '700 12px Inter, system-ui, sans-serif';
          const ew = this.labelWidth(p.emote.text, ef) + 18;
          const ey = y - (p.me ? 34 : 24) - (age < 0.15 ? (1 - age / 0.15) * 6 : 0);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.roundRect(tx - ew / 2, ey - 11, ew, 22, 11);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(tx - 5, ey + 10);
          ctx.lineTo(tx + 5, ey + 10);
          ctx.lineTo(tx, ey + 16);
          ctx.fill();
          ctx.fillStyle = '#0d1220';
          ctx.font = ef;
          ctx.fillText(p.emote.text, tx, ey + 0.5);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  drawBallIndicator(view) {
    const { ctx, cam } = this;
    const b = view.ball;
    const [x, y] = cam.project(b.x, b.y, b.z);
    const m = 28;
    if (x >= m && x <= this.W - m && y >= m + 40 && y <= this.H - m) return;
    const cx = Math.max(m, Math.min(this.W - m, x));
    const cy = Math.max(m + 60, Math.min(this.H - m, y));
    const a = Math.atan2(y - cy, x - cx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(6,10,18,0.7)';
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, TAU);
    ctx.fill();
    ctx.rotate(a);
    ctx.fillStyle = LIME;
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(14, -6);
    ctx.lineTo(14, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawScreenFx(fx, view, opts) {
    const { ctx, cam, W, H } = this;
    const a = this.arena;
    if (a && this.quality !== 'low') {
      ctx.globalCompositeOperation = 'lighter';
      for (const [lx, ly] of a.lights) {
        const [sx, sy] = cam.project(lx, ly, 120);
        const R = 220 * cam.zoom;
        if (sx < -R || sx > W + R || sy < -R || sy > H + R) continue;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R);
        g.addColorStop(0, 'rgba(255,250,225,0.5)');
        g.addColorStop(0.08, 'rgba(255,248,220,0.22)');
        g.addColorStop(1, 'rgba(255,248,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - R, sy - R, R * 2, R * 2);
      }
      // Photographer flashes in the stands
      const f = view.field;
      for (const cf of fx.camFlashes) {
        const onX = cf.u < 0.5;
        const lx = onX ? (cf.v * 2 - 1) * (f.hw + 150) : (cf.u < 0.75 ? -1 : 1) * (f.hw + APRON.x + 60 + cf.v * 120);
        const ly = onX ? (cf.u < 0.25 ? -1 : 1) * (f.hh + APRON.y + 50 + cf.v * 120) : (cf.v * 2 - 1) * f.hh;
        const [sx, sy] = cam.project(lx, ly, 0);
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 10);
        g.addColorStop(0, `rgba(255,255,255,${0.9 * (1 - cf.t / 0.15)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - 10, sy - 10, 20, 20);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0, W, H);
    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(${fx.flashColor},${fx.flash * 0.6})`;
      ctx.fillRect(0, 0, W, H);
    }
    for (const c of fx.confetti) {
      const x = c.x * W;
      const y = c.y * H;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(c.rot);
      ctx.scale(1, Math.cos(c.rot * 1.7));
      ctx.fillStyle = c.c;
      ctx.globalAlpha = Math.min(1, (c.max - c.life) * 2);
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (opts.letterbox) {
      const h = Math.round(H * 0.08 * opts.letterbox);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, h);
      ctx.fillRect(0, H - h, W, h);
    }
  }

  // ---------------------------------------------------------------------------

  drawMinimap(canvas, view) {
    const ctx = canvas.getContext('2d');
    const f = view.field;
    const w = canvas.width;
    const h = canvas.height;
    const sx = w / (f.w + 40);
    const sy = h / (f.h + 40);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(30,110,55,0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    const X = (x) => (x + f.hw + 20) * sx;
    const Y = (y) => (y + f.hh + 20) * sy;
    ctx.strokeRect(X(-f.hw), Y(-f.hh), f.w * sx, f.h * sy);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(-f.hh));
    ctx.lineTo(X(0), Y(f.hh));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(0), Y(0), f.cr * sx, 0, TAU);
    ctx.stroke();
    // View rectangle
    const cam = this.cam;
    const tl = cam.unproject(0, 0);
    const br = cam.unproject(this.W, this.H);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(X(tl.x), Y(tl.y), (br.x - tl.x) * sx, (br.y - tl.y) * sy);
    for (const p of view.players) {
      ctx.fillStyle = view.kits[p.team].primary;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), p.me ? 4.5 : 3.5, 0, TAU);
      ctx.fill();
      if (p.me) {
        ctx.strokeStyle = LIME;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(X(view.ball.x), Y(view.ball.y), 2.5, 0, TAU);
    ctx.fill();
  }
}
