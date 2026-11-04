// Keyboard, mouse, gamepad and touch input merged into one per-tick input sample.

import { BTN } from '../../shared/constants.js';

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  // Not Shift: five quick presses open the Windows Sticky Keys dialog mid-match.
  kick: ['Space', 'KeyX', 'KeyK', 'KeyL'],
};
const GAME_CODES = new Set(Object.values(KEYS).flat());

const ACTIONS = {
  Enter: 'chat',
  NumpadEnter: 'chat',
  Escape: 'menu',
  Tab: 'scores',
  KeyH: 'help',
  KeyM: 'mute',
  KeyF: 'camera',
  Digit1: 'emote0',
  Digit2: 'emote1',
  Digit3: 'emote2',
  Digit4: 'emote3',
  Digit5: 'emote4',
  Digit6: 'emote5',
};

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, moved: false, left: false, right: false };
    this.enabled = false; // only while a match is shown
    this.touch = null;
    this.onAction = null;
    this.gamepadActive = false;

    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab' && this.onAction && !isTyping(e)) this.onAction('scores-up', e);
    });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.moved = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      if (this.onAction) this.onAction('pointer', e);
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  keyDown(e) {
    if (isTyping(e)) return;
    const action = ACTIONS[e.code];
    if (action && this.onAction) {
      if (this.enabled && e.code !== 'Escape') e.preventDefault();
      if (!e.repeat) this.onAction(action, e);
      if (action !== 'scores') return;
    }
    if (!this.enabled) return;
    if (GAME_CODES.has(e.code)) {
      e.preventDefault();
      this.keys.add(e.code);
    }
  }

  releaseAll() {
    this.keys.clear();
    this.mouse.left = false;
    this.mouse.right = false;
    if (this.touch) this.touch.reset();
  }

  down(name) {
    for (const c of KEYS[name]) if (this.keys.has(c)) return true;
    return false;
  }

  readGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
      const btn = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
      const out = {
        mx: dz(gp.axes[0] || 0),
        my: dz(gp.axes[1] || 0),
        b: 0,
      };
      for (let i = 0; i <= 7; i++) if (btn(i)) out.b |= BTN.KICK;
      if (btn(12)) out.my = -1;
      if (btn(13)) out.my = 1;
      if (btn(14)) out.mx = -1;
      if (btn(15)) out.mx = 1;
      const any = out.mx || out.my || out.b;
      if (any) this.gamepadActive = true;
      return out;
    }
    return null;
  }

  /**
   * @param {{x:number,y:number,facing:number}|null} me rendered position of the local player
   */
  sample(me) {
    const out = { mx: 0, my: 0, a: me ? me.facing : 0, b: 0 };
    if (!this.enabled) return out;

    let mx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let my = (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
    let b = 0;
    if (this.down('kick')) b |= BTN.KICK;
    if (this.mouse.left || this.mouse.right) b |= BTN.KICK;

    const gp = this.readGamepad();
    if (gp) {
      if (gp.mx || gp.my) {
        mx = gp.mx;
        my = gp.my;
      }
      b |= gp.b;
    }
    if (this.touch && this.touch.active) {
      const t = this.touch.state;
      if (t.mx || t.my) {
        mx = t.mx;
        my = t.my;
      }
      b |= t.b;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    // The kick direction comes from body position, so `a` only reports where we face.
    const aim = len > 0.15 ? Math.atan2(my, mx) : me ? me.facing : 0;
    out.mx = Math.round(mx * 100) / 100;
    out.my = Math.round(my * 100) / 100;
    out.a = Math.round(aim * 1000) / 1000;
    out.b = b;
    return out;
  }
}
