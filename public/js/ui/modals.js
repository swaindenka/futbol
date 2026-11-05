// Modal dialogs: create room, practice, settings, help, in-game menu, end of match.

import { el, esc, icon, seg, toggle, openModal } from './dom.js';
import {
  KITS, PU, PU_INFO, PU_LEVEL_NAMES, puLevel,
} from '../../shared/constants.js';
import { BOT_LEVEL_NAMES } from '../../shared/bot.js';

const upper = (s) => String(s).toLocaleUpperCase('tr');

// Help screen: every pickup (and the curses hidden in the surprise box).
const PU_HELP = [PU.FIRE, PU.GIANT, PU.SPEED, PU.MAGNET, PU.GHOST, PU.SHIELD, PU.ICE, PU.SHOCK, PU.RUBBER, PU.MYSTERY, PU.DIZZY, PU.SLIPPY];
const PU_HELP_TEXT = {
  [PU.FIRE]: 'Sonraki vuruşun alev alır, çok sert gider; çarptığı oyuncuyu savurup sersemletir.',
  [PU.GIANT]: '8 sn kocaman ve ağır olursun: rakipleri itersin, kaleyi kapatırsın.',
  [PU.SPEED]: '6 sn çok daha hızlı koşar, daha çabuk ivmelenirsin.',
  [PU.MAGNET]: '7 sn top ayağına yapışır, yakındaki yavaş topları kendine çeker.',
  [PU.GHOST]: '6 sn oyuncuların içinden geçersin; şok ve ateş topu sana işlemez.',
  [PU.SHIELD]: 'Kalenin önünde enerji perdesi: ilk şutu geri çevirir (12 sn).',
  [PU.ICE]: 'Rakip takımın tamamı 4 sn yavaşlar.',
  [PU.SHOCK]: 'Anında patlar: yakındaki rakipleri savurur ve kısa süre sersemletir.',
  [PU.RUBBER]: 'Top 10 sn bantlardan ve oyunculardan hız kaybetmeden seker.',
  [PU.MYSTERY]: 'İçinden rastgele bir güçlendirme çıkar… ya da bir lanet!',
  [PU.DIZZY]: 'Lanet: 3.5 sn kontrollerin ters döner.',
  [PU.SLIPPY]: 'Lanet: 4.5 sn ayakların buzda gibi kayar.',
};

export function statsTablesHtml(players, kits, myId, { rating = true } = {}) {
  const team = (t) => {
    const rows = players.filter((p) => p.team === t);
    const body = rows.map((p) => `
      <tr class="${p.id === myId ? 'me' : ''}">
        <td><span class="pn">${esc(p.name)}${p.bot ? ' <em>bot</em>' : ''}${p.ownGoals ? ` <em title="Kendi kalesine">${p.ownGoals} k.k.</em>` : ''}</span></td>
        <td>${p.goals}</td><td>${p.assists}</td><td>${p.shots}</td><td>${p.saves || 0}</td><td>${p.tackles || 0}</td>
        ${rating && p.rating !== undefined ? `<td><span class="rating ${p.rating >= 8 ? 'hi' : ''}">${p.rating.toFixed(1)}</span></td>` : ''}
      </tr>`).join('');
    return `
      <div class="stats-team">
        <h4><i style="--k:${kits[t].primary}"></i>${esc(kits[t].name)}</h4>
        <table class="stats">
          <thead><tr><th>Oyuncu</th><th title="Gol">G</th><th title="Asist">A</th><th title="Şut">Şut</th><th title="Kurtarış">Kur</th><th title="Top kapma">Kap</th>${rating && rows.some((p) => p.rating !== undefined) ? '<th>Puan</th>' : ''}</tr></thead>
          <tbody>${body || '<tr><td colspan="8" class="muted">—</td></tr>'}</tbody>
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

  profile() {
    const app = this.app;
    const name = el('input', { class: 'input', maxlength: 16, value: app.prefs.name, spellcheck: 'false', autocomplete: 'nickname' });
    const num = el('input', { class: 'input', type: 'number', min: 1, max: 99, inputmode: 'numeric', value: app.prefs.number, style: { textAlign: 'center', fontFamily: 'var(--display)', fontSize: '18px' } });
    const jersey = el('div', { class: 'jersey', html: '<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#ico-jersey"/></svg><span></span>' });
    const kits = app.session && app.session.mode !== 'demo' ? app.session.kits : app.room ? app.room.settings.kits.map((i) => KITS[i]) : [KITS[0], KITS[4]];
    const me = app.room && app.room.players.find((p) => p.id === app.myId);
    const team = me && me.team >= 0 ? me.team : 0;
    jersey.querySelector('svg').style.color = kits[team].primary;
    const paint = () => {
      jersey.querySelector('span').textContent = String(num.value || '').slice(0, 2);
    };
    paint();
    num.addEventListener('input', paint);
    const m = openModal({
      id: 'profile',
      title: 'Profilim',
      body: el('div', { class: 'profile' }, jersey,
        el('label', { class: 'field grow' }, el('span', { text: 'Takma ad' }), name),
        el('label', { class: 'field num' }, el('span', { text: 'No' }), num)),
      foot: [
        el('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Vazgeç'),
        el('button', { class: 'btn primary', type: 'button', onclick: save }, 'Kaydet'),
      ],
    });
    function save() {
      const n = name.value.replace(/\s+/g, ' ').trim().slice(0, 16);
      let v = Math.floor(+num.value);
      if (!Number.isFinite(v) || v < 1 || v > 99) v = app.prefs.number;
      app.setProfile(n || app.prefs.name, v);
      m.close();
    }
    for (const inp of [name, num]) inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
  }

  practice() {
    const app = this.app;
    const opts = { teamSize: 3, level: 1, duration: 180, powerups: 2, ...(app.prefs.practice || {}) };
    opts.powerups = puLevel(opts.powerups);
    const m = openModal({
      id: 'practice',
      title: 'Antrenman',
      body: el('div', { class: 'menu-list' },
        el('p', { class: 'muted', style: { margin: 0 }, text: 'Sunucuya gerek yok: botlara karşı tek başına oyna, kontrolleri öğren.' }),
        el('div', { class: 'set-row' }, el('label', { text: 'Takım boyutu' }), seg([1, 2, 3, 4].map((v) => ({ v, label: `${v}v${v}` })), opts.teamSize, (v) => { opts.teamSize = v; }, { cls: 'lime' })),
        el('div', { class: 'set-row' }, el('label', { text: 'Rakip seviyesi' }), seg([0, 1, 2].map((v) => ({ v, label: BOT_LEVEL_NAMES[v] })), opts.level, (v) => { opts.level = v; })),
        el('div', { class: 'set-row' }, el('label', { text: 'Süre' }), seg([60, 180, 300].map((v) => ({ v, label: `${v / 60} dk` })), opts.duration, (v) => { opts.duration = v; })),
        el('div', { class: 'set-row' }, el('label', { text: 'Güçlendirmeler' }), seg([0, 1, 2, 3].map((v) => ({ v, label: PU_LEVEL_NAMES[v] })), opts.powerups, (v) => { opts.powerups = v; }))),
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
            ${item('Vur', `${k('Space')} ${k('X')} veya tık`)}
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
            <li>Top yakınındayken önünde çıkan <b>oklar</b> vuruşta topun gideceği yönü gösterir.</li>
            <li>Tuşa basılıyken etrafında beyaz bir halka çıkar; top değdiği anda vuruş olur.</li>
            <li>Topla dönerken yavaş dön: top ayağına yapışmaz ama hafifçe seni takip eder.</li>
            <li><b>Falso:</b> vurduktan hemen sonra yön tuşunu yana çevirirsen top o yöne kavis alır. Defansın ya da kalecinin yanından dolandırmak için kullan; düz vuruş için yönü vuruş doğrultusunda tut.</li>
            <li><b>Kurtarış ve top kapma</b> maç sonu puanını artırır: kaleye giden şutu gövdenle kes, rakibin ayağındaki topu çal.</li>
            <li><b>Kenarlar banttır:</b> top duvarlardan seker, banttan gol atabilirsin. Köşeler yuvarlak olduğu için top köşede sıkışmaz.</li>
          </ul>
        </div>
        <div class="help-section">
          <h3>Güçlendirmeler</h3>
          <p class="muted small" style="margin:0 0 8px">Maç sırasında sahada parlayan rozetler belirir, üstünden geçen kapar. Sıklığı oda ayarlarından seçilir (Kapalı / Az / Normal / Kaos).</p>
          <div class="pu-help">${PU_HELP.map((k) => `<div class="pu-help-item" style="--pc:${PU_INFO[k].color}"><b>${esc(PU_INFO[k].name)}</b><span>${esc(PU_HELP_TEXT[k])}</span></div>`).join('')}</div>
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
    const m = openModal({ id: 'menu', title: online ? (room ? room.name : 'Maç') : 'Duraklatıldı', body: list });
    list.append(el('button', { class: 'btn primary', type: 'button', onclick: () => m.close() }, icon('play'), 'Devam et'));
    if (!online) {
      list.append(el('button', {
        class: 'btn',
        type: 'button',
        onclick: () => {
          m.close();
          app.startPractice(app.prefs.practice || {});
        },
      }, icon('refresh'), 'Yeniden başlat'));
    }
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
    list.append(el('button', { class: 'btn', type: 'button', onclick: () => { m.close(); this.profile(); } }, icon('jersey-sm'), 'Profilim (ad / numara)'));
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
        ${mvp ? `<div class="mvp"><span class="mvp-badge">MVP</span><div><div class="mvp-name">${esc(mvp.name)}</div><div class="mvp-sub">${esc(kits[mvp.team].name)} · ${mvp.goals} gol · ${mvp.assists} asist · ${mvp.shots} şut${mvp.saves ? ` · ${mvp.saves} kurtarış` : ''}</div></div><div class="mvp-rating">${mvp.rating.toFixed(1)}</div></div>` : ''}
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
    void upper;
    return m;
  }
}
