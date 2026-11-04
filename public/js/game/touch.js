// On-screen controls for touch devices: floating joystick + action buttons.

import { BTN } from '../../shared/constants.js';

const BUTTONS = [
  { id: 'shoot', label: 'ŞUT', bit: BTN.SHOOT, cls: 'big' },
  { id: 'pass', label: 'PAS', bit: BTN.PASS, cls: '' },
  { id: 'lob', label: 'AŞIRT', bit: BTN.LOB, cls: '' },
  { id: 'tackle', label: 'KAY', bit: BTN.TACKLE, cls: '' },
  { id: 'sprint', label: 'DEPAR', bit: BTN.SPRINT, cls: 'small' },
];

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.state = { mx: 0, my: 0, b: 0 };
    this.active = false;
    this.stick = null;
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <div class="touch-zone"></div>
      <div class="stick" hidden><div class="stick-knob"></div></div>
      <div class="touch-buttons">
        ${BUTTONS.map((b) => `<button class="tbtn ${b.cls}" data-id="${b.id}" aria-label="${b.label}">${b.label}</button>`).join('')}
      </div>`;
    this.zone = r.querySelector('.touch-zone');
    this.stickEl = r.querySelector('.stick');
    this.knob = r.querySelector('.stick-knob');
    this.zone.addEventListener('pointerdown', (e) => this.stickStart(e));
    window.addEventListener('pointermove', (e) => this.stickMove(e));
    window.addEventListener('pointerup', (e) => this.stickEnd(e));
    window.addEventListener('pointercancel', (e) => this.stickEnd(e));
    for (const el of r.querySelectorAll('.tbtn')) {
      const def = BUTTONS.find((b) => b.id === el.dataset.id);
      const press = (e) => {
        e.preventDefault();
        this.active = true;
        this.state.b |= def.bit;
        el.classList.add('on');
        if (navigator.vibrate) navigator.vibrate(8);
      };
      const release = (e) => {
        e.preventDefault();
        this.state.b &= ~def.bit;
        el.classList.remove('on');
      };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  stickStart(e) {
    e.preventDefault();
    this.active = true;
    this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.stickEl.hidden = false;
    this.stickEl.style.left = `${e.clientX}px`;
    this.stickEl.style.top = `${e.clientY}px`;
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  stickMove(e) {
    if (!this.stick || e.pointerId !== this.stick.id) return;
    const max = 52;
    let dx = e.clientX - this.stick.x;
    let dy = e.clientY - this.stick.y;
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const m = Math.min(1, d / max);
    this.state.mx = d > 6 ? (dx / Math.max(d, 1)) * m : 0;
    this.state.my = d > 6 ? (dy / Math.max(d, 1)) * m : 0;
    if (d > max * 0.9) this.state.b |= BTN.SPRINT;
    else if (!this.root.querySelector('[data-id="sprint"].on')) this.state.b &= ~BTN.SPRINT;
  }

  stickEnd(e) {
    if (!this.stick || e.pointerId !== this.stick.id) return;
    this.stick = null;
    this.stickEl.hidden = true;
    this.state.mx = 0;
    this.state.my = 0;
    if (!this.root.querySelector('[data-id="sprint"].on')) this.state.b &= ~BTN.SPRINT;
  }

  reset() {
    this.state.mx = 0;
    this.state.my = 0;
    this.state.b = 0;
    this.stick = null;
    this.stickEl.hidden = true;
    for (const el of this.root.querySelectorAll('.tbtn.on')) el.classList.remove('on');
  }

  show(v) {
    this.root.hidden = !v;
    if (!v) this.reset();
  }
}

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
