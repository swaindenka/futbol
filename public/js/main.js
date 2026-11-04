// Application controller: screens, networking, sessions.

import { Renderer } from './game/renderer.js';
import { Input } from './game/input.js';
import { TouchControls, isTouchDevice } from './game/touch.js';
import { Session } from './game/session.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { $, $$, toast, modalOpen, closeTopModal, closeAllModals } from './ui/dom.js';
import { Hud } from './ui/hud.js';
import { HomeScreen } from './ui/home.js';
import { RoomScreen } from './ui/room.js';
import { Modals, statsTablesHtml } from './ui/modals.js';
import { DEFAULT_SETTINGS, KITS } from '../shared/constants.js';

class App {
  constructor() {
    this.prefs = loadPrefs();
    this.canvas = $('#game');
    this.renderer = new Renderer(this.canvas);
    this.renderer.quality = this.prefs.quality;
    this.renderer.resize();
    this.audio = new Audio();
    this.audio.volume = this.prefs.volume;
    this.audio.muted = this.prefs.muted;
    document.body.classList.toggle('muted', this.prefs.muted);
    this.input = new Input(this.canvas);
    this.input.onAction = (a, e) => this.onAction(a, e);
    this.touch = isTouchDevice() ? new TouchControls($('#touch')) : null;
    this.input.touch = this.touch;
    document.body.classList.toggle('touch-ui', !!this.touch);
    if (this.touch) this.touch.setLook(this.prefs.touchAlpha, this.prefs.touchSize);
    this.net = new Net();
    this.net.hello = () => ({ t: 'hello', name: this.prefs.name, number: this.prefs.number });

    this.hud = new Hud(this);
    this.modals = new Modals(this);
    this.home = new HomeScreen(this);
    this.roomUI = new RoomScreen(this);

    this.session = null;
    this.screen = 'home';
    this.myId = -1;
    this.room = null;
    this.chatOpen = false;
    this.liveStats = new Map();
    this.pendingJoin = new URLSearchParams(location.search).get('oda');
    this.lastRoomCode = null;
    this.endModal = null;

    this.bindNet();
    this.bindUi();
    this.startDemo();
    this.showScreen('home');

    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = () => this.audio.ensure();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    const loop = (t) => {
      if (this.session) {
        try {
          this.session.frame(t);
        } catch (err) {
          console.error(err);
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.net.connect();
  }

  // ---------------------------------------------------------------------------
  // Preferences

  savePrefs() {
    savePrefs(this.prefs);
  }

  setPref(key, value) {
    this.prefs[key] = value;
    this.savePrefs();
    if (key === 'volume') this.audio.setVolume(value);
    if ((key === 'touchAlpha' || key === 'touchSize') && this.touch) this.touch.setLook(this.prefs.touchAlpha, this.prefs.touchSize);
    if (key === 'quality') {
      this.renderer.setQuality(value);
      if (this.session) {
        this.session.fx.quality = value;
        this.renderer.prepare(this.session.field, this.session.kits);
      }
    }
  }

  setMuted(m) {
    this.prefs.muted = m;
    this.savePrefs();
    this.audio.setMuted(m);
    document.body.classList.toggle('muted', m);
  }

  setProfile(name, number) {
    const changed = name !== this.prefs.name || number !== this.prefs.number;
    this.prefs.name = name;
    this.prefs.number = number;
    this.savePrefs();
    if (changed) this.net.send({ t: 'profile', name, number });
  }

  // ---------------------------------------------------------------------------
  // Screens

  showScreen(name) {
    this.screen = name;
    this.home.show(name === 'home');
    this.roomUI.show(name === 'room');
    const game = name === 'game';
    this.hud.show(game);
    document.body.classList.toggle('in-game', game);
    this.input.enabled = game;
    if (!game) this.input.releaseAll();
    if (this.touch) this.touch.show(game && this.session && this.session.isPlaying());
    if (!game) this.setChat(false);
  }

  canControl() {
    return this.screen === 'game' && !modalOpen() && !this.chatOpen;
  }

  requireOnline(fn) {
    if (this.net.status === 'open' && this.myId >= 0) fn();
    else toast('Sunucuya bağlı değilsin. Bağlantı bekleniyor…', 'err');
  }

  inviteUrl(code) {
    return `${location.origin}${location.pathname}?oda=${code}`;
  }

  setUrlRoom(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('oda', code);
    else url.searchParams.delete('oda');
    history.replaceState(null, '', url);
  }

  // ---------------------------------------------------------------------------
  // Sessions

  setSession(s) {
    if (this.session) this.session.destroy();
    this.session = s;
  }

  startDemo() {
    const a = Math.floor(Math.random() * KITS.length);
    let b = Math.floor(Math.random() * KITS.length);
    if (b === a) b = (a + 4) % KITS.length;
    this.setSession(new Session(this, {
      mode: 'demo',
      settings: { ...DEFAULT_SETTINGS, duration: 600, goldenGoal: false, replays: false, kits: [a, b] },
      teamSize: 4,
      level: 2,
      fieldKey: 'large',
    }));
  }

  restartDemo() {
    if (this.session && this.session.mode === 'demo') this.startDemo();
  }

  startPractice(opts) {
    this.starting = true;
    closeAllModals();
    this.starting = false;
    const kits = [0, 4];
    this.setSession(new Session(this, {
      mode: 'practice',
      settings: { ...DEFAULT_SETTINGS, duration: opts.duration || 180, goldenGoal: true, kits },
      teamSize: opts.teamSize || 3,
      level: opts.level ?? 1,
    }));
    this.hud.reset(this.session);
    this.showScreen('game');
    this.firstHints();
  }

  startOnline(msg) {
    this.starting = true;
    closeAllModals();
    this.starting = false;
    this.setSession(new Session(this, {
      mode: 'online',
      myId: this.myId,
      fieldKey: msg.field,
      settings: msg.settings,
      rules: msg.rules,
      roster: msg.roster,
      snap: msg.snap,
    }));
    this.liveStats.clear();
    this.hud.reset(this.session);
    this.showScreen('game');
    if (this.session.isPlaying()) this.firstHints();
  }

  firstHints() {
    if (this.prefs.hintsSeen) return;
    this.prefs.hintsSeen = true;
    this.savePrefs();
    const touch = this.touch && matchMedia('(pointer: coarse)').matches;
    this.hud.hints(touch
      ? ['Sol tarafta parmağınla koş, topa çarparak sür.', 'Topun arkasına geç ve <b>VUR</b> tuşuna bas!']
      : ['<kbd>W A S D</kbd> veya ok tuşlarıyla koş, topa çarparak sür.', 'Topun arkasına geç ve <kbd>Space</kbd> ile vur!']);
  }

  backHome() {
    closeAllModals();
    this.startDemo();
    this.showScreen(this.room ? 'room' : 'home');
  }

  toRoom() {
    if (this.screen === 'room') return;
    if (this.session && this.session.mode !== 'demo') this.startDemo();
    if (this.room) {
      this.roomUI.render(this.room);
      this.showScreen('room');
    } else this.showScreen('home');
  }

  leaveRoom() {
    this.net.send({ t: 'leave' });
    this.room = null;
    this.lastRoomCode = null;
    this.setUrlRoom(null);
    this.roomUI.clearChat();
    if (this.session && this.session.mode === 'online') this.startDemo();
    this.showScreen('home');
  }

  showEnd(result, opts) {
    const kits = this.session ? this.session.kits : (this.room ? this.room.settings.kits.map((i) => KITS[i]) : [KITS[0], KITS[4]]);
    this.hud.showScores(false);
    this.endModal = this.modals.end(result, kits, opts);
  }

  sendEmote(idx) {
    const s = this.session;
    if (!s || !s.isPlaying()) return;
    if (s.mode === 'online') this.net.send({ t: 'emote', e: idx });
    else s.showEmote(this.myId, idx);
  }

  // ---------------------------------------------------------------------------
  // Network

  bindNet() {
    const net = this.net;
    const conn = $('#conn');
    net.on('status', (s) => {
      conn.dataset.s = s;
      conn.querySelector('span').textContent = s === 'open' ? 'Çevrimiçi' : s === 'connecting' ? 'Bağlanıyor…' : s === 'offline' ? 'Çevrimdışı' : 'Bağlantı yok';
      if (s === 'closed') {
        if (this.myId >= 0 && (this.room || (this.session && this.session.mode === 'online'))) {
          toast('Sunucu bağlantısı koptu, yeniden bağlanılıyor…', 'err');
          if (this.room) this.lastRoomCode = this.room.code;
          this.room = null;
          if (this.session && this.session.mode === 'online') this.startDemo();
          if (this.screen !== 'game' || !this.session || this.session.mode !== 'practice') this.showScreen('home');
        }
        this.myId = -1;
        this.home.renderRooms([]);
      }
    });
    net.on('welcome', (m) => {
      this.myId = m.id;
      this.home.renderRooms(m.rooms || []);
      const code = this.pendingJoin || this.lastRoomCode;
      this.pendingJoin = null;
      if (code) net.send({ t: 'join', code });
    });
    net.on('rooms', (m) => this.home.renderRooms(m.rooms));
    net.on('joined', (m) => {
      this.myId = m.you;
      this.room = m.room;
      this.lastRoomCode = m.room.code;
      this.setUrlRoom(m.room.code);
      this.roomUI.clearChat();
      this.roomUI.render(m.room);
      closeAllModals();
      if (!(this.session && this.session.mode === 'practice' && this.screen === 'game')) {
        if (this.session && this.session.mode !== 'demo') this.startDemo();
        this.showScreen('room');
      }
    });
    net.on('room', (m) => {
      if (!this.room || this.room.code !== m.room.code) return;
      this.room = m.room;
      this.roomUI.render(m.room);
      if (this.session && this.session.mode === 'online' && m.room.roster) this.session.setRoster(m.room.roster);
      if (this.screen === 'game' && this.touch) this.touch.show(this.session && this.session.isPlaying());
    });
    net.on('start', (m) => {
      if (!this.room) return;
      this.startOnline(m);
    });
    net.on('roster', (m) => {
      if (this.session && this.session.mode === 'online') {
        this.session.setRoster(m.roster);
        if (this.touch && this.screen === 'game') this.touch.show(this.session.isPlaying());
      }
    });
    net.on('s', (m) => {
      if (this.session && this.session.mode === 'online') {
        this.session.onSnapshot(m.a, m.d);
        if (this.touch && this.screen === 'game' && this.touch.root.hidden === this.session.isPlaying()) this.touch.show(this.session.isPlaying());
      }
    });
    net.on('pings', (m) => {
      this.roomUI.updatePings(m.p);
      if (m.st) {
        this.liveStats.clear();
        for (const [id, goals, assists, shots] of m.st) this.liveStats.set(id, { goals, assists, shots });
      }
    });
    net.on('chat', (m) => {
      this.roomUI.chat(m);
      this.hud.chat(m, this.session ? this.session.kits : null);
      if (!m.sys && m.id !== this.myId && this.screen === 'game') this.audio.ui();
    });
    net.on('emote', (m) => {
      if (this.session && this.session.mode === 'online') this.session.showEmote(m.id, m.e);
    });
    net.on('end', (m) => {
      if (this.session && this.session.mode === 'online') {
        this.session.ended = true;
        this.showEnd(m.result, { online: true });
      }
    });
    net.on('error', (m) => {
      toast(m.msg || 'Bir hata oluştu', 'err');
      if (m.code === 'no_room' || m.code === 'full') {
        this.lastRoomCode = null;
        this.setUrlRoom(null);
      }
    });
    net.on('kicked', () => {
      toast('Oda sahibi seni odadan çıkardı.', 'err');
      this.room = null;
      this.lastRoomCode = null;
      this.setUrlRoom(null);
      if (this.session && this.session.mode === 'online') this.startDemo();
      closeAllModals();
      this.showScreen('home');
    });
    net.on('left', () => {
      this.room = null;
    });
  }

  // ---------------------------------------------------------------------------
  // UI bindings / hotkeys

  bindUi() {
    for (const b of $$('[data-open]')) {
      b.addEventListener('click', () => {
        this.audio.ui();
        if (b.dataset.open === 'help') this.modals.help();
        if (b.dataset.open === 'settings') this.modals.settings();
      });
    }
    for (const b of $$('[data-toggle="mute"]')) b.addEventListener('click', () => this.setMuted(!this.prefs.muted));
    $('#hud-menu').addEventListener('click', () => this.modals.gameMenu());
    $('#hud-cam').addEventListener('click', () => this.cycleCamera());
    $('#hud-chat-btn').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setChat(!this.chatOpen);
    });
    $('#hud-full').addEventListener('click', () => this.toggleFullscreen());
    for (const b of $$('#spectate-bar [data-join]')) b.addEventListener('click', () => this.net.send({ t: 'team', team: +b.dataset.join }));

    const form = $('#hud-chat-form');
    const input = $('#hud-chat-input');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) {
        if (this.session && this.session.mode === 'online') this.net.send({ t: 'chat', text });
        else this.hud.chat({ name: this.prefs.name, text, team: 0 }, this.session ? this.session.kits : null);
      }
      input.value = '';
      this.setChat(false);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        input.value = '';
        this.setChat(false);
      }
    });
    input.addEventListener('blur', () => setTimeout(() => this.setChat(false), 0));

    // Skip replay with Space / tap
    window.addEventListener('keydown', (e) => {
      if (this.session && this.session.replay && (e.code === 'Space' || e.code === 'Escape') && this.screen === 'game') {
        this.session.skipReplay();
      }
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && this.session && this.session.replay) this.session.skipReplay();
    });
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.renderer.resize(), 50));
    // Keep keyboard focus on the game after clicking HUD buttons (Space must not re-click them).
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.hud button');
      if (b) b.blur();
    });
  }

  setChat(open) {
    const form = $('#hud-chat-form');
    if (open === this.chatOpen) return;
    this.chatOpen = open;
    form.hidden = !open;
    if (open) {
      this.input.releaseAll();
      $('#hud-chat-input').focus();
    } else $('#hud-chat-input').blur();
  }

  cycleCamera() {
    const order = ['auto', 'full', 'follow'];
    const next = order[(order.indexOf(this.prefs.camera) + 1) % order.length];
    this.setPref('camera', next);
    toast(`Kamera: ${next === 'auto' ? 'Otomatik' : next === 'full' ? 'Tüm saha' : 'Takip'}`);
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  scoresHtml() {
    const s = this.session;
    if (!s) return '';
    let players;
    if (s.mode === 'online') {
      players = s.state.players.map((p) => {
        const m = s.meta.get(p.id) || {};
        const st = this.liveStats.get(p.id) || { goals: 0, assists: 0, shots: 0 };
        return { id: p.id, name: m.name || '?', team: p.team, bot: m.bot, ...st };
      });
    } else players = s.stats.summary(s.state.score).players.filter((p) => s.state.players.some((q) => q.id === p.id));
    return statsTablesHtml(players, s.kits, s.myId, { rating: false });
  }

  onAction(a, e) {
    const inGame = this.screen === 'game';
    switch (a) {
      case 'chat':
        if (inGame) this.setChat(!this.chatOpen);
        else if (this.screen === 'room' && !modalOpen() && (!document.activeElement || document.activeElement === document.body)) {
          e.preventDefault();
          $('#room-chat-input').focus();
        }
        break;
      case 'menu':
        if (closeTopModal()) break;
        if (inGame && !(this.session && this.session.replay)) this.modals.gameMenu();
        break;
      case 'scores':
        if (inGame && !modalOpen()) this.hud.showScores(true, this.scoresHtml());
        break;
      case 'scores-up':
        this.hud.showScores(false);
        break;
      case 'help':
        if (!modalOpen()) this.modals.help();
        break;
      case 'mute':
        this.setMuted(!this.prefs.muted);
        break;
      case 'camera':
        if (inGame) this.cycleCamera();
        break;
      case 'pointer':
        this.audio.ensure();
        break;
      default:
        if (a.startsWith('emote') && inGame && !modalOpen()) {
          this.sendEmote(+a.slice(5));
          document.body.classList.add('show-emotes');
          clearTimeout(this.emoteTimer);
          this.emoteTimer = setTimeout(() => document.body.classList.remove('show-emotes'), 1500);
        }
        break;
    }
  }
}

window.app = new App();
