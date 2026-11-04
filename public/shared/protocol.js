// Compact snapshot encoding (arrays instead of objects) shared by server and client.

import { makeField, makeBall } from './physics.js';
import { round } from './util.js';

const r2 = (v) => round(v, 100);
const r3 = (v) => round(v, 1000);
const r5 = (v) => round(v, 100000);

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
    [r2(b.x), r2(b.y), r2(b.z), r3(b.vx), r3(b.vy), r3(b.vz), r5(b.spin), b.owner, b.last, b.prev, b.lt],
    s.players.map((p) => [
      p.id, p.team, p.slot,
      r2(p.x), r2(p.y), r3(p.vx), r3(p.vy), r3(p.facing),
      r2(p.stamina), p.exh, p.charge, p.ct, p.pb,
      p.slide, r3(p.sdx), r3(p.sdy), p.rec, p.stun, p.tcd, p.kcd,
      r2(p.in.mx), r2(p.in.my), r3(p.in.a), p.in.b,
    ]),
    events || [],
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
  ball.z = bd[2];
  ball.vx = bd[3];
  ball.vy = bd[4];
  ball.vz = bd[5];
  ball.spin = bd[6];
  ball.owner = bd[7];
  ball.last = bd[8];
  ball.prev = bd[9];
  ball.lt = bd[10];
  const players = d[10].map((a) => ({
    id: a[0],
    team: a[1],
    slot: a[2],
    x: a[3],
    y: a[4],
    vx: a[5],
    vy: a[6],
    facing: a[7],
    stamina: a[8],
    exh: a[9],
    charge: a[10],
    ct: a[11],
    pb: a[12],
    slide: a[13],
    sdx: a[14],
    sdy: a[15],
    rec: a[16],
    stun: a[17],
    tcd: a[18],
    kcd: a[19],
    in: { mx: a[20], my: a[21], a: a[22], b: a[23] },
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
