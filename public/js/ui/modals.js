// Modal dialogs: create room, practice, settings, help, in-game menu, end of match.

import { el, esc, icon, seg, toggle, openModal } from './dom.js';
import { KITS } from '../../shared/constants.js';
import { BOT_LEVEL_NAMES } from '../../shared/bot.js';

const upper = (s) => String(s).toLocaleUpperCase('tr');

export function statsTablesHtml(players, kits, myId, { rating = true } = {}) {
  const team = (t) => {
    const rows = players.filter((p) => p.team === t);
    const body = rows.map((p) => `
      <tr class="${p.id === myId ? 'me' : ''}">
        <td><span class="pn">${esc(p.name)}${p.bot ? ' <em>bot</em>' : ''}</span></td>
        <td>${p.goals}</td><td>${p.assists}</td><td>${p.shots}</td>
        ${rating && p.rating !== undefined ? `<td><span class="rating ${p.rating >= 8 ? 'hi' : ''}">${p.rating.toFixed(1)}</span></td>` : ''}
      </tr>`).join('');
    return `
      <div class="stats-team">
        <h4><i style="--k:${kits[t].primary}"></i>${esc(kits[t].name)}</h4>
        <table class="stats">
          <thead><tr><th>Oyuncu</th><th title="Gol">G</th><th title="Asist">A</th><th title="Şut">Şut</th>${rating && rows.some((p) => p.rating !== undefined) ? '<th>Puan</th>' : ''}</tr></thead>
          <tbody>${body || '<tr><td colspan="7" class="muted">—</td></tr>'}</tbody>
        </table>
      </div>`;
  };
  return `<div class="stats-teams">${team(0)}${team(1)}</div>`;
}

export class Modals {
  constructor(app) {
    this.app = app;
  }

  createRoom() {
    const app = this.app;
    const name = el('input', { class: 'input', maxlength: 28, value: `${app.prefs.name} odası`, spellcheck: 'false' });
    let isPublic = true;
    const m = openModal({
      id: 'create',
      title: 'Oda Kur',
      body: el('div', { class: 'menu-list' },
        el('label', { class: 'field' }, el('span', { text: 'Oda adı' }), name),
        el('div', { class: 'toggle-row' }, el('span', { text: 'Herkese açık (listede görünsün)' }), toggle(true, (v) => { isPublic = v; }))),
      foot: [
        el('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Vazgeç'),
        el('button', { class: 'btn primary', type: 'button', onclick: submit }, icon('plus'), 'Oluştur'),
      ],
    });
    function submit() {
      app.net.send({ t: 'create', name: name.value, isPublic });
      m.close();
    }
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  practice() {
    const app = this.app;
    const opts = { teamSize: 3, level: 1, duration: 180, ...(app.prefs.practice || {}) };
    const m = openModal({
      id: 'practice',
      title: 'Antrenman',
      body: el('div', { class: 'menu-list' },
        el('p', { class: 'muted', style: { margin: 0 }, text: 'Sunucuya gerek yok: botlara karşı tek başına oyna, kontrolleri öğren.' }),
        el('div', { class: 'set-row' }, el('label', { text: 'Takım boyutu' }), seg([1, 2, 3, 4].map((v) => ({ v, label: `${v}v${v}` })), opts.teamSize, (v) => { opts.teamSize = v; }, { cls: 'lime' })),
        el('div', { class: 'set-row' }, el('label', { text: 'Rakip seviyesi' }), seg([0, 1, 2].map((v) => ({ v, label: BOT_LEVEL_NAMES[v] })), opts.level, (v) => { opts.level = v; })),
        el('div', { class: 'set-row' }, el('label', { text: 'Süre' }), seg([60, 180, 300].map((v) => ({ v, label: `${v / 60} dk` })), opts.duration, (v) => { opts.duration = v; }))),
      foot: [
        el('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Vazgeç'),
        el('button', {
          class: 'btn primary',
          type: 'button',
          onclick: () => {
            m.close();
            app.prefs.practice = opts;
            app.savePrefs();
            app.startPractice(opts);
          },
        }, icon('play'), 'Başla'),
      ],
    });
  }

  settings() {
    const app = this.app;
    const p = app.prefs;
    const vol = el('input', { type: 'range', class: 'range', min: 0, max: 1, step: 0.05, value: p.volume });
    vol.addEventListener('input', () => app.setPref('volume', +vol.value));
    const tilt = el('input', { type: 'range', class: 'range', min: 0.55, max: 1, step: 0.01, value: p.tilt });
    tilt.addEventListener('input', () => app.setPref('tilt', +tilt.value));
    const row = (label, ctl) => el('div', { class: 'set-row' }, el('label', { text: label }), ctl);
    let touchRows = [];
    if (app.touch) {
      const ta = el('input', { type: 'range', class: 'range', min: 0.2, max: 1, step: 0.05, value: p.touchAlpha });
      ta.addEventListener('input', () => app.setPref('touchAlpha', +ta.value));
      touchRows = [
        row('Dokunmatik tuş saydamlığı (sol: daha saydam)', ta),
        row('Dokunmatik tuş boyutu', seg([{ v: 0.82, label: 'Küçük' }, { v: 1, label: 'Orta' }, { v: 1.2, label: 'Büyük' }], p.touchSize, (v) => app.setPref('touchSize', v))),
      ];
    }
    openModal({
      id: 'settings',
      title: 'Ayarlar',
      body: el('div', { class: 'menu-list' },
        row('Ses düzeyi', vol),
        el('div', { class: 'toggle-row' }, el('span', { text: 'Sesi kapat' }), toggle(p.muted, (v) => app.setMuted(v))),
        row('Kamera', seg([{ v: 'auto', label: 'Otomatik' }, { v: 'full', label: 'Tüm saha' }, { v: 'follow', label: 'Takip' }], p.camera, (v) => app.setPref('camera', v))),
        row('Kamera açısı (sol: eğik · sağ: tam üstten)', tilt),
        row('Grafik kalitesi', seg([{ v: 'high', label: 'Yüksek' }, { v: 'medium', label: 'Orta' }, { v: 'low', label: 'Düşük' }], p.quality, (v) => app.setPref('quality', v))),
        el('div', { class: 'toggle-row' }, el('span', { text: 'Gol tekrarlarını göster' }), toggle(p.replays, (v) => app.setPref('replays', v))),
        ...touchRows),
    });
  }

  help() {
    const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
    const item = (label, keys) => `<div class="help-item"><span>${label}</span><span>${keys}</span></div>`;
    openModal({
      id: 'help',
      title: 'Nasıl Oynanır',
      wide: true,
      body: `
        <div class="help-grid">
          <div class="help-section">
            <h3>Oynanış</h3>
            ${item('Hareket', `${k('W', 'A', 'S', 'D')} veya ${k('↑', '←', '↓', '→')}`)}
            ${item('Vur', `${k('Space')} ${k('X')} ${k('Shift')} veya tık`)}
            ${item('Mobil', 'Sol tarafta joystick, sağda VUR')}
            ${item('Gamepad', 'Sol çubuk ile koş, herhangi bir tuş ile vur')}
          </div>
          <div class="help-section">
            <h3>Diğer</h3>
            ${item('Sohbet', k('Enter'))}
            ${item('Hızlı mesajlar', k('1', '2', '3', '4', '5', '6'))}
            ${item('Skor tablosu', k('Tab'))}
            ${item('Kamera modu', k('F'))}
            ${item('Ses aç/kapat', k('M'))}
            ${item('Menü', k('Esc'))}
          </div>
        </div>
        <div class="help-section">
          <h3>İpuçları</h3>
          <ul class="tips">
            <li><b>Topa koşarak çarparsan</b> top önünde ilerler, böylece topu sürersin.</li>
            <li><b>Vur tuşu</b> topu senden uzağa, gövdenin baktığı değil topun bulunduğu yöne doğru sertçe gönderir. Nişan almak için topun arkasına geç.</li>
            <li>Tuşa basılıyken etrafında beyaz bir halka çıkar; top değdiği anda vuruş olur.</li>
            <li><b>Kenarlar banttır:</b> top duvarlardan seker, banttan gol atabilirsin.</li>
          </ul>
        </div>`,
    });
  }

  gameMenu() {
    const app = this.app;
    const s = app.session;
    if (!s || s.mode === 'demo') return;
    const online = s.mode === 'online';
    const room = app.room;
    const host = online && room && room.hostId === app.myId;
    const list = el('div', { class: 'menu-list' });
    const m = openModal({ id: 'menu', title: online ? (room ? room.name : 'Maç') : 'Antrenman', body: list });
    list.append(el('button', { class: 'btn primary', type: 'button', onclick: () => m.close() }, icon('play'), 'Devam et'));
    if (online) {
      const mine = room && room.players.find((p) => p.id === app.myId);
      const teams = el('div', { class: 'menu-teams' });
      [[0, s.kits[0].name], [1, s.kits[1].name], [-1, 'İzleyici']].forEach(([t, label]) => {
        teams.append(el('button', {
          class: `btn small ${mine && mine.team === t ? 'accent' : ''}`,
          type: 'button',
          onclick: () => {
            app.net.send({ t: 'team', team: t });
            m.close();
          },
        }, label));
      });
      list.append(el('div', { class: 'set-row' }, el('label', { text: 'Takım değiştir' }), teams));
    }
    list.append(el('button', { class: 'btn', type: 'button', onclick: () => { m.close(); this.settings(); } }, icon('gear'), 'Ayarlar'));
    list.append(el('button', { class: 'btn', type: 'button', onclick: () => { m.close(); this.help(); } }, icon('keyboard'), 'Kontroller'));
    if (host) list.append(el('button', { class: 'btn', type: 'button', onclick: () => { app.net.send({ t: 'stop' }); m.close(); } }, icon('x'), 'Maçı bitir'));
    if (online) {
      list.append(el('button', { class: 'btn danger', type: 'button', onclick: () => { m.close(); app.leaveRoom(); } }, icon('back'), 'Odadan ayrıl'));
    } else {
      list.append(el('button', { class: 'btn danger', type: 'button', onclick: () => { m.close(); app.backHome(); } }, icon('back'), 'Ana menüye dön'));
    }
  }

  end(result, kits, opts) {
    const app = this.app;
    const myId = app.session ? app.session.myId : app.myId;
    const [a, b] = result.score;
    const me = result.players.find((p) => p.id === myId);
    let title;
    if (result.winner < 0) title = 'Berabere';
    else if (me && me.team === result.winner) title = 'Kazandın! 🏆';
    else if (me) title = 'Kaybettin';
    else title = `${kits[result.winner].name} kazandı`;
    const mvp = result.players.find((p) => p.id === result.mvp);
    const teamBadge = (k) => `<div class="team-badge" style="--tc:${k.primary};--tc2:${k.secondary};--stripes:${k.pattern === 'stripes' ? 1 : 0}"></div>`;
    const body = el('div', {
      html: `
        <div class="end-hero">
          <div class="result">Maç sonucu</div>
          <div class="winner" style="color:${result.winner >= 0 ? kits[result.winner].primary : 'var(--text)'}">${esc(title)}</div>
          <div class="end-score">
            <div class="end-team">${teamBadge(kits[0])}<span>${esc(kits[0].name)}</span></div>
            <div class="end-num">${a}</div><div class="end-num dash">–</div><div class="end-num">${b}</div>
            <div class="end-team">${teamBadge(kits[1])}<span>${esc(kits[1].name)}</span></div>
          </div>
          <div class="poss">
            <div class="poss-bar"><i style="width:${result.possession[0]}%;background:${kits[0].primary}"></i><i style="width:${result.possession[1]}%;background:${kits[1].primary}"></i></div>
            <div class="poss-labels"><span>%${result.possession[0]}</span><span>Topa sahip olma</span><span>%${result.possession[1]}</span></div>
          </div>
        </div>
        ${mvp ? `<div class="mvp"><span class="mvp-badge">MVP</span><div><div class="mvp-name">${esc(mvp.name)}</div><div class="mvp-sub">${esc(kits[mvp.team].name)} · ${mvp.goals} gol · ${mvp.assists} asist · ${mvp.shots} şut</div></div><div class="mvp-rating">${mvp.rating.toFixed(1)}</div></div>` : ''}
        ${statsTablesHtml(result.players, kits, myId)}`,
    });
    const foot = [];
    let m;
    if (opts.practice) {
      foot.push(el('button', { class: 'btn ghost', type: 'button', onclick: () => { m.skip = true; m.close(); app.backHome(); } }, 'Ana menü'));
      foot.push(el('button', { class: 'btn primary', type: 'button', onclick: () => { m.skip = true; m.close(); app.startPractice(app.prefs.practice || {}); } }, icon('play'), 'Tekrar oyna'));
    } else {
      const host = app.room && app.room.hostId === myId;
      foot.push(el('button', { class: 'btn', type: 'button', onclick: () => { m.skip = true; m.close(); app.toRoom(); } }, 'Odaya dön'));
      if (host) foot.push(el('button', { class: 'btn primary', type: 'button', onclick: () => { m.skip = true; m.close(); app.net.send({ t: 'start' }); } }, icon('play'), 'Rövanş'));
    }
    m = openModal({
      id: 'end',
      title: '',
      wide: true,
      body,
      foot,
      closable: true,
      onClose: () => {
        if (m.skip || app.starting) return;
        if (opts.practice) {
          if (app.session && app.session.ended) app.backHome();
        } else if (app.screen === 'game' && (!app.session || app.session.ended)) app.toRoom();
      },
    });
    void KITS;
    void upper;
    return m;
  }
}
