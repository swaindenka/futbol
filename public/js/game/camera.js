// 2.5D camera: a tilted top-down view (like looking at a pool table while standing next to it).
// Ground is an affine transform; elevated points get a light perspective push away from the
// view centre so goals, boards and lofted balls read as 3D.

import { clamp, lerp } from '../../shared/util.js';

export const RAIL_H = 16;
export const RAIL_T = 9;
export const TOKEN_H = 9;

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.W = 1;
    this.H = 1;
    this.offY = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.persp = 0.0011;
    this.topPad = 70;
    this.setTilt(0.74);
    this.mode = 'full';
    this.initialized = false;
  }

  setTilt(t) {
    this.tilt = clamp(t, 0.5, 1);
    this.hs = Math.sqrt(Math.max(0, 1 - this.tilt * this.tilt)) + (this.tilt > 0.97 ? 0.08 : 0);
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
  }

  fitZoom(field) {
    const cw = field.w + field.gd * 2 + 70;
    const ch = (field.h + 40) * this.tilt + RAIL_H * this.hs + 40;
    const availH = this.H - this.topPad - 14;
    return Math.min((this.W - 20) / cw, availH / ch);
  }

  /**
   * @param {number} dt seconds
   * @param {object} field
   * @param {{x:number,y:number}|null} focus
   * @param {{x:number,y:number}} ball
   * @param {string} pref 'auto' | 'full' | 'follow'
   * @param {number} [zoomBoost]
   */
  update(dt, field, focus, ball, pref, zoomBoost = 1) {
    const fit = this.fitZoom(field);
    let mode = pref;
    if (pref === 'auto') mode = fit < 0.6 ? 'follow' : 'full';
    this.mode = mode;
    let tz;
    let tx;
    let ty;
    let toffY;
    if (mode === 'full' && zoomBoost === 1) {
      tz = fit;
      tx = 0;
      ty = 0;
      toffY = this.topPad / 2 - 4;
    } else {
      tz = Math.max(fit * 1.05, clamp(Math.min(this.W, this.H * 1.7) / 980, 0.72, 1.45)) * zoomBoost;
      const fx = focus ? focus.x * 0.62 + ball.x * 0.38 : ball.x;
      const fy = focus ? focus.y * 0.62 + ball.y * 0.38 : ball.y;
      // Keep the view inside the arena where possible.
      const halfW = this.W / 2 / tz;
      const halfH = this.H / 2 / tz / this.tilt;
      const limX = Math.max(0, field.hw + field.gd + 40 - halfW);
      const limY = Math.max(0, field.hh + 60 - halfH);
      tx = clamp(fx, -limX, limX);
      ty = clamp(fy, -limY, limY);
      toffY = this.topPad / 4;
    }
    const k = this.initialized ? 1 - Math.exp(-dt * 5) : 1;
    const kz = this.initialized ? 1 - Math.exp(-dt * 3.5) : 1;
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k);
    this.zoom = lerp(this.zoom, tz, kz);
    this.offY = lerp(this.offY, toffY, kz);
    this.initialized = true;
  }

  snap() {
    this.initialized = false;
  }

  /** World -> screen (CSS px). Returns [sx, sy, scale]. */
  project(x, y, z = 0) {
    const s = 1 + z * this.persp;
    return [
      this.W / 2 + this.shakeX + (x - this.x) * this.zoom * s,
      this.H / 2 + this.offY + this.shakeY + ((y - this.y) * this.tilt * s - z * this.hs) * this.zoom,
      s,
    ];
  }

  /** Screen -> world on the ground plane. */
  unproject(sx, sy) {
    return {
      x: (sx - this.W / 2 - this.shakeX) / this.zoom + this.x,
      y: (sy - this.H / 2 - this.offY - this.shakeY) / this.zoom / this.tilt + this.y,
    };
  }

  /** Canvas transform that maps world ground coordinates to the screen. */
  groundTransform(ctx, dpr) {
    const z = this.zoom;
    ctx.setTransform(
      dpr * z,
      0,
      0,
      dpr * z * this.tilt,
      dpr * (this.W / 2 + this.shakeX - this.x * z),
      dpr * (this.H / 2 + this.offY + this.shakeY - this.y * z * this.tilt),
    );
  }
}
