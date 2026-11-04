// Pre-rendered artwork: the arena ground (pitch, apron, stands with crowd) and small textures.

export const ARENA_MARGIN = { x: 270, y: 250 };
export const APRON = { x: 64, y: 54 };

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const m = (c) => Math.max(0, Math.min(255, Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f))));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d4a373'];
const HAIR = ['#1b1b1b', '#3b2a1e', '#5a3825', '#8c6239', '#d8b25c', '#2a2a2a', '#6d6d6d'];
const NEUTRAL = ['#f5f5f5', '#202020', '#3a3f4b', '#7b8394', '#c7ccd6', '#1d3557', '#5c4033'];

function pitchLines(ctx, f) {
  const { hw, hh, w, gh, cr } = f;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(255,255,255,0.35)';
  ctx.shadowBlur = 3;
  ctx.strokeRect(-hw + 1.5, -hh + 1.5, w - 3, f.h - 3);
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.lineTo(0, hh);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, cr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  ctx.fill();

  const pd = w * 0.13;
  const pw = Math.min(f.h * 0.62, gh * 2 + w * 0.2);
  const gdp = w * 0.045;
  const gw = gh * 2 + 70;
  const spot = w * 0.09;
  for (const side of [-1, 1]) {
    const x0 = side * hw;
    ctx.beginPath();
    ctx.moveTo(x0, -pw / 2);
    ctx.lineTo(x0 - side * pd, -pw / 2);
    ctx.lineTo(x0 - side * pd, pw / 2);
    ctx.lineTo(x0, pw / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x0, -gw / 2);
    ctx.lineTo(x0 - side * gdp, -gw / 2);
    ctx.lineTo(x0 - side * gdp, gw / 2);
    ctx.lineTo(x0, gw / 2);
    ctx.stroke();
    const sx = x0 - side * spot;
    ctx.beginPath();
    ctx.arc(sx, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // Penalty arc: the part of the circle outside the box.
    const r = cr * 0.92;
    const dx = pd - spot;
    if (r > dx) {
      const a = Math.acos(dx / r);
      ctx.beginPath();
      if (side > 0) ctx.arc(sx, 0, r, Math.PI - a, Math.PI + a);
      else ctx.arc(sx, 0, r, -a, a);
      ctx.stroke();
    }
    // Corner arcs
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      const cx = side * hw;
      const cy = sy * hh;
      const start = side > 0 ? (sy > 0 ? Math.PI : Math.PI / 2) : sy > 0 ? -Math.PI / 2 : 0;
      ctx.arc(cx, cy, 14, start, start + Math.PI / 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function grass(ctx, f, rnd, quality) {
  const { hw, hh, w, h } = f;
  const stripes = 16;
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#2f8d40' : '#37984a';
    ctx.fillRect(-hw + i * sw, -hh, sw + 0.5, h);
  }
  // Checker: alternate horizontal bands slightly lighter.
  const bands = 8;
  const bh = h / bands;
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let j = 0; j < bands; j += 2) ctx.fillRect(-hw, -hh + j * bh, w, bh);

  // Blade noise.
  const n = Math.round((w * h) / (quality === 'low' ? 110 : 45));
  for (let i = 0; i < n; i++) {
    const x = -hw + rnd() * w;
    const y = -hh + rnd() * h;
    const light = rnd() < 0.5;
    ctx.fillStyle = light ? `rgba(190,255,170,${0.03 + rnd() * 0.05})` : `rgba(0,30,0,${0.04 + rnd() * 0.07})`;
    ctx.fillRect(x, y, 1 + rnd() * 1.5, 2 + rnd() * 3);
  }
  // Floodlight pools and a soft vignette near the boards.
  const pools = [[-hw * 0.7, -hh * 0.7], [hw * 0.7, -hh * 0.7], [-hw * 0.7, hh * 0.7], [hw * 0.7, hh * 0.7], [0, 0]];
  for (const [px, py] of pools) {
    const g = ctx.createRadialGradient(px, py, 0, px, py, Math.max(w, h) * 0.42);
    g.addColorStop(0, 'rgba(255,255,235,0.075)');
    g.addColorStop(1, 'rgba(255,255,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-hw, -hh, w, h);
  }
  const vg = ctx.createRadialGradient(0, 0, Math.min(w, h) * 0.35, 0, 0, Math.max(w, h) * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,10,0,0.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(-hw, -hh, w, h);
}

function apron(ctx, f) {
  const ax = f.hw + APRON.x;
  const ay = f.hh + APRON.y;
  ctx.fillStyle = '#1f5130';
  ctx.fillRect(-ax, -ay, ax * 2, ay * 2);
  const sw = 34;
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = -ax; x < ax; x += sw * 2) ctx.fillRect(x, -ay, sw, ay * 2);
  // Running track style edge
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(-ax + 3, -ay + 3, ax * 2 - 6, ay * 2 - 6);
  // Goal interiors (behind the goal line): darker grass with net shadow.
  for (const side of [-1, 1]) {
    const x0 = side > 0 ? f.hw : -f.hw - f.gd;
    ctx.fillStyle = '#245f33';
    ctx.fillRect(x0, -f.gh, f.gd, f.gh * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let y = -f.gh; y <= f.gh; y += 10) {
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + f.gd, y);
      ctx.stroke();
    }
  }
}

function dugouts(ctx, f, kits) {
  const y = f.hh + APRON.y - 22;
  for (const side of [-1, 1]) {
    const kit = kits[side < 0 ? 0 : 1];
    const x = side * 150;
    ctx.fillStyle = 'rgba(10,14,22,0.9)';
    ctx.beginPath();
    ctx.roundRect(x - 70, y - 12, 140, 28, 6);
    ctx.fill();
    ctx.fillStyle = shade(kit.primary, -0.2);
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.roundRect(x - 62 + i * 16, y - 6, 12, 12, 3);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(160,220,255,0.18)';
    ctx.fillRect(x - 70, y - 14, 140, 5);
  }
  // Technical area lines
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  for (const side of [-1, 1]) {
    ctx.strokeRect(side * 150 - 90, f.hh + 8, 180, APRON.y - 34);
  }
  ctx.setLineDash([]);
}

/** Paints the stands (background + crowd). raised=true draws an excited crowd frame. */
function stands(ctx, f, kits, raised, seed) {
  const rnd = mulberry32(seed);
  const ax = f.hw + APRON.x;
  const ay = f.hh + APRON.y;
  const M = ARENA_MARGIN;
  const outerX = f.hw + M.x;
  const outerY = f.hh + M.y;

  // Background concrete + seats
  ctx.save();
  ctx.beginPath();
  ctx.rect(-outerX, -outerY, outerX * 2, outerY * 2);
  ctx.rect(-ax, -ay, ax * 2, ay * 2);
  ctx.clip('evenodd');
  const bg = ctx.createRadialGradient(0, 0, Math.min(ax, ay), 0, 0, Math.max(outerX, outerY) * 1.1);
  bg.addColorStop(0, '#1a2233');
  bg.addColorStop(1, '#0a0e16');
  ctx.fillStyle = bg;
  ctx.fillRect(-outerX, -outerY, outerX * 2, outerY * 2);

  const gap = 26;
  const rowH = 17;
  const rows = 11;
  const spacing = 9.5;
  const rowColors = ['#202a3d', '#1c2536'];
  for (let r = 0; r < rows; r++) {
    const d = gap + r * rowH + (r >= 5 ? 14 : 0);
    ctx.strokeStyle = rowColors[r % 2];
    ctx.lineWidth = rowH - 3;
    ctx.strokeRect(-ax - d - rowH / 2, -ay - d - rowH / 2, (ax + d + rowH / 2) * 2, (ay + d + rowH / 2) * 2);
  }
  // Walkway between tiers
  const wd = gap + 5 * rowH + 3;
  ctx.strokeStyle = '#2b3448';
  ctx.lineWidth = 8;
  ctx.strokeRect(-ax - wd, -ay - wd, (ax + wd) * 2, (ay + wd) * 2);
  // Inner wall
  ctx.strokeStyle = '#0d121c';
  ctx.lineWidth = 10;
  ctx.strokeRect(-ax - 9, -ay - 9, (ax + 9) * 2, (ay + 9) * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-ax - 14, -ay - 14, (ax + 14) * 2, (ay + 14) * 2);

  // Crowd
  const teamCols = kits.map((k) => [k.primary, k.secondary]);
  const person = (x, y, side) => {
    if (rnd() > 0.86) return; // empty seat
    let shirt;
    const t = rnd();
    if (t < 0.55) shirt = teamCols[side][rnd() < 0.75 ? 0 : 1];
    else if (t < 0.65) shirt = teamCols[1 - side][0];
    else shirt = NEUTRAL[Math.floor(rnd() * NEUTRAL.length)];
    const skin = SKIN[Math.floor(rnd() * SKIN.length)];
    const hair = HAIR[Math.floor(rnd() * HAIR.length)];
    const up = raised && rnd() < 0.7;
    const arms = raised && rnd() < 0.45;
    const lift = up ? -2.2 : 0;
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.ellipse(x, y + 1.2 + lift, 3.9, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (arms) {
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(x - 3.6, y - 3 + lift, 1.2, 0, Math.PI * 2);
      ctx.arc(x + 3.6, y - 3 + lift, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rnd() < 0.3 ? hair : skin;
    ctx.beginPath();
    ctx.arc(x, y - 0.6 + lift, 2.1, 0, Math.PI * 2);
    ctx.fill();
    if (rnd() < 0.5) {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(x, y - 1.3 + lift, 1.6, Math.PI, 0);
      ctx.fill();
    }
    // Occasional scarf / flag
    if (rnd() < 0.03) {
      ctx.fillStyle = teamCols[side][0];
      ctx.fillRect(x - 6, y - 7 + lift, 12, 4);
      ctx.fillStyle = teamCols[side][1];
      ctx.fillRect(x - 6, y - 5 + lift, 12, 2);
    }
  };
  for (let r = 0; r < rows; r++) {
    const d = gap + r * rowH + (r >= 5 ? 14 : 0) + rowH / 2 - 2;
    const ex = ax + d;
    const ey = ay + d;
    let seat = 0;
    for (let x = -ex; x <= ex; x += spacing) {
      seat++;
      if (seat % 22 === 0 || seat % 22 === 1) continue; // stairs
      const side = x < 0 ? 0 : 1;
      person(x + (rnd() - 0.5), -ey + (rnd() - 0.5), side);
      person(x + (rnd() - 0.5), ey + (rnd() - 0.5), side);
    }
    seat = 0;
    for (let y = -ey + spacing; y < ey; y += spacing) {
      seat++;
      if (seat % 22 === 0 || seat % 22 === 1) continue;
      person(-ex + (rnd() - 0.5), y + (rnd() - 0.5), 0);
      person(ex + (rnd() - 0.5), y + (rnd() - 0.5), 1);
    }
  }
  // Roof shadow at the back of the stands
  const sh = 70;
  const grd = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.65)');
    return g;
  };
  ctx.fillStyle = grd(0, -outerY + sh, 0, -outerY);
  ctx.fillRect(-outerX, -outerY, outerX * 2, sh);
  ctx.fillStyle = grd(0, outerY - sh, 0, outerY);
  ctx.fillRect(-outerX, outerY - sh, outerX * 2, sh);
  ctx.fillStyle = grd(-outerX + sh, 0, -outerX, 0);
  ctx.fillRect(-outerX, -outerY, sh, outerY * 2);
  ctx.fillStyle = grd(outerX - sh, 0, outerX, 0);
  ctx.fillRect(outerX - sh, -outerY, sh, outerY * 2);
  ctx.restore();
}

/**
 * Builds the arena ground image in world units.
 * @returns {{base:HTMLCanvasElement, alt:HTMLCanvasElement|null, ox:number, oy:number, w:number, h:number, lights:Array}}
 */
export function buildArena(field, kits, quality = 'high') {
  const q = quality === 'high' ? 1.35 : quality === 'medium' ? 1 : 0.7;
  const M = ARENA_MARGIN;
  const W = field.w + M.x * 2;
  const H = field.h + M.y * 2;
  const seed = 1337 + field.w;

  const base = makeCanvas(W * q, H * q);
  const ctx = base.getContext('2d');
  ctx.scale(q, q);
  ctx.translate(W / 2, H / 2);
  ctx.fillStyle = '#080b12';
  ctx.fillRect(-W / 2, -H / 2, W, H);
  stands(ctx, field, kits, false, seed);
  apron(ctx, field);
  dugouts(ctx, field, kits);
  grass(ctx, field, mulberry32(seed + 7), quality);
  pitchLines(ctx, field);

  let alt = null;
  if (quality !== 'low') {
    const aq = q * 0.85;
    alt = makeCanvas(W * aq, H * aq);
    const actx = alt.getContext('2d');
    actx.scale(aq, aq);
    actx.translate(W / 2, H / 2);
    stands(actx, field, kits, true, seed);
  }

  const lx = field.hw + APRON.x + 200;
  const ly = field.hh + APRON.y + 175;
  const lights = [[-lx, -ly], [lx, -ly], [-lx, ly], [lx, ly]];
  return { base, alt, ox: -W / 2, oy: -H / 2, w: W, h: H, lights };
}

/** Soccer ball surface tile used as a scrolling pattern. */
export function buildBallTile() {
  const s = 64;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f7f7f4';
  ctx.fillRect(0, 0, s, s);
  const penta = (cx, cy, r, rot) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + (i * Math.PI * 2) / 5;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = '#1b1d22';
  const pts = [[16, 16], [48, 16], [0, 48], [32, 48], [64, 48], [0, -16], [32, -16], [64, -16], [16, 80], [48, 80]];
  for (const [x, y] of pts) penta(x, y, 7.5, -Math.PI / 2 + (x + y) * 0.01);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  for (const [x, y] of pts) {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 7.5, y + Math.sin(a) * 7.5);
      ctx.lineTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15);
      ctx.stroke();
    }
  }
  return c;
}

export function buildVignette(W, H) {
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return c;
}
