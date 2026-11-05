// Visual effects: particles, shock rings, confetti, screen shake, net ripples, flashes.

const MAX_PARTICLES = 500;

export class Effects {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.confetti = [];
    this.flash = 0;
    this.flashColor = '255,255,255';
    this.shake = 0;
    this.ripples = { '-1': null, 1: null };
    this.trail = [];
    this.excite = 0; // crowd excitement 0..1
    this.ledFlash = null; // { text, color, t }
    this.camFlashes = [];
    this.quality = 'high';
  }

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.confetti.length = 0;
    this.trail.length = 0;
    this.flash = 0;
    this.shake = 0;
    this.excite = 0;
    this.ledFlash = null;
  }

  add(p) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  kick(x, y, power, dirA) {
    const n = Math.min(14, 3 + Math.round(power));
    if (this.quality === 'low' && n > 4) return;
    for (let i = 0; i < n; i++) {
      const a = dirA + Math.PI + (Math.random() - 0.5) * 2.2;
      const sp = 0.6 + Math.random() * 1.8;
      this.add({
        k: 'grass', x, y, z: 2,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 1 + Math.random() * 2.4,
        life: 0, max: 0.5 + Math.random() * 0.4, size: 1.2 + Math.random() * 1.6,
        c: Math.random() < 0.5 ? '#6fd36b' : '#2e7d32',
      });
    }
    if (power > 12) this.ring(x, y, power > 12.8 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)', 10, 26 + power * 2);
  }

  dust(x, y, dirA) {
    for (let i = 0; i < 6; i++) {
      const a = dirA + Math.PI + (Math.random() - 0.5) * 1.6;
      this.add({
        k: 'dust', x: x + (Math.random() - 0.5) * 10, y: y + (Math.random() - 0.5) * 10, z: 1,
        vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.8, vz: 0.3,
        life: 0, max: 0.6 + Math.random() * 0.3, size: 5 + Math.random() * 4, c: 'rgba(210,230,190,',
      });
    }
  }

  flame(x, y, z = 4, strong = false) {
    if (this.quality === 'low' && Math.random() < 0.6) return;
    const a = Math.random() * Math.PI * 2;
    this.add({
      k: 'flame', x: x + Math.cos(a) * 4, y: y + Math.sin(a) * 4, z,
      vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, vz: 0.8 + Math.random() * 1.2,
      life: 0, max: strong ? 0.55 : 0.4, size: strong ? 6 + Math.random() * 4 : 3.5 + Math.random() * 2.5,
      c: Math.random() < 0.5 ? '255,96,24' : '255,150,30',
    });
  }

  burst(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2;
      this.add({
        k: 'spark', x, y, z: 16,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 1 + Math.random() * 2,
        life: 0, max: 0.5 + Math.random() * 0.3, size: 2.2, c: color,
      });
    }
    this.ring(x, y, color.startsWith('#') ? 'rgba(255,255,255,0.8)' : color, 10, 50, 0.5);
  }

  sparks(x, y, z) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      this.add({
        k: 'spark', x, y, z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: Math.random() * 3,
        life: 0, max: 0.35 + Math.random() * 0.3, size: 1.5, c: '#fff6c9',
      });
    }
  }

  stars(x, y) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.add({
        k: 'star', x, y, z: 30,
        vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 1.4, vz: 1.5,
        life: 0, max: 0.6, size: 4, c: '#ffe14d',
      });
    }
  }

  ring(x, y, color, r0, r1, max = 0.45) {
    this.rings.push({ x, y, color, r0, r1, t: 0, max });
  }

  netHit(side, y, z, v) {
    this.ripples[side] = { y, z, t: 0, amp: Math.min(4 + v * 1.4, 18) };
  }

  addShake(a) {
    this.shake = Math.min(14, Math.max(this.shake, a));
  }

  goal(colors) {
    this.flash = 0.55;
    this.flashColor = '255,255,255';
    this.addShake(10);
    this.excite = 1;
    const n = this.quality === 'low' ? 60 : 180;
    for (let i = 0; i < n; i++) {
      this.confetti.push({
        x: Math.random(),
        y: -0.05 - Math.random() * 0.4,
        vx: (Math.random() - 0.5) * 0.12,
        vy: 0.12 + Math.random() * 0.22,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        c: colors[i % colors.length],
        life: 0,
        max: 3 + Math.random() * 1.5,
        sway: Math.random() * 6,
      });
    }
  }

  update(dt) {
    const g = 9.5 * 60 * dt * 0.02;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.particles.splice(i, 1);
        continue;
      }
      const k = dt * 60;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.z += p.vz * k;
      if (p.k === 'grass' || p.k === 'spark') {
        p.vz -= g * 1.6;
        if (p.z < 0) {
          p.z = 0;
          p.vz *= -0.3;
          p.vx *= 0.6;
          p.vy *= 0.6;
        }
      } else if (p.k === 'dust') {
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.size += dt * 10;
      } else if (p.k === 'flame') {
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.size *= 0.97;
      } else if (p.k === 'star') {
        p.vx *= 0.92;
        p.vy *= 0.92;
        p.vz *= 0.9;
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.max) this.rings.splice(i, 1);
    }
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.life += dt;
      if (c.life >= c.max || c.y > 1.1) {
        this.confetti.splice(i, 1);
        continue;
      }
      c.x += (c.vx + Math.sin(c.life * 3 + c.sway) * 0.05) * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
    }
    for (const side of ['-1', '1']) {
      const rp = this.ripples[side];
      if (rp) {
        rp.t += dt;
        if (rp.t > 1.4) this.ripples[side] = null;
      }
    }
    this.flash = Math.max(0, this.flash - dt * 1.4);
    this.shake = Math.max(0, this.shake - dt * 28);
    this.excite = Math.max(0, this.excite - dt * 0.16);
    if (this.ledFlash) {
      this.ledFlash.t += dt;
      if (this.ledFlash.t > 6) this.ledFlash = null;
    }
    // Photographer flashes in the stands when excited.
    if (this.excite > 0.2 && this.quality !== 'low' && Math.random() < this.excite * 0.6) {
      this.camFlashes.push({ u: Math.random(), v: Math.random(), t: 0 });
    }
    for (let i = this.camFlashes.length - 1; i >= 0; i--) {
      this.camFlashes[i].t += dt;
      if (this.camFlashes[i].t > 0.15) this.camFlashes.splice(i, 1);
    }
  }

  /** Displacement of a net at (y, z) for the ripple on `side`. */
  netOffset(side, y, z) {
    const rp = this.ripples[side];
    if (!rp) return 0;
    const d2 = (y - rp.y) ** 2 + ((z - rp.z) * 1.6) ** 2;
    return rp.amp * Math.exp(-d2 / (2 * 28 * 28)) * Math.cos(rp.t * 16) * Math.exp(-rp.t * 3.5);
  }
}
