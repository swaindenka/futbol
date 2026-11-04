// Keyboard, mouse, gamepad and touch input merged into one per-tick input sample.

import { BTN } from '../../shared/constants.js';

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  shoot: ['Space', 'KeyX'],
  pass: ['KeyE', 'KeyC'],
  lob: ['KeyR', 'KeyV'],
  tackle: ['KeyQ', 'KeyZ'],
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
    this.aimMode = 'mouse';
    this.lastMove = { x: 1, y: 0, set: false };
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
        ax: dz(gp.axes[2] || 0),
        ay: dz(gp.axes[3] || 0),
        b: 0,
      };
      if (btn(0) || btn(7)) out.b |= BTN.SHOOT;
      if (btn(2) || btn(5)) out.b |= BTN.PASS;
      if (btn(3)) out.b |= BTN.LOB;
      if (btn(1)) out.b |= BTN.TACKLE;
      if (btn(4) || btn(6)) out.b |= BTN.SPRINT;
      if (btn(12)) out.my = -1;
      if (btn(13)) out.my = 1;
      if (btn(14)) out.mx = -1;
      if (btn(15)) out.mx = 1;
      const any = out.mx || out.my || out.ax || out.ay || out.b;
      if (any) this.gamepadActive = true;
      return out;
    }
    return null;
  }

  /**
   * @param {{x:number,y:number,facing:number}|null} me rendered position of the local player
   * @param {import('./camera.js').Camera} cam
   */
  sample(me, cam) {
    const out = { mx: 0, my: 0, a: me ? me.facing : 0, b: 0 };
    if (!this.enabled) return out;

    let mx = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    let my = (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
    let b = 0;
    if (this.down('sprint')) b |= BTN.SPRINT;
    if (this.down('shoot')) b |= BTN.SHOOT;
    if (this.down('pass')) b |= BTN.PASS;
    if (this.down('lob')) b |= BTN.LOB;
    if (this.down('tackle')) b |= BTN.TACKLE;
    if (this.mouse.left) b |= BTN.SHOOT;
    if (this.mouse.right) b |= BTN.LOB;

    let aim = null;
    const gp = this.readGamepad();
    if (gp) {
      if (gp.mx || gp.my) {
        mx = gp.mx;
        my = gp.my;
      }
      b |= gp.b;
      if (gp.ax || gp.ay) aim = Math.atan2(gp.ay, gp.ax);
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
    if (len > 0.15) {
      this.lastMove.x = mx;
      this.lastMove.y = my;
      this.lastMove.set = true;
    }

    if (aim === null && this.aimMode === 'mouse' && this.mouse.moved && me && !(this.touch && this.touch.active)) {
      const w = cam.unproject(this.mouse.x, this.mouse.y);
      aim = Math.atan2(w.y - me.y, w.x - me.x);
    }
    if (aim === null) {
      if (len > 0.15) aim = Math.atan2(my, mx);
      else if (me) aim = me.facing;
      else aim = 0;
    }
    out.mx = Math.round(mx * 100) / 100;
    out.my = Math.round(my * 100) / 100;
    out.a = Math.round(aim * 1000) / 1000;
    out.b = b;
    return out;
  }
}
