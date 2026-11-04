// Bot AI for the one-button game. Runs on the server (online bots) and in the browser
// (practice mode / animated menu background).
// Bots push the ball by running behind it and press KICK when their body lines up
// with the target (goal, open teammate or a clearance direction).

import { P, B, BTN, PHASE } from './constants.js';
import { teamPlayers, findPlayer, PHYS } from './physics.js';
import { clamp, distToSegment, angleDiff, lerp } from './util.js';

const LEVELS = [
  { name: 'Kolay', react: 14, speed: 0.8, tol: 0.5, err: 0.2, range: 0.32 },
  { name: 'Orta', react: 7, speed: 0.92, tol: 0.36, err: 0.1, range: 0.4 },
  { name: 'Zor', react: 3, speed: 1.0, tol: 0.26, err: 0.04, range: 0.48 },
];

export const BOT_LEVEL_NAMES = LEVELS.map((l) => l.name);

const CONTACT = PHYS.CONTACT;
const REACH = PHYS.REACH;

export class BotBrain {
  constructor(id, level = 1, rng = Math.random) {
    this.id = id;
    this.cfg = LEVELS[clamp(level | 0, 0, 2)];
    this.rng = rng;
    this.cool = Math.floor(rng() * this.cfg.react);
    this.hold = 0;
    this.rest = 0;
    this.err = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.still = 0;
  }

  /**
   * @param {object} s simulation state
   * @param {Set<number>|Map<number,*>} [humans] ids of human players (bots defer the ball to them)
   */
  update(s, humans) {
    const me = findPlayer(s, this.id);
    const o = { mx: 0, my: 0, a: me ? me.facing : 0, b: 0 };
    if (!me || s.phase === PHASE.COUNTDOWN || s.phase === PHASE.ENDED) {
      this.hold = 0;
      return o;
    }
    if (--this.cool <= 0) {
      this.cool = this.cfg.react + Math.floor(this.rng() * 4);
      this.err = (this.rng() * 2 - 1) * this.cfg.err;
    }
    if (this.rest > 0) this.rest--;

    const ctx = this.context(s, me, humans);
    if (s.phase === PHASE.GOAL) this.moveTo(o, me, ctx.home.x, ctx.home.y);
    else if (ctx.isKeeper) this.keeper(s, me, ctx, o);
    else if (ctx.isChaser && !ctx.kickoffWait) this.attack(s, me, ctx, o);
    else this.support(s, me, ctx, o);

    // Kick button handling: hold for a few ticks, then rest so the next press is a new edge.
    if (this.hold > 0) {
      this.hold--;
      o.b |= BTN.KICK;
      if (this.hold === 0) this.rest = 4;
    }
    return o;
  }

  context(s, me, humans) {
    const f = s.field;
    const b = s.ball;
    const dir = me.team === 0 ? 1 : -1;
    const mates = teamPlayers(s, me.team);
    const opps = s.players.filter((p) => p.team !== me.team);
    const n = mates.length;
    const keeperP = n >= 3 ? mates[n - 1] : null;

    let chaser = null;
    let best = Infinity;
    for (const m of mates) {
      if (m === keeperP) continue;
      let d = Math.hypot(b.x - m.x, b.y - m.y);
      if ((b.x - m.x) * dir > 0) d -= 25; // goal-side of the ball is better
      if (humans && humans.has(m.id)) d -= 45;
      if (d < best) {
        best = d;
        chaser = m;
      }
    }
    const outfield = mates.filter((m) => m !== keeperP);
    const rank = Math.max(0, outfield.indexOf(me));
    const isKeeper = keeperP === me;
    const homeX = (isKeeper ? -0.82 : -0.35) * f.hw * dir;
    return {
      f, b, dir, mates, opps, outfield, rank,
      isKeeper,
      isChaser: chaser === me || (!chaser && !isKeeper),
      home: { x: homeX, y: (rank - (outfield.length - 1) / 2) * f.hh * 0.5 },
      goalX: dir * f.hw,
      ownX: -dir * f.hw,
      kickoffWait: s.phase === PHASE.KICKOFF && s.ko !== me.team,
    };
  }

  moveTo(o, me, tx, ty, fast = true) {
    const dx = tx - me.x;
    const dy = ty - me.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) return;
    const mag = clamp(d / (fast ? 22 : 36), 0, 1) * this.cfg.speed;
    o.mx = (dx / d) * mag;
    o.my = (dy / d) * mag;
  }

  /** Where the ball will roughly be when we can reach it. */
  intercept(s, me) {
    const b = s.ball;
    const f = s.field;
    const spd = P.SPEED * this.cfg.speed * 1.1;
    let px = b.x;
    let py = b.y;
    for (let t = 0; t <= 60; t += 3) {
      const k = (1 - B.FRICTION ** t) / (1 - B.FRICTION);
      px = clamp(b.x + b.vx * k, -f.hw + 10, f.hw - 10);
      py = clamp(b.y + b.vy * k, -f.hh + 10, f.hh - 10);
      if (Math.hypot(px - me.x, py - me.y) - CONTACT <= t * spd) break;
    }
    return { x: px, y: py };
  }

  /** Steer behind the ball relative to `ang` and kick when lined up (if `shoot`). */
  strike(s, me, o, ang, shoot) {
    const ip = this.intercept(s, me);
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const rel = (me.x - ip.x) * ax + (me.y - ip.y) * ay;
    const d = Math.hypot(ip.x - me.x, ip.y - me.y);
    let tx;
    let ty;
    if (rel > -CONTACT * 0.6 && d < 120) {
      // Wrong side of the ball: loop around it.
      const side = (me.x - ip.x) * -ay + (me.y - ip.y) * ax >= 0 ? 1 : -1;
      tx = ip.x - ax * (CONTACT + 14) - ay * side * (CONTACT + 12);
      ty = ip.y - ay * (CONTACT + 14) + ax * side * (CONTACT + 12);
    } else if (d > 140) {
      tx = ip.x - ax * CONTACT;
      ty = ip.y - ay * CONTACT;
    } else {
      // Run through the ball: pushes it along `ang`.
      tx = ip.x + ax * 10;
      ty = ip.y + ay * 10;
    }
    const f = s.field;
    const lim = P.R - PHYS.EDGE;
    const cx = clamp(tx, -f.hw + lim, f.hw - lim);
    const cy = clamp(ty, -f.hh + lim, f.hh - lim);
    const b = s.ball;
    const bd = Math.hypot(b.x - me.x, b.y - me.y);
    // The spot behind the ball is outside the pitch (ball in a corner / on the boards), or we
    // have not moved for a while: stop lining up and just go at the ball to dig it out.
    const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY);
    this.lastX = me.x;
    this.lastY = me.y;
    this.still = moved < 0.4 && bd < 90 ? this.still + 1 : 0;
    const dig = Math.hypot(cx - tx, cy - ty) > 6 || this.still > 30;
    if (dig) {
      // Work the ball back toward the middle of the pitch: get on its wall side, then push.
      const ox = -Math.sign(b.x) * (Math.abs(b.x) > f.hw - 40 ? 1 : 0) + Math.cos(ang) * 0.5;
      const oy = -Math.sign(b.y) * (Math.abs(b.y) > f.hh - 40 ? 1 : 0);
      const ol = Math.hypot(ox, oy) || 1;
      const ux = ox / ol;
      const uy = oy / ol;
      const bx = clamp(b.x - ux * (CONTACT - 2), -f.hw + lim, f.hw - lim);
      const by = clamp(b.y - uy * (CONTACT - 2), -f.hh + lim, f.hh - lim);
      const behind = (me.x - b.x) * ux + (me.y - b.y) * uy < -4;
      if (behind) this.moveTo(o, me, b.x + ux * 20, b.y + uy * 20);
      else this.moveTo(o, me, bx, by);
    } else this.moveTo(o, me, cx, cy);
    if (this.hold || this.rest) return;
    if (bd > REACH + 6) return;
    const bodyAng = Math.atan2(b.y - me.y, b.x - me.x);
    const diff = Math.abs(angleDiff(bodyAng, ang));
    const kx = Math.cos(bodyAng);
    const ky = Math.sin(bodyAng);
    // Never kick straight into nearby boards: the ball would just bounce back.
    const intoWall = (Math.abs(b.y) > f.hh - 45 && ky * Math.sign(b.y) > 0.45)
      || (Math.abs(b.x) > f.hw - 45 && Math.abs(b.y) > f.gh && kx * Math.sign(b.x) > 0.45);
    if (intoWall) return;
    // Ball on the boards / in a corner: accept any kick that still goes our way.
    const onBoards = Math.abs(b.y) > f.hh - 30 || Math.abs(b.x) > f.hw - 30;
    const ourWay = kx * Math.cos(ang) > 0;
    if ((shoot && diff < this.cfg.tol) || ((onBoards || dig) && diff < 1.3 && ourWay)) this.hold = 6;
  }

  shotAngle(s, ctx) {
    const { f, b, opps, goalX } = ctx;
    const ys = [-f.gh + B.R + 8, f.gh - B.R - 8, 0, -f.gh * 0.5, f.gh * 0.5];
    let best = null;
    for (const y of ys) {
      let clearance = Infinity;
      for (const q of opps) clearance = Math.min(clearance, distToSegment(q.x, q.y, b.x, b.y, goalX, y) - P.R);
      if (!best || clearance > best.clearance) best = { y, clearance };
    }
    return { ang: Math.atan2(best.y - b.y, goalX - b.x) + this.err, clear: best.clearance };
  }

  openMate(s, me, ctx) {
    const { b, opps, mates, dir } = ctx;
    let best = null;
    let bestScore = -Infinity;
    for (const m of mates) {
      if (m === me) continue;
      const d = Math.hypot(m.x - b.x, m.y - b.y);
      if (d < 90 || d > 520) continue;
      let lane = Infinity;
      for (const q of opps) lane = Math.min(lane, distToSegment(q.x, q.y, b.x, b.y, m.x, m.y));
      if (lane < CONTACT + 12) continue;
      const forward = (m.x - b.x) * dir;
      if (forward < 20) continue;
      const score = forward + Math.min(lane, 120);
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  attack(s, me, ctx, o) {
    const { f, b, goalX, opps } = ctx;
    const dGoal = Math.hypot(goalX - b.x, b.y);
    const shot = this.shotAngle(s, ctx);
    const inRange = dGoal < this.cfg.range * f.w;
    if (inRange && (shot.clear > 0 || dGoal < f.w * 0.15)) {
      this.strike(s, me, o, shot.ang, true);
      return;
    }
    // Under pressure: pass to an open teammate further forward.
    let pressure = Infinity;
    for (const q of opps) pressure = Math.min(pressure, Math.hypot(q.x - b.x, q.y - b.y));
    if (pressure < 80) {
      const mate = this.openMate(s, me, ctx);
      if (mate) {
        this.strike(s, me, o, Math.atan2(mate.y - b.y, mate.x - b.x) + this.err, true);
        return;
      }
    }
    // Otherwise dribble (push) toward goal, drifting away from the boards.
    const ty = clamp(-b.y * 0.6, -f.hh, f.hh);
    this.strike(s, me, o, Math.atan2(ty - b.y * 0.3, goalX - b.x), false);
  }

  keeper(s, me, ctx, o) {
    const { f, b, dir, ownX, mates } = ctx;
    const homeX = ownX + dir * (P.R + 12);
    const dOwn = Math.hypot(b.x - ownX, b.y);
    const myD = Math.hypot(b.x - me.x, b.y - me.y);
    let closest = true;
    for (const m of mates) if (m !== me && Math.hypot(b.x - m.x, b.y - m.y) < myD - 10) closest = false;
    if (dOwn < f.w * 0.11 || (dOwn < f.w * 0.2 && closest)) {
      // Clear it upfield, toward the nearer side.
      this.strike(s, me, o, Math.atan2((b.y >= 0 ? 1 : -1) * 0.5, dir), true);
      return;
    }
    let ty = clamp(b.y * 0.55, -f.gh + 8, f.gh - 8);
    if (b.vx * dir < -1) {
      const t = (homeX - b.x) / b.vx;
      if (t > 0 && t < 90) ty = clamp(b.y + b.vy * t, -f.gh + 4, f.gh - 4);
    }
    const tx = homeX + dir * clamp((f.w * 0.5 - dOwn) * 0.05, 0, 26);
    this.moveTo(o, me, tx, ty, false);
  }

  support(s, me, ctx, o) {
    const { f, b, dir, opps, outfield, rank, mates, ownX } = ctx;
    const m = Math.max(1, outfield.length);
    const lanes = m === 1 ? [0] : m === 2 ? [-0.42, 0.42] : m === 3 ? [-0.55, 0, 0.55] : [-0.6, -0.2, 0.2, 0.6];
    const laneY = lanes[Math.min(rank, lanes.length - 1)] * f.hh;
    const attacking = b.lt === me.team;
    let tx;
    let ty;
    if (s.phase === PHASE.KICKOFF) {
      tx = ctx.home.x;
      ty = ctx.home.y;
    } else if (attacking) {
      tx = clamp(b.x + dir * (150 + rank * 30), -f.hw + 90, f.hw - 90);
      ty = laneY * 0.9 + b.y * 0.2;
    } else {
      tx = lerp(ownX, b.x, 0.5);
      ty = laneY * 0.6 + b.y * 0.35;
      let mark = null;
      let md = Infinity;
      for (const q of opps) {
        if (q.id === b.owner) continue;
        const dGoal = Math.abs(q.x - ownX);
        const score = dGoal + Math.abs(q.y - laneY) * 1.5;
        if (score < md && dGoal < f.w * 0.6) {
          md = score;
          mark = q;
        }
      }
      if (mark) {
        tx = lerp(mark.x, ownX, 0.22);
        ty = lerp(mark.y, 0, 0.15);
      }
    }
    for (const q of mates) {
      if (q === me) continue;
      const dx = tx - q.x;
      const dy = ty - q.y;
      const d = Math.hypot(dx, dy);
      if (d < 90 && d > 0) {
        tx += (dx / d) * (90 - d) * 0.6;
        ty += (dy / d) * (90 - d) * 0.6;
      }
    }
    this.moveTo(o, me, clamp(tx, -f.hw + 30, f.hw - 30), clamp(ty, -f.hh + 30, f.hh - 30), false);
  }
}
