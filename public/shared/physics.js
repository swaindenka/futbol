// Deterministic match simulation shared by server (authoritative) and client (prediction).
// Simple one-button football: players push the ball by running into it and press KICK to
// strike it away from their body. The state is plain data so it can be snapshotted,
// sent over the wire and re-simulated.

import {
  P, B, K, AT, BTN, PHASE, TIMING, TICK_RATE, FIELDS, GOAL_DEPTH, CROSSBAR_Z, POST_R,
  PU, PU_INFO, PU_TUNE, PU_RATES, puLevel, pickPowerUp,
} from './constants.js';
import { clamp, turnToward, angleDiff } from './util.js';

const CONTACT = P.R + B.R;
const REACH = CONTACT + K.REACH;
const OWN_RANGE = CONTACT + 6;
// Corners are rounded like pool-table cushions so the ball can never get pinned there.
const CORNER_R = 64;
// Players may step slightly past the lines so a ball stuck on the boards can be won back.
const EDGE = 12;

export function makeField(key) {
  const f = FIELDS[key] || FIELDS.large;
  return {
    key: FIELDS[key] ? key : 'large',
    w: f.w,
    h: f.h,
    hw: f.w / 2,
    hh: f.h / 2,
    gh: f.goal / 2,
    gd: GOAL_DEPTH,
    bar: CROSSBAR_Z,
    cr: Math.round(f.h * 0.135),
    rc: CORNER_R, // rounded corner cushions
  };
}

export function makeBall() {
  // z stays 0 (no lofted balls) but is kept for the renderer.
  // tk / tkt / tka: per team, the last player to touch the ball, when, and their assist candidate.
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, owner: -1, last: -1, prev: -1, lt: -1,
    tk: [-1, -1], tkt: [-1, -1], tka: [-1, -1],
    fire: 0, // fireball ticks left
    rub: 0, // rubber-ball ticks left
    rt: -1, // team the rubber ball is on: it bounces wildly off the other team only
    at: 0, // aftertouch ticks left: the kicker can still bend the ball
    ak: -1, // aftertouch kicker
    os: 0, // tick the current owner got the ball (not sent: only used for tackle events)
  };
}

export function makeInput(team = 0) {
  return { mx: 0, my: 0, a: team === 0 ? 0 : Math.PI, b: 0 };
}

export function makePlayer(id, team, slot) {
  return {
    id,
    team,
    slot,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: team === 0 ? 0 : Math.PI,
    ct: 0, // 1 while the kick is armed (button pressed, not used yet)
    pb: 0, // previous buttons
    kcd: 0, // kick cooldown
    eff: 0, // power-up effect (PU.*) and ticks left
    et: 0,
    sl: 0, // slowed by ice: ticks left
    st: 0, // dazed (no control) ticks left
    db: 0, // curse (PU.DIZZY / PU.SLIPPY) and ticks left
    dt: 0,
    cg: 0, // kick charge (PU.FIRE / PU.SHOCK) released by the next kick; stacks with `eff`
    fb: 0, // ticks left to use the charge
    in: makeInput(team),
  };
}

/**
 * @param {string} fieldKey
 * @param {{duration:number, goldenGoal:boolean, scoreLimit:number, replays:boolean}} settings
 */
export function makeState(fieldKey, settings) {
  const pu = puLevel(settings.powerups);
  return {
    tick: 0,
    phase: PHASE.COUNTDOWN,
    pt: TIMING.COUNTDOWN, // phase ticks (meaning depends on phase)
    time: Math.round((settings.duration || 180) * TICK_RATE),
    score: [0, 0],
    ko: 0, // kickoff team
    ot: 0, // overtime (golden goal)
    kt: 0, // kickoff touched
    field: makeField(fieldKey),
    rules: {
      gg: settings.goldenGoal !== false,
      limit: settings.scoreLimit | 0,
      pause: settings.replays ? TIMING.GOAL_PAUSE_REPLAY : TIMING.GOAL_PAUSE,
      pu, // power-up rate level (0 = off)
    },
    ball: makeBall(),
    players: [],
    pu: [], // power-ups on the pitch: { id, k, x, y, t, m } (m: surprise box content)
    puId: 1,
    puT: pu ? PU_RATES[pu].first : PU_TUNE.FIRST,
    sh: [0, 0], // shield ticks left on each team's goal
  };
}

export function findPlayer(s, id) {
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
  return null;
}

/** Body radius: bigger while the Giant power-up is active. */
export function radius(p) {
  return p.eff === PU.GIANT ? P.R * PU_TUNE.GIANT_SCALE : P.R;
}

/** Body mass for player-player bumps: a Giant shoves normal players around. */
function mass(p) {
  return p.eff === PU.GIANT ? PU_TUNE.GIANT_MASS : 1;
}

const ghost = (p) => p.eff === PU.GHOST;

export function teamPlayers(s, team) {
  return s.players.filter((p) => p.team === team).sort((a, b) => a.slot - b.slot);
}

// Formation spots as fractions of half-width / half-height, for the left (red) team.
const FORMATIONS = {
  1: [[-0.18, 0]],
  2: [[-0.18, 0], [-0.62, 0]],
  3: [[-0.18, 0], [-0.55, -0.42], [-0.55, 0.42]],
  4: [[-0.18, 0], [-0.5, -0.45], [-0.5, 0.45], [-0.82, 0]],
};

export function formationSpot(s, p, kickoff) {
  const list = teamPlayers(s, p.team);
  const n = clamp(list.length, 1, 4);
  const i = clamp(list.indexOf(p), 0, n - 1);
  const [fx, fy] = FORMATIONS[n][i];
  let x = fx * s.field.hw;
  const y = fy * s.field.hh;
  if (kickoff && i === 0) {
    x = p.team === s.ko ? -(REACH + 8) : -(s.field.cr + P.R + 10);
  }
  return { x: p.team === 0 ? x : -x, y };
}

function freeSlot(s, team) {
  const used = new Set(s.players.filter((p) => p.team === team).map((p) => p.slot));
  for (let i = 0; i < 8; i++) if (!used.has(i)) return i;
  return used.size;
}

export function addPlayer(s, id, team, slot) {
  const p = makePlayer(id, team, slot ?? freeSlot(s, team));
  s.players.push(p);
  s.players.sort((a, b) => a.id - b.id);
  const kickoff = s.phase === PHASE.COUNTDOWN || s.phase === PHASE.KICKOFF;
  const spot = formationSpot(s, p, kickoff);
  p.x = spot.x;
  p.y = spot.y;
  return p;
}

export function removePlayer(s, id) {
  const i = s.players.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const [p] = s.players.splice(i, 1);
  const b = s.ball;
  if (b.owner === id) b.owner = -1;
  if (b.last === id) b.last = -1;
  if (b.prev === id) b.prev = -1;
  for (let t = 0; t < 2; t++) {
    if (b.tk[t] === id) b.tk[t] = -1;
    if (b.tka[t] === id) b.tka[t] = -1;
  }
  return p;
}

export function resetKickoff(s) {
  for (const p of s.players) {
    const spot = formationSpot(s, p, true);
    p.x = spot.x;
    p.y = spot.y;
    p.vx = p.vy = 0;
    p.facing = p.team === 0 ? 0 : Math.PI;
    p.ct = 0;
    p.kcd = 0;
    p.eff = p.et = p.sl = p.st = p.db = p.dt = p.fb = p.cg = 0;
    p.pb = p.in.b | 0;
  }
  s.pu = [];
  s.puT = s.rules.pu ? PU_RATES[s.rules.pu].first : PU_TUNE.FIRST;
  s.sh = [0, 0];
  const b = s.ball;
  b.fire = b.rub = 0;
  b.rt = -1;
  b.at = 0;
  b.ak = -1;
  b.x = b.y = b.z = 0;
  b.vx = b.vy = 0;
  b.owner = -1;
  b.prev = -1;
  b.tk = [-1, -1];
  b.tkt = [-1, -1];
  b.tka = [-1, -1];
  s.kt = 0;
}

export function inReach(p, b) {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const reach = REACH + radius(p) - P.R;
  return dx * dx + dy * dy <= reach * reach;
}

// A touch only counts as winning the ball if the opponent had it at their feet this long.
const TACKLE_HOLD = 24;

function touch(s, p, ev) {
  const b = s.ball;
  // Winning the ball off an opponent who was dribbling it is a tackle ("top kapma").
  if (ev && b.owner >= 0 && b.owner !== p.id && s.phase === PHASE.PLAY) {
    const o = findPlayer(s, b.owner);
    if (o && o.team !== p.team && b.lt === o.team && s.tick - b.os >= TACKLE_HOLD) {
      ev.push({ e: 'tackle', p: p.id, v: o.id });
      b.os = s.tick;
    }
  }
  b.at = 0; // any new touch ends the previous kicker's aftertouch
  if (b.last !== p.id) {
    const lastP = b.last >= 0 ? findPlayer(s, b.last) : null;
    b.prev = lastP && lastP.team === p.team ? b.last : -1;
    b.last = p.id;
  }
  b.lt = p.team;
  b.tk[p.team] = p.id;
  b.tkt[p.team] = s.tick;
  b.tka[p.team] = b.prev;
  if (s.phase === PHASE.KICKOFF) s.kt = 1;
}

/** Velocity a kick gives the ball: straight away from the player's centre. */
function kickImpulse(s, p, b) {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  let pw = K.POWER;
  if (p.fb > 0 && p.cg === PU.FIRE) pw *= PU_TUNE.FIRE_MUL;
  if (p.eff === PU.GIANT) pw *= PU_TUNE.GIANT_KICK;
  if (b.rub > 0 && b.rt === p.team) pw *= PU_TUNE.RUBBER_KICK;
  return { x: (dx / d) * pw + p.vx * K.CARRY, y: (dy / d) * pw + p.vy * K.CARRY };
}

function updatePlayer(s, p, frozen) {
  const btn = p.in.b | 0;
  const pressed = btn & ~p.pb;
  p.pb = btn;
  if (p.kcd > 0) p.kcd--;
  if (p.et > 0 && --p.et === 0) p.eff = 0;
  if (p.fb > 0 && --p.fb === 0) p.cg = 0;
  if (p.sl > 0) p.sl--;
  if (p.dt > 0 && --p.dt === 0) p.db = 0;

  if (frozen) {
    p.vx *= 0.7;
    p.vy *= 0.7;
    p.ct = 0;
    return;
  }
  if (p.st > 0) {
    // Dazed: no control, the body keeps sliding from the hit.
    p.st--;
    p.vx *= PU_TUNE.STUN_DRAG;
    p.vy *= PU_TUNE.STUN_DRAG;
    p.ct = 0;
    return;
  }

  // Arm the kick on press; it fires once when the ball is within reach.
  if (btn & BTN.KICK) {
    if (pressed & BTN.KICK) p.ct = 1;
  } else p.ct = 0;

  const [mx, my] = moveInput(p);
  const len = Math.hypot(mx, my);
  const moving = len > 0.08;
  let max = P.SPEED * (btn & BTN.KICK ? P.KICK_SLOW : 1);
  let accel = P.ACCEL;
  let decel = P.DECEL;
  if (p.eff === PU.SPEED) {
    max *= PU_TUNE.SPEED_MUL;
    accel *= PU_TUNE.SPEED_ACCEL;
  }
  if (p.sl > 0) max *= PU_TUNE.SLOW_MUL;
  if (p.db === PU.SLIPPY) {
    accel = PU_TUNE.SLIP_ACCEL;
    decel = PU_TUNE.SLIP_DECEL;
  }
  if (moving) {
    p.vx += (mx * max - p.vx) * accel;
    p.vy += (my * max - p.vy) * accel;
    // Only clear input turns the body, so tiny corrections do not make players twitch.
    if (len > 0.3) p.facing = turnToward(p.facing, Math.atan2(my, mx), P.TURN);
  } else {
    p.vx *= decel;
    p.vy *= decel;
  }
}

function kicks(s, ev) {
  if (s.phase === PHASE.COUNTDOWN || s.phase === PHASE.ENDED) return;
  const b = s.ball;
  const kickers = [];
  for (const p of s.players) if (p.ct && p.kcd === 0 && inReach(p, b)) kickers.push(p);
  if (!kickers.length) return;
  // Simultaneous kicks are added together, so a 50-50 clash blocks instead of
  // letting the last kicker win and the ball tunnel through the other player.
  let vx = 0;
  let vy = 0;
  for (const p of kickers) {
    const imp = kickImpulse(s, p, b);
    vx += imp.x;
    vy += imp.y;
  }
  if (kickers.length > 1) {
    vx *= 0.6;
    vy *= 0.6;
  }
  b.vx = vx;
  b.vy = vy;
  b.owner = -1;
  for (const p of kickers) {
    p.ct = 0;
    p.kcd = K.KICK_CD;
    touch(s, p, ev);
    let fire = 0;
    if (p.fb > 0 && p.cg === PU.FIRE) {
      // The fireball is used up by this kick.
      b.fire = PU_TUNE.FIRE_TICKS;
      fire = 1;
    } else if (p.fb > 0 && p.cg === PU.SHOCK) {
      const n = shockWave(s, p);
      ev.push({ e: 'shock', p: p.id, x: Math.round(p.x), y: Math.round(p.y), n });
    }
    p.fb = p.cg = 0;
    const v = Math.round(Math.hypot(vx, vy) * 10) / 10;
    ev.push({ e: 'kick', p: p.id, v, a: Math.round(Math.atan2(vy, vx) * 100) / 100, fire });
  }
  // A clean (uncontested) kick can be bent by its kicker for a moment.
  if (kickers.length === 1) {
    b.at = AT.TICKS;
    b.ak = kickers[0].id;
  }
}

/** Movement input after curses (Dizzy reverses it). Zero while dazed. */
export function moveInput(p) {
  if (p.st > 0) return [0, 0];
  let mx = clamp(+p.in.mx || 0, -1, 1);
  let my = clamp(+p.in.my || 0, -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  if (p.db === PU.DIZZY) return [-mx, -my];
  return [mx, my];
}

// ---------------------------------------------------------------------------
// Power-ups

/** Daze a player (no control for a moment). Ghosts are immune. */
function stun(p, ticks) {
  if (ghost(p)) return false;
  p.st = Math.max(p.st, ticks);
  p.ct = 0;
  return true;
}

/** Shock wave: shove every opponent near `p` away and daze them. Returns how many were hit. */
function shockWave(s, p) {
  let hit = 0;
  const R = PU_TUNE.SHOCK_R;
  for (const q of s.players) {
    if (q.team === p.team || ghost(q)) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > R) continue;
    const nx = d > 0.01 ? dx / d : q.team === 0 ? -1 : 1;
    const ny = d > 0.01 ? dy / d : 0;
    const f = PU_TUNE.SHOCK_KNOCK * (1 - (0.5 * d) / R);
    q.vx += nx * f;
    q.vy += ny * f;
    stun(q, PU_TUNE.SHOCK_STUN);
    hit++;
  }
  return hit;
}

function applyPowerUp(s, p, k) {
  const info = PU_INFO[k];
  switch (info.kind) {
    case 'foe':
      for (const q of s.players) if (q.team !== p.team) q.sl = info.ticks;
      return;
    case 'charge':
      p.cg = k;
      p.fb = info.ticks;
      return;
    case 'ball':
      s.ball.rub = info.ticks;
      s.ball.rt = p.team;
      return;
    case 'team':
      s.sh[p.team] = info.ticks;
      return;
    case 'curse':
      p.db = k;
      p.dt = info.ticks;
      return;
    default:
      p.eff = k;
      p.et = info.ticks;
  }
}

/** Picking up runs everywhere (prediction too); spawning only on the authority. */
function powerUps(s, auth, ev) {
  const list = s.pu;
  for (let i = list.length - 1; i >= 0; i--) {
    const u = list[i];
    u.t++;
    if (u.t > PU_TUNE.LIFE) {
      list.splice(i, 1);
      continue;
    }
    if (u.t < 0) continue; // still landing: shown on the pitch but not ready yet
    for (const p of s.players) {
      const reach = radius(p) + PU_TUNE.PICK_R;
      const dx = p.x - u.x;
      const dy = p.y - u.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      // The surprise box content is rolled when it spawns, so prediction stays in sync.
      const box = u.k === PU.MYSTERY;
      const k = box ? u.m || PU.FIRE : u.k;
      applyPowerUp(s, p, k);
      list.splice(i, 1);
      ev.push({ e: 'pu', p: p.id, k, x: Math.round(u.x), y: Math.round(u.y), m: box ? 1 : 0 });
      break;
    }
  }
  const rate = PU_RATES[s.rules.pu | 0];
  if (!auth || !rate || s.phase !== PHASE.PLAY) return;
  if (--s.puT > 0) return;
  s.puT = rate.min + Math.floor(Math.random() * (rate.max - rate.min));
  if (list.length >= (s.players.length > 4 ? rate.capBig : rate.cap)) return;
  const f = s.field;
  for (let tries = 0; tries < 12; tries++) {
    const x = (Math.random() * 2 - 1) * (f.hw - 140);
    const y = (Math.random() * 2 - 1) * (f.hh - 60);
    let ok = Math.hypot(x - s.ball.x, y - s.ball.y) > 80;
    for (const p of s.players) if (Math.hypot(x - p.x, y - p.y) < 90) ok = false;
    for (const u of list) if (Math.hypot(x - u.x, y - u.y) < 120) ok = false;
    if (!ok) continue;
    const k = pickPowerUp(Math.random);
    const id = s.puId++;
    const u = { id, k, x: Math.round(x), y: Math.round(y), t: -PU_TUNE.WARN, m: 0 };
    if (k === PU.MYSTERY) u.m = pickPowerUp(Math.random, 'mw');
    list.push(u);
    ev.push({ e: 'pus', k, x: u.x, y: u.y });
    break;
  }
}

/**
 * Light close control: while the ball rests against a player's feet and nobody else is
 * contesting it, its velocity drifts toward the player's, so the ball follows turns
 * instead of rolling off. It is not a magnet: fast balls and contested balls are untouched.
 */
function closeControl(s, p, d) {
  const b = s.ball;
  if (p.eff === PU.MAGNET) {
    magnet(s, p, d);
    return;
  }
  if (d > radius(p) + B.R + 6 || p.kcd > 0 || p.st > 0 || s.phase === PHASE.COUNTDOWN) return;
  if (b.rub > 0 && b.rt >= 0 && p.team !== b.rt) return; // the rubber ball will not settle for them
  const rvx = b.vx - p.vx;
  const rvy = b.vy - p.vy;
  if (rvx * rvx + rvy * rvy > K.CONTROL_REL * K.CONTROL_REL) return;
  // A ghost's ball slips through opponents, so close opponents do not break its control.
  if (!ghost(p)) {
    for (const q of s.players) {
      if (q !== p && q.team !== p.team && Math.hypot(b.x - q.x, b.y - q.y) < CONTACT + 8) return;
    }
  }
  b.vx -= rvx * K.CONTROL;
  b.vy -= rvy * K.CONTROL;
}

/**
 * Magnet: a slow (relative) ball within reach is drawn to the player's feet and swung
 * around the body to the front, so it follows every turn, even when an opponent is close.
 * Shots are not caught.
 */
function magnet(s, p, d) {
  const b = s.ball;
  const front = radius(p) + B.R + 1;
  if (d > front + PU_TUNE.MAG_RANGE || p.kcd > 0 || p.st > 0 || s.phase === PHASE.COUNTDOWN) return;
  const rvx = b.vx - p.vx;
  const rvy = b.vy - p.vy;
  if (rvx * rvx + rvy * rvy > PU_TUNE.MAG_REL * PU_TUNE.MAG_REL) return;
  b.vx -= rvx * PU_TUNE.MAG_DAMP;
  b.vy -= rvy * PU_TUNE.MAG_DAMP;
  // Aim at a point on the contact circle a little closer to the front than the ball is now:
  // a ball behind the player orbits around the body instead of pressing into it.
  const rel = Math.atan2(b.y - p.y, b.x - p.x);
  const ang = rel + clamp(angleDiff(rel, p.facing), -PU_TUNE.MAG_ORBIT, PU_TUNE.MAG_ORBIT);
  const tx = p.x + Math.cos(ang) * front - b.x;
  const ty = p.y + Math.sin(ang) * front - b.y;
  const td = Math.hypot(tx, ty);
  if (td < 0.5) return;
  const pull = PU_TUNE.MAG_PULL * Math.min(1, td / 18);
  b.vx += (tx / td) * pull;
  b.vy += (ty / td) * pull;
}

/** Track who is closest to the ball ("owner") for bots, HUD and stats. */
function ownership(s, ev) {
  const b = s.ball;
  // Opponents walking through a ghost's ball do not take it just by being close.
  const carrier = ghostCarrier(s);
  let best = null;
  let bestD = carrier ? Infinity : OWN_RANGE;
  for (const p of s.players) {
    if (carrier && p.team !== carrier.team) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y) - (radius(p) - P.R);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best) closeControl(s, best, bestD + radius(best) - P.R);
  // A magnet also works from a little further away, unless a teammate already has the ball.
  for (const p of s.players) {
    if (p.eff !== PU.MAGNET || p === best || (best && best.team === p.team)) continue;
    magnet(s, p, Math.hypot(b.x - p.x, b.y - p.y));
  }
  if (!best) {
    b.owner = -1;
    return;
  }
  if (b.owner !== best.id) {
    // Being near the ball is not a touch: only real contact (collision / kick) credits a player.
    b.owner = best.id;
    b.os = s.tick;
    ev.push({ e: 'trap', p: best.id });
  }
}

/** Keeps a circle of radius `r` inside the rounded corner arcs. Returns impact speed or 0. */
function cornerArc(f, o, r, e) {
  const rc = f.rc;
  const cx = f.hw - rc;
  const cy = f.hh - rc;
  const ax = Math.abs(o.x);
  const ay = Math.abs(o.y);
  if (ax <= cx || ay <= cy) return 0;
  const sx = Math.sign(o.x);
  const sy = Math.sign(o.y);
  const dx = ax - cx;
  const dy = ay - cy;
  const d = Math.hypot(dx, dy);
  const lim = rc - r;
  if (d <= lim) return 0;
  const nx = (dx / d) * sx;
  const ny = (dy / d) * sy;
  o.x = sx * cx + nx * lim;
  o.y = sy * cy + ny * lim;
  const vn = o.vx * nx + o.vy * ny;
  if (vn > 0) {
    o.vx -= (1 + e) * vn * nx;
    o.vy -= (1 + e) * vn * ny;
  }
  return vn;
}

/** An active shield closes the goal mouth: it blocks the first ball that comes in, then breaks. */
function shields(s, ev) {
  const b = s.ball;
  const f = s.field;
  for (let t = 0; t < 2; t++) {
    if (s.sh[t] <= 0) continue;
    const side = t === 0 ? -1 : 1;
    if (Math.abs(b.y) >= f.gh || b.x * side <= f.hw - B.R || b.vx * side <= 0) continue;
    const v = Math.abs(b.vx);
    b.x = side * (f.hw - B.R);
    b.vx = -b.vx * PU_TUNE.SHIELD_E;
    b.at = 0;
    s.sh[t] = 0;
    ev.push({ e: 'shield', t, y: Math.round(b.y), v: Math.round(v * 10) / 10 });
  }
}

function ballWalls(s, ev) {
  const b = s.ball;
  const f = s.field;
  const r = B.R;
  const wallE = b.rub > 0 ? PU_TUNE.RUBBER_WALL_E : B.WALL_E;
  shields(s, ev);
  const hit = cornerArc(f, b, r, wallE);
  if (hit > 1.5) ev.push({ e: 'wall', v: Math.round(hit * 10) / 10 });
  if (hit > 0) b.at = 0;
  const inGoalBox = Math.abs(b.x) > f.hw && Math.abs(b.y) < f.gh;

  if (inGoalBox) {
    // Inside a goal: side nets and back net.
    const side = Math.sign(b.x);
    const lim = f.gh - r;
    if (b.y < -lim) {
      b.y = -lim;
      if (b.vy < 0) b.vy = -b.vy * 0.3;
    } else if (b.y > lim) {
      b.y = lim;
      if (b.vy > 0) b.vy = -b.vy * 0.3;
    }
    const back = f.hw + f.gd - r;
    if (Math.abs(b.x) > back) {
      b.x = side * back;
      if (b.vx * side > 0) {
        const sp = Math.abs(b.vx);
        b.at = 0;
        b.vx = -b.vx * B.NET_E;
        b.vy *= 0.6;
        if (sp > 1) ev.push({ e: 'net', s: side, y: Math.round(b.y), z: 12, v: Math.round(sp * 10) / 10 });
      }
    }
    return;
  }
  if (b.y - r < -f.hh) {
    b.y = -f.hh + r;
    if (b.vy < 0) {
      if (b.vy < -1.5) ev.push({ e: 'wall', v: Math.round(-b.vy * 10) / 10 });
      b.vy = -b.vy * wallE;
      b.at = 0;
    }
  } else if (b.y + r > f.hh) {
    b.y = f.hh - r;
    if (b.vy > 0) {
      if (b.vy > 1.5) ev.push({ e: 'wall', v: Math.round(b.vy * 10) / 10 });
      b.vy = -b.vy * wallE;
      b.at = 0;
    }
  }
  if (Math.abs(b.x) + r > f.hw && Math.abs(b.y) >= f.gh) {
    const side = Math.sign(b.x);
    b.x = side * (f.hw - r);
    if (b.vx * side > 0) {
      const sp = Math.abs(b.vx);
      if (sp > 1.5) ev.push({ e: 'wall', v: Math.round(sp * 10) / 10 });
      b.vx = -b.vx * wallE;
      b.at = 0;
    }
  }
}

function ballPosts(s, ev) {
  const b = s.ball;
  const f = s.field;
  const min = B.R + POST_R;
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      const px = sx * f.hw;
      const py = sy * f.gh;
      const dx = b.x - px;
      const dy = b.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d;
      const ny = dy / d;
      b.x = px + nx * min;
      b.y = py + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.at = 0;
        b.vx -= (1 + B.POST_E) * vn * nx;
        b.vy -= (1 + B.POST_E) * vn * ny;
        if (vn < -1) ev.push({ e: 'post', x: px, y: py, v: Math.round(-vn * 10) / 10 });
      }
    }
  }
}

/**
 * Aftertouch ("falso"): for a moment after a clean kick, the kicker's sideways stick input
 * rotates the ball's velocity, so shots can be curved around a defender. Speed is kept.
 */
function aftertouch(s) {
  const b = s.ball;
  if (b.at <= 0) return;
  b.at--;
  const k = findPlayer(s, b.ak);
  const sp = Math.hypot(b.vx, b.vy);
  if (!k || sp < AT.MIN_SPEED) return;
  const [mx, my] = moveInput(k);
  const side = (b.vx * my - b.vy * mx) / sp; // sideways share of the input, -1..1
  const mag = Math.abs(side);
  if (mag <= AT.DEAD) return;
  const th = Math.sign(side) * ((mag - AT.DEAD) / (1 - AT.DEAD)) * AT.TURN;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const vx = b.vx * c - b.vy * sn;
  b.vy = b.vx * sn + b.vy * c;
  b.vx = vx;
}

function updateBall(s, ev) {
  const b = s.ball;
  aftertouch(s);
  const fr = b.fire > 0 ? PU_TUNE.FIRE_FRICTION : b.rub > 0 ? PU_TUNE.RUBBER_FRICTION : B.FRICTION;
  if (b.fire > 0) b.fire--;
  if (b.rub > 0 && --b.rub === 0) b.rt = -1;
  b.vx *= fr;
  b.vy *= fr;
  b.x += b.vx;
  b.y += b.vy;
  if (b.vx * b.vx + b.vy * b.vy < 0.0004) b.vx = b.vy = 0;
  ballPosts(s, ev);
  ballWalls(s, ev);
}

function collidePlayers(s) {
  const ps = s.players;
  const n = ps.length;
  for (let i = 0; i < n; i++) {
    const a = ps[i];
    for (let j = i + 1; j < n; j++) {
      const c = ps[j];
      if (ghost(a) || ghost(c)) continue; // ghosts pass through everyone
      const R2 = radius(a) + radius(c);
      let dx = c.x - a.x;
      let dy = c.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 >= R2 * R2) continue;
      if (d2 < 1e-6) {
        dx = 0.1;
        dy = 0;
        d2 = 0.01;
      }
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      // Heavier bodies (Giant) move less and shove harder.
      const ia = 1 / mass(a);
      const ic = 1 / mass(c);
      const share = (R2 - d) / (ia + ic);
      a.x -= nx * share * ia;
      a.y -= ny * share * ia;
      c.x += nx * share * ic;
      c.y += ny * share * ic;
      const rvn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      if (rvn < 0) {
        const jmp = (-(1 + P.BUMP_E) * rvn) / (ia + ic);
        a.vx -= jmp * nx * ia;
        a.vy -= jmp * ny * ia;
        c.vx += jmp * nx * ic;
        c.vy += jmp * ny * ic;
      }
    }
  }
}

/**
 * A save: a defender stops an opponent's shot that was on its way into their goal
 * (straight-line path inside the posts, fast enough to get there).
 */
function isSave(s, p) {
  const b = s.ball;
  const f = s.field;
  if (s.phase !== PHASE.PLAY || b.lt < 0 || b.lt === p.team) return false;
  const side = p.team === 0 ? -1 : 1;
  const vx = b.vx * side;
  if (vx <= 0 || Math.hypot(b.vx, b.vy) < 3.6) return false;
  const dx = f.hw - b.x * side;
  if (dx <= 0 || dx > f.w * 0.6) return false;
  if (vx < dx * (1 - B.FRICTION) + 1.5) return false; // would stop before the line
  const y = b.y + (b.vy * dx) / vx;
  return Math.abs(y) < f.gh + 4;
}

function collideBallPlayers(s, ev) {
  // Two passes so a ball squeezed between two players is resolved, never left inside one.
  for (let pass = 0; pass < 2; pass++) collideBallPlayersOnce(s, pass === 0, ev);
}

/** The ghost who is carrying the ball at their feet (it slips through opponents), or null. */
export function ghostCarrier(s) {
  const b = s.ball;
  if (b.owner < 0) return null;
  const g = findPlayer(s, b.owner);
  if (!g || !ghost(g)) return null;
  const reach = radius(g) + B.R + PU_TUNE.GHOST_CARRY;
  return Math.hypot(b.x - g.x, b.y - g.y) <= reach ? g : null;
}

/**
 * A fireball bursts through the first opponent in its way: they are blasted aside and dazed,
 * the ball keeps most of its speed but stops burning. Teammates are just brushed aside.
 */
function pierce(s, p, min, ev) {
  const b = s.ball;
  const sp = Math.hypot(b.vx, b.vy) || 1;
  const ux = b.vx / sp;
  const uy = b.vy / sp;
  const side = Math.sign((p.x - b.x) * -uy + (p.y - b.y) * ux) || 1;
  const px = -uy * side;
  const py = ux * side;
  const off = (p.x - b.x) * px + (p.y - b.y) * py;
  if (off < min + 1) {
    p.x += px * (min + 1 - off);
    p.y += py * (min + 1 - off);
  }
  if (p.team === b.lt) return;
  p.vx += px * PU_TUNE.FIRE_KNOCK + ux * PU_TUNE.FIRE_KNOCK * 0.4;
  p.vy += py * PU_TUNE.FIRE_KNOCK + uy * PU_TUNE.FIRE_KNOCK * 0.4;
  stun(p, PU_TUNE.FIRE_STUN);
  b.vx *= PU_TUNE.FIRE_PIERCE;
  b.vy *= PU_TUNE.FIRE_PIERCE;
  b.fire = 0;
  ev.push({ e: 'blast', p: p.id });
}

function collideBallPlayersOnce(s, bounce, ev) {
  const b = s.ball;
  const carrier = ghostCarrier(s);
  for (const p of s.players) {
    if (carrier && p.team !== carrier.team) continue; // the ball slips through them
    const min = radius(p) + B.R;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d;
    const ny = dy / d;
    if (bounce && b.fire > 0 && !ghost(p) && (b.vx - p.vx) * nx + (b.vy - p.vy) * ny < -5) {
      pierce(s, p, min, ev);
      continue;
    }
    if (bounce) {
      b.x = p.x + nx * min;
      b.y = p.y + ny * min;
    } else {
      // Ball is wedged (e.g. between two players): move the player instead.
      p.x = b.x - nx * min;
      p.y = b.y - ny * min;
    }
    const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
    if (vn < 0) {
      // A rubber ball without a team (debug / old snapshots) springs off everyone.
      const springy = b.rub > 0 && b.rt < 0;
      const e = bounce ? (springy ? PU_TUNE.RUBBER_PLAYER_E : B.PLAYER_E) : 0;
      if (bounce && vn < -0.6 && isSave(s, p)) ev.push({ e: 'save', p: p.id, v: Math.round(Math.hypot(b.vx, b.vy) * 10) / 10 });
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      p.vx += vn * nx * 0.08;
      p.vy += vn * ny * 0.08;
      if (vn < -0.6) touch(s, p, ev);
      if (bounce && vn < -1.6) ev.push({ e: 'tap', p: p.id, v: Math.round(-vn * 10) / 10 });
    }
  }
}

function playerBounds(s) {
  const f = s.field;
  for (const p of s.players) {
    const pr = radius(p);
    const minX = -f.hw + pr - EDGE;
    const maxX = f.hw - pr + EDGE;
    const minY = -f.hh + pr - EDGE;
    const maxY = f.hh - pr + EDGE;
    const postMin = pr + POST_R;
    cornerArc(f, p, pr - EDGE, 0);
    if (p.x < minX) {
      p.x = minX;
      if (p.vx < 0) p.vx = 0;
    } else if (p.x > maxX) {
      p.x = maxX;
      if (p.vx > 0) p.vx = 0;
    }
    if (p.y < minY) {
      p.y = minY;
      if (p.vy < 0) p.vy = 0;
    } else if (p.y > maxY) {
      p.y = maxY;
      if (p.vy > 0) p.vy = 0;
    }
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        const dx = p.x - sx * f.hw;
        const dy = p.y - sy * f.gh;
        const d2 = dx * dx + dy * dy;
        if (d2 >= postMin * postMin) continue;
        const d = Math.sqrt(d2) || 0.001;
        p.x = sx * f.hw + (dx / d) * postMin;
        p.y = sy * f.gh + (dy / d) * postMin;
      }
    }
  }
}

function kickoffRules(s) {
  const r = s.field.cr + P.R;
  for (const p of s.players) {
    if (p.team === 0 && p.x > 0) {
      p.x = 0;
      if (p.vx > 0) p.vx = 0;
    } else if (p.team === 1 && p.x < 0) {
      p.x = 0;
      if (p.vx < 0) p.vx = 0;
    }
    if (p.team !== s.ko) {
      const d = Math.hypot(p.x, p.y);
      if (d < r) {
        if (d < 0.01) {
          p.x = p.team === 0 ? -r : r;
          p.y = 0;
        } else {
          p.x = (p.x / d) * r;
          p.y = (p.y / d) * r;
        }
      }
    }
  }
}

function checkGoal(s, ev) {
  const b = s.ball;
  const f = s.field;
  if (Math.abs(b.y) >= f.gh) return;
  let team = -1;
  if (b.x > f.hw + B.R) team = 0;
  else if (b.x < -f.hw - B.R) team = 1;
  if (team < 0) return;
  s.score[team]++;
  s.phase = PHASE.GOAL;
  s.pt = s.rules.pause;
  s.ko = 1 - team;
  let scorerId = b.last;
  let assist = b.prev;
  const scorer = findPlayer(s, scorerId);
  let own = scorer ? (scorer.team !== team ? 1 : 0) : 0;
  if (own && b.tk[team] >= 0 && s.tick - b.tkt[team] < 150 && findPlayer(s, b.tk[team])) {
    // A shot (or dribble) that deflects in off a defender belongs to the attacker.
    scorerId = b.tk[team];
    assist = b.tka[team];
    own = 0;
  }
  ev.push({
    e: 'goal',
    t: team,
    p: scorerId,
    a: own ? -1 : assist,
    own,
    s: [s.score[0], s.score[1]],
  });
}

function endMatch(s, ev) {
  s.phase = PHASE.ENDED;
  s.pt = 0;
  ev.push({ e: 'end', s: [s.score[0], s.score[1]] });
}

function tickClock(s, ev) {
  if (s.ot || s.time <= 0) return;
  s.time--;
  if (s.time > 0) return;
  if (s.score[0] === s.score[1] && s.rules.gg) {
    s.ot = 1;
    ev.push({ e: 'overtime' });
  } else endMatch(s, ev);
}

function shouldEnd(s) {
  const top = Math.max(s.score[0], s.score[1]);
  if (s.rules.limit > 0 && top >= s.rules.limit) return true;
  return !!s.ot;
}

function phaseLogic(s, auth, ev) {
  if (s.phase === PHASE.KICKOFF && s.kt) {
    s.phase = PHASE.PLAY;
    ev.push({ e: 'play' });
  }
  if (!auth) return;
  switch (s.phase) {
    case PHASE.COUNTDOWN:
      if (--s.pt <= 0) {
        s.phase = PHASE.KICKOFF;
        s.pt = 0;
        ev.push({ e: 'whistle' });
      }
      break;
    case PHASE.KICKOFF:
      s.pt++;
      if (s.pt > TIMING.KICKOFF_MAX) {
        s.phase = PHASE.PLAY;
        ev.push({ e: 'play' });
      }
      tickClock(s, ev);
      break;
    case PHASE.PLAY:
      checkGoal(s, ev);
      if (s.phase === PHASE.PLAY) tickClock(s, ev);
      break;
    case PHASE.GOAL:
      if (--s.pt <= 0) {
        if (shouldEnd(s)) endMatch(s, ev);
        else {
          resetKickoff(s);
          s.phase = PHASE.COUNTDOWN;
          s.pt = TIMING.COUNTDOWN;
          ev.push({ e: 'kickoff', t: s.ko });
        }
      }
      break;
    default:
      break;
  }
}

/**
 * Advance the simulation by one tick using each player's `in` input.
 * @param {object} s state
 * @param {boolean} auth authoritative (server / offline) - handles goals, clock and phases
 * @returns {Array<object>} events
 */
export function step(s, auth) {
  const ev = [];
  s.tick++;
  const frozen = s.phase === PHASE.COUNTDOWN || s.phase === PHASE.ENDED;
  for (const p of s.players) {
    updatePlayer(s, p, frozen);
    p.x += p.vx;
    p.y += p.vy;
  }
  kicks(s, ev);
  updateBall(s, ev);
  collidePlayers(s);
  collideBallPlayers(s, ev);
  ballWalls(s, ev);
  playerBounds(s);
  ownership(s, ev);
  if (s.pu.length || s.rules.pu) powerUps(s, auth, ev);
  if (s.phase === PHASE.PLAY || s.phase === PHASE.KICKOFF) {
    if (s.sh[0] > 0) s.sh[0]--;
    if (s.sh[1] > 0) s.sh[1]--;
  }
  if (s.phase === PHASE.KICKOFF) kickoffRules(s);
  phaseLogic(s, auth, ev);
  return ev;
}

export const PHYS = { CONTACT, REACH, EDGE };
