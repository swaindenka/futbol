import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeState, addPlayer, resetKickoff, step, findPlayer, radius,
} from '../public/shared/physics.js';
import { encodeSnapshot, decodeSnapshot } from '../public/shared/protocol.js';
import { BotBrain } from '../public/shared/bot.js';
import { MatchStats } from '../public/shared/stats.js';
import {
  PHASE, BTN, B, P, TIMING, PU, PU_INFO, PU_TUNE, AT, puLevel, pickPowerUp,
} from '../public/shared/constants.js';

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

test('a shot passing close to the keeper is still the shooter\'s goal', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  const k = findPlayer(s, 2);
  p.x = 300;
  p.y = 0;
  s.ball.x = 300 + P.R + B.R + 1;
  s.ball.y = 0;
  // Keeper stands just off the shot line: close enough to be "nearest", not touching.
  k.x = s.field.hw - 40;
  k.y = P.R + B.R + 3;
  const ev = run(s, 80, { 1: (i) => ({ mx: 0, my: 0, a: 0, b: i < 3 ? BTN.KICK : 0 }), 2: { mx: 0, my: 0, a: Math.PI, b: 0 } });
  const goal = ev.find((e) => e.e === 'goal');
  assert.ok(goal);
  assert.equal(goal.p, 1);
  assert.equal(goal.own, 0);
});

test('a shot deflected in by a defender is credited to the shooter', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  const d = findPlayer(s, 2);
  p.x = 250;
  p.y = 0;
  s.ball.x = 250 + P.R + B.R + 1;
  s.ball.y = 0;
  d.x = 380;
  d.y = 20; // clips the ball and deflects it
  const ev = run(s, 120, { 1: (i) => ({ mx: 0, my: 0, a: 0, b: i < 3 ? BTN.KICK : 0 }), 2: { mx: 0, my: 0, a: Math.PI, b: 0 } });
  const goal = ev.find((e) => e.e === 'goal');
  if (goal) {
    assert.equal(goal.p, 1, 'shooter gets the goal');
    assert.equal(goal.own, 0);
  }
});

test('rounded corners: a ball pushed into a corner slides back out', () => {
  const s = setup();
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  findPlayer(s, 2).x = 0;
  const f = s.field;
  s.ball.x = f.hw - 30;
  s.ball.y = f.hh - 30;
  p.x = f.hw - 80;
  p.y = f.hh - 80;
  // Keep pushing diagonally into the corner.
  run(s, 120, { 1: { mx: 0.7, my: 0.7, a: 0, b: 0 } });
  const inCorner = Math.abs(s.ball.x) > f.hw - 25 && Math.abs(s.ball.y) > f.hh - 25;
  assert.ok(!inCorner, `ball escaped the corner (${s.ball.x.toFixed(0)}, ${s.ball.y.toFixed(0)})`);
});

test('close control: the ball follows a gentle turn', () => {
  const s = setup(1, 'large');
  s.phase = PHASE.PLAY;
  const p = findPlayer(s, 1);
  findPlayer(s, 2).y = 330;
  p.x = -500;
  p.y = 0;
  s.ball.x = -470;
  s.ball.y = 0;
  run(s, 100, { 1: { mx: 1, my: 0, a: 0, b: 0 } });
  run(s, 60, { 1: { mx: 0.92, my: -0.38, a: 0, b: 0 } });
  const gap = Math.hypot(s.ball.x - p.x, s.ball.y - p.y) - (P.R + B.R);
  assert.ok(gap < 40, `ball stays with the player after a turn (gap ${gap.toFixed(0)})`);
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

test('bots move smoothly (no constant direction reversals)', () => {
  let ticks = 0;
  let reversals = 0;
  for (const [size, field] of [[2, 'small'], [3, 'medium'], [4, 'large']]) {
    const s = makeState(field, { ...rules, duration: 60, goldenGoal: false });
    const brains = new Map();
    let id = 1;
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < size; i++) {
        addPlayer(s, id, t);
        brains.set(id, new BotBrain(id, 1));
        id++;
      }
    }
    resetKickoff(s);
    const prev = new Map();
    while (s.phase !== PHASE.ENDED) {
      for (const p of s.players) p.in = brains.get(p.id).update(s);
      step(s, true);
      if (s.phase !== PHASE.PLAY) continue;
      for (const p of s.players) {
        const m = Math.hypot(p.in.mx, p.in.my);
        const a = Math.atan2(p.in.my, p.in.mx);
        const q = prev.get(p.id);
        if (q && m > 0.2 && q.m > 0.2) {
          ticks++;
          let d = Math.abs(a - q.a);
          if (d > Math.PI) d = 2 * Math.PI - d;
          if (d > 2.4) reversals++;
        }
        prev.set(p.id, { a, m });
      }
    }
  }
  const perSecond = (reversals / ticks) * 60;
  assert.ok(perSecond < 0.5, `reversals per bot-second: ${perSecond.toFixed(2)} (about 1.3-1.9 before the fix)`);
});

test('2v2: a straight shot right after the kickoff is not a free goal', () => {
  // Regression: defending bots used to drift to the sides during the kickoff and leave the
  // centre lane and the (keeper-less) goal open.
  let goals = 0;
  let trials = 0;
  for (const level of [0, 1, 2]) {
    for (const wait of [10, 120, 400]) {
      for (const aimY of [0, -30, 30]) {
        const s = makeState('small', { ...rules, goldenGoal: false });
        const brains = new Map();
        let id = 1;
        for (let t = 0; t < 2; t++) {
          for (let i = 0; i < 2; i++) {
            addPlayer(s, id, t);
            if (id !== 1) brains.set(id, new BotBrain(id, level));
            id++;
          }
        }
        s.ko = 0;
        resetKickoff(s);
        s.phase = PHASE.KICKOFF;
        s.pt = 0;
        const me = findPlayer(s, 1);
        for (let t = 0; t < wait + 300; t++) {
          for (const p of s.players) if (p.id !== 1) p.in = brains.get(p.id).update(s);
          if (t < wait) me.in = { mx: 0, my: 0, a: 0, b: 0 };
          else {
            const dx = s.field.hw - s.ball.x;
            const dy = aimY - s.ball.y;
            const d = Math.hypot(dx, dy);
            const mx = s.ball.x - (dx / d) * 20 - me.x + (dx / d) * 30;
            const my = s.ball.y - (dy / d) * 20 - me.y + (dy / d) * 30;
            const m = Math.hypot(mx, my) || 1;
            me.in = { mx: mx / m, my: my / m, a: 0, b: t % 20 < 10 ? BTN.KICK : 0 };
          }
          const ev = step(s, true);
          if (ev.some((e) => e.e === 'goal')) {
            if (ev.find((e) => e.e === 'goal').t === 0) goals++;
            break;
          }
        }
        trials++;
      }
    }
  }
  assert.ok(goals <= 1, `kickoff shots scored ${goals}/${trials} (was 12/15 before the fix)`);
});

// ---------------------------------------------------------------------------
// Power-ups

function puSetup() {
  const s = setup();
  s.phase = PHASE.PLAY;
  s.puT = 1e9; // no random spawns during these tests
  return s;
}

test('power-ups spawn during play when enabled, never when disabled', () => {
  for (const on of [true, false]) {
    const s = makeState('small', { ...rules, powerups: on });
    addPlayer(s, 1, 0);
    addPlayer(s, 2, 1);
    resetKickoff(s);
    s.phase = PHASE.PLAY;
    s.time = 1e6;
    const ev = run(s, PU_TUNE.FIRST + PU_TUNE.EVERY_MAX + 10);
    const spawned = ev.filter((e) => e.e === 'pus').length;
    if (on) assert.ok(spawned >= 1, 'spawned');
    else assert.equal(spawned, 0);
  }
});

test('picking up Giant makes the body bigger, then it wears off', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  s.pu.push({ id: 1, k: PU.GIANT, x: p.x + 5, y: p.y, t: 0 });
  const ev = run(s, 1);
  assert.ok(ev.some((e) => e.e === 'pu' && e.p === 1 && e.k === PU.GIANT));
  assert.equal(s.pu.length, 0);
  assert.ok(radius(p) > P.R * 1.4);
  run(s, 481);
  assert.equal(radius(p), P.R);
});

test('Fire: the next kick is much harder, sets the ball on fire and is used up', () => {
  const kickSpeed = (fire) => {
    const s = puSetup();
    const p = findPlayer(s, 1);
    findPlayer(s, 2).y = 250;
    p.x = 0;
    p.y = 0;
    if (fire) {
      p.eff = PU.FIRE;
      p.et = 480;
    }
    s.ball.x = P.R + B.R + 1;
    s.ball.y = 0;
    const ev = run(s, 2, { 1: { mx: 0, my: 0, a: 0, b: BTN.KICK } });
    return { v: ev.find((e) => e.e === 'kick').v, s, p };
  };
  const normal = kickSpeed(false);
  const fire = kickSpeed(true);
  assert.ok(fire.v > normal.v * 1.4, `fire ${fire.v} vs normal ${normal.v}`);
  assert.ok(fire.s.ball.fire > 0);
  assert.equal(fire.p.eff, 0, 'fireball used up');
});

test('Ice slows the whole other team', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  const q = findPlayer(s, 2);
  s.pu.push({ id: 1, k: PU.ICE, x: p.x, y: p.y, t: 0 });
  run(s, 1);
  assert.ok(q.sl > 0 && p.sl === 0);
  q.x = -100;
  q.y = 0;
  q.vx = q.vy = 0;
  run(s, 60, { 2: { mx: 1, my: 0, a: 0, b: 0 } });
  assert.ok(Math.hypot(q.vx, q.vy) < P.SPEED * 0.6, 'slowed');
});

test('Rubber ball keeps its speed off the boards', () => {
  const s = puSetup();
  for (const p of s.players) p.x = -400;
  s.ball.rub = 600;
  s.ball.x = 0;
  s.ball.y = 0;
  s.ball.vx = 0;
  s.ball.vy = 8;
  run(s, 40);
  assert.ok(Math.abs(s.ball.vy) > 6, `still fast after the bounce (${s.ball.vy.toFixed(1)})`);
});

test('snapshot carries power-ups and effects', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  p.eff = PU.SPEED;
  p.et = 100;
  s.ball.rub = 50;
  s.pu.push({ id: 7, k: PU.FIRE, x: 10, y: 20, t: 3 });
  const d = JSON.parse(JSON.stringify(encodeSnapshot(s, [])));
  const r = decodeSnapshot(d, { field: 'small', rules: s.rules });
  assert.equal(r.players.find((q) => q.id === 1).eff, PU.SPEED);
  assert.equal(r.ball.rub, 50);
  assert.deepEqual(r.pu[0], { id: 7, k: PU.FIRE, x: 10, y: 20, t: 3, m: 0 });
});

// ---------------------------------------------------------------------------
// Aftertouch (falso)

/** Player 1 kicks the ball to the right from the left half, then holds `my` on the stick. */
function curveShot(my, opts = {}) {
  const s = puSetup();
  const p = findPlayer(s, 1);
  const q = findPlayer(s, 2);
  q.x = 300;
  q.y = 250;
  p.x = -300;
  p.y = 0;
  s.ball.x = p.x + P.R + B.R + 1;
  s.ball.y = 0;
  const ev = run(s, 50, { 1: (i) => ({ mx: opts.mx ?? 0, my, a: 0, b: i < 3 ? BTN.KICK : 0 }) });
  return { s, ev };
}

test('aftertouch: sideways stick input right after a kick curves the ball', () => {
  const straight = curveShot(0);
  const down = curveShot(1);
  const up = curveShot(-1);
  assert.ok(Math.abs(straight.s.ball.y) < 0.5, 'no input: straight shot');
  assert.ok(down.s.ball.y > 40, `curls down (y=${down.s.ball.y.toFixed(1)})`);
  assert.ok(up.s.ball.y < -40, `curls up (y=${up.s.ball.y.toFixed(1)})`);
  const sp = (r) => Math.hypot(r.s.ball.vx, r.s.ball.vy);
  assert.ok(Math.abs(sp(down) - sp(straight)) < 0.05, 'curving keeps the speed');
  assert.equal(down.s.ball.at, 0, 'the window closes');
});

test('aftertouch: a small sideways wobble does not bend a straight shot', () => {
  const r = curveShot(AT.DEAD * 0.9, { mx: 1 });
  assert.ok(Math.abs(r.s.ball.y) < 0.5);
});

test('aftertouch ends when the ball hits the boards or another player', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  const q = findPlayer(s, 2);
  q.x = 400;
  q.y = 0;
  p.x = 0;
  p.y = 0;
  s.ball.x = P.R + B.R + 1;
  s.ball.y = 0;
  run(s, 2, { 1: { mx: 0, my: 0, a: 0, b: BTN.KICK } });
  assert.ok(s.ball.at > 0 && s.ball.ak === 1);
  run(s, 40, { 1: { mx: 0, my: 1, a: 0, b: 0 }, 2: { mx: 0, my: 0, a: Math.PI, b: 0 } });
  assert.equal(s.ball.at, 0, 'touching the opponent cancels it');
});

// ---------------------------------------------------------------------------
// Debuffs

test('a dazed player cannot move or kick, then recovers', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  findPlayer(s, 2).y = 250;
  p.x = 0;
  p.y = 0;
  p.st = 30;
  s.ball.x = P.R + B.R + 1;
  s.ball.y = 0;
  const ev = run(s, 20, { 1: { mx: -1, my: 0, a: 0, b: BTN.KICK } });
  assert.ok(!ev.some((e) => e.e === 'kick'), 'no kick while dazed');
  assert.ok(Math.abs(p.vx) < 0.2, 'no running while dazed');
  run(s, 30, { 1: { mx: -1, my: 0, a: 0, b: 0 } });
  assert.ok(p.vx < -2, 'moves again afterwards');
});

test('Ters Köşe reverses the controls, Kaygan makes the feet slide', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  findPlayer(s, 2).y = 250;
  p.db = PU.DIZZY;
  p.dt = PU_INFO[PU.DIZZY].ticks;
  run(s, 20, { 1: { mx: 1, my: 0, a: 0, b: 0 } });
  assert.ok(p.vx < -1.5, 'pressing right runs left');
  const s2 = puSetup();
  const a = findPlayer(s2, 1);
  findPlayer(s2, 2).y = 250;
  a.db = PU.SLIPPY;
  a.dt = PU_INFO[PU.SLIPPY].ticks;
  run(s2, 10, { 1: { mx: 1, my: 0, a: 0, b: 0 } });
  assert.ok(a.vx > 0 && a.vx < 1.3, `slow to get going (${a.vx.toFixed(2)})`);
  a.vx = 3;
  run(s2, 20, { 1: { mx: 0, my: 0, a: 0, b: 0 } });
  assert.ok(a.vx > 2, 'and slow to stop');
  run(s2, PU_INFO[PU.SLIPPY].ticks);
  assert.equal(a.db, 0, 'the curse wears off');
});

// ---------------------------------------------------------------------------
// New power-ups

test('Magnet: the ball follows the player through a full turn', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  findPlayer(s, 2).y = 250;
  p.x = 0;
  p.y = 0;
  p.eff = PU.MAGNET;
  p.et = 400;
  s.ball.x = P.R + B.R + 30; // a little away from the feet
  s.ball.y = 0;
  run(s, 30);
  const d0 = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
  assert.ok(d0 < P.R + B.R + 6, `pulled to the feet (${d0.toFixed(1)})`);
  run(s, 90, { 1: { mx: -1, my: 0, a: Math.PI, b: 0 } });
  assert.ok(p.x < -150, 'ran the other way');
  const d1 = Math.hypot(s.ball.x - p.x, s.ball.y - p.y);
  assert.ok(d1 < P.R + B.R + 12, `the ball came along (${d1.toFixed(1)})`);
  assert.ok(s.ball.x < p.x, 'in front of the player');
});

test('Magnet does not catch hard shots', () => {
  const shot = (eff) => {
    const s = puSetup();
    const p = findPlayer(s, 1);
    findPlayer(s, 2).y = 250;
    p.x = 0;
    p.y = 60;
    p.eff = eff;
    p.et = 400;
    s.ball.x = -200;
    s.ball.y = 0;
    s.ball.vx = 11;
    run(s, 40);
    return s.ball;
  };
  const plain = shot(0);
  const mag = shot(PU.MAGNET);
  assert.ok(Math.abs(mag.x - plain.x) < 0.5 && Math.abs(mag.y) < 0.5, 'the shot flies past untouched');
});

test('Shield blocks the first shot into the goal, then breaks', () => {
  const s = puSetup();
  for (const p of s.players) p.y = 250;
  s.sh[1] = PU_INFO[PU.SHIELD].ticks;
  s.ball.x = s.field.hw - 60;
  s.ball.y = 0;
  s.ball.vx = 9;
  s.ball.lt = 0;
  let ev = run(s, 30);
  assert.ok(ev.some((e) => e.e === 'shield' && e.t === 1), 'blocked');
  assert.ok(!ev.some((e) => e.e === 'goal'));
  assert.equal(s.sh[1], 0, 'broken');
  assert.ok(s.ball.vx < 0, 'bounced back');
  s.ball.x = s.field.hw - 60;
  s.ball.y = 0;
  s.ball.vx = 9;
  ev = run(s, 30);
  assert.ok(ev.some((e) => e.e === 'goal' && e.t === 0), 'second shot goes in');
});

test('Shield picked up guards the picker\'s own goal and runs out', () => {
  const s = puSetup();
  const p = findPlayer(s, 2);
  s.pu.push({ id: 1, k: PU.SHIELD, x: p.x, y: p.y, t: 0 });
  run(s, 1);
  assert.ok(s.sh[1] > 0 && s.sh[0] === 0);
  run(s, PU_INFO[PU.SHIELD].ticks);
  assert.equal(s.sh[1], 0);
});

test('Ghost passes through opponents, a Giant shoves them', () => {
  const bump = (eff) => {
    const s = puSetup();
    const a = findPlayer(s, 1);
    const c = findPlayer(s, 2);
    a.x = -60;
    a.y = 0;
    c.x = 0;
    c.y = 0;
    a.eff = eff;
    a.et = 400;
    s.ball.y = 250;
    run(s, 50, { 1: { mx: 1, my: 0, a: 0, b: 0 }, 2: { mx: -1, my: 0, a: Math.PI, b: 0 } });
    return { a, c };
  };
  const normal = bump(0);
  const g = bump(PU.GHOST);
  const big = bump(PU.GIANT);
  assert.ok(normal.a.x < normal.c.x, 'normal players block each other');
  assert.ok(g.a.x > g.c.x + 20, 'the ghost went through');
  assert.ok(big.a.x > normal.a.x + 30, `the giant pushes through (${big.a.x.toFixed(0)} vs ${normal.a.x.toFixed(0)})`);
});

test('Shock wave knocks back and dazes nearby opponents only', () => {
  const s = makeState('small', { ...rules, powerups: true });
  for (let i = 1; i <= 4; i++) addPlayer(s, i, i <= 2 ? 0 : 1);
  resetKickoff(s);
  s.phase = PHASE.PLAY;
  s.puT = 1e9;
  const [me, mate, near, far] = [1, 2, 3, 4].map((id) => findPlayer(s, id));
  me.x = 0;
  me.y = 0;
  mate.x = -60;
  mate.y = 0;
  near.x = 80;
  near.y = 0;
  far.x = 380;
  far.y = 200;
  s.ball.x = 0;
  s.ball.y = 200;
  s.pu.push({ id: 1, k: PU.SHOCK, x: 0, y: 0, t: 0 });
  run(s, 1);
  assert.ok(near.st > 0 && near.vx > 3, 'opponent blasted');
  assert.equal(far.st, 0, 'far opponent untouched');
  assert.equal(mate.st, 0, 'teammate untouched');
  assert.equal(me.eff, 0, 'instant, nothing to hold');
});

test('Surprise box: content rolled at spawn, the same on the client prediction', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  s.pu.push({ id: 3, k: PU.MYSTERY, x: p.x, y: p.y, t: 0, m: PU.DIZZY });
  const d = JSON.parse(JSON.stringify(encodeSnapshot(s, [])));
  const client = decodeSnapshot(d, { field: 'small', rules: s.rules });
  const evS = step(s, true);
  const evC = step(client, false);
  for (const [st, ev] of [[s, evS], [client, evC]]) {
    const me = findPlayer(st, 1);
    assert.equal(me.db, PU.DIZZY, 'cursed');
    const e = ev.find((x) => x.e === 'pu');
    assert.equal(e.k, PU.DIZZY);
    assert.equal(e.m, 1);
  }
});

test('surprise box rolls: mostly power-ups, sometimes curses; boxes never contain boxes', () => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const seen = new Map();
  for (let i = 0; i < 4000; i++) {
    const k = pickPowerUp(rand, 'mw');
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  assert.ok(!seen.has(PU.MYSTERY));
  const curses = (seen.get(PU.DIZZY) || 0) + (seen.get(PU.SLIPPY) || 0);
  assert.ok(curses > 600 && curses < 1500, `curse share ${curses / 40}%`);
  for (let i = 0; i < 2000; i++) {
    const k = pickPowerUp(rand);
    assert.notEqual(PU_INFO[k].kind, 'curse', 'curses are never spawned on the pitch');
  }
});

test('Fireball hit dazes, but a ghost is immune', () => {
  const hit = (eff) => {
    const s = puSetup();
    const a = findPlayer(s, 1);
    const c = findPlayer(s, 2);
    a.y = 250;
    c.x = 100;
    c.y = 0;
    c.eff = eff;
    c.et = 300;
    s.ball.x = 0;
    s.ball.y = 0;
    s.ball.vx = 14;
    s.ball.fire = 60;
    s.ball.lt = 0;
    const ev = run(s, 12);
    return { c, ev };
  };
  const normal = hit(0);
  assert.ok(normal.ev.some((e) => e.e === 'blast'));
  assert.ok(normal.c.st > 0);
  const g = hit(PU.GHOST);
  assert.ok(!g.ev.some((e) => e.e === 'blast'));
  assert.equal(g.c.st, 0);
});

// ---------------------------------------------------------------------------
// Saves and tackles

test('blocking a shot that was going in is a save; a shot going wide is not', () => {
  const shot = (vy) => {
    const s = puSetup();
    const a = findPlayer(s, 1);
    const k = findPlayer(s, 2);
    a.y = -250;
    k.x = s.field.hw - 60;
    k.y = 0;
    s.ball.x = 0;
    s.ball.y = 0;
    s.ball.vx = 10;
    s.ball.vy = vy;
    s.ball.lt = 0;
    s.ball.last = 1;
    return run(s, 60);
  };
  const on = shot(0);
  assert.ok(on.some((e) => e.e === 'save' && e.p === 2), 'save');
  const wide = shot(4.5);
  assert.ok(!wide.some((e) => e.e === 'save'), 'no save for a shot going wide');
});

test('winning the ball off a dribbling opponent is a tackle', () => {
  const s = puSetup();
  const a = findPlayer(s, 1);
  const c = findPlayer(s, 2);
  a.x = -150;
  a.y = 0;
  s.ball.x = a.x + P.R + B.R + 1;
  s.ball.y = 0;
  c.x = 120;
  c.y = 0;
  const ev = run(s, 90, { 1: { mx: 1, my: 0, a: 0, b: 0 }, 2: { mx: -1, my: 0, a: Math.PI, b: 0 } });
  const t = ev.filter((e) => e.e === 'tackle');
  assert.ok(t.some((e) => e.p === 2 && e.v === 1), 'tackle by the defender');
  const stats = new MatchStats();
  stats.ensure({ id: 1, name: 'a', number: 1, team: 0 });
  stats.ensure({ id: 2, name: 'b', number: 2, team: 1 });
  stats.events(s, ev);
  assert.ok(stats.players.get(2).tackles >= 1);
});

// ---------------------------------------------------------------------------
// Rates, snapshot, bots

test('power-up rate levels: chaos spawns far more than few, off spawns none', () => {
  assert.equal(puLevel(true), 2);
  assert.equal(puLevel(false), 0);
  assert.equal(puLevel(undefined), 2);
  assert.equal(puLevel(9), 3);
  const count = (level) => {
    const s = makeState('large', { ...rules, powerups: level });
    for (let i = 1; i <= 8; i++) addPlayer(s, i, i <= 4 ? 0 : 1);
    resetKickoff(s);
    s.phase = PHASE.PLAY;
    s.time = 1e6;
    for (const p of s.players) p.y = s.field.hh - 30; // keep everyone off the pickups
    let n = 0;
    for (let i = 0; i < 3600; i++) for (const e of step(s, true)) if (e.e === 'pus') n++;
    return n;
  };
  const off = count(0);
  const few = count(1);
  const chaos = count(3);
  assert.equal(off, 0);
  assert.ok(few >= 1 && chaos > few * 2, `few ${few}, chaos ${chaos}`);
});

test('snapshot carries debuffs, aftertouch and shields', () => {
  const s = puSetup();
  const p = findPlayer(s, 1);
  p.st = 12;
  p.db = PU.SLIPPY;
  p.dt = 99;
  s.ball.at = 9;
  s.ball.ak = 1;
  s.sh = [0, 321];
  s.pu.push({ id: 4, k: PU.MYSTERY, x: 1, y: 2, t: 3, m: PU.GHOST });
  const d = JSON.parse(JSON.stringify(encodeSnapshot(s, [])));
  const r = decodeSnapshot(d, { field: 'small', rules: s.rules });
  const q = r.players.find((x) => x.id === 1);
  assert.deepEqual([q.st, q.db, q.dt], [12, PU.SLIPPY, 99]);
  assert.deepEqual([r.ball.at, r.ball.ak], [9, 1]);
  assert.deepEqual(r.sh, [0, 321]);
  assert.equal(r.pu[0].m, PU.GHOST);
});

test('bots play a chaos power-up 4v4 match without errors', () => {
  const s = makeState('large', { duration: 90, goldenGoal: false, scoreLimit: 0, powerups: 3 });
  const brains = new Map();
  let id = 1;
  for (let t = 0; t < 2; t++) {
    for (let i = 0; i < 4; i++) {
      addPlayer(s, id, t, i);
      brains.set(id, new BotBrain(id, i % 3));
      id++;
    }
  }
  resetKickoff(s);
  const picked = new Set();
  for (let i = 0; i < 60 * 140 && s.phase !== PHASE.ENDED; i++) {
    for (const p of s.players) p.in = brains.get(p.id).update(s);
    for (const e of step(s, true)) if (e.e === 'pu') picked.add(e.k);
    for (const p of s.players) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(Number.isFinite(s.ball.x) && Number.isFinite(s.ball.y));
    assert.ok(Math.abs(s.ball.x) < s.field.hw + s.field.gd + 1 && Math.abs(s.ball.y) < s.field.hh + 1, 'ball stays on the pitch');
  }
  assert.equal(s.phase, PHASE.ENDED);
  assert.ok(picked.size >= 4, `bots picked up ${picked.size} kinds`);
});

test('a bot\'s shot is not bent by its own movement (unless it curls it on purpose)', () => {
  for (const level of [0, 1]) {
    const s = puSetup();
    const me = findPlayer(s, 1);
    const opp = findPlayer(s, 2);
    opp.x = -350;
    opp.y = 200;
    me.x = 150;
    me.y = 60;
    s.ball.x = 190;
    s.ball.y = 40;
    const brain = new BotBrain(1, level, () => 0.5);
    let kicked = null;
    for (let i = 0; i < 200 && s.phase === PHASE.PLAY; i++) {
      me.in = brain.update(s);
      const ev = step(s, true);
      const k = ev.find((e) => e.e === 'kick' && e.p === 1);
      if (k && !kicked) kicked = { a: k.a, t: i };
      if (kicked && s.ball.at === 0 && i > kicked.t + 2) {
        const now = Math.atan2(s.ball.vy, s.ball.vx);
        assert.ok(Math.abs(now - kicked.a) < 0.03, `level ${level}: ball kept its line (${kicked.a} -> ${now.toFixed(2)})`);
        break;
      }
    }
    assert.ok(kicked, 'the bot kicked');
  }
});
