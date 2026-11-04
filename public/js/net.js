// WebSocket client with auto-reconnect and RTT measurement.

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.status = 'idle';
    this.rtt = 0;
    this.retry = 0;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.hello = null;
    this.url = Net.defaultUrl();
    // Debug: ?lag=120 simulates a one-way delay of 60ms each direction (120ms RTT).
    const lag = +new URLSearchParams(location.search).get('lag');
    this.lag = Number.isFinite(lag) && lag > 0 ? Math.min(lag, 1000) / 2 : 0;
  }

  static defaultUrl() {
    const qs = new URLSearchParams(location.search);
    const custom = qs.get('server');
    if (custom) return custom;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, msg) {
    const list = this.handlers.get(type);
    if (list) for (const fn of list) fn(msg);
  }

  setStatus(s) {
    this.status = s;
    this.emit('status', s);
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    if (location.protocol === 'file:') {
      this.setStatus('offline');
      return;
    }
    this.setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      if (this.hello) this.send(this.hello());
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 2000);
    };
    ws.onmessage = (ev) => {
      if (this.lag) setTimeout(() => this.receive(ev), this.lag);
      else this.receive(ev);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      this.setStatus('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => {};
  }

  receive(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.t === 'pong') {
      const r = performance.now() - msg.c;
      this.rtt = this.rtt ? this.rtt * 0.7 + r * 0.3 : r;
      this.emit('rtt', this.rtt);
      return;
    }
    this.emit(msg.t, msg);
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(8000, 800 * 2 ** this.retry);
    this.retry++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  ping() {
    this.send({ t: 'ping', c: performance.now(), r: Math.round(this.rtt) });
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const raw = JSON.stringify(obj);
    if (this.lag) {
      const ws = this.ws;
      setTimeout(() => ws.readyState === 1 && ws.send(raw), this.lag);
    } else this.ws.send(raw);
  }

  get open() {
    return !!this.ws && this.ws.readyState === 1;
  }
}
