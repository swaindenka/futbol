// Home screen: profile, quick play, room list, join by code.

import { $, el, esc, icon } from './dom.js';
import { KITS } from '../../shared/constants.js';

export class HomeScreen {
  constructor(app) {
    this.app = app;
    this.root = $('#screen-home');
    this.list = $('#rooms-list');
    this.rooms = [];
    const p = app.prefs;
    this.name = $('#in-name');
    this.number = $('#in-number');
    this.name.value = p.name;
    this.number.value = p.number;
    this.updateJersey();

    const commit = () => {
      const name = this.name.value.replace(/\s+/g, ' ').trim().slice(0, 16) || p.name;
      let num = Math.floor(+this.number.value);
      if (!Number.isFinite(num) || num < 1 || num > 99) num = p.number;
      app.setProfile(name, num);
      this.updateJersey();
    };
    this.name.addEventListener('change', commit);
    this.name.addEventListener('blur', commit);
    this.number.addEventListener('input', () => this.updateJersey(true));
    this.number.addEventListener('change', commit);

    $('#btn-quick').addEventListener('click', () => {
      commit();
      app.requireOnline(() => app.net.send({ t: 'quick' }));
    });
    $('#btn-create').addEventListener('click', () => {
      commit();
      app.requireOnline(() => app.modals.createRoom());
    });
    $('#btn-practice').addEventListener('click', () => {
      commit();
      app.modals.practice();
    });
    $('#btn-refresh').addEventListener('click', () => app.net.send({ t: 'list' }));
    const code = $('#in-code');
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    });
    $('#join-form').addEventListener('submit', (e) => {
      e.preventDefault();
      commit();
      if (code.value.length < 5) {
        code.focus();
        return;
      }
      app.requireOnline(() => app.net.send({ t: 'join', code: code.value }));
    });
    this.renderRooms([]);
  }

  syncProfile() {
    if (document.activeElement !== this.name) this.name.value = this.app.prefs.name;
    if (document.activeElement !== this.number) this.number.value = this.app.prefs.number;
    this.updateJersey();
  }

  updateJersey(live = false) {
    const v = live ? this.number.value : this.app.prefs.number;
    $('#jersey-num').textContent = String(v || '').slice(0, 2);
    $('#jersey-preview svg').style.color = KITS[0].primary;
  }

  show(v) {
    this.root.hidden = !v;
    if (v) this.app.net.send({ t: 'list' });
  }

  renderRooms(rooms) {
    this.rooms = rooms;
    $('#rooms-count').textContent = rooms.length;
    this.list.innerHTML = '';
    if (!rooms.length) {
      const online = this.app.net.status === 'open';
      this.list.append(el('div', {
        class: 'empty',
        html: `<div><svg class="ball-anim" viewBox="0 0 64 64"><use href="#ico-ball"/></svg>
          <b>${online ? 'Henüz açık oda yok' : 'Sunucuya bağlanılamadı'}</b>
          ${online ? 'İlk odayı sen kur, kodu arkadaşlarına gönder!' : 'Bağlantı yeniden deneniyor… Bu arada <b style="display:inline">Antrenman</b> ile botlara karşı oynayabilirsin.'}</div>`,
      }));
      return;
    }
    rooms.forEach((r, i) => {
      const slots = el('span', { class: 'slots' });
      for (let k = 0; k < r.max; k++) slots.append(el('i', { class: k < r.players ? 'on' : '' }));
      const row = el('div', { class: 'room-row' },
        el('div', { class: 'rr-icon', text: `${r.teamSize}v${r.teamSize}` }),
        el('div', {},
          el('div', { class: 'rr-name', text: r.name }),
          el('div', { class: 'rr-sub', html: `<span class="status-dot ${r.status}">${r.status === 'playing' ? 'Maçta' : 'Lobide'}</span> · ${esc(r.host)}` })),
        el('div', { class: 'rr-count' }, slots, el('span', { text: `${r.players}/${r.max}` })),
        el('button', {
          class: 'btn small accent',
          type: 'button',
          disabled: r.players >= r.max || undefined,
          onclick: () => this.app.net.send({ t: 'join', code: r.code }),
        }, r.players >= r.max ? 'Dolu' : 'Katıl'));
      this.list.append(row);
    });
    void icon;
  }
}
