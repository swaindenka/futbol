// Deterministic match simulation shared by server (authoritative) and client (prediction).
// The state is plain data so it can be snapshotted, sent over the wire and re-simulated.

import {
  P, B, K, BTN, PHASE, TIMING, TICK_RATE, FIELDS, GOAL_DEPTH, CROSSBAR_Z, POST_R,
} from './constants.js';
import { clamp, turnToward, wrapAngle } from './util.js';

const CONTACT = P.R + B.R;
const REACH = CONTACT + K.RANGE;

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
  };
}

export function makeBall() {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: -1, last: -1, prev: -1, lt: -1 };
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
    stamina: P.STAMINA,
    exh: 0, // exhausted flag
    charge: 0, // ticks charged
    ct: 0, // charge type: 0 none, 1 shot, 2 lob
    pb: 0, // previous buttons
    slide: 0,
    sdx: 0,
    sdy: 0,
    rec: 0, // recovering after slide
    stun: 0,
    tcd: 0, // tackle cooldown
    kcd: 0, // kick cooldown (no control / no self collision)
    in: makeInput(team),
  };
}

/**
 * @param {string} fieldKey
 * @param {{duration:number, goldenGoal:boolean, scoreLimit:number, replays:boolean}} settings
 */
export function makeState(fieldKey, settings) {
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
    },
    ball: makeBall(),
    players: [],
  };
}

export function findPlayer(s, id) {
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
  return null;
}

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
    x = p.team === s.ko ? -(CONTACT + K.CONTROL_RANGE + 6) : -(s.field.cr + P.R + 10);
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
  return p;
}

export function resetKickoff(s) {
  for (const p of s.players) {
    const spot = formationSpot(s, p, true);
    p.x = spot.x;
    p.y = spot.y;
    p.vx = p.vy = 0;
    p.facing = p.team === 0 ? 0 : Math.PI;
    p.charge = p.ct = 0;
    p.slide = p.rec = p.stun = 0;
    p.kcd = 0;
    p.pb = p.in.b | 0;
  }
  const b = s.ball;
  b.x = b.y = b.z = 0;
  b.vx = b.vy = b.vz = 0;
  b.spin = 0;
  b.owner = -1;
  b.prev = -1;
  s.kt = 0;
}

export function inReach(p, b) {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  return dx * dx + dy * dy <= REACH * REACH && b.z <= K.MAX_Z;
}

function lateralSpin(p, dx, dy) {
  const lat = dx * p.vy - dy * p.vx;
  return clamp((-lat / (P.SPEED * P.SPRINT)) * B.MAX_SPIN, -B.MAX_SPIN, B.MAX_SPIN);
}

/** Velocity a kick would give the ball. ct: 1 shot, 2 lob. c in [0,1]. */
export function kickVector(p, ct, c, aim) {
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  if (ct === 2) {
    const h = K.LOB_H_MIN + (K.LOB_H_MAX - K.LOB_H_MIN) * c;
    const vz = K.LOB_Z_MIN + (K.LOB_Z_MAX - K.LOB_Z_MIN) * c;
    return { vx: dx * h + p.vx * 0.2, vy: dy * h + p.vy * 0.2, vz, spin: lateralSpin(p, dx, dy) * 0.5, power: h };
  }
  const pw = K.SHOT_MIN + (K.SHOT_MAX - K.SHOT_MIN) * c;
  return {
    vx: dx * pw + p.vx * 0.25,
    vy: dy * pw + p.vy * 0.25,
    vz: c > 0.85 ? (c - 0.85) * 6 : 0,
    spin: lateralSpin(p, dx, dy),
    power: pw,
  };
}

function touch(s, p) {
  const b = s.ball;
  if (b.last !== p.id) {
    const lastP = b.last >= 0 ? findPlayer(s, b.last) : null;
    b.prev = lastP && lastP.team === p.team ? b.last : -1;
    b.last = p.id;
  }
  b.lt = p.team;
  if (s.phase === PHASE.KICKOFF) s.kt = 1;
}

function kick(s, p, ct, c, aim, ev) {
  const b = s.ball;
  if (!inReach(p, b)) return false;
  const v = kickVector(p, ct, c, aim);
  b.vx = v.vx;
  b.vy = v.vy;
  b.vz = v.vz;
  if (b.vz > 0 && b.z <= 0) b.z = 0.01;
  b.spin = v.spin;
  b.owner = -1;
  p.kcd = K.KICK_CD;
  touch(s, p);
  const kind = ct === 2 ? 'lob' : c < 0.15 ? 'tap' : 'shot';
  ev.push({ e: 'kick', p: p.id, k: kind, v: Math.round(v.power * 10) / 10, a: Math.round(aim * 100) / 100 });
  return true;
}

/** Ticks for a ball rolling with initial speed v0 to cover distance d. */
function travelTicks(v0, d) {
  const f = B.FRICTION;
  const arg = 1 - (d * (1 - f)) / v0;
  if (arg <= 0.01) return 400;
  return Math.log(arg) / Math.log(f);
}

export function choosePassTarget(s, p, aim) {
  const b = s.ball;
  const ax = Math.cos(aim);
  const ay = Math.sin(aim);
  let best = null;
  let bestScore = Infinity;
  for (const q of s.players) {
    if (q === p || q.team !== p.team) continue;
    const dx = q.x - b.x;
    const dy = q.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < 40) continue;
    const ang = Math.acos(clamp((dx * ax + dy * ay) / d, -1, 1));
    if (ang > K.PASS_CONE) continue;
    const score = ang * 1.6 + d / 700;
    if (score < bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

function pass(s, p, aim, ev) {
  const b = s.ball;
  if (!inReach(p, b)) return false;
  const f = s.field;
  const mate = choosePassTarget(s, p, aim);
  let dirx = Math.cos(aim);
  let diry = Math.sin(aim);
  let v = 8;
  if (mate) {
    let tx = mate.x;
    let ty = mate.y;
    let d = Math.hypot(tx - b.x, ty - b.y);
    for (let i = 0; i < 2; i++) {
      v = clamp(K.PASS_ARRIVE + d * (1 - B.FRICTION), K.PASS_MIN, K.PASS_MAX);
      const t = Math.min(travelTicks(v, d), 90);
      tx = clamp(mate.x + mate.vx * t * 0.85, -f.hw + 20, f.hw - 20);
      ty = clamp(mate.y + mate.vy * t * 0.85, -f.hh + 20, f.hh - 20);
      d = Math.max(1, Math.hypot(tx - b.x, ty - b.y));
    }
    v = clamp(K.PASS_ARRIVE + d * (1 - B.FRICTION), K.PASS_MIN, K.PASS_MAX);
    dirx = (tx - b.x) / d;
    diry = (ty - b.y) / d;
  }
  b.vx = dirx * v;
  b.vy = diry * v;
  b.vz = 0;
  b.spin = 0;
  b.owner = -1;
  p.kcd = K.KICK_CD;
  touch(s, p);
  ev.push({ e: 'kick', p: p.id, k: 'pass', v: Math.round(v * 10) / 10, t: mate ? mate.id : -1 });
  return true;
}

function regen(p) {
  if (p.stamina < P.STAMINA) p.stamina = Math.min(P.STAMINA, p.stamina + P.REGEN);
  if (p.exh && p.stamina >= P.RECOVER_AT) p.exh = 0;
}

function updatePlayer(s, p, frozen, ev) {
  const inp = p.in;
  const btn = inp.b | 0;
  const pressed = btn & ~p.pb;
  p.pb = btn;
  if (p.tcd > 0) p.tcd--;
  if (p.kcd > 0) p.kcd--;

  if (frozen) {
    p.vx *= 0.7;
    p.vy *= 0.7;
    p.ct = p.charge = 0;
    regen(p);
    return;
  }
  if (p.stun > 0) {
    p.stun--;
    p.vx *= 0.88;
    p.vy *= 0.88;
    p.ct = p.charge = 0;
    regen(p);
    return;
  }
  if (p.slide > 0) {
    p.slide--;
    p.vx *= P.SLIDE_DAMP;
    p.vy *= P.SLIDE_DAMP;
    if (p.slide === 0) p.rec = P.SLIDE_RECOVER;
    return;
  }
  if (p.rec > 0) {
    p.rec--;
    p.vx *= 0.8;
    p.vy *= 0.8;
    regen(p);
    return;
  }

  let mx = clamp(+inp.mx || 0, -1, 1);
  let my = clamp(+inp.my || 0, -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  const moving = len > 0.08;
  const sprint = (btn & BTN.SPRINT) !== 0 && !p.exh && moving;
  if (sprint) {
    p.stamina -= P.SPRINT_COST;
    if (p.stamina <= 0) {
      p.stamina = 0;
      p.exh = 1;
    }
  } else regen(p);

  let max = P.SPEED * (sprint ? P.SPRINT : 1);
  if (p.ct) max *= P.CHARGE_SLOW;
  if (s.ball.owner === p.id) max *= P.DRIBBLE_SLOW;
  if (moving) {
    p.vx += (mx * max - p.vx) * P.ACCEL;
    p.vy += (my * max - p.vy) * P.ACCEL;
  } else {
    p.vx *= P.DECEL;
    p.vy *= P.DECEL;
  }

  const aim = Number.isFinite(inp.a) ? wrapAngle(inp.a) : p.facing;
  const want = p.ct ? aim : moving ? Math.atan2(my, mx) : p.facing;
  p.facing = turnToward(p.facing, want, p.ct ? P.TURN_CHARGE : P.TURN);

  if (pressed & BTN.TACKLE && p.tcd === 0 && !p.ct) {
    const a = moving ? Math.atan2(my, mx) : p.facing;
    p.sdx = Math.cos(a);
    p.sdy = Math.sin(a);
    p.slide = P.SLIDE_TICKS;
    p.tcd = P.TACKLE_CD;
    p.vx = p.sdx * P.SLIDE_SPEED;
    p.vy = p.sdy * P.SLIDE_SPEED;
    p.facing = a;
    ev.push({ e: 'slide', p: p.id });
    return;
  }

  if (!p.ct) {
    if (pressed & BTN.SHOOT) {
      p.ct = 1;
      p.charge = 0;
    } else if (pressed & BTN.LOB) {
      p.ct = 2;
      p.charge = 0;
    }
  }
  if (p.ct) {
    const held = p.ct === 1 ? btn & BTN.SHOOT : btn & BTN.LOB;
    if (held) {
      if (p.charge < K.CHARGE_TICKS) p.charge++;
    } else {
      kick(s, p, p.ct, p.charge / K.CHARGE_TICKS, aim, ev);
      p.ct = 0;
      p.charge = 0;
    }
  } else if (pressed & BTN.PASS) {
    pass(s, p, aim, ev);
  }
}

function ballControl(s, ev) {
  const b = s.ball;
  if (b.z > K.CONTROL_MAX_Z || s.phase === PHASE.COUNTDOWN) {
    b.owner = -1;
    return;
  }
  let best = null;
  let bestScore = Infinity;
  const rel2 = K.CONTROL_MAX_REL * K.CONTROL_MAX_REL;
  for (const p of s.players) {
    if (p.stun || p.slide || p.rec || p.kcd) continue;
    const d = Math.hypot(b.x - p.x, b.y - p.y) - CONTACT;
    if (d > K.CONTROL_RANGE) continue;
    const rvx = b.vx - p.vx;
    const rvy = b.vy - p.vy;
    if (b.owner !== p.id && rvx * rvx + rvy * rvy > rel2) continue;
    const score = d - (b.owner === p.id ? 5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) {
    b.owner = -1;
    return;
  }
  const p = best;
  const reach = CONTACT + 1.5;
  const tx = p.x + Math.cos(p.facing) * reach;
  const ty = p.y + Math.sin(p.facing) * reach;
  const dvx = p.vx + (tx - b.x) * K.CONTROL_PULL;
  const dvy = p.vy + (ty - b.y) * K.CONTROL_PULL;
  b.vx += (dvx - b.vx) * K.CONTROL_BLEND;
  b.vy += (dvy - b.vy) * K.CONTROL_BLEND;
  b.spin *= 0.5;
  if (b.owner !== p.id) {
    b.owner = p.id;
    touch(s, p);
    ev.push({ e: 'trap', p: p.id });
  }
}

function ballWalls(s, ev) {
  const b = s.ball;
  const f = s.field;
  const r = B.R;
  const inGoalBox = Math.abs(b.x) > f.hw && Math.abs(b.y) < f.gh;

  if (inGoalBox) {
    // Inside a goal box: side nets, back net and roof.
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
        b.vx = -b.vx * B.NET_E;
        b.vy *= 0.6;
        if (sp > 1) ev.push({ e: 'net', s: side, y: Math.round(b.y), z: Math.round(b.z), v: Math.round(sp * 10) / 10 });
      }
    }
    if (b.z > f.bar - r) {
      b.z = f.bar - r;
      if (b.vz > 0) b.vz = -b.vz * 0.3;
    }
  } else {
    if (b.y - r < -f.hh) {
      b.y = -f.hh + r;
      if (b.vy < 0) {
        if (b.vy < -1.5) ev.push({ e: 'wall', v: Math.round(-b.vy * 10) / 10 });
        b.vy = -b.vy * B.WALL_E;
      }
    } else if (b.y + r > f.hh) {
      b.y = f.hh - r;
      if (b.vy > 0) {
        if (b.vy > 1.5) ev.push({ e: 'wall', v: Math.round(b.vy * 10) / 10 });
        b.vy = -b.vy * B.WALL_E;
      }
    }
    if (Math.abs(b.x) + r > f.hw) {
      const side = Math.sign(b.x);
      const mouth = Math.abs(b.y) < f.gh && b.z < f.bar - r * 0.5;
      if (!mouth) {
        b.x = side * (f.hw - r);
        if (b.vx * side > 0) {
          const sp = Math.abs(b.vx);
          const bar = Math.abs(b.y) < f.gh && b.z < f.bar + r;
          if (bar) {
            ev.push({ e: 'post', bar: 1, v: Math.round(sp * 10) / 10 });
            b.vz = -Math.abs(b.vz) * 0.4;
          } else if (sp > 1.5) ev.push({ e: 'wall', v: Math.round(sp * 10) / 10 });
          b.vx = -b.vx * B.WALL_E;
        }
      }
    }
  }
}

function ballPosts(s, ev) {
  const b = s.ball;
  const f = s.field;
  if (b.z >= f.bar) return;
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
        b.vx -= (1 + B.POST_E) * vn * nx;
        b.vy -= (1 + B.POST_E) * vn * ny;
        if (vn < -1) ev.push({ e: 'post', x: px, y: py, v: Math.round(-vn * 10) / 10 });
      }
    }
  }
}

function updateBall(s, ev) {
  const b = s.ball;
  if (b.spin) {
    const sp = b.spin;
    const vx = b.vx;
    b.vx = vx - b.vy * sp;
    b.vy = b.vy + vx * sp;
    b.spin *= b.z > 0 ? B.SPIN_AIR : B.SPIN_GROUND;
    if (Math.abs(b.spin) < 1e-5) b.spin = 0;
  }
  if (b.z > 0 || b.vz > 0) {
    b.vz -= B.GRAVITY;
    b.z += b.vz;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -1.4) {
        const imp = -b.vz;
        b.vz = imp * B.BOUNCE;
        b.vx *= 0.86;
        b.vy *= 0.86;
        if (imp > 2.5) ev.push({ e: 'bounce', v: Math.round(imp * 10) / 10 });
      } else b.vz = 0;
    }
    b.vx *= B.AIR_DRAG;
    b.vy *= B.AIR_DRAG;
  } else {
    b.vx *= B.FRICTION;
    b.vy *= B.FRICTION;
  }
  b.x += b.vx;
  b.y += b.vy;
  if (b.vx * b.vx + b.vy * b.vy < 0.0004) b.vx = b.vy = 0;
  ballPosts(s, ev);
  ballWalls(s, ev);
}

function tackleCheck(s, att, vic, ev) {
  if (!att.slide || vic.team === att.team || vic.stun || vic.slide) return;
  const b = s.ball;
  const ballDist = Math.hypot(b.x - vic.x, b.y - vic.y);
  const clean = b.owner === vic.id || ballDist < P.FOUL_BALL_DIST;
  if (clean) {
    vic.stun = P.STUN_TICKS;
    ev.push({ e: 'tackle', p: att.id, v: vic.id });
  } else {
    vic.stun = P.FOUL_STUN_VICTIM;
    att.slide = 0;
    att.rec = 0;
    att.stun = P.FOUL_STUN_TACKLER;
    ev.push({ e: 'foul', p: att.id, v: vic.id });
  }
  vic.ct = vic.charge = 0;
  vic.vx = att.sdx * 3;
  vic.vy = att.sdy * 3;
  if (b.owner === vic.id) b.owner = -1;
}

function collidePlayers(s, ev) {
  const ps = s.players;
  const n = ps.length;
  const R2 = P.R * 2;
  for (let i = 0; i < n; i++) {
    const a = ps[i];
    for (let j = i + 1; j < n; j++) {
      const c = ps[j];
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
      const overlap = (R2 - d) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      c.x += nx * overlap;
      c.y += ny * overlap;
      const rvn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      if (rvn < 0) {
        const jmp = (-(1 + P.BUMP_E) * rvn) / 2;
        a.vx -= jmp * nx;
        a.vy -= jmp * ny;
        c.vx += jmp * nx;
        c.vy += jmp * ny;
      }
      tackleCheck(s, a, c, ev);
      tackleCheck(s, c, a, ev);
    }
  }
}

function collideBallPlayers(s, ev) {
  const b = s.ball;
  if (b.z >= P.H) return;
  const min = CONTACT;
  for (const p of s.players) {
    if (p.kcd > 0 && b.last === p.id) continue;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d;
    const ny = dy / d;
    b.x = p.x + nx * min;
    b.y = p.y + ny * min;
    if (p.slide) {
      const sp = Math.max(6.5, Math.hypot(b.vx, b.vy) * 0.5);
      let vx = p.sdx * 0.7 + nx * 0.5;
      let vy = p.sdy * 0.7 + ny * 0.5;
      const l = Math.hypot(vx, vy) || 1;
      vx /= l;
      vy /= l;
      b.vx = vx * sp;
      b.vy = vy * sp;
      b.owner = -1;
      touch(s, p);
      ev.push({ e: 'poke', p: p.id });
      continue;
    }
    const rvx = b.vx - p.vx;
    const rvy = b.vy - p.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const high = b.z > K.CONTROL_MAX_Z;
      const e = high ? B.HEAD_E : B.PLAYER_E;
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      p.vx += vn * nx * 0.06;
      p.vy += vn * ny * 0.06;
      if (high) b.vz *= 0.5;
      if (vn < -0.6) touch(s, p);
      if (vn < -4) ev.push({ e: 'block', p: p.id, v: Math.round(-vn * 10) / 10 });
    }
  }
}

function playerBounds(s) {
  const f = s.field;
  const minX = -f.hw + P.R;
  const maxX = f.hw - P.R;
  const minY = -f.hh + P.R;
  const maxY = f.hh - P.R;
  const postMin = P.R + POST_R;
  for (const p of s.players) {
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
    // Goal posts
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
  if (Math.abs(b.y) >= f.gh || b.z >= f.bar) return;
  let team = -1;
  if (b.x > f.hw + B.R) team = 0;
  else if (b.x < -f.hw - B.R) team = 1;
  if (team < 0) return;
  s.score[team]++;
  s.phase = PHASE.GOAL;
  s.pt = s.rules.pause;
  s.ko = 1 - team;
  const scorer = findPlayer(s, b.last);
  const own = scorer ? (scorer.team !== team ? 1 : 0) : 0;
  ev.push({
    e: 'goal',
    t: team,
    p: b.last,
    a: own ? -1 : b.prev,
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
  if (s.ot) return true;
  return false;
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
          s.phase = PHASE.KICKOFF;
          s.pt = 0;
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
  const ps = s.players;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    updatePlayer(s, p, frozen, ev);
    p.x += p.vx;
    p.y += p.vy;
  }
  ballControl(s, ev);
  updateBall(s, ev);
  collidePlayers(s, ev);
  collideBallPlayers(s, ev);
  ballWalls(s, ev);
  playerBounds(s);
  if (s.phase === PHASE.KICKOFF) kickoffRules(s);
  phaseLogic(s, auth, ev);
  return ev;
}

/** Simulates only the ball (no players) to preview a trajectory. Returns points. */
export function previewBallPath(field, ball, ticks, every = 2) {
  const s = { field, ball: { ...ball }, players: [], phase: PHASE.PLAY };
  const pts = [];
  const sink = [];
  let landing = null;
  for (let i = 0; i < ticks; i++) {
    const wasAir = s.ball.z > 0;
    updateBall(s, sink);
    if (wasAir && s.ball.z === 0 && !landing) landing = { x: s.ball.x, y: s.ball.y };
    if (i % every === 0) pts.push({ x: s.ball.x, y: s.ball.y, z: s.ball.z });
    if (Math.abs(s.ball.x) > field.hw + B.R) break;
  }
  return { pts, landing };
}

export const PHYS = { CONTACT, REACH };
