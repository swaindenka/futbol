// Bot AI: produces inputs for a player each tick. Runs on the server (online bots)
// and in the browser (practice mode / animated menu background).

import { P, B, BTN, PHASE } from './constants.js';
import { teamPlayers, findPlayer, inReach, PHYS } from './physics.js';
import { clamp, distToSegment, angleDiff, lerp } from './util.js';

const LEVELS = [
  { name: 'Kolay', react: 16, speed: 0.82, aimErr: 0.2, tackle: 0.2, range: 0.34, sprint: 0.3, poke: 0.15 },
  { name: 'Orta', react: 8, speed: 0.93, aimErr: 0.1, tackle: 0.45, range: 0.4, sprint: 0.65, poke: 0.3 },
  { name: 'Zor', react: 3, speed: 1.0, aimErr: 0.045, tackle: 0.75, range: 0.46, sprint: 1, poke: 0.5 },
];

export const BOT_LEVEL_NAMES = LEVELS.map((l) => l.name);

const CONTACT = PHYS.CONTACT;

export class BotBrain {
  constructor(id, level = 1, rng = Math.random) {
    this.id = id;
    this.cfg = LEVELS[clamp(level | 0, 0, 2)];
    this.rng = rng;
    this.cool = Math.floor(rng() * this.cfg.react);
    this.action = null;
    this.sprintMode = false;
    this.dribbleBias = rng() < 0.5 ? -1 : 1;
  }

  /**
   * @param {object} s simulation state
   * @param {Set<number>} [humans] ids of human players (bots defer the ball to human teammates)
   */
  update(s, humans) {
    const me = findPlayer(s, this.id);
    const o = { mx: 0, my: 0, a: me ? me.facing : 0, b: 0 };
    if (!me || s.phase === PHASE.COUNTDOWN || s.phase === PHASE.ENDED) {
      this.action = null;
      return o;
    }
    if (me.stun || me.slide || me.rec) {
      this.action = null;
      return o;
    }

    const ctx = this.context(s, me, humans);

    if (this.action) {
      this.runAction(s, me, ctx, o);
      return o;
    }

    let decide = false;
    if (--this.cool <= 0) {
      decide = true;
      this.cool = this.cfg.react + Math.floor(this.rng() * 4);
      this.sprintMode = this.rng() < this.cfg.sprint;
    }

    if (s.phase === PHASE.GOAL) {
      this.moveTo(o, me, ctx.home.x, ctx.home.y, false);
      return o;
    }

    if (ctx.hasBall) this.withBall(s, me, ctx, o, decide);
    else if (ctx.isKeeper) this.keeper(s, me, ctx, o, decide);
    else if (ctx.isChaser) this.chase(s, me, ctx, o, decide);
    else this.support(s, me, ctx, o);
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
    const isKeeper = keeperP === me;
    const hasBall = b.owner === me.id;

    // Who chases? Fastest outfield player to reach the ball; humans get priority.
    let chaser = null;
    let best = Infinity;
    for (const m of mates) {
      if (m === keeperP) continue;
      let d = Math.hypot(b.x - m.x, b.y - m.y);
      // Being goal-side of the ball is a bonus.
      if ((b.x - m.x) * dir > 0) d -= 25;
      if (humans && humans.has(m.id)) d -= 45;
      if (d < best) {
        best = d;
        chaser = m;
      }
    }
    const isChaser = chaser === me || (!chaser && !isKeeper);

    const outfield = mates.filter((m) => m !== keeperP);
    const rank = Math.max(0, outfield.indexOf(me));

    const spotX = (n >= 3 && isKeeper ? -0.82 : -0.35) * f.hw * dir;
    const home = { x: spotX, y: (rank - (outfield.length - 1) / 2) * f.hh * 0.5 };

    return {
      f, b, dir, mates, opps, n, isKeeper, hasBall, isChaser, outfield, rank, home,
      goalX: dir * f.hw,
      ownX: -dir * f.hw,
      kickoffWait: s.phase === PHASE.KICKOFF && s.ko !== me.team,
    };
  }

  setAction(btn, hold, aim) {
    this.action = { btn, hold: Math.max(1, Math.round(hold)), aim, t: 0 };
  }

  runAction(s, me, ctx, o) {
    const a = this.action;
    a.t++;
    o.a = a.aim;
    const b = ctx.b;
    if (a.t <= a.hold) {
      o.b = a.btn;
      // Shuffle toward the ball while winding up so it stays in reach.
      const dx = b.x - me.x;
      const dy = b.y - me.y;
      const d = Math.hypot(dx, dy);
      if (d > CONTACT + 2) {
        o.mx = (dx / d) * 0.6;
        o.my = (dy / d) * 0.6;
      }
      if (a.btn & (BTN.SHOOT | BTN.LOB) && d > 90) {
        this.action = null; // ball is gone, abort
        o.b = 0;
      }
    } else {
      o.b = 0;
      this.action = null;
    }
  }

  moveTo(o, me, tx, ty, sprintOk) {
    const dx = tx - me.x;
    const dy = ty - me.y;
    const d = Math.hypot(dx, dy);
    if (d < 3) return;
    const mag = clamp(d / 36, 0, 1) * this.cfg.speed;
    o.mx = (dx / d) * mag;
    o.my = (dy / d) * mag;
    if (sprintOk && this.sprintMode && d > 130 && me.stamina > 35 && !me.exh) o.b |= BTN.SPRINT;
  }

  intercept(s, me) {
    const b = s.ball;
    const f = s.field;
    const spd = P.SPEED * this.cfg.speed * 1.15;
    let px = b.x;
    let py = b.y;
    for (let t = 0; t <= 60; t += 3) {
      const k = (1 - B.FRICTION ** t) / (1 - B.FRICTION);
      px = clamp(b.x + b.vx * k, -f.hw + 10, f.hw - 10);
      py = clamp(b.y + b.vy * k, -f.hh + 10, f.hh - 10);
      const reach = Math.hypot(px - me.x, py - me.y) - CONTACT;
      if (reach <= t * spd) return { x: px, y: py, t };
    }
    return { x: px, y: py, t: 60 };
  }

  chase(s, me, ctx, o, decide) {
    const { f, b, dir, goalX } = ctx;
    if (ctx.kickoffWait) {
      this.support(s, me, ctx, o);
      return;
    }
    const ip = this.intercept(s, me);
    let ax = goalX - ip.x;
    let ay = -ip.y * 0.6;
    const al = Math.hypot(ax, ay) || 1;
    ax /= al;
    ay /= al;
    const rel = (me.x - ip.x) * ax + (me.y - ip.y) * ay;
    const d = Math.hypot(ip.x - me.x, ip.y - me.y);
    let tx;
    let ty;
    if (rel > -4 && d < 130) {
      // Wrong side of the ball: loop around it.
      const side = (me.x - ip.x) * -ay + (me.y - ip.y) * ax >= 0 ? 1 : -1;
      tx = ip.x - ax * (CONTACT + 16) + -ay * side * (CONTACT + 14);
      ty = ip.y - ay * (CONTACT + 16) + ax * side * (CONTACT + 14);
    } else if (d > 160) {
      tx = ip.x;
      ty = ip.y;
    } else {
      tx = ip.x - ax * (CONTACT - 4);
      ty = ip.y - ay * (CONTACT - 4);
    }
    this.moveTo(o, me, clamp(tx, -f.hw, f.hw), clamp(ty, -f.hh, f.hh), true);
    o.a = Math.atan2(ay, ax);

    if (!decide) return;
    // Defensive actions against an opponent in possession.
    const owner = b.owner >= 0 ? findPlayer(s, b.owner) : null;
    if (owner && owner.team !== me.team) {
      const od = Math.hypot(owner.x - me.x, owner.y - me.y);
      const face = Math.abs(angleDiff(me.facing, Math.atan2(owner.y - me.y, owner.x - me.x)));
      if (od < 50 && face < 0.7 && me.tcd === 0 && this.rng() < this.cfg.tackle * 0.45) {
        o.mx = Math.cos(me.facing);
        o.my = Math.sin(me.facing);
        this.setAction(BTN.TACKLE, 1, me.facing);
        o.b = BTN.TACKLE;
        return;
      }
      if (inReach(me, b) && this.rng() < this.cfg.poke) {
        this.setAction(BTN.SHOOT, 2, Math.atan2(-b.y * 0.5, goalX - b.x));
        return;
      }
    }
    // Loose ball in reach near our goal: clear it.
    if (!owner && inReach(me, b) && Math.abs(b.x - ctx.ownX) < f.w * 0.25) {
      const aim = Math.atan2(clamp(-b.y, -1, 1) * 0.3 + (this.rng() - 0.5) * 0.8, dir);
      this.setAction(BTN.SHOOT, 30 + this.rng() * 15, aim);
    }
    void dir;
  }

  bestShot(s, me, ctx) {
    const { f, b, opps, goalX } = ctx;
    const ys = [-f.gh + B.R + 8, f.gh - B.R - 8, 0, -f.gh * 0.5, f.gh * 0.5];
    let best = null;
    for (const y of ys) {
      let clearance = Infinity;
      for (const q of opps) {
        const dd = distToSegment(q.x, q.y, b.x, b.y, goalX, y) - P.R;
        if (dd < clearance) clearance = dd;
      }
      if (!best || clearance > best.clearance) best = { y, clearance };
    }
    return best;
  }

  findPass(s, me, ctx, mustForward) {
    const { b, opps, mates, dir } = ctx;
    let best = null;
    let bestScore = -Infinity;
    for (const m of mates) {
      if (m === me) continue;
      const d = Math.hypot(m.x - b.x, m.y - b.y);
      if (d < 70 || d > 700) continue;
      let lane = Infinity;
      for (const q of opps) {
        const dd = distToSegment(q.x, q.y, b.x, b.y, m.x, m.y);
        if (dd < lane) lane = dd;
      }
      if (lane < CONTACT + 10) continue;
      let space = Infinity;
      for (const q of opps) space = Math.min(space, Math.hypot(q.x - m.x, q.y - m.y));
      const forward = (m.x - me.x) * dir;
      if (mustForward && forward < -40) continue;
      const score = forward * 0.6 + Math.min(space, 200) * 0.8 + Math.min(lane, 120) * 0.4 - d * 0.15;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  withBall(s, me, ctx, o, decide) {
    const { f, b, dir, opps, goalX } = ctx;
    const dGoal = Math.hypot(goalX - me.x, me.y * 0.8);

    // Dribble direction toward goal with avoidance.
    let vx = goalX - me.x;
    let vy = -me.y * 0.7;
    const vl = Math.hypot(vx, vy) || 1;
    vx /= vl;
    vy /= vl;
    let pressure = Infinity;
    for (const q of opps) {
      const dx = me.x - q.x;
      const dy = me.y - q.y;
      const d = Math.hypot(dx, dy);
      const ahead = (q.x - me.x) * dir > -10;
      if (ahead) pressure = Math.min(pressure, d);
      if (d < 150 && d > 0) {
        const w = ((150 - d) / 150) * 1.4;
        // Sidestep perpendicular to the threat rather than straight away.
        const px = -dy / d;
        const py = dx / d;
        const side = px * vx + py * vy >= 0 ? 1 : -1;
        vx += (dx / d) * w * 0.35 + px * side * w * 0.6;
        vy += (dy / d) * w * 0.35 + py * side * w * 0.6;
      }
    }
    // Stay off the boards.
    if (me.y > f.hh - 70) vy -= 0.8;
    if (me.y < -f.hh + 70) vy += 0.8;
    const l2 = Math.hypot(vx, vy) || 1;
    o.mx = (vx / l2) * this.cfg.speed;
    o.my = (vy / l2) * this.cfg.speed;
    if (this.sprintMode && pressure > 90 && me.stamina > 45 && !me.exh) o.b |= BTN.SPRINT;

    if (!decide) return;
    if (s.phase === PHASE.KICKOFF) {
      const mate = this.findPass(s, me, ctx, false);
      if (mate) {
        this.setAction(BTN.PASS, 1, Math.atan2(mate.y - b.y, mate.x - b.x));
        return;
      }
    }
    const err = (this.rng() * 2 - 1) * this.cfg.aimErr;
    const shot = this.bestShot(s, me, ctx);
    const range = this.cfg.range * f.w;
    if (dGoal < range && (shot.clearance > CONTACT || dGoal < f.w * 0.15)) {
      const aim = Math.atan2(shot.y - b.y, goalX - b.x) + err;
      const c = clamp(0.4 + dGoal / (f.w * 0.45), 0.45, 1);
      this.setAction(BTN.SHOOT, c * 45, aim);
      return;
    }
    if (pressure < 75 || (this.rng() < 0.08 && dGoal > range)) {
      const mate = this.findPass(s, me, ctx, pressure > 75);
      if (mate) {
        this.setAction(BTN.PASS, 1, Math.atan2(mate.y - b.y, mate.x - b.x) + err * 0.5);
        return;
      }
      if (pressure < 45 && this.rng() < 0.35) {
        // Chip it over the defender toward goal.
        const aim = Math.atan2(-b.y * 0.5, goalX - b.x) + err;
        this.setAction(BTN.LOB, 15 + this.rng() * 25, aim);
      }
    }
  }

  keeper(s, me, ctx, o, decide) {
    const { f, b, dir, ownX, mates } = ctx;
    const homeX = ownX + dir * (P.R + 12);
    const dOwn = Math.hypot(b.x - ownX, b.y);
    let closest = true;
    const myD = Math.hypot(b.x - me.x, b.y - me.y);
    for (const m of mates) if (m !== me && Math.hypot(b.x - m.x, b.y - m.y) < myD - 10) closest = false;
    const owner = b.owner >= 0 ? findPlayer(s, b.owner) : null;
    const threat = !owner || owner.team !== me.team;
    if (threat && b.z < 30 && (dOwn < f.w * 0.11 || (dOwn < f.w * 0.2 && closest))) {
      const ip = this.intercept(s, me);
      this.moveTo(o, me, ip.x - dir * 6, ip.y, true);
      if (decide && inReach(me, b)) {
        const aim = Math.atan2((b.y >= 0 ? 1 : -1) * 0.55, dir);
        this.setAction(this.rng() < 0.5 ? BTN.LOB : BTN.SHOOT, 30 + this.rng() * 15, aim);
      }
      return;
    }
    let ty = clamp(b.y * 0.55, -f.gh + 8, f.gh - 8);
    if (b.vx * dir < -1) {
      const t = (homeX - b.x) / b.vx;
      if (t > 0 && t < 90) ty = clamp(b.y + b.vy * t, -f.gh + 4, f.gh - 4);
    }
    const tx = homeX + dir * clamp((f.w * 0.5 - dOwn) * 0.05, 0, 26);
    this.moveTo(o, me, tx, ty, false);
    o.a = Math.atan2(b.y - me.y, b.x - me.x);
  }

  support(s, me, ctx, o) {
    const { f, b, dir, opps, outfield, rank, mates, ownX } = ctx;
    const m = Math.max(1, outfield.length);
    const lanes = m === 1 ? [0] : m === 2 ? [-0.42, 0.42] : m === 3 ? [-0.55, 0, 0.55] : [-0.6, -0.2, 0.2, 0.6];
    const laneY = lanes[Math.min(rank, lanes.length - 1)] * f.hh;
    const attacking = b.lt === me.team;
    let tx;
    let ty;
    if (ctx.kickoffWait || s.phase === PHASE.KICKOFF) {
      tx = ctx.home.x;
      ty = ctx.home.y;
    } else if (attacking) {
      tx = clamp(b.x + dir * (150 + rank * 30), -f.hw + 90, f.hw - 90);
      ty = laneY * 0.9 + b.y * 0.2;
    } else {
      tx = lerp(ownX, b.x, 0.5);
      ty = laneY * 0.6 + b.y * 0.35;
      // Mark the most dangerous free opponent in our lane.
      let mark = null;
      let md = Infinity;
      for (const q of opps) {
        if (q.id === b.owner) continue;
        const dGoal = Math.abs(q.x - ownX);
        const laneDist = Math.abs(q.y - laneY);
        const score = dGoal + laneDist * 1.5;
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
    // Keep spacing from teammates.
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
    this.moveTo(o, me, clamp(tx, -f.hw + 30, f.hw - 30), clamp(ty, -f.hh + 30, f.hh - 30), !attacking);
    o.a = Math.atan2(b.y - me.y, b.x - me.x);
  }
}
