// Per-browser preferences (best effort: storage may be unavailable).

const KEY = 'futbol-arena-prefs-v1';

const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

export const DEFAULT_PREFS = {
  name: '',
  number: 10,
  volume: 0.7,
  muted: false,
  aim: finePointer ? 'mouse' : 'keys',
  aimGuide: true,
  camera: 'auto',
  tilt: 0.74,
  quality: 'high',
  replays: true,
  hintsSeen: false,
  touchAlpha: 0.55,
  touchSize: 1,
};

export function loadPrefs() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  const p = { ...DEFAULT_PREFS, ...stored };
  if (!p.name) p.name = `Oyuncu${Math.floor(100 + Math.random() * 900)}`;
  return p;
}

export function savePrefs(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
