import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeState, addPlayer, resetKickoff, step, findPlayer,
} from '../public/shared/physics.js';
import { encodeSnapshot, decodeSnapshot } from '../public/shared/protocol.js';
import { BotBrain } from '../public/shared/bot.js';
import { MatchStats } from '../public/shared/stats.js';
import { PHASE, BTN, B, P, TIMING } from '../public/shared/constants.js';

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
  run(s, 120, Object.fromEntries(blue.map((p) => [p.id, { mx: -1, my: 0, a: Math.PI, b: 0 }])));
  assert.equal(s.phase, PHASE.KICKOFF, 'idle kicker must not start play');
  for (const p of blue) assert.ok(Math.hypot(p.x, p.y) >= s.field.cr + P.R - 0.01, 'blue stays outside the centre circle');
  for (const p of blue) assert.ok(p.x >= 0, 'blue stays in own half');
});

test('running into the ball pushes it forward (dribbling)', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  findPlayer(s, 2).y = 250;
  p.x = -200;
  p.y = 0;
  s.ball.x = -160;
  s.ball.y = 0;
  run(s, 90, { 1: { mx: 1, my: 0, a: 0, b: 0 } });
  assert.ok(s.ball.x > p.x, 'ball stays ahead of the player');
  assert.ok(s.ball.x > -20, `ball moved forward (x=${s.ball.x.toFixed(0)})`);
});

test('kick sends the ball away from the player and scores', () => {
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
  const events = run(s, 120, { 1: (i) => ({ mx: 0, my: 0, a: 0, b: i < 5 ? BTN.KICK : 0 }) });
  const kicks = events.filter((e) => e.e === 'kick');
  assert.equal(kicks.length, 1, 'holding the button kicks only once');
  assert.ok(kicks[0].v > 9);
  const goal = events.find((e) => e.e === 'goal');
  assert.ok(goal, 'goal event');
  assert.equal(goal.t, 0);
  assert.equal(goal.p, 1);
  assert.deepEqual(s.score, [1, 0]);
});

test('kick is armed while held and fires when the ball arrives', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  findPlayer(s, 2).y = 250;
  p.x = 0;
  p.y = 0;
  s.ball.x = 120;
  s.ball.y = 0;
  s.ball.vx = -5;
  const events = run(s, 40, { 1: { mx: 0, my: 0, a: 0, b: BTN.KICK } });
  assert.ok(events.some((e) => e.e === 'kick' && e.p === 1), 'one-timer');
  assert.ok(s.ball.vx > 0, 'ball sent back');
});

test('simultaneous kicks never let the ball pass through a player', () => {
  let overlaps = 0;
  for (let off = -12; off <= 12; off += 2) {
    for (let delay = 0; delay < 6; delay++) {
      const s = setup();
      s.phase = PHASE.PLAY;
      const a = findPlayer(s, 1);
      const c = findPlayer(s, 2);
      a.x = -80;
      a.y = 0;
      c.x = 80;
      c.y = off;
      s.ball.x = 0;
      s.ball.y = 0;
      for (let t = 0; t < 40; t++) {
        a.in = { mx: 1, my: 0, a: 0, b: t >= delay ? BTN.KICK : 0 };
        c.in = { mx: -1, my: 0, a: Math.PI, b: BTN.KICK };
        step(s, true);
        for (const p of s.players) if (Math.hypot(s.ball.x - p.x, s.ball.y - p.y) < P.R + B.R - 1) overlaps++;
      }
    }
  }
  assert.equal(overlaps, 0);
});

test('after a goal the teams reset and a 3-2-1 countdown runs before the kickoff', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  for (const p of s.players) p.y = 250;
  s.ball.x = s.field.hw - 5;
  s.ball.y = 0;
  s.ball.vx = 8;
  const ev = run(s, 10);
  assert.ok(ev.some((e) => e.e === 'goal'));
  run(s, TIMING.GOAL_PAUSE);
  assert.equal(s.phase, PHASE.COUNTDOWN);
  assert.equal(s.ball.x, 0);
  run(s, TIMING.COUNTDOWN);
  assert.equal(s.phase, PHASE.KICKOFF);
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

test('a ball stuck on the boards can be won back from the wall side', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  findPlayer(s, 2).y = -250;
  s.ball.x = 0;
  s.ball.y = s.field.hh - B.R;
  p.x = 0;
  p.y = s.field.hh + 20;
  run(s, 30, { 1: { mx: 0, my: -1, a: 0, b: 0 } });
  assert.ok(s.ball.y < s.field.hh - 40, `ball pushed off the boards (y=${s.ball.y.toFixed(0)})`);
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
