import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';

let srv;
let url;

before(async () => {
  srv = createGameServer();
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${srv.server.address().port}/ws`;
});

after(async () => {
  for (const room of srv.lobby.rooms.values()) room.destroy();
  for (const ws of srv.wss.clients) ws.terminate();
  await new Promise((r) => srv.server.close(r));
});

function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const c = { ws, msgs: [], waiters: [], id: -1 };
    c.send = (m) => ws.send(JSON.stringify(m));
    c.wait = (pred, ms = 3000) => new Promise((res, rej) => {
      const found = c.msgs.find(pred);
      if (found) {
        c.msgs.splice(c.msgs.indexOf(found), 1);
        res(found);
        return;
      }
      const t = setTimeout(() => rej(new Error(`timeout waiting in ${name}`)), ms);
      c.waiters.push({ pred, res: (m) => { clearTimeout(t); res(m); } });
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const w = c.waiters.find((x) => x.pred(m));
      if (w) {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        w.res(m);
      } else {
        c.msgs.push(m);
        if (c.msgs.length > 400) c.msgs.splice(0, 200);
      }
    });
    ws.on('open', async () => {
      c.send({ t: 'hello', name, number: 7 });
      const w = await c.wait((m) => m.t === 'welcome');
      c.id = w.id;
      resolve(c);
    });
    ws.on('error', reject);
  });
}

test('health endpoint and static files', async () => {
  const base = url.replace('ws://', 'http://').replace('/ws', '');
  const h = await fetch(`${base}/health`).then((r) => r.json());
  assert.equal(h.ok, true);
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /FUTBOL/);
  const shared = await fetch(`${base}/shared/physics.js`);
  assert.equal(shared.status, 200);
  const trav = await fetch(`${base}/..%2Fserver%2Findex.js`);
  assert.notEqual(trav.status, 200);
});

test('8 players fill a room, the 9th is rejected, a 4v4 match runs', async () => {
  const host = await client('Host');
  host.send({ t: 'create', name: 'Test Odası', isPublic: true });
  const joined = await host.wait((m) => m.t === 'joined');
  const code = joined.room.code;
  assert.equal(code.length, 5);
  host.send({ t: 'settings', settings: { teamSize: 4, duration: 60 } });

  const others = [];
  for (let i = 0; i < 7; i++) {
    const c = await client(`P${i}`);
    c.send({ t: 'join', code });
    await c.wait((m) => m.t === 'joined');
    others.push(c);
  }
  const extra = await client('Extra');
  extra.send({ t: 'join', code });
  const err = await extra.wait((m) => m.t === 'error');
  assert.equal(err.code, 'full');

  // Wait for the room state to settle with 8 players.
  let room;
  for (;;) {
    const m = await host.wait((x) => x.t === 'room');
    room = m.room;
    if (room.players.length === 8 && room.settings.teamSize === 4) break;
  }
  const red = room.players.filter((p) => p.team === 0).length;
  const blue = room.players.filter((p) => p.team === 1).length;
  assert.equal(red, 4);
  assert.equal(blue, 4);

  // Non-host cannot start.
  others[0].send({ t: 'start' });
  host.send({ t: 'start' });
  const start = await host.wait((m) => m.t === 'start');
  assert.equal(start.field, 'large');
  assert.equal(start.roster.length, 8);
  assert.ok(start.roster.every((r) => !r.bot), 'no bots needed in a full 4v4');

  // Snapshots arrive; inputs are acknowledged and move the player.
  const snap1 = await host.wait((m) => m.t === 's');
  const me0 = snap1.d[10].find((p) => p[0] === host.id);
  let seq = 0;
  const sendInputs = setInterval(() => {
    seq++;
    host.send({ t: 'i', s: seq, x: 0, y: 1, a: 0, b: 1 });
  }, 16);
  await new Promise((r) => setTimeout(r, 3600)); // countdown is 3s
  clearInterval(sendInputs);
  host.msgs = host.msgs.filter((m) => m.t !== 's');
  const snap2 = await host.wait((m) => m.t === 's');
  const me1 = snap2.d[10].find((p) => p[0] === host.id);
  assert.ok(snap2.a > 0, 'inputs acknowledged');
  assert.ok(me1[4] - me0[4] > 20, `host moved down (${me0[4]} -> ${me1[4]})`);

  // Leaving mid-match with bots on: a bot takes the place.
  host.send({ t: 'settings', settings: { teamSize: 2 } }); // ignored mid-match
  others[6].ws.close();
  const roster = await host.wait((m) => m.t === 'roster');
  assert.equal(roster.roster.length, 7 + (srv.lobby.rooms.get(code).settings.bots ? 1 : 0));

  // Host ends the match.
  host.send({ t: 'stop' });
  const end = await host.wait((m) => m.t === 'end', 5000);
  assert.equal(end.result.score.length, 2);
  assert.ok(end.result.players.length >= 7);

  for (const c of [host, ...others, extra]) c.ws.close();
});

test('bots fill empty slots and host migrates when the host leaves', async () => {
  const a = await client('A');
  const b = await client('B');
  a.send({ t: 'create', name: 'Bot Test', isPublic: false });
  const j = await a.wait((m) => m.t === 'joined');
  b.send({ t: 'join', code: j.room.code });
  await b.wait((m) => m.t === 'joined');
  a.send({ t: 'settings', settings: { teamSize: 3, bots: true } });
  await a.wait((m) => m.t === 'room' && m.room.settings.teamSize === 3);
  a.send({ t: 'start' });
  const start = await b.wait((m) => m.t === 'start');
  assert.equal(start.roster.length, 6);
  assert.equal(start.roster.filter((r) => r.bot).length, 4);
  assert.equal(start.field, 'medium');
  a.ws.close();
  const room = await b.wait((m) => m.t === 'room' && m.room.hostId === b.id);
  assert.equal(room.room.players.length, 1);
  b.send({ t: 'stop' });
  await b.wait((m) => m.t === 'end', 5000);
  b.ws.close();
});

test('quick join creates or reuses a public lobby room', async () => {
  const a = await client('Q1');
  a.send({ t: 'quick' });
  const ja = await a.wait((m) => m.t === 'joined');
  const b = await client('Q2');
  b.send({ t: 'quick' });
  const jb = await b.wait((m) => m.t === 'joined');
  assert.equal(ja.room.code, jb.room.code);
  b.send({ t: 'chat', text: '  merhaba  ' });
  const chat = await a.wait((m) => m.t === 'chat' && !m.sys);
  assert.equal(chat.text, 'merhaba');
  a.ws.close();
  b.ws.close();
});
