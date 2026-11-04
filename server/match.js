// Authoritative match running on the server at 60 Hz.

import {
  makeState, addPlayer, removePlayer, resetKickoff, step, findPlayer,
} from '../public/shared/physics.js';
import { BotBrain } from '../public/shared/bot.js';
import { MatchStats } from '../public/shared/stats.js';
import { encodeSnapshot, sanitizeInput } from '../public/shared/protocol.js';
import {
  PHASE, SNAPSHOT_EVERY, TICK_MS, TIMING, BOT_NAMES, fieldForTeamSize,
} from '../public/shared/constants.js';

const MAX_QUEUE = 30;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Match {
  constructor(room) {
    this.room = room;
    const st = room.settings;
    this.settings = { ...st, kits: [...st.kits] };
    const counts = [0, 0];
    for (const c of room.clients.values()) if (c.team >= 0) counts[c.team]++;
    const size = st.bots ? st.teamSize : Math.max(counts[0], counts[1], 1);
    this.fieldKey = st.field === 'auto' ? fieldForTeamSize(size) : st.field;
    this.state = makeState(this.fieldKey, st);
    this.bots = new Map();
    this.humans = new Map();
    this.meta = new Map();
    this.stats = new MatchStats();
    this.events = [];
    this.botNames = shuffle(BOT_NAMES);
    this.botNameIdx = 0;
    this.stopped = false;
    this.endedAt = -1;
    this.timer = null;

    for (const c of room.clients.values()) if (c.team >= 0) this.addHuman(c, c.team, true);
    this.fillBots();
    resetKickoff(this.state);
  }

  // ---- roster management ---------------------------------------------------

  teamCount(team) {
    let n = 0;
    for (const p of this.state.players) if (p.team === team) n++;
    return n;
  }

  addHuman(client, team, initial = false) {
    const s = this.state;
    let slot;
    let pos = null;
    if (this.teamCount(team) >= this.settings.teamSize) {
      // Replace a bot on that team (the one with the highest slot).
      const bots = s.players.filter((p) => p.team === team && this.bots.has(p.id)).sort((a, b) => b.slot - a.slot);
      if (!bots.length) return false;
      const bot = bots[0];
      slot = bot.slot;
      pos = { x: bot.x, y: bot.y, facing: bot.facing };
      this.removeBot(bot.id);
    }
    const p = addPlayer(s, client.id, team, slot);
    if (pos) {
      p.x = pos.x;
      p.y = pos.y;
      p.facing = pos.facing;
    }
    this.humans.set(client.id, { queue: [], seq: -1 });
    const meta = { id: client.id, name: client.name, number: client.number, team, bot: false };
    this.meta.set(client.id, meta);
    this.stats.ensure(meta);
    if (!initial) this.room.broadcastRoster();
    return true;
  }

  removeHuman(id) {
    const p = removePlayer(this.state, id);
    this.humans.delete(id);
    this.meta.delete(id);
    if (p && this.settings.bots) {
      const bot = this.addBot(p.team, p.slot);
      bot.x = p.x;
      bot.y = p.y;
      bot.facing = p.facing;
    }
    this.room.broadcastRoster();
  }

  changeTeam(client, team) {
    if (this.humans.has(client.id)) this.removeHuman(client.id);
    if (team >= 0) {
      if (!this.addHuman(client, team)) return false;
      if (this.settings.bots) this.trimBots();
    }
    this.room.broadcastRoster();
    return true;
  }

  updateHumanMeta(client) {
    const m = this.meta.get(client.id);
    if (!m) return;
    m.name = client.name;
    m.number = client.number;
    this.stats.ensure(m);
  }

  addBot(team, slot) {
    const id = this.room.lobby.nextId();
    const used = new Set([...this.meta.values()].filter((m) => m.team === team).map((m) => m.number));
    let number = 2 + Math.floor(Math.random() * 20);
    while (used.has(number)) number++;
    const name = this.botNames[this.botNameIdx++ % this.botNames.length];
    const p = addPlayer(this.state, id, team, slot);
    this.bots.set(id, new BotBrain(id, this.settings.botLevel));
    const meta = { id, name, number, team, bot: true };
    this.meta.set(id, meta);
    this.stats.ensure(meta);
    return p;
  }

  removeBot(id) {
    removePlayer(this.state, id);
    this.bots.delete(id);
    this.meta.delete(id);
  }

  fillBots() {
    if (!this.settings.bots) return;
    for (let team = 0; team < 2; team++) {
      while (this.teamCount(team) < this.settings.teamSize) this.addBot(team);
    }
  }

  trimBots() {
    for (let team = 0; team < 2; team++) {
      while (this.teamCount(team) > this.settings.teamSize) {
        const bots = this.state.players.filter((p) => p.team === team && this.bots.has(p.id));
        if (!bots.length) break;
        this.removeBot(bots[bots.length - 1].id);
      }
    }
    this.fillBots();
  }

  roster() {
    return this.state.players.map((p) => this.meta.get(p.id)).filter(Boolean);
  }

  // ---- networking -----------------------------------------------------------

  input(id, msg) {
    const h = this.humans.get(id);
    if (!h) return;
    const inp = sanitizeInput(msg);
    if (inp.s <= h.seq) return; // stale / duplicate
    const q = h.queue;
    if (q.length && inp.s <= q[q.length - 1].s) return;
    q.push(inp);
    if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
  }

  startMessage() {
    return {
      t: 'start',
      field: this.fieldKey,
      settings: this.settings,
      rules: this.state.rules,
      roster: this.roster(),
      snap: encodeSnapshot(this.state, []),
    };
  }

  broadcastSnapshot() {
    const d = JSON.stringify(encodeSnapshot(this.state, this.events));
    this.events = [];
    for (const c of this.room.clients.values()) {
      const h = this.humans.get(c.id);
      const ack = h ? h.seq : -1;
      c.sendRaw(`{"t":"s","a":${ack},"d":${d}}`);
    }
  }

  // ---- loop -----------------------------------------------------------------

  start() {
    let last = performance.now();
    let acc = 0;
    const loop = () => {
      if (this.stopped) return;
      const now = performance.now();
      acc += now - last;
      last = now;
      let n = 0;
      while (acc >= TICK_MS && n < 8) {
        this.tick();
        acc -= TICK_MS;
        n++;
        if (this.stopped) return;
      }
      if (n === 8) acc = 0; // way behind, drop time instead of spiraling
      this.timer = setTimeout(loop, Math.max(1, TICK_MS - acc - 0.5));
    };
    loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  tick() {
    const s = this.state;
    for (const p of s.players) {
      const brain = this.bots.get(p.id);
      if (brain) {
        p.in = brain.update(s, this.humans);
        continue;
      }
      const h = this.humans.get(p.id);
      if (!h || !h.queue.length) continue; // keep last input
      // If the client is far ahead (burst after a hiccup) skip stale inputs to cap latency.
      if (h.queue.length > 6) h.queue.splice(0, h.queue.length - 3);
      const inp = h.queue.shift();
      h.seq = inp.s;
      p.in = { mx: inp.mx, my: inp.my, a: inp.a, b: inp.b };
    }
    const ev = step(s, true);
    this.stats.tick(s);
    if (ev.length) {
      this.stats.events(s, ev);
      for (const e of ev) this.events.push(e);
    }
    if (s.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();

    if (s.phase === PHASE.ENDED) {
      if (this.endedAt < 0) this.endedAt = s.tick;
      else if (s.tick - this.endedAt > TIMING.END_HOLD) this.finish();
    }
  }

  finish() {
    if (this.stopped) return;
    this.stop();
    for (const m of this.meta.values()) this.stats.ensure(m);
    const summary = this.stats.summary(this.state.score);
    this.room.onMatchEnd(summary);
  }

  liveStats() {
    const out = [];
    for (const st of this.stats.players.values()) {
      if (!findPlayer(this.state, st.id)) continue;
      out.push([st.id, st.goals, st.assists, st.shots, st.tackles]);
    }
    return out;
  }
}
