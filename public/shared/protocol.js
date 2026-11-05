// Compact snapshot encoding (arrays instead of objects) shared by server and client.

import { makeField, makeBall } from './physics.js';
import { round } from './util.js';

const r2 = (v) => round(v, 100);
const r3 = (v) => round(v, 1000);

export function encodeSnapshot(s, events) {
  const b = s.ball;
  return [
    s.tick,
    s.phase,
    s.pt,
    s.time,
    s.score[0],
    s.score[1],
    s.ko,
    s.ot,
    s.kt,
    [r2(b.x), r2(b.y), r3(b.vx), r3(b.vy), b.owner, b.last, b.prev, b.lt, b.fire, b.rub, b.at, b.ak, b.rt],
    s.players.map((p) => [
      p.id, p.team, p.slot,
      r2(p.x), r2(p.y), r3(p.vx), r3(p.vy), r3(p.facing),
      p.ct, p.pb, p.kcd,
      r2(p.in.mx), r2(p.in.my), r3(p.in.a), p.in.b,
      p.eff, p.et, p.sl, p.st, p.db, p.dt, p.fb, p.cg,
    ]),
    events || [],
    s.pu.map((u) => [u.id, u.k, u.x, u.y, u.t, u.m || 0]),
    s.puId,
    s.sh[0],
    s.sh[1],
  ];
}

/**
 * Decode a snapshot array into a full simulation state.
 * @param {Array} d encoded snapshot
 * @param {object} base { field (key or object), rules }
 */
export function decodeSnapshot(d, base) {
  const field = typeof base.field === 'string' ? makeField(base.field) : base.field;
  const bd = d[9];
  const ball = makeBall();
  ball.x = bd[0];
  ball.y = bd[1];
  ball.vx = bd[2];
  ball.vy = bd[3];
  ball.owner = bd[4];
  ball.last = bd[5];
  ball.prev = bd[6];
  ball.lt = bd[7];
  ball.fire = bd[8] || 0;
  ball.rub = bd[9] || 0;
  ball.at = bd[10] || 0;
  ball.ak = bd[11] ?? -1;
  ball.rt = bd[12] ?? -1;
  const players = d[10].map((a) => ({
    id: a[0],
    team: a[1],
    slot: a[2],
    x: a[3],
    y: a[4],
    vx: a[5],
    vy: a[6],
    facing: a[7],
    ct: a[8],
    pb: a[9],
    kcd: a[10],
    in: { mx: a[11], my: a[12], a: a[13], b: a[14] },
    eff: a[15] || 0,
    et: a[16] || 0,
    sl: a[17] || 0,
    st: a[18] || 0,
    db: a[19] || 0,
    dt: a[20] || 0,
    fb: a[21] || 0,
    cg: a[22] || 0,
  }));
  return {
    tick: d[0],
    phase: d[1],
    pt: d[2],
    time: d[3],
    score: [d[4], d[5]],
    ko: d[6],
    ot: d[7],
    kt: d[8],
    field,
    rules: base.rules,
    ball,
    players,
    pu: (d[12] || []).map((u) => ({ id: u[0], k: u[1], x: u[2], y: u[3], t: u[4], m: u[5] || 0 })),
    puId: d[13] || 1,
    puT: 0,
    sh: [d[14] || 0, d[15] || 0],
    events: d[11] || [],
  };
}

/** Sanitize an input message coming from a client. */
export function sanitizeInput(m) {
  const num = (v, lo, hi) => {
    v = +v;
    if (!Number.isFinite(v)) return 0;
    return v < lo ? lo : v > hi ? hi : v;
  };
  return {
    s: Math.floor(num(m.s, 0, 2 ** 31)),
    mx: num(m.x, -1, 1),
    my: num(m.y, -1, 1),
    a: num(m.a, -10, 10),
    b: Math.floor(num(m.b, 0, 31)),
  };
}
