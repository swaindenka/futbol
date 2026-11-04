// In-game heads-up display (DOM overlay).

import { $, el, esc, fmtTime } from './dom.js';
import { PHASE, EMOTES, TIMING } from '../../shared/constants.js';

const upper = (s) => String(s).toLocaleUpperCase('tr');

export class Hud {
  constructor(app) {
    this.app = app;
    this.root = $('#hud');
    this.s0 = $('#sb-s0');
    this.s1 = $('#sb-s1');
    this.clock = $('#sb-clock');
    this.tag = $('#sb-tag');
    this.countdownEl = $('#countdown');
    this.bannerEl = $('#banner');
    this.goalEl = $('#goal-banner');
    this.popEl = $('#pop');
    this.feedEl = $('#feed');
    this.chatLog = $('#hud-chat-log');
    this.replayBadge = $('#replay-badge');
    this.spectateBar = $('#spectate-bar');
    this.minimap = $('#minimap');
    this.ping = $('#hud-ping');
    this.scores = $('#scores-overlay');
    this.hintEl = $('#hint');
    this.last = {};
    this.minimapTick = 0;

    const bar = $('#emote-bar');
    EMOTES.forEach((t, i) => {
      const b = el('button', { type: 'button', html: `<kbd>${i + 1}</kbd>${esc(t)}` });
      b.addEventListener('click', () => app.sendEmote(i));
      bar.append(b);
    });
  }

  show(v) {
    this.root.hidden = !v;
    if (!v) {
      this.setReplay(false);
      this.scores.hidden = true;
    }
  }

  reset(session) {
    this.last = {};
    this.feedEl.innerHTML = '';
    this.goalEl.innerHTML = '';
    this.bannerEl.innerHTML = '';
    this.countdownEl.innerHTML = '';
    const kits = session.kits;
    const teams = this.root.querySelectorAll('.sb-team');
    teams.forEach((t, i) => {
      t.querySelector('.sb-kit').style.setProperty('--k', kits[i].primary);
      t.querySelector('.sb-name').textContent = upper(kits[i].name).slice(0, 3);
      t.title = kits[i].name;
    });
    for (const b of this.root.querySelectorAll('[data-kitname]')) b.textContent = kits[+b.dataset.kitname].name;
    this.ping.hidden = session.mode !== 'online';
  }

  set(key, value, fn) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    fn(value);
  }

  update(session, view) {
    const s = session.state;
    this.set('s0', s.score[0], (v) => {
      this.s0.textContent = v;
    });
    this.set('s1', s.score[1], (v) => {
      this.s1.textContent = v;
    });
    const clock = s.ot ? 'UZATMA' : fmtTime(s.time);
    this.set('clock', clock, (v) => {
      this.clock.textContent = v;
    });
    const low = !s.ot && s.time < 60 * 10 && s.phase !== PHASE.ENDED;
    this.set('low', low, (v) => this.clock.classList.toggle('low', v));
    const tag = s.ot ? 'ALTIN GOL' : s.phase === PHASE.KICKOFF ? 'SANTRA' : '';
    this.set('tag', tag, (v) => {
      this.tag.hidden = !v;
      this.tag.textContent = v;
    });

    const cd = s.phase === PHASE.COUNTDOWN ? Math.ceil(s.pt / TIMING.COUNTDOWN_STEP) : 0;
    this.set('cd', cd, (v) => {
      this.countdownEl.innerHTML = v > 0 && v <= 3 ? `<span>${v}</span>` : '';
    });

    const spectating = session.mode === 'online' && !session.isPlaying() && s.phase !== PHASE.ENDED;
    this.set('spec', spectating, (v) => {
      this.spectateBar.hidden = !v;
    });

    const follow = this.app.renderer.cam.mode === 'follow' && !session.replay;
    this.set('mm', follow, (v) => {
      this.minimap.hidden = !v;
    });
    if (follow && ++this.minimapTick % 3 === 0) this.app.renderer.drawMinimap(this.minimap, view);

    if (session.mode === 'online') {
      const rtt = Math.round(this.app.net.rtt);
      this.set('ping', rtt, (v) => {
        this.ping.textContent = `${v} ms`;
        this.ping.style.color = v < 80 ? '' : v < 160 ? 'var(--gold)' : 'var(--red)';
      });
    }
  }

  banner(title, sub = '', ms = 2000) {
    const n = el('div', { class: 'bn', style: { animationDuration: `${ms}ms` } }, el('h2', { text: title }), sub ? el('p', { text: sub }) : null);
    this.bannerEl.innerHTML = '';
    this.bannerEl.append(n);
    setTimeout(() => n.remove(), ms);
  }

  popText(t) {
    const n = el('span', { text: t });
    this.popEl.innerHTML = '';
    this.popEl.append(n);
    setTimeout(() => n.remove(), 1300);
  }

  goal({ team, kit, scorer, assist, own, mine, score, kits }) {
    const title = own ? 'KENDİ KALESİNE!' : mine ? 'GOLÜN!' : 'GOOOL!';
    const who = scorer ? `${esc(scorer)}${own ? ' (k.k.)' : ''}` : esc(kit.name);
    const assistTxt = assist ? `<small>Asist: ${esc(assist)}</small>` : '';
    const node = el('div', {
      class: 'gb',
      style: { '--gc': kit.primary, '--gc2': kit.secondary },
      html: `
        <div class="gb-stripe" style="--gc:${kit.primary};--gc2:${kit.secondary}"></div>
        <div class="gb-text" style="color:${kit.text}">
          <h1>${title}</h1>
          <div class="gb-who">⚽ ${who}${assistTxt}</div>
          <div class="gb-score">${esc(upper(kits[0].name).slice(0, 3))} ${score[0]} - ${score[1]} ${esc(upper(kits[1].name).slice(0, 3))}</div>
        </div>`,
    });
    this.goalEl.innerHTML = '';
    this.goalEl.append(node);
    setTimeout(() => node.remove(), 1700);
    const target = team === 0 ? this.s0 : this.s1;
    target.classList.remove('bump');
    void target.offsetWidth;
    target.classList.add('bump');
    this.feed(`⚽ ${scorer || kit.name}${own ? ' (kendi kalesine)' : ''}${assist ? ` · asist ${assist}` : ''}`, '', kit.primary);
  }

  feed(text, kind = '', color) {
    const n = el('div', { class: `feed-item ${kind}`, text });
    if (color) n.style.setProperty('--fc', color);
    this.feedEl.append(n);
    while (this.feedEl.children.length > 5) this.feedEl.firstChild.remove();
    setTimeout(() => n.classList.add('out'), 5200);
    setTimeout(() => n.remove(), 5600);
  }

  chat(msg, kits) {
    const n = el('div', { class: `msg ${msg.sys ? 'sys' : ''}` });
    if (msg.sys) n.textContent = msg.text;
    else {
      const color = msg.team >= 0 && kits ? kits[msg.team].primary : '#b6ff3b';
      n.append(el('b', { text: msg.name, style: { color } }), msg.text);
    }
    this.chatLog.append(n);
    while (this.chatLog.children.length > 7) this.chatLog.firstChild.remove();
    setTimeout(() => n.classList.add('fade'), 9000);
    setTimeout(() => n.remove(), 10500);
  }

  setReplay(on) {
    this.replayBadge.hidden = !on;
  }

  hints(list) {
    let i = 0;
    const next = () => {
      if (i >= list.length || this.root.hidden) {
        this.hintEl.innerHTML = '';
        return;
      }
      const n = el('div', { html: list[i++] });
      this.hintEl.innerHTML = '';
      this.hintEl.append(n);
      setTimeout(() => n.classList.add('out'), 4200);
      setTimeout(next, 4700);
    };
    setTimeout(next, 3600);
  }

  showScores(on, html) {
    this.scores.hidden = !on;
    if (on) this.scores.innerHTML = html;
  }
}
