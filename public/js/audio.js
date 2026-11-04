// Procedural audio with WebAudio: no asset files required.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.crowdGain = null;
    this.volume = 0.7;
    this.muted = false;
    this.noise = null;
    this.crowdLevel = 0.12;
    this.lastPlay = new Map();
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    // White noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.startCrowd();
    return true;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    this.setVolume(this.volume);
  }

  throttle(key, ms) {
    const now = performance.now();
    const last = this.lastPlay.get(key) || 0;
    if (now - last < ms) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  startCrowd() {
    const c = this.ctx;
    const src = this.noiseSrc();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.6;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.value = 0;
    // Slow swell
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(bp).connect(lp).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.crowdGain = g;
    this.crowdFilter = bp;
    this.setCrowd(this.crowdLevel);
  }

  setCrowd(level, time = 0.8) {
    this.crowdLevel = level;
    if (!this.crowdGain) return;
    this.crowdGain.gain.setTargetAtTime(level, this.ctx.currentTime, time);
  }

  kick(power, kind) {
    if (!this.ensure() || !this.throttle('kick', 40)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const p = Math.min(1, power / 16);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'pass' ? 190 : 150 + p * 40, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = c.createGain();
    this.env(g, t, 0.004, 0.35 + p * 0.5, 0.16);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
    const n = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1200 + p * 1800;
    f.Q.value = 1.2;
    const ng = c.createGain();
    this.env(ng, t, 0.002, 0.15 + p * 0.3, 0.06);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 0.12);
    if (p > 0.8 && kind === 'shot') this.whoosh(0.25);
  }

  whoosh(v = 0.2) {
    if (!this.ensure()) return;
    const c = this.ctx;
    const t = c.currentTime;
    const n = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
    const g = c.createGain();
    this.env(g, t, 0.05, v, 0.25);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.4);
  }

  touch() {
    if (!this.ensure() || !this.throttle('touch', 90)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    const g = c.createGain();
    this.env(g, t, 0.003, 0.16, 0.07);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.12);
  }

  wall(v) {
    if (!this.ensure() || !this.throttle('wall', 60)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const p = Math.min(1, v / 12);
    const n = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 520;
    f.Q.value = 3;
    const g = c.createGain();
    this.env(g, t, 0.002, 0.2 + p * 0.5, 0.09);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.15);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    const og = c.createGain();
    this.env(og, t, 0.002, 0.15 + p * 0.25, 0.1);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  bounce(v) {
    if (!this.ensure() || !this.throttle('bounce', 80)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.08);
    const g = c.createGain();
    this.env(g, t, 0.003, Math.min(0.4, v * 0.06), 0.1);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  post() {
    if (!this.ensure() || !this.throttle('post', 120)) return;
    const c = this.ctx;
    const t = c.currentTime;
    for (const [fr, a] of [[880, 0.3], [1331, 0.18], [2210, 0.12], [3150, 0.07]]) {
      const o = c.createOscillator();
      o.frequency.value = fr;
      const g = c.createGain();
      this.env(g, t, 0.002, a, 0.9);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 1);
    }
    this.crowdOoh();
  }

  net(v) {
    if (!this.ensure() || !this.throttle('net', 150)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const n = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 2500;
    const g = c.createGain();
    this.env(g, t, 0.01, Math.min(0.5, 0.15 + v * 0.03), 0.35);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.5);
  }

  slide() {
    if (!this.ensure() || !this.throttle('slide', 100)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const n = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.3);
    const g = c.createGain();
    this.env(g, t, 0.02, 0.28, 0.3);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.4);
  }

  thud() {
    if (!this.ensure() || !this.throttle('thud', 100)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const g = c.createGain();
    this.env(g, t, 0.004, 0.6, 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  whistle(kind = 'short') {
    if (!this.ensure()) return;
    const c = this.ctx;
    const blasts = kind === 'end' ? [[0, 0.35], [0.45, 0.35], [0.9, 0.9]] : kind === 'long' ? [[0, 0.7]] : [[0, 0.28]];
    for (const [off, dur] of blasts) {
      const t = c.currentTime + off;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.setValueAtTime(0.22, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const trill = c.createOscillator();
      trill.frequency.value = 28;
      const tg = c.createGain();
      tg.gain.value = 120;
      trill.connect(tg);
      for (const fr of [2750, 2860]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = fr;
        tg.connect(o.frequency);
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
      trill.start(t);
      trill.stop(t + dur + 0.05);
      g.connect(this.master);
    }
  }

  crowdOoh() {
    if (!this.crowdGain) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(this.crowdLevel + 0.25, t, 0.08);
    this.crowdGain.gain.setTargetAtTime(this.crowdLevel, t + 0.8, 0.6);
    this.crowdFilter.frequency.setTargetAtTime(500, t, 0.1);
    this.crowdFilter.frequency.setTargetAtTime(650, t + 0.8, 0.5);
  }

  goal() {
    if (!this.ensure()) return;
    const c = this.ctx;
    const t = c.currentTime;
    this.whistle('short');
    if (this.crowdGain) {
      this.crowdGain.gain.cancelScheduledValues(t);
      this.crowdGain.gain.setTargetAtTime(0.75, t, 0.25);
      this.crowdGain.gain.setTargetAtTime(this.crowdLevel, t + 3.2, 1.2);
      this.crowdFilter.frequency.setTargetAtTime(1100, t, 0.3);
      this.crowdFilter.frequency.setTargetAtTime(650, t + 3.5, 1);
    }
    // Horn chord
    for (const [fr, d] of [[233, 0], [293, 0.02], [349, 0.04]]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.07, t + d + 0.05);
      g.gain.setValueAtTime(0.07, t + d + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.5);
      o.connect(f).connect(g).connect(this.master);
      o.start(t + d);
      o.stop(t + d + 1.6);
    }
  }

  beep(high = false) {
    if (!this.ensure()) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = high ? 1046 : 660;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2500;
    const g = c.createGain();
    this.env(g, t, 0.005, 0.12, high ? 0.4 : 0.15);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  ui() {
    if (!this.ensure() || !this.throttle('ui', 40)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(1300, t + 0.05);
    const g = c.createGain();
    this.env(g, t, 0.003, 0.06, 0.06);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }
}
