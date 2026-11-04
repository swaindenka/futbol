// A running match on the client. Modes:
//  - 'online'   : server authoritative; we predict the whole world locally and reconcile on snapshots
//  - 'practice' : fully local match against bots
//  - 'demo'     : bots only, used as the animated menu background

import {
  makeState, addPlayer, resetKickoff, step, findPlayer, previewBallPath, kickVector, inReach,
} from '../../shared/physics.js';
import { decodeSnapshot } from '../../shared/protocol.js';
import { BotBrain } from '../../shared/bot.js';
import { MatchStats } from '../../shared/stats.js';
import {
  KITS, PHASE, TICK_MS, K, BTN, EMOTES, BOT_NAMES, fieldForTeamSize,
} from '../../shared/constants.js';
import { lerp } from '../../shared/util.js';
import { Effects } from './effects.js';

const SNAP_PLAYER = 90;
const SNAP_BALL = 170;
const REPLAY_BEFORE = 110;
const REPLAY_AFTER = 24;
const REPLAY_SPEED = 0.6;
const REPLAY_DELAY = 1900;

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Session {
  constructor(app, opts) {
    this.app = app;
    this.mode = opts.mode;
    this.myId = opts.myId ?? -1;
    this.settings = opts.settings;
    this.kits = this.settings.kits.map((i) => KITS[i] || KITS[0]);
    this.meta = new Map();
    this.fx = new Effects();
    this.fx.quality = app.prefs.quality;
    this.brains = new Map();
    this.humans = new Set();
    this.stats = null;
    this.history = [];
    this.seq = 0;
    this.prev = new Map();
    this.prevBall = { x: 0, y: 0, z: 0 };
    this.off = new Map();
    this.ballOff = { x: 0, y: 0, z: 0 };
    this.acc = 0;
    this.lastFrame = null;
    this.replayBuf = [];
    this.replay = null;
    this.replayTimer = null;
    this.emotes = new Map();
    this.ended = false;
    this.destroyed = false;
    this.lastCount = -1;
    this.goalCount = 0;

    if (this.mode === 'online') {
      this.base = { field: opts.fieldKey, rules: opts.rules };
      this.state = decodeSnapshot(opts.snap, this.base);
      this.setRoster(opts.roster || []);
    } else this.setupLocal(opts);

    this.field = this.state.field;
    this.effectsTick = this.state.tick;
    app.renderer.prepare(this.field, this.kits);
    app.renderer.setLedMessages([
      'FUTBOL ARENA',
      `${this.kits[0].name.toLocaleUpperCase('tr')} — ${this.kits[1].name.toLocaleUpperCase('tr')}`,
      'GERÇEK ZAMANLI 4v4',
      'FAIR PLAY',
    ]);
    this.savePrev();
  }

  setupLocal(opts) {
    const demo = this.mode === 'demo';
    const n = demo ? opts.teamSize || 4 : opts.teamSize || 3;
    const fieldKey = opts.fieldKey || fieldForTeamSize(n);
    this.state = makeState(fieldKey, this.settings);
    this.stats = new MatchStats();
    const names = shuffled(BOT_NAMES);
    let id = 1;
    let ni = 0;
    for (let team = 0; team < 2; team++) {
      for (let i = 0; i < n; i++) {
        const isMe = !demo && team === 0 && i === 0;
        const pid = id++;
        addPlayer(this.state, pid, team, i);
        const meta = isMe
          ? { id: pid, name: this.app.prefs.name, number: this.app.prefs.number, team, bot: false }
          : { id: pid, name: names[ni++ % names.length], number: [1, 4, 7, 9, 10, 11, 8, 6][(i + team * 3) % 8], team, bot: true };
        if (isMe) {
          this.myId = pid;
          this.humans.add(pid);
        } else this.brains.set(pid, new BotBrain(pid, opts.level ?? 1));
        this.meta.set(pid, meta);
        this.stats.ensure(meta);
      }
    }
    resetKickoff(this.state);
    if (demo) {
      this.state.phase = PHASE.KICKOFF;
      this.state.pt = 0;
    }
  }

  setRoster(list) {
    this.meta.clear();
    for (const r of list) this.meta.set(r.id, r);
  }

  myPlayer() {
    return this.myId >= 0 ? findPlayer(this.state, this.myId) : null;
  }

  isPlaying() {
    return !!this.myPlayer();
  }

  destroy() {
    this.destroyed = true;
    if (this.replayTimer) clearTimeout(this.replayTimer);
  }

  // ---------------------------------------------------------------------------

  savePrev() {
    for (const p of this.state.players) {
      let pr = this.prev.get(p.id);
      if (!pr) {
        pr = { x: p.x, y: p.y };
        this.prev.set(p.id, pr);
      }
      pr.x = p.x;
      pr.y = p.y;
    }
    const b = this.state.ball;
    this.prevBall.x = b.x;
    this.prevBall.y = b.y;
    this.prevBall.z = b.z;
  }

  renderPos(p, alpha = 1) {
    const pr = this.prev.get(p.id) || p;
    const o = this.off.get(p.id);
    return {
      x: lerp(pr.x, p.x, alpha) + (o ? o.x : 0),
      y: lerp(pr.y, p.y, alpha) + (o ? o.y : 0),
      facing: p.facing,
    };
  }

  tick() {
    const s = this.state;
    this.savePrev();
    const me = this.myPlayer();
    let inp = null;
    if (me) {
      const control = !this.replay && this.app.canControl();
      inp = control
        ? this.app.input.sample(this.renderPos(me), this.app.renderer.cam)
        : { mx: 0, my: 0, a: me.in.a, b: 0 };
    }

    if (this.mode === 'online') {
      if (me) {
        this.seq++;
        this.app.net.send({ t: 'i', s: this.seq, x: inp.mx, y: inp.my, a: inp.a, b: inp.b });
        this.history.push({ s: this.seq, mx: inp.mx, my: inp.my, a: inp.a, b: inp.b });
        if (this.history.length > 240) this.history.shift();
        me.in = { mx: inp.mx, my: inp.my, a: inp.a, b: inp.b };
      }
      const ev = step(s, false);
      this.localEvents(ev);
      return;
    }

    for (const p of s.players) {
      if (p.id === this.myId) p.in = inp;
      else {
        const brain = this.brains.get(p.id);
        if (brain) p.in = brain.update(s, this.humans);
      }
    }
    const ev = step(s, true);
    this.stats.tick(s);
    if (ev.length) {
      this.stats.events(s, ev);
      for (const e of ev) this.handleEvent(e);
    }
    if (s.tick % 2 === 0) this.recordFrame(s);
    if (this.mode === 'demo' && s.phase === PHASE.GOAL && s.pt > 120) s.pt = 120;
  }

  localEvents(ev) {
    const s = this.state;
    if (s.tick <= this.effectsTick) return;
    this.effectsTick = s.tick;
    for (const e of ev) {
      if (e.p === this.myId && (e.e === 'kick' || e.e === 'slide' || e.e === 'trap')) this.handleEvent(e);
    }
  }

  onSnapshot(ack, d) {
    if (this.destroyed) return;
    const old = new Map();
    for (const p of this.state.players) {
      const o = this.off.get(p.id);
      old.set(p.id, { x: p.x + (o ? o.x : 0), y: p.y + (o ? o.y : 0) });
    }
    const ob = this.state.ball;
    const oldBall = { x: ob.x + this.ballOff.x, y: ob.y + this.ballOff.y, z: ob.z + this.ballOff.z };
    const prevPhase = this.state.phase;

    const ns = decodeSnapshot(d, this.base);
    this.recordFrame(ns);
    const reset = (prevPhase === PHASE.GOAL || prevPhase === PHASE.COUNTDOWN) && ns.phase === PHASE.KICKOFF;
    this.state = ns;

    while (this.history.length && this.history[0].s <= ack) this.history.shift();
    const me = this.myPlayer();
    if (!me) this.history.length = 0;
    if (this.history.length) {
      for (const h of this.history) {
        this.savePrev();
        me.in = { mx: h.mx, my: h.my, a: h.a, b: h.b };
        this.localEvents(step(ns, false));
      }
    } else {
      for (const p of ns.players) {
        const pr = this.prev.get(p.id) || {};
        pr.x = p.x - p.vx;
        pr.y = p.y - p.vy;
        this.prev.set(p.id, pr);
      }
      this.prevBall.x = ns.ball.x - ns.ball.vx;
      this.prevBall.y = ns.ball.y - ns.ball.vy;
      this.prevBall.z = ns.ball.z;
    }

    // Visual error smoothing
    const seen = new Set();
    for (const p of ns.players) {
      seen.add(p.id);
      const o = old.get(p.id);
      let off = this.off.get(p.id);
      if (!off) {
        off = { x: 0, y: 0 };
        this.off.set(p.id, off);
      }
      if (!o || reset) {
        off.x = off.y = 0;
        if (!o) this.prev.set(p.id, { x: p.x, y: p.y });
        continue;
      }
      const dx = o.x - p.x;
      const dy = o.y - p.y;
      if (dx * dx + dy * dy > SNAP_PLAYER * SNAP_PLAYER) off.x = off.y = 0;
      else {
        off.x = dx;
        off.y = dy;
      }
    }
    for (const id of this.off.keys()) if (!seen.has(id)) this.off.delete(id);
    const b = ns.ball;
    const bx = oldBall.x - b.x;
    const by = oldBall.y - b.y;
    if (reset || bx * bx + by * by > SNAP_BALL * SNAP_BALL) this.ballOff = { x: 0, y: 0, z: 0 };
    else this.ballOff = { x: bx, y: by, z: oldBall.z - b.z };
    if (reset) this.savePrev();

    for (const e of ns.events) {
      if (e.p === this.myId && (e.e === 'kick' || e.e === 'slide' || e.e === 'trap')) continue;
      this.handleEvent(e);
    }
    if (this.replay && ns.phase === PHASE.KICKOFF) this.stopReplay();
  }

  // ---------------------------------------------------------------------------
  // Events -> effects / audio / HUD

  name(id) {
    const m = this.meta.get(id);
    return m ? m.name : '';
  }

  handleEvent(e) {
    const { fx } = this;
    const audio = this.mode === 'demo' ? null : this.app.audio;
    const hud = this.mode === 'demo' ? null : this.app.hud;
    const b = this.state.ball;
    switch (e.e) {
      case 'kick': {
        const a = Number.isFinite(e.a) ? e.a : Math.atan2(b.vy, b.vx);
        if (audio) audio.kick(e.v, e.k);
        fx.kick(b.x, b.y, e.v, a);
        if (e.v > 13.5) fx.addShake(2 + (e.v - 13.5) * 1.6);
        break;
      }
      case 'trap':
      case 'poke':
        if (audio) audio.touch();
        break;
      case 'block':
        if (audio) audio.touch();
        fx.ring(b.x, b.y, 'rgba(255,255,255,0.6)', 8, 22, 0.25);
        break;
      case 'wall':
        if (audio) audio.wall(e.v);
        break;
      case 'bounce':
        if (audio) audio.bounce(e.v);
        break;
      case 'post':
        if (audio) audio.post();
        fx.sparks(b.x, b.y, Math.max(b.z, 10));
        fx.addShake(5);
        if (hud) hud.popText(e.bar ? 'ÜST DİREK!' : 'DİREK!');
        break;
      case 'net':
        if (audio) audio.net(e.v);
        fx.netHit(e.s, e.y, e.z, e.v);
        break;
      case 'slide': {
        const p = findPlayer(this.state, e.p);
        if (audio) audio.slide();
        if (p) fx.dust(p.x, p.y, p.facing);
        break;
      }
      case 'tackle': {
        const v = findPlayer(this.state, e.v);
        if (audio) audio.thud();
        if (v) fx.stars(v.x, v.y);
        if (hud && (e.p === this.myId || e.v === this.myId)) hud.feed(e.p === this.myId ? 'Topu kaptın! 💪' : `${this.name(e.p)} topu kaptı`, 'info');
        break;
      }
      case 'foul': {
        const v = findPlayer(this.state, e.v);
        if (audio) {
          audio.thud();
          audio.whistle('short');
        }
        if (v) fx.stars(v.x, v.y);
        if (hud) hud.feed(`Faul! ${this.name(e.p)} → ${this.name(e.v)}`, 'foul');
        break;
      }
      case 'goal':
        this.onGoal(e);
        break;
      case 'whistle':
        if (audio) audio.whistle('long');
        if (hud) hud.banner('BAŞLA!', '', 1200);
        break;
      case 'kickoff':
        if (audio) audio.whistle('short');
        if (this.replay) this.stopReplay();
        break;
      case 'overtime':
        if (audio) audio.whistle('long');
        if (hud) hud.banner('ALTIN GOL', 'İlk golü atan kazanır!', 2600);
        break;
      case 'end':
        this.ended = true;
        if (this.mode === 'demo') {
          setTimeout(() => !this.destroyed && this.app.restartDemo(), 1500);
          break;
        }
        if (audio) audio.whistle('end');
        if (hud) hud.banner('MAÇ SONU', '', 2400);
        if (this.mode === 'practice') {
          setTimeout(() => {
            if (!this.destroyed) this.app.showEnd(this.stats.summary(this.state.score), { practice: true });
          }, 2600);
        }
        break;
      default:
        break;
    }
  }

  onGoal(e) {
    const kit = this.kits[e.t];
    this.goalCount++;
    this.fx.goal([kit.primary, kit.secondary, '#ffffff', '#ffd23f']);
    this.fx.ledFlash = { text: 'GOOOOL!', color: kit.primary, t: 0 };
    if (this.mode === 'demo') return;
    this.app.audio.goal();
    this.app.hud.goal({
      team: e.t,
      kit,
      scorer: this.name(e.p),
      assist: e.a >= 0 ? this.name(e.a) : '',
      own: !!e.own,
      mine: e.p === this.myId,
      score: e.s,
      kits: this.kits,
    });
    if (this.settings.replays && this.app.prefs.replays !== false) {
      const goalTick = this.mode === 'online' ? this.state.tick - this.history.length : this.state.tick;
      if (this.replayTimer) clearTimeout(this.replayTimer);
      this.replayTimer = setTimeout(() => this.startReplay(goalTick), REPLAY_DELAY);
    }
  }

  recordFrame(s) {
    const b = s.ball;
    const frame = {
      t: s.tick,
      b: [b.x, b.y, b.z, b.vx, b.vy],
      p: s.players.map((p) => [p.id, p.team, p.x, p.y, p.facing, p.vx, p.vy, p.ct, p.charge, p.slide, p.stun]),
    };
    const buf = this.replayBuf;
    if (buf.length && buf[buf.length - 1].t >= frame.t) return;
    buf.push(frame);
    if (buf.length > 220) buf.shift();
  }

  startReplay(goalTick) {
    if (this.destroyed) return;
    const from = goalTick - REPLAY_BEFORE;
    const to = goalTick + REPLAY_AFTER;
    const frames = this.replayBuf.filter((f) => f.t >= from && f.t <= to);
    if (frames.length < 12) return;
    this.replay = { frames, t: frames[0].t, end: frames[frames.length - 1].t, i: 0 };
    this.app.hud.setReplay(true);
    this.app.renderer.cam.snap();
  }

  stopReplay() {
    if (!this.replay) return;
    this.replay = null;
    this.app.hud.setReplay(false);
    this.app.renderer.cam.snap();
  }

  skipReplay() {
    if (this.replay) this.stopReplay();
  }

  showEmote(id, idx) {
    const text = EMOTES[idx];
    if (!text) return;
    this.emotes.set(id, { text, age: 0 });
  }

  // ---------------------------------------------------------------------------
  // Views

  buildPlayerView(id, team, x, y, facing, vx, vy, extra) {
    const m = this.meta.get(id);
    const em = this.emotes.get(id);
    return {
      id,
      team,
      x,
      y,
      facing,
      vx,
      vy,
      me: id === this.myId,
      name: m ? m.name : '',
      number: m ? m.number : '',
      emote: em && em.age < 2.4 ? em : null,
      ...extra,
    };
  }

  liveView(alpha) {
    const s = this.state;
    const players = s.players.map((p) => {
      const pos = this.renderPos(p, alpha);
      return this.buildPlayerView(p.id, p.team, pos.x, pos.y, p.facing, p.vx, p.vy, {
        ct: p.ct,
        charge: p.charge / K.CHARGE_TICKS,
        stamina: p.stamina / 100,
        exh: p.exh,
        slide: p.slide,
        stun: p.stun,
        sprint: (p.in.b & BTN.SPRINT) !== 0 && Math.hypot(p.vx, p.vy) > 3,
      });
    });
    const b = s.ball;
    const pb = this.prevBall;
    const ball = {
      x: lerp(pb.x, b.x, alpha) + this.ballOff.x,
      y: lerp(pb.y, b.y, alpha) + this.ballOff.y,
      z: Math.max(0, lerp(pb.z, b.z, alpha) + this.ballOff.z),
      speed: Math.hypot(b.vx, b.vy),
    };
    let aim = null;
    const me = this.myPlayer();
    if (me && me.ct && this.app.prefs.aimGuide !== false && inReach(me, b) && s.phase !== PHASE.GOAL) {
      const c = me.charge / K.CHARGE_TICKS;
      const v = kickVector(me, me.ct, c, me.in.a);
      const start = { ...b, vx: v.vx, vy: v.vy, vz: v.vz, spin: v.spin, z: v.vz > 0 ? Math.max(b.z, 0.01) : b.z };
      const ticks = me.ct === 2 ? 110 : Math.round(16 + c * 34);
      const res = previewBallPath(s.field, start, ticks, 2);
      aim = { ct: me.ct, pts: res.pts, landing: me.ct === 2 ? res.landing : null };
    }
    return { field: s.field, kits: this.kits, phase: s.phase, ko: s.ko, players, ball, aim };
  }

  replayView(dt) {
    const r = this.replay;
    r.t += dt * 60 * REPLAY_SPEED;
    if (r.t >= r.end) {
      this.stopReplay();
      return this.liveView(1);
    }
    const fr = r.frames;
    while (r.i < fr.length - 2 && fr[r.i + 1].t <= r.t) r.i++;
    const a = fr[r.i];
    const c = fr[r.i + 1] || a;
    const k = c.t > a.t ? (r.t - a.t) / (c.t - a.t) : 0;
    const map = new Map(c.p.map((p) => [p[0], p]));
    const players = a.p.map((p) => {
      const q = map.get(p[0]) || p;
      return this.buildPlayerView(p[0], p[1], lerp(p[2], q[2], k), lerp(p[3], q[3], k), q[4], p[5], p[6], {
        ct: p[7], charge: p[8] / K.CHARGE_TICKS, stamina: 1, exh: 0, slide: p[9], stun: p[10], sprint: false,
      });
    });
    const ball = {
      x: lerp(a.b[0], c.b[0], k),
      y: lerp(a.b[1], c.b[1], k),
      z: lerp(a.b[2], c.b[2], k),
      speed: Math.hypot(a.b[3], a.b[4]),
    };
    return { field: this.state.field, kits: this.kits, phase: PHASE.PLAY, ko: 0, players, ball, aim: null, replay: true };
  }

  // ---------------------------------------------------------------------------

  frame(now) {
    if (this.lastFrame === null) this.lastFrame = now;
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.25) dt = 0.25;
    if (dt < 0) dt = 0;
    this.acc += dt * 1000;
    let n = 0;
    while (this.acc >= TICK_MS && n < 10) {
      this.tick();
      this.acc -= TICK_MS;
      n++;
    }
    if (n >= 10) this.acc = 0;
    const alpha = this.acc / TICK_MS;

    const kp = Math.exp(-dt * 9);
    const kme = Math.exp(-dt * 16);
    for (const [id, o] of this.off) {
      const k = id === this.myId ? kme : kp;
      o.x *= k;
      o.y *= k;
    }
    this.ballOff.x *= kp;
    this.ballOff.y *= kp;
    this.ballOff.z *= kp;
    for (const [id, em] of this.emotes) {
      em.age += dt;
      if (em.age > 2.6) this.emotes.delete(id);
    }
    this.fx.update(dt);

    const view = this.replay ? this.replayView(dt) : this.liveView(alpha);
    const me = view.players.find((p) => p.me);
    const prefs = this.app.prefs;
    const demo = this.mode === 'demo';
    this.app.renderer.draw(view, this.fx, dt, {
      focus: this.replay ? null : me || null,
      cameraMode: this.replay ? 'follow' : demo ? 'full' : prefs.camera,
      zoomBoost: this.replay ? 1.15 : 1,
      shift: this.app.touch && !this.replay && !demo ? { x: this.app.renderer.W * 0.1, y: this.app.renderer.H * 0.06 } : null,
      tilt: prefs.tilt,
      topPad: demo ? 0 : 74,
      letterbox: this.replay ? 1 : 0,
      showNames: !demo,
    });
    if (!demo) this.app.hud.update(this, view);

    // Countdown beeps
    const s = this.state;
    if (!demo && s.phase === PHASE.COUNTDOWN) {
      const c = Math.ceil(s.pt / 60);
      if (c !== this.lastCount && c > 0 && c <= 3) this.app.audio.beep(false);
      this.lastCount = c;
    } else this.lastCount = -1;
  }
}
