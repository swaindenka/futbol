// A room: a lobby of up to 8 people who form two teams and play matches.

import { Match } from './match.js';
import {
  DEFAULT_SETTINGS, SETTING_OPTIONS, MAX_ROOM_PLAYERS, MAX_TEAM_SIZE, KITS, EMOTES, puLevel,
} from '../public/shared/constants.js';

const CHAT_MAX = 160;
const EMPTY_GRACE_MS = 30_000;

export class Room {
  constructor(lobby, code, { name, isPublic }) {
    this.lobby = lobby;
    this.code = code;
    this.name = name;
    this.isPublic = isPublic;
    this.clients = new Map();
    this.hostId = -1;
    this.settings = { ...DEFAULT_SETTINGS, kits: [...DEFAULT_SETTINGS.kits] };
    this.match = null;
    this.lastResult = null;
    this.createdAt = Date.now();
    this.pingTimer = setInterval(() => this.broadcastPings(), 2000);
  }

  get status() {
    return this.match ? 'playing' : 'lobby';
  }

  get full() {
    return this.clients.size >= MAX_ROOM_PLAYERS;
  }

  listing() {
    return {
      code: this.code,
      name: this.name,
      players: this.clients.size,
      max: MAX_ROOM_PLAYERS,
      status: this.status,
      teamSize: this.settings.teamSize,
      host: this.clients.get(this.hostId)?.name || '',
    };
  }

  info() {
    return {
      code: this.code,
      name: this.name,
      isPublic: this.isPublic,
      hostId: this.hostId,
      settings: this.settings,
      status: this.status,
      players: [...this.clients.values()].map((c) => ({
        id: c.id, name: c.name, number: c.number, team: c.team, ping: c.ping,
      })),
      roster: this.match ? this.match.roster() : null,
    };
  }

  send(client, msg) {
    client.send(msg);
  }

  broadcast(msg, except) {
    const raw = JSON.stringify(msg);
    for (const c of this.clients.values()) if (c !== except) c.sendRaw(raw);
  }

  broadcastRoom() {
    this.broadcast({ t: 'room', room: this.info() });
    this.lobby.roomsChanged();
  }

  broadcastRoster() {
    if (!this.match) return;
    this.broadcast({ t: 'roster', roster: this.match.roster() });
  }

  broadcastPings() {
    if (!this.clients.size) return;
    const pings = {};
    for (const c of this.clients.values()) pings[c.id] = c.ping;
    const msg = { t: 'pings', p: pings };
    if (this.match) msg.st = this.match.liveStats();
    this.broadcast(msg);
  }

  system(text) {
    this.broadcast({ t: 'chat', sys: 1, text });
  }

  teamHumans(team) {
    let n = 0;
    for (const c of this.clients.values()) if (c.team === team) n++;
    return n;
  }

  join(client) {
    if (this.full) return 'Oda dolu.';
    if (this.emptyTimer) {
      clearTimeout(this.emptyTimer);
      this.emptyTimer = null;
    }
    client.room = this;
    client.team = -1;
    this.clients.set(client.id, client);
    if (this.hostId < 0 || !this.clients.has(this.hostId)) this.hostId = client.id;
    // Auto-assign to the smaller team if there is space and we are in the lobby.
    if (!this.match) {
      const t = this.teamHumans(0) <= this.teamHumans(1) ? 0 : 1;
      if (this.teamHumans(t) < this.settings.teamSize) client.team = t;
      else if (this.teamHumans(1 - t) < this.settings.teamSize) client.team = 1 - t;
    }
    client.send({ t: 'joined', room: this.info(), you: client.id });
    if (this.match) client.send(this.match.startMessage());
    this.system(`${client.name} odaya katıldı.`);
    this.broadcastRoom();
    return null;
  }

  /**
   * @param {object} client
   * @param {boolean} [dropped] connection lost (not an explicit leave): keep an empty room
   *   alive for a short while so the player can come back after a refresh.
   */
  leave(client, dropped = false) {
    if (!this.clients.has(client.id)) return;
    this.clients.delete(client.id);
    client.room = null;
    if (this.match) this.match.removeHuman(client.id);
    client.team = -1;
    if (!this.clients.size) {
      if (!dropped) {
        this.destroy();
        return;
      }
      if (this.match) {
        this.match.stop();
        this.match = null;
      }
      this.emptyTimer = setTimeout(() => {
        if (!this.clients.size) this.destroy();
      }, EMPTY_GRACE_MS);
      this.lobby.roomsChanged();
      return;
    }
    if (this.hostId === client.id) {
      this.hostId = this.clients.keys().next().value;
      const h = this.clients.get(this.hostId);
      this.system(`${client.name} ayrıldı. Yeni oda sahibi: ${h.name}.`);
    } else this.system(`${client.name} ayrıldı.`);
    this.broadcastRoom();
  }

  destroy() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    if (this.match) this.match.stop();
    this.match = null;
    clearInterval(this.pingTimer);
    this.lobby.removeRoom(this);
  }

  isHost(client) {
    return client.id === this.hostId;
  }

  setTeam(client, team) {
    team = team === 0 || team === 1 ? team : -1;
    if (client.team === team) return;
    if (team >= 0 && this.teamHumans(team) >= this.settings.teamSize) {
      client.send({ t: 'error', msg: 'Bu takım dolu.' });
      return;
    }
    const prev = client.team;
    client.team = team;
    if (this.match && !this.match.changeTeam(client, team)) {
      client.team = prev;
      client.send({ t: 'error', msg: 'Bu takıma şu an katılamazsın.' });
      return;
    }
    this.broadcastRoom();
  }

  updateSettings(client, patch) {
    if (!this.isHost(client) || this.match || !patch || typeof patch !== 'object') return;
    const s = this.settings;
    const pick = (key, v) => (SETTING_OPTIONS[key].includes(v) ? v : s[key]);
    if ('duration' in patch) s.duration = pick('duration', +patch.duration);
    if ('teamSize' in patch) s.teamSize = pick('teamSize', +patch.teamSize);
    if ('botLevel' in patch) s.botLevel = pick('botLevel', +patch.botLevel);
    if ('field' in patch) s.field = pick('field', String(patch.field));
    if ('scoreLimit' in patch) s.scoreLimit = pick('scoreLimit', +patch.scoreLimit);
    if ('bots' in patch) s.bots = !!patch.bots;
    if ('goldenGoal' in patch) s.goldenGoal = !!patch.goldenGoal;
    if ('replays' in patch) s.replays = !!patch.replays;
    if ('powerups' in patch) s.powerups = puLevel(patch.powerups);
    if (Array.isArray(patch.kits) && patch.kits.length === 2) {
      const k = patch.kits.map((v) => Math.max(0, Math.min(KITS.length - 1, v | 0)));
      if (k[0] !== k[1]) s.kits = k;
    }
    if ('name' in patch && typeof patch.name === 'string') {
      const n = patch.name.replace(/\s+/g, ' ').trim().slice(0, 28);
      if (n) this.name = n;
    }
    if ('isPublic' in patch) this.isPublic = !!patch.isPublic;
    // Shrinking team size moves overflow players to spectators.
    for (const team of [0, 1]) {
      const members = [...this.clients.values()].filter((c) => c.team === team);
      for (let i = s.teamSize; i < members.length; i++) members[i].team = -1;
    }
    this.broadcastRoom();
  }

  shuffleTeams(client) {
    if (!this.isHost(client) || this.match) return;
    const players = [...this.clients.values()].filter((c) => c.team >= 0);
    for (let i = players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [players[i], players[j]] = [players[j], players[i]];
    }
    players.forEach((c, i) => {
      c.team = i % 2;
    });
    this.system('Takımlar karıştırıldı.');
    this.broadcastRoom();
  }

  kick(client, targetId) {
    if (!this.isHost(client) || targetId === client.id) return;
    const target = this.clients.get(targetId);
    if (!target) return;
    target.send({ t: 'kicked' });
    this.leave(target);
  }

  canStart() {
    const red = this.teamHumans(0);
    const blue = this.teamHumans(1);
    if (red + blue === 0) return 'Takımlarda hiç oyuncu yok.';
    if (!this.settings.bots && (red === 0 || blue === 0)) return 'Bot kapalıyken iki takımda da en az bir oyuncu olmalı.';
    return null;
  }

  start(client) {
    if (!this.isHost(client) || this.match) return;
    const err = this.canStart();
    if (err) {
      client.send({ t: 'error', msg: err });
      return;
    }
    this.match = new Match(this);
    this.broadcast(this.match.startMessage());
    this.broadcastRoom();
    this.match.start();
  }

  stopMatch(client) {
    if (!this.isHost(client) || !this.match) return;
    this.match.finish();
  }

  onMatchEnd(summary) {
    this.match = null;
    this.lastResult = summary;
    this.broadcast({ t: 'end', result: summary });
    this.broadcastRoom();
  }

  chat(client, text) {
    if (typeof text !== 'string') return;
    const now = Date.now();
    if (now - (client.lastChat || 0) < 400) return;
    client.lastChat = now;
    const clean = text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, CHAT_MAX);
    if (!clean) return;
    this.broadcast({ t: 'chat', id: client.id, name: client.name, team: client.team, text: clean });
  }

  emote(client, idx) {
    idx |= 0;
    if (idx < 0 || idx >= EMOTES.length) return;
    const now = Date.now();
    if (now - (client.lastEmote || 0) < 1200) return;
    client.lastEmote = now;
    this.broadcast({ t: 'emote', id: client.id, e: idx });
  }

  handle(client, msg) {
    switch (msg.t) {
      case 'i':
        if (this.match) this.match.input(client.id, msg);
        break;
      case 'team':
        this.setTeam(client, msg.team);
        break;
      case 'settings':
        this.updateSettings(client, msg.settings);
        break;
      case 'shuffle':
        this.shuffleTeams(client);
        break;
      case 'kick':
        this.kick(client, msg.id);
        break;
      case 'start':
        this.start(client);
        break;
      case 'stop':
        this.stopMatch(client);
        break;
      case 'chat':
        this.chat(client, msg.text);
        break;
      case 'emote':
        this.emote(client, msg.e);
        break;
      default:
        break;
    }
  }

  onProfileChange(client, oldName) {
    if (oldName && oldName !== client.name) this.system(`${oldName} artık ${client.name}.`);
    if (this.match) {
      this.match.updateHumanMeta(client);
      this.broadcastRoster();
    }
    this.broadcastRoom();
  }
}

export { MAX_TEAM_SIZE };
