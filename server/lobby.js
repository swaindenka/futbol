// Connection + room registry. Routes messages from sockets to rooms.

import { Room } from './room.js';
import { PROTOCOL_VERSION } from '../public/shared/constants.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MSGS_PER_SEC = 240;

export function sanitizeName(v) {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim() : '';
  return s.slice(0, 16) || 'Oyuncu';
}

export function sanitizeNumber(v) {
  const n = Math.floor(+v);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : 10;
}

class Client {
  constructor(lobby, ws, id) {
    this.lobby = lobby;
    this.ws = ws;
    this.id = id;
    this.name = 'Oyuncu';
    this.number = 10;
    this.team = -1;
    this.room = null;
    this.ping = 0;
    this.msgCount = 0;
    this.msgWindow = Date.now();
    this.hello = false;
  }

  sendRaw(raw) {
    if (this.ws.readyState !== 1) return;
    // Drop snapshots for clients that cannot keep up instead of buffering forever.
    if (this.ws.bufferedAmount > 512 * 1024 && raw.startsWith('{"t":"s"')) return;
    this.ws.send(raw);
  }

  send(msg) {
    this.sendRaw(JSON.stringify(msg));
  }
}

export class Lobby {
  constructor() {
    this.rooms = new Map();
    this.clients = new Set();
    this.idSeq = 1;
    this.listTimer = null;
  }

  nextId() {
    const id = this.idSeq++;
    if (this.idSeq > 2_000_000_000) this.idSeq = 1;
    return id;
  }

  makeCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  connect(ws) {
    const client = new Client(this, ws, this.nextId());
    this.clients.add(client);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - client.msgWindow > 1000) {
        client.msgWindow = now;
        client.msgCount = 0;
      }
      if (++client.msgCount > MAX_MSGS_PER_SEC) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        this.handle(client, msg);
      } catch (err) {
        console.error('message error', err);
      }
    });
    ws.on('close', () => this.disconnect(client));
    ws.on('error', () => {});
    return client;
  }

  disconnect(client) {
    if (client.room) client.room.leave(client);
    this.clients.delete(client);
  }

  roomsList() {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic)
      .sort((a, b) => (a.status === b.status ? b.clients.size - a.clients.size : a.status === 'lobby' ? -1 : 1))
      .slice(0, 50)
      .map((r) => r.listing());
  }

  roomsChanged() {
    if (this.listTimer) return;
    this.listTimer = setTimeout(() => {
      this.listTimer = null;
      const raw = JSON.stringify({ t: 'rooms', rooms: this.roomsList() });
      for (const c of this.clients) if (!c.room && c.hello) c.sendRaw(raw);
    }, 300);
  }

  removeRoom(room) {
    this.rooms.delete(room.code);
    this.roomsChanged();
  }

  createRoom(client, opts) {
    if (client.room) client.room.leave(client);
    const code = this.makeCode();
    const nameRaw = typeof opts.name === 'string' ? opts.name.replace(/\s+/g, ' ').trim().slice(0, 28) : '';
    const room = new Room(this, code, {
      name: nameRaw || `${client.name} odası`,
      isPublic: opts.isPublic !== false,
    });
    this.rooms.set(code, room);
    room.join(client);
    return room;
  }

  joinRoom(client, code) {
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) {
      client.send({ t: 'error', msg: 'Oda bulunamadı. Kodu kontrol et.', code: 'no_room' });
      return;
    }
    if (client.room === room) return;
    if (room.full) {
      client.send({ t: 'error', msg: 'Oda dolu (en fazla 8 kişi).', code: 'full' });
      return;
    }
    if (client.room) client.room.leave(client);
    const err = room.join(client);
    if (err) client.send({ t: 'error', msg: err });
  }

  quickJoin(client) {
    const candidates = [...this.rooms.values()]
      .filter((r) => r.isPublic && !r.full)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'lobby' ? -1 : 1;
        return b.clients.size - a.clients.size;
      });
    if (candidates.length) this.joinRoom(client, candidates[0].code);
    else this.createRoom(client, { name: `${client.name} odası`, isPublic: true });
  }

  handle(client, msg) {
    switch (msg.t) {
      case 'hello':
        client.name = sanitizeName(msg.name);
        client.number = sanitizeNumber(msg.number);
        client.hello = true;
        client.send({ t: 'welcome', id: client.id, v: PROTOCOL_VERSION, rooms: this.roomsList() });
        break;
      case 'profile':
        client.name = sanitizeName(msg.name);
        client.number = sanitizeNumber(msg.number);
        if (client.room) client.room.onProfileChange(client);
        break;
      case 'ping':
        if (Number.isFinite(+msg.r)) client.ping = Math.max(0, Math.min(9999, Math.round(+msg.r)));
        client.send({ t: 'pong', c: msg.c });
        break;
      case 'list':
        client.send({ t: 'rooms', rooms: this.roomsList() });
        break;
      case 'create':
        this.createRoom(client, { name: msg.name, isPublic: msg.isPublic });
        break;
      case 'join':
        this.joinRoom(client, msg.code);
        break;
      case 'quick':
        this.quickJoin(client);
        break;
      case 'leave':
        if (client.room) client.room.leave(client);
        client.send({ t: 'left' });
        client.send({ t: 'rooms', rooms: this.roomsList() });
        break;
      default:
        if (client.room) client.room.handle(client, msg);
        break;
    }
  }

  stats() {
    return { rooms: this.rooms.size, clients: this.clients.size };
  }
}
