// Room lobby screen: teams, kits, match settings, chat, start.

import { $, $$, el, esc, icon, seg, toggle, copyText, toast } from './dom.js';
import {
  KITS, SETTING_OPTIONS, MAX_ROOM_PLAYERS, PU_LEVEL_NAMES, puLevel,
} from '../../shared/constants.js';
import { BOT_LEVEL_NAMES } from '../../shared/bot.js';

const FIELD_NAMES = { auto: 'Otomatik', small: 'Küçük', medium: 'Orta', large: 'Büyük' };

export class RoomScreen {
  constructor(app) {
    this.app = app;
    this.root = $('#screen-room');
    this.room = null;
    this.chatLog = $('#room-chat-log');

    $('#btn-leave').addEventListener('click', () => app.leaveRoom());
    $('#btn-copy-code').addEventListener('click', async () => {
      if (!this.room) return;
      if (await copyText(this.room.code)) toast('Oda kodu kopyalandı', 'ok');
    });
    $('#btn-invite').addEventListener('click', async () => {
      if (!this.room) return;
      const url = app.inviteUrl(this.room.code);
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try {
          await navigator.share({ title: 'Futbol Arena', text: `${this.room.name} odasına gel!`, url });
          return;
        } catch {
          /* fall back to copy */
        }
      }
      if (await copyText(url)) toast('Davet linki kopyalandı — arkadaşlarına gönder!', 'ok');
    });
    $('#btn-start').addEventListener('click', () => app.net.send({ t: 'start' }));
    $('#btn-profile').addEventListener('click', () => app.modals.profile());
    $('#btn-shuffle').addEventListener('click', () => app.net.send({ t: 'shuffle' }));
    for (const b of $$('[data-join]', this.root)) b.addEventListener('click', () => app.net.send({ t: 'team', team: +b.dataset.join }));
    $('#room-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('#room-chat-input');
      const text = inp.value.trim();
      if (text) app.net.send({ t: 'chat', text });
      inp.value = '';
    });
  }

  show(v) {
    this.root.hidden = !v;
  }

  isHost() {
    return this.room && this.room.hostId === this.app.myId;
  }

  sendSettings(patch) {
    this.app.net.send({ t: 'settings', settings: patch });
  }

  render(room) {
    this.room = room;
    const me = this.app.myId;
    const host = this.isHost();
    const st = room.settings;
    const kits = st.kits.map((i) => KITS[i]);
    $('#room-name').textContent = room.name;
    const mine = room.players.find((p) => p.id === me);
    if (mine) {
      $('#room-my-num').textContent = mine.number;
      $('#room-my-name').textContent = mine.name;
    }
    $('#room-code').textContent = room.code;
    $('#room-visibility').textContent = room.isPublic ? '🌐 Herkese açık' : '🔒 Gizli';
    $('#room-count').textContent = `${room.players.length}/${MAX_ROOM_PLAYERS} kişi`;

    for (const card of $$('.team-card', this.root)) this.renderTeam(card, +card.dataset.team, room, kits, host, me);

    const spec = $('#spec-list');
    spec.innerHTML = '';
    const specs = room.players.filter((p) => p.team < 0);
    if (!specs.length) spec.append(el('span', { class: 'muted small', text: 'Kimse izlemiyor.' }));
    for (const p of specs) {
      spec.append(el('span', { class: `chip ${p.id === me ? 'me' : ''}` },
        p.id === room.hostId ? el('span', { class: 'host', style: { color: 'var(--gold)' } }, icon('crown')) : null,
        p.name,
        host && p.id !== me ? el('button', { class: 'kick-btn', title: 'Odadan at', style: { border: 'none', background: 'none', color: 'var(--dim)' }, onclick: () => this.app.net.send({ t: 'kick', id: p.id }) }, icon('x')) : null));
    }
    $('[data-join="-1"]', this.root).hidden = !mine || mine.team < 0;

    this.renderSettings(st, host, room);

    const startBtn = $('#btn-start');
    const shuffleBtn = $('#btn-shuffle');
    startBtn.hidden = !host;
    shuffleBtn.hidden = !host;
    const red = room.players.filter((p) => p.team === 0).length;
    const blue = room.players.filter((p) => p.team === 1).length;
    let hint;
    let ok = true;
    if (room.status === 'playing') {
      hint = 'Maç devam ediyor…';
      ok = false;
    } else if (red + blue === 0) {
      hint = 'Başlamak için en az bir oyuncu bir takıma geçmeli.';
      ok = false;
    } else if (!st.bots && (red === 0 || blue === 0)) {
      hint = 'Botlar kapalı: iki takımda da en az bir oyuncu olmalı.';
      ok = false;
    } else if (host) {
      const bots = st.bots ? st.teamSize * 2 - red - blue : 0;
      hint = bots > 0 ? `Hazırsan başlat! Boş <b>${bots}</b> yer botlarla doldurulacak.` : 'Herkes hazır — düdüğü çal!';
    } else {
      const h = room.players.find((p) => p.id === room.hostId);
      hint = `Oda sahibi <b>${esc(h ? h.name : '')}</b> maçı başlatacak…`;
    }
    $('#room-hint').innerHTML = hint;
    startBtn.disabled = !ok;
    $('#settings-lock').textContent = host ? 'Oda sahibisin' : 'Sadece oda sahibi değiştirebilir';
  }

  renderTeam(card, team, room, kits, host, me) {
    const kit = kits[team];
    const st = room.settings;
    card.style.setProperty('--tc', kit.primary);
    card.style.setProperty('--tc2', kit.secondary);
    card.innerHTML = '';
    const members = room.players.filter((p) => p.team === team);
    const badge = el('div', { class: 'team-badge', style: { '--stripes': kit.pattern === 'stripes' ? 1 : 0 } });
    card.append(el('div', { class: 'team-head' }, badge,
      el('div', {}, el('div', { class: 'team-name', text: kit.name }),
        el('div', { class: 'team-sub', text: `${members.length}/${st.teamSize} oyuncu · ${team === 0 ? 'Sol kale' : 'Sağ kale'}` }))));
    if (host) {
      const picker = el('div', { class: 'kit-picker' });
      KITS.forEach((k, i) => {
        const other = st.kits[1 - team];
        const b = el('button', {
          type: 'button',
          class: `kit-swatch ${st.kits[team] === i ? 'on' : ''}`,
          title: k.name,
          disabled: other === i || undefined,
          style: { '--k': `linear-gradient(135deg, ${k.primary} 50%, ${k.secondary} 50%)` },
        });
        b.style.background = `linear-gradient(135deg, ${k.primary} 55%, ${k.secondary} 55%)`;
        b.addEventListener('click', () => {
          const next = [...st.kits];
          next[team] = i;
          this.sendSettings({ kits: next });
        });
        picker.append(b);
      });
      card.append(picker);
    }
    const list = el('div', { class: 'slots-list' });
    for (const p of members) {
      list.append(el('div', {
        class: `pslot ${p.id === me ? 'me' : ''}`,
        title: p.id === me ? 'Adını / numaranı değiştirmek için tıkla' : undefined,
        onclick: p.id === me ? () => this.app.modals.profile() : undefined,
      },
        el('span', { class: 'num', text: p.number }),
        el('span', { class: 'pname', text: p.name + (p.id === me ? ' (sen)' : '') }),
        p.id === room.hostId ? el('span', { class: 'host', title: 'Oda sahibi' }, icon('crown')) : null,
        el('span', { class: 'ping', 'data-ping': p.id, text: p.ping ? `${p.ping}ms` : '' }),
        host && p.id !== me ? el('button', { class: 'kick-btn', title: 'Odadan at', onclick: () => this.app.net.send({ t: 'kick', id: p.id }) }, icon('x')) : null));
    }
    for (let i = members.length; i < st.teamSize; i++) {
      list.append(st.bots
        ? el('div', { class: 'pslot bot-slot' }, icon('bot'), el('span', { class: 'pname', text: `Bot (${BOT_LEVEL_NAMES[st.botLevel]})` }))
        : el('div', { class: 'pslot empty-slot', text: 'Boş' }));
    }
    card.append(list);
    const mine = room.players.find((p) => p.id === me);
    const full = members.length >= st.teamSize;
    if (!mine || mine.team !== team) {
      card.append(el('div', { class: 'team-foot' }, el('button', {
        class: 'btn small',
        type: 'button',
        disabled: full || undefined,
        onclick: () => this.app.net.send({ t: 'team', team }),
      }, full ? 'Takım dolu' : `${kit.name} takımına geç`)));
    }
  }

  renderSettings(st, host, room) {
    const body = $('#room-settings');
    body.innerHTML = '';
    const dis = !host || room.status === 'playing';
    const row = (label, control) => el('div', { class: 'set-row' }, el('label', { text: label }), control);
    body.append(row('Süre', seg(SETTING_OPTIONS.duration.map((v) => ({ v, label: `${v / 60} dk` })), st.duration, (v) => this.sendSettings({ duration: v }), { disabled: dis })));
    body.append(row('Takım boyutu', seg(SETTING_OPTIONS.teamSize.map((v) => ({ v, label: `${v}v${v}` })), st.teamSize, (v) => this.sendSettings({ teamSize: v }), { disabled: dis, cls: 'lime' })));
    body.append(row('Saha', seg(SETTING_OPTIONS.field.map((v) => ({ v, label: FIELD_NAMES[v] })), st.field, (v) => this.sendSettings({ field: v }), { disabled: dis })));
    body.append(row('Gol limiti', seg(SETTING_OPTIONS.scoreLimit.map((v) => ({ v, label: v ? String(v) : 'Yok' })), st.scoreLimit, (v) => this.sendSettings({ scoreLimit: v }), { disabled: dis })));
    body.append(el('div', { class: 'toggle-row' }, el('span', { text: 'Boş yerleri botlarla doldur' }), toggle(st.bots, (v) => this.sendSettings({ bots: v }), { disabled: dis, label: 'Botlar' })));
    if (st.bots) body.append(row('Bot seviyesi', seg(SETTING_OPTIONS.botLevel.map((v) => ({ v, label: BOT_LEVEL_NAMES[v] })), st.botLevel, (v) => this.sendSettings({ botLevel: v }), { disabled: dis })));
    body.append(el('div', { class: 'toggle-row' }, el('span', { text: 'Altın gol (beraberlikte uzatma)' }), toggle(st.goldenGoal, (v) => this.sendSettings({ goldenGoal: v }), { disabled: dis, label: 'Altın gol' })));
    body.append(row('Güçlendirmeler', seg(SETTING_OPTIONS.powerups.map((v) => ({ v, label: PU_LEVEL_NAMES[v] })), puLevel(st.powerups), (v) => this.sendSettings({ powerups: v }), { disabled: dis })));
    body.append(el('div', { class: 'toggle-row' }, el('span', { text: 'Gol tekrarları' }), toggle(st.replays, (v) => this.sendSettings({ replays: v }), { disabled: dis, label: 'Tekrarlar' })));
    body.append(el('div', { class: 'toggle-row' }, el('span', { text: 'Oda listede görünsün' }), toggle(room.isPublic, (v) => this.sendSettings({ isPublic: v }), { disabled: dis, label: 'Herkese açık' })));
  }

  updatePings(pings) {
    for (const n of $$('[data-ping]', this.root)) {
      const v = pings[n.dataset.ping];
      if (v !== undefined) n.textContent = v ? `${v}ms` : '';
    }
  }

  chat(msg) {
    const n = el('div', { class: `msg ${msg.sys ? 'sys' : ''}` });
    if (msg.sys) n.textContent = msg.text;
    else {
      const kits = this.room ? this.room.settings.kits.map((i) => KITS[i]) : null;
      const color = msg.team >= 0 && kits ? kits[msg.team].primary : 'var(--lime)';
      n.append(el('b', { text: msg.name, style: { color } }), msg.text);
    }
    this.chatLog.append(n);
    while (this.chatLog.children.length > 80) this.chatLog.firstChild.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  clearChat() {
    this.chatLog.innerHTML = '';
  }
}
