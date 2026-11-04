// Deterministic match simulation shared by server (authoritative) and client (prediction).
// Simple one-button football: players push the ball by running into it and press KICK to
// strike it away from their body. The state is plain data so it can be snapshotted,
// sent over the wire and re-simulated.

import {
  P, B, K, BTN, PHASE, TIMING, TICK_RATE, FIELDS, GOAL_DEPTH, CROSSBAR_Z, POST_R,
} from './constants.js';
import { clamp, turnToward } from './util.js';

const CONTACT = P.R + B.R;
const REACH = CONTACT + K.REACH;
const OWN_RANGE = CONTACT + 6;
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
  };
}

export function makeBall() {
  // z stays 0 (no lofted balls) but is kept for the renderer.
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, owner: -1, last: -1, prev: -1, lt: -1 };
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
    p.pb = p.in.b | 0;
  }
  const b = s.ball;
  b.x = b.y = b.z = 0;
  b.vx = b.vy = 0;
  b.owner = -1;
  b.prev = -1;
  s.kt = 0;
}

export function inReach(p, b) {
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  return dx * dx + dy * dy <= REACH * REACH;
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

/** Kick the ball straight away from the player's centre. */
function kick(s, p, ev) {
  const b = s.ball;
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d;
  const ny = dy / d;
  b.vx = nx * K.POWER + p.vx * K.CARRY;
  b.vy = ny * K.POWER + p.vy * K.CARRY;
  b.owner = -1;
  p.ct = 0;
  p.kcd = K.KICK_CD;
  touch(s, p);
  ev.push({ e: 'kick', p: p.id, v: Math.round(Math.hypot(b.vx, b.vy) * 10) / 10, a: Math.round(Math.atan2(ny, nx) * 100) / 100 });
}

function updatePlayer(s, p, frozen) {
  const inp = p.in;
  const btn = inp.b | 0;
  const pressed = btn & ~p.pb;
  p.pb = btn;
  if (p.kcd > 0) p.kcd--;

  if (frozen) {
    p.vx *= 0.7;
    p.vy *= 0.7;
    p.ct = 0;
    return;
  }

  // Arm the kick on press; it fires once when the ball is within reach.
  if (btn & BTN.KICK) {
    if (pressed & BTN.KICK) p.ct = 1;
  } else p.ct = 0;

  let mx = clamp(+inp.mx || 0, -1, 1);
  let my = clamp(+inp.my || 0, -1, 1);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  const moving = len > 0.08;
  const max = P.SPEED * (btn & BTN.KICK ? P.KICK_SLOW : 1);
  if (moving) {
    p.vx += (mx * max - p.vx) * P.ACCEL;
    p.vy += (my * max - p.vy) * P.ACCEL;
    p.facing = turnToward(p.facing, Math.atan2(my, mx), P.TURN);
  } else {
    p.vx *= P.DECEL;
    p.vy *= P.DECEL;
  }
}

function kicks(s, ev) {
  if (s.phase === PHASE.COUNTDOWN || s.phase === PHASE.ENDED) return;
  const b = s.ball;
  for (const p of s.players) {
    if (p.ct && p.kcd === 0 && inReach(p, b)) kick(s, p, ev);
  }
}

/** Track who is closest to the ball ("owner") for bots, HUD and stats. */
function ownership(s, ev) {
  const b = s.ball;
  let best = null;
  let bestD = OWN_RANGE;
  for (const p of s.players) {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best) {
    b.owner = -1;
    return;
  }
  if (b.owner !== best.id) {
    b.owner = best.id;
    touch(s, best);
    ev.push({ e: 'trap', p: best.id });
  }
}

function ballWalls(s, ev) {
  const b = s.ball;
  const f = s.field;
  const r = B.R;
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
      b.vy = -b.vy * B.WALL_E;
    }
  } else if (b.y + r > f.hh) {
    b.y = f.hh - r;
    if (b.vy > 0) {
      if (b.vy > 1.5) ev.push({ e: 'wall', v: Math.round(b.vy * 10) / 10 });
      b.vy = -b.vy * B.WALL_E;
    }
  }
  if (Math.abs(b.x) + r > f.hw && Math.abs(b.y) >= f.gh) {
    const side = Math.sign(b.x);
    b.x = side * (f.hw - r);
    if (b.vx * side > 0) {
      const sp = Math.abs(b.vx);
      if (sp > 1.5) ev.push({ e: 'wall', v: Math.round(sp * 10) / 10 });
      b.vx = -b.vx * B.WALL_E;
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
        b.vx -= (1 + B.POST_E) * vn * nx;
        b.vy -= (1 + B.POST_E) * vn * ny;
        if (vn < -1) ev.push({ e: 'post', x: px, y: py, v: Math.round(-vn * 10) / 10 });
      }
    }
  }
}

function updateBall(s, ev) {
  const b = s.ball;
  b.vx *= B.FRICTION;
  b.vy *= B.FRICTION;
  b.x += b.vx;
  b.y += b.vy;
  if (b.vx * b.vx + b.vy * b.vy < 0.0004) b.vx = b.vy = 0;
  ballPosts(s, ev);
  ballWalls(s, ev);
}

function collidePlayers(s) {
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
    }
  }
}

function collideBallPlayers(s) {
  const b = s.ball;
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
    const vn = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
    if (vn < 0) {
      b.vx -= (1 + B.PLAYER_E) * vn * nx;
      b.vy -= (1 + B.PLAYER_E) * vn * ny;
      p.vx += vn * nx * 0.08;
      p.vy += vn * ny * 0.08;
      if (vn < -0.6) touch(s, p);
    }
  }
}

function playerBounds(s) {
  const f = s.field;
  const minX = -f.hw + P.R - EDGE;
  const maxX = f.hw - P.R + EDGE;
  const minY = -f.hh + P.R - EDGE;
  const maxY = f.hh - P.R + EDGE;
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
  for (const p of s.players) {
    updatePlayer(s, p, frozen);
    p.x += p.vx;
    p.y += p.vy;
  }
  kicks(s, ev);
  updateBall(s, ev);
  collidePlayers(s);
  collideBallPlayers(s);
  ballWalls(s, ev);
  playerBounds(s);
  ownership(s, ev);
  if (s.phase === PHASE.KICKOFF) kickoffRules(s);
  phaseLogic(s, auth, ev);
  return ev;
}

export const PHYS = { CONTACT, REACH, EDGE };
