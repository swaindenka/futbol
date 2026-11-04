// Small DOM helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const icon = (id) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#ico-${id}`);
  s.append(u);
  return s;
};

export function toast(msg, kind = '') {
  const root = $('#toasts');
  const t = el('div', { class: `toast ${kind}`, text: msg });
  root.append(t);
  while (root.children.length > 3) root.firstChild.remove();
  setTimeout(() => t.remove(), 3100);
}

/** Segmented control. options: [{v, label}] */
export function seg(options, value, onChange, { disabled = false, cls = '' } = {}) {
  const wrap = el('div', { class: `seg ${cls} ${disabled ? 'disabled' : ''}`, role: 'radiogroup' });
  for (const o of options) {
    const b = el('button', {
      type: 'button',
      class: o.v === value ? 'on' : '',
      role: 'radio',
      'aria-checked': o.v === value ? 'true' : 'false',
      disabled: disabled || undefined,
      title: o.title,
      text: o.label,
    });
    b.addEventListener('click', () => {
      if (o.v === value) return;
      for (const x of wrap.children) {
        x.classList.remove('on');
        x.setAttribute('aria-checked', 'false');
      }
      b.classList.add('on');
      b.setAttribute('aria-checked', 'true');
      value = o.v;
      onChange(o.v);
    });
    wrap.append(b);
  }
  return wrap;
}

export function toggle(on, onChange, { disabled = false, label = '' } = {}) {
  const b = el('button', { type: 'button', class: `toggle ${on ? 'on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, disabled: disabled || undefined });
  b.addEventListener('click', () => {
    on = !on;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    onChange(on);
  });
  return b;
}

const stack = [];

export function modalOpen() {
  return stack.length > 0;
}

/**
 * Opens a modal dialog. Returns { el, body, close }.
 */
export function openModal({ title, body, foot, wide = false, onClose, closable = true, id }) {
  if (id) {
    const existing = stack.find((m) => m.id === id);
    if (existing) existing.close();
  }
  const wrap = el('div', { class: 'modal-wrap' });
  const box = el('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' });
  if (title) {
    const head = el('div', { class: 'modal-head' }, el('h2', { text: title }));
    if (closable) {
      const x = el('button', { class: 'icon-btn', type: 'button', title: 'Kapat (Esc)' }, icon('x'));
      x.addEventListener('click', () => api.close());
      head.append(x);
    }
    box.append(head);
  }
  const bodyEl = el('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  box.append(bodyEl);
  if (foot) box.append(el('div', { class: 'modal-foot' }, foot));
  wrap.append(box);
  if (closable) {
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) api.close();
    });
  }
  $('#overlay-root').append(wrap);
  const api = {
    id,
    el: box,
    body: bodyEl,
    closable,
    closed: false,
    close() {
      if (api.closed) return;
      api.closed = true;
      wrap.remove();
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      if (onClose) onClose();
    },
  };
  stack.push(api);
  const focusable = box.querySelector('input, .btn.primary');
  if (focusable && !matchMedia('(pointer: coarse)').matches) setTimeout(() => focusable.focus(), 50);
  return api;
}

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top && top.closable) {
    top.close();
    return true;
  }
  return false;
}

export function closeAllModals() {
  for (const m of [...stack]) m.close();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function fmtTime(ticks) {
  const total = Math.max(0, Math.ceil(ticks / 60));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
