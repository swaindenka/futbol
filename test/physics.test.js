import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeState, addPlayer, resetKickoff, step, findPlayer, kickVector, previewBallPath,
} from '../public/shared/physics.js';
import { encodeSnapshot, decodeSnapshot } from '../public/shared/protocol.js';
import { BotBrain } from '../public/shared/bot.js';
import { MatchStats } from '../public/shared/stats.js';
import { PHASE, BTN, B, P, K } from '../public/shared/constants.js';

const rules = { duration: 120, goldenGoal: true, scoreLimit: 0, replays: false };

function setup(n = 1, field = 'small') {
  const s = makeState(field, rules);
  let id = 1;
  for (let t = 0; t < 2; t++) for (let i = 0; i < n; i++) addPlayer(s, id++, t);
  resetKickoff(s);
  return s;
}

function run(s, ticks, inputs = {}) {
  const events = [];
  for (let i = 0; i < ticks; i++) {
    for (const p of s.players) if (inputs[p.id]) p.in = typeof inputs[p.id] === 'function' ? inputs[p.id](i, p) : inputs[p.id];
    events.push(...step(s, true));
  }
  return events;
}

test('countdown freezes players, then kickoff starts', () => {
  const s = setup();
  const p = findPlayer(s, 1);
  const x0 = p.x;
  run(s, 60, { 1: { mx: 1, my: 0, a: 0, b: 0 } });
  assert.equal(s.phase, PHASE.COUNTDOWN);
  assert.ok(Math.abs(p.x - x0) < 0.01, 'player must not move during countdown');
  const ev = run(s, 130, { 1: { mx: 0, my: 0, a: 0, b: 0 } });
  assert.equal(s.phase, PHASE.KICKOFF);
  assert.ok(ev.some((e) => e.e === 'whistle'));
});

test('kickoff taker does not auto-touch the ball and opponents stay out of the circle', () => {
  const s = setup(2);
  s.phase = PHASE.KICKOFF;
  s.pt = 0;
  const blue = s.players.filter((p) => p.team === 1);
  run(s, 120, Object.fromEntries(blue.map((p) => [p.id, { mx: -1, my: 0, a: Math.PI, b: BTN.SPRINT }])));
  assert.equal(s.phase, PHASE.KICKOFF, 'idle kicker must not start play');
  for (const p of blue) assert.ok(Math.hypot(p.x, p.y) >= s.field.cr + P.R - 0.01, 'blue stays outside the centre circle');
  for (const p of blue) assert.ok(p.x >= 0, 'blue stays in own half');
});

test('dribbling keeps the ball close while running', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  p.x = -200;
  p.y = 0;
  s.ball.x = -200 + P.R + B.R + 2;
  s.ball.y = 0;
  run(s, 90, { 1: { mx: 1, my: 0, a: 0, b: BTN.SPRINT }, 2: { mx: 0, my: 1, a: 0, b: 0 } });
  const d = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
  assert.ok(p.x > -100, 'player advanced');
  assert.ok(d < P.R + B.R + K.CONTROL_RANGE + 2, `ball stays at the feet (d=${d.toFixed(1)})`);
  assert.equal(s.ball.owner, 1);
});

test('charged shot scores a goal and records scorer', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  const opp = findPlayer(s, 2);
  opp.x = -400;
  opp.y = 250;
  p.x = 250;
  p.y = 0;
  s.ball.x = 250 + P.R + B.R + 1;
  s.ball.y = 0;
  const events = run(s, 200, { 1: (i) => ({ mx: 0, my: 0, a: 0, b: i < 30 ? BTN.SHOOT : 0 }) });
  const goal = events.find((e) => e.e === 'goal');
  assert.ok(goal, 'goal event');
  assert.equal(goal.t, 0);
  assert.equal(goal.p, 1);
  assert.deepEqual(s.score, [1, 0]);
});

test('ball bounces off the boards like a cushion', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  for (const p of s.players) p.x = -400;
  s.ball.x = 0;
  s.ball.y = 0;
  s.ball.vx = 0;
  s.ball.vy = 12;
  const events = run(s, 60);
  assert.ok(events.some((e) => e.e === 'wall'));
  assert.ok(s.ball.y < s.field.hh, 'ball inside');
});

test('lob flies over a defender', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  const d = findPlayer(s, 2);
  p.x = -100;
  p.y = 0;
  s.ball.x = -100 + P.R + B.R + 1;
  s.ball.y = 0;
  d.x = 20;
  d.y = 0;
  run(s, 46, { 1: (i) => ({ mx: 0, my: 0, a: 0, b: i < 45 ? BTN.LOB : 0 }), 2: { mx: 0, my: 0, a: Math.PI, b: 0 } });
  run(s, 45);
  assert.ok(s.ball.x > d.x + 40, `ball cleared the defender (x=${s.ball.x.toFixed(0)})`);
});

test('slide tackle on ball carrier is clean, on a player without the ball is a foul', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const a = findPlayer(s, 1);
  const v = findPlayer(s, 2);
  a.x = 0;
  a.y = 0;
  v.x = 60;
  v.y = 0;
  s.ball.x = 60 + P.R + B.R;
  s.ball.y = 0;
  s.ball.owner = 2;
  let ev = run(s, 20, { 1: (i) => ({ mx: 1, my: 0, a: 0, b: i === 1 ? BTN.TACKLE : 0 }) });
  assert.ok(ev.some((e) => e.e === 'tackle' && e.p === 1 && e.v === 2), 'clean tackle');
  assert.ok(v.stun > 0);

  const s2 = setup();
  s2.phase = PHASE.PLAY;
  const a2 = findPlayer(s2, 1);
  const v2 = findPlayer(s2, 2);
  a2.x = 0;
  a2.y = 0;
  v2.x = 60;
  v2.y = 0;
  s2.ball.x = -300;
  s2.ball.y = 200;
  ev = run(s2, 20, { 1: (i) => ({ mx: 1, my: 0, a: 0, b: i === 1 ? BTN.TACKLE : 0 }) });
  assert.ok(ev.some((e) => e.e === 'foul' && e.p === 1), 'foul when ball is far away');
  assert.ok(a2.stun > 0, 'fouling player is punished');
});

test('pass goes toward a teammate in the aim cone', () => {
  const s = setup(2);
  s.phase = PHASE.PLAY;
  const [p, mate] = s.players.filter((q) => q.team === 0);
  for (const q of s.players.filter((q) => q.team === 1)) {
    q.x = 300;
    q.y = 250;
  }
  p.x = -200;
  p.y = 0;
  mate.x = 50;
  mate.y = 120;
  s.ball.x = -200 + P.R + B.R + 1;
  s.ball.y = 0;
  const ev = run(s, 2, { [p.id]: (i) => ({ mx: 0, my: 0, a: 0.3, b: i === 1 ? BTN.PASS : 0 }) });
  const k = ev.find((e) => e.e === 'kick');
  assert.equal(k.k, 'pass');
  assert.equal(k.t, mate.id);
  const ang = Math.atan2(s.ball.vy, s.ball.vx);
  assert.ok(Math.abs(ang - Math.atan2(120, 250)) < 0.25, 'ball heads to the mate');
});

test('curve: lateral run bends the shot', () => {
  const p = { vx: 0, vy: 4, x: 0, y: 0 };
  const v = kickVector(p, 1, 1, 0);
  assert.ok(Math.abs(v.spin) > 0, 'spin applied');
  const field = makeState('large', rules).field;
  const path = previewBallPath(field, { x: 0, y: 0, z: 0, vx: v.vx, vy: v.vy, vz: 0, spin: v.spin }, 60);
  assert.ok(path.pts.length > 10);
});

test('golden goal when the clock runs out level', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  s.time = 3;
  const ev = run(s, 5);
  assert.ok(ev.some((e) => e.e === 'overtime'));
  assert.equal(s.ot, 1);
  assert.equal(s.phase, PHASE.PLAY);
});

test('snapshot encode/decode round trip', () => {
  const s = setup(3, 'medium');
  run(s, 200);
  const d = JSON.parse(JSON.stringify(encodeSnapshot(s, [{ e: 'x' }])));
  const r = decodeSnapshot(d, { field: 'medium', rules: s.rules });
  assert.equal(r.players.length, s.players.length);
  assert.equal(r.tick, s.tick);
  assert.ok(Math.abs(r.players[2].x - s.players[2].x) < 0.01);
  assert.equal(r.events[0].e, 'x');
});

test('bots play a full 4v4 match without errors and score', () => {
  const s = makeState('large', { ...rules, duration: 240, goldenGoal: false });
  const brains = new Map();
  const stats = new MatchStats();
  let id = 1;
  for (let t = 0; t < 2; t++) {
    for (let i = 0; i < 4; i++) {
      addPlayer(s, id, t);
      brains.set(id, new BotBrain(id, 2));
      stats.ensure({ id, name: `b${id}`, team: t, number: id });
      id++;
    }
  }
  resetKickoff(s);
  let kicks = 0;
  for (let i = 0; i < 60 * 60 * 6 && s.phase !== PHASE.ENDED; i++) {
    for (const p of s.players) p.in = brains.get(p.id).update(s);
    const ev = step(s, true);
    stats.tick(s);
    stats.events(s, ev);
    kicks += ev.filter((e) => e.e === 'kick').length;
    for (const p of s.players) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(Number.isFinite(s.ball.x) && Number.isFinite(s.ball.y) && Number.isFinite(s.ball.z));
  }
  assert.equal(s.phase, PHASE.ENDED);
  assert.ok(kicks > 50, `bots kick the ball (${kicks})`);
  const sum = stats.summary(s.score);
  assert.equal(sum.players.length, 8);
  assert.equal(sum.possession[0] + sum.possession[1], 100);
});
