// Shared game constants. Imported by both the Node server and the browser client.
// Units: 1 world unit = 1 px at zoom 1. Velocities are units per tick (60 ticks/s).

export const PROTOCOL_VERSION = 2;
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // server sends a snapshot every 2 ticks (30 Hz)

export const MAX_ROOM_PLAYERS = 8;
export const MAX_TEAM_SIZE = 4;

export const TEAM_RED = 0;
export const TEAM_BLUE = 1;
export const TEAM_SPEC = -1;

export const FIELDS = {
  small: { w: 1000, h: 560, goal: 150 },
  medium: { w: 1200, h: 660, goal: 170 },
  large: { w: 1400, h: 760, goal: 190 },
};

export const GOAL_DEPTH = 46;
export const CROSSBAR_Z = 52;
export const POST_R = 6;

// Player tuning
export const P = {
  R: 17, // radius
  SPEED: 3.3,
  KICK_SLOW: 0.85, // slower while the kick button is held
  ACCEL: 0.17,
  DECEL: 0.8,
  TURN: 0.25,
  BUMP_E: 0.3,
};

// Ball tuning
export const B = {
  R: 8.5,
  FRICTION: 0.988,
  WALL_E: 0.72,
  POST_E: 0.75,
  NET_E: 0.15,
  PLAYER_E: 0.5,
};

// Kick tuning (single button: kick the ball away from the player)
export const K = {
  REACH: 5, // extra reach beyond contact distance
  POWER: 11.5,
  CARRY: 0.4, // share of the player's velocity added to the kick
  KICK_CD: 8,
  CONTROL: 0.14, // close-control blend per tick (0 = pure push, 1 = glued)
  CONTROL_REL: 3.5, // only for balls moving slowly relative to the player
};

// Aftertouch ("falso"): right after a kick, the kicker's sideways stick input bends the ball.
export const AT = {
  TICKS: 24, // window after the kick
  TURN: 0.0115, // max rotation of the ball's velocity per tick (radians)
  DEAD: 0.2, // sideways input below this does nothing (keeps straight shots straight)
  MIN_SPEED: 3, // slow balls do not curve
};

// Random power-ups that pop up on the pitch during play.
export const PU = {
  FIRE: 1, // next kick is a fireball
  GIANT: 2, // bigger, heavier body
  SPEED: 3, // faster
  ICE: 4, // the other team is slowed
  RUBBER: 5, // super bouncy ball
  MAGNET: 6, // the ball sticks to your feet
  SHIELD: 7, // a barrier guards your goal against one shot
  GHOST: 8, // pass through players, immune to knock-backs
  SHOCK: 9, // next kick releases a shock wave: nearby opponents are blasted away and dazed
  MYSTERY: 10, // surprise box: usually a power-up, sometimes a curse
  // Curses: only from the surprise box, never spawned on their own.
  DIZZY: 11, // controls reversed
  SLIPPY: 12, // feet slide like on ice
};

// kind: 'self' (personal buff), 'charge' (held until the next kick, stacks with a buff),
// 'team', 'foe' (hits the other team), 'ball', 'box', 'curse'.
// w: spawn weight (0 = never spawned directly), mw: weight inside the surprise box.
export const PU_INFO = {
  1: { id: 'fire', name: 'Ateş Topu', desc: 'Sonraki vuruşun alev alır, önündekini delip geçer', color: '#ff7a1a', ticks: 600, kind: 'charge', w: 12, mw: 3 },
  2: { id: 'giant', name: 'Dev', desc: 'Kocaman, ağır ve güçlü oldun', color: '#a05cff', ticks: 540, kind: 'self', w: 9, mw: 2 },
  3: { id: 'speed', name: 'Hız', desc: 'Rüzgar gibisin', color: '#ffd23f', ticks: 480, kind: 'self', w: 11, mw: 3 },
  4: { id: 'ice', name: 'Buz', desc: 'Rakipler yavaşladı', color: '#5fd4ff', ticks: 240, kind: 'foe', w: 9, mw: 2 },
  5: { id: 'rubber', name: 'Lastik Top', desc: 'Top sizin: bantlardan seker, rakip ayağında tutamaz', color: '#ff4fa3', ticks: 600, kind: 'ball', w: 7, mw: 1 },
  6: { id: 'magnet', name: 'Mıknatıs', desc: 'Top ayağına yapışır', color: '#ff3b4e', ticks: 540, kind: 'self', w: 10, mw: 2 },
  7: { id: 'shield', name: 'Kalkan', desc: 'Kalen bir şuta karşı korunur', color: '#2ee59d', ticks: 720, kind: 'team', w: 6, mw: 2 },
  8: { id: 'ghost', name: 'Hayalet', desc: 'Topla birlikte rakiplerin içinden geçersin', color: '#8b9bb4', ticks: 420, kind: 'self', w: 8, mw: 2 },
  9: { id: 'shock', name: 'Şok Vuruşu', desc: 'Sonraki vuruşun etrafa şok dalgası yayar', color: '#3d6bff', ticks: 600, kind: 'charge', w: 10, mw: 2 },
  10: { id: 'mystery', name: 'Sürpriz Kutu', desc: 'Şansını dene', color: '#f5c542', ticks: 0, kind: 'box', w: 10, mw: 0 },
  11: { id: 'dizzy', name: 'Ters Köşe', desc: 'Kontrollerin ters döndü', color: '#d17bff', ticks: 210, kind: 'curse', w: 0, mw: 3 },
  12: { id: 'slippy', name: 'Kaygan', desc: 'Ayakların kayıyor', color: '#5fe3cf', ticks: 270, kind: 'curse', w: 0, mw: 3 },
};

export const PU_KINDS = Object.keys(PU_INFO).map(Number);

/** Weighted random pick of a power-up kind; `key` is 'w' (pitch) or 'mw' (surprise box). */
export function pickPowerUp(rand, key = 'w') {
  let total = 0;
  for (const k of PU_KINDS) total += PU_INFO[k][key] || 0;
  let r = rand() * total;
  for (const k of PU_KINDS) {
    r -= PU_INFO[k][key] || 0;
    if (r < 0) return k;
  }
  return PU.FIRE;
}

export const PU_TUNE = {
  PICK_R: 14, // pickup reach beyond the player's radius
  WARN: 60, // a landing marker shows where a power-up appears this long before it can be taken
  LIFE: 600, // ticks a power-up stays on the pitch
  FIRST: 420, // first spawn after kickoff (normal rate)
  EVERY_MIN: 540,
  EVERY_MAX: 900,
  GIANT_SCALE: 1.55,
  GIANT_MASS: 2.4, // body mass vs a normal player (bumps and shoves)
  GIANT_KICK: 1.2, // kick power
  SPEED_MUL: 1.4,
  SPEED_ACCEL: 1.35,
  SLOW_MUL: 0.55,
  FIRE_MUL: 1.6,
  FIRE_TICKS: 90,
  FIRE_FRICTION: 0.996,
  FIRE_KNOCK: 6,
  FIRE_STUN: 36, // a fireball hit dazes the player it hits
  FIRE_PIERCE: 0.82, // speed the fireball keeps after bursting through an opponent
  RUBBER_WALL_E: 0.98,
  RUBBER_PLAYER_E: 0.9,
  RUBBER_FRICTION: 0.994,
  RUBBER_KICK: 1.15, // kick power of the team the rubber ball plays for
  MAG_RANGE: 56, // magnet reach beyond contact distance
  MAG_REL: 7, // only balls slower than this (relative) are caught: long passes yes, shots no
  MAG_DAMP: 0.24, // relative velocity damping per tick
  MAG_PULL: 0.5, // pull toward the feet
  MAG_ORBIT: 0.5, // how far around the body (radians) the pull aims toward the front
  SHIELD_E: 0.9,
  SHOCK_R: 230,
  SHOCK_KNOCK: 8.5,
  SHOCK_STUN: 60,
  GHOST_CARRY: 24, // a ball this close (beyond contact) to a ghost's feet slips through opponents
  STUN_DRAG: 0.9, // velocity kept per tick while dazed
  SLIP_ACCEL: 0.035,
  SLIP_DECEL: 0.985,
};

// Spawn rates per room setting: 0 off, 1 few, 2 normal, 3 chaos.
export const PU_RATES = [
  null,
  { first: 600, min: 900, max: 1400, cap: 1, capBig: 1 },
  { first: PU_TUNE.FIRST, min: PU_TUNE.EVERY_MIN, max: PU_TUNE.EVERY_MAX, cap: 1, capBig: 2 },
  { first: 200, min: 200, max: 380, cap: 2, capBig: 3 },
];
export const PU_LEVEL_NAMES = ['Kapalı', 'Az', 'Normal', 'Kaos'];

/** Power-up level from a setting (old rooms / prefs stored a boolean). */
export function puLevel(v) {
  if (v === true || v === undefined || v === null) return 2;
  if (v === false) return 0;
  const n = Math.floor(+v);
  return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 2;
}

export const BTN = {
  KICK: 2,
};

export const PHASE = {
  COUNTDOWN: 0,
  KICKOFF: 1,
  PLAY: 2,
  GOAL: 3,
  ENDED: 4,
};

export const TIMING = {
  COUNTDOWN_STEP: 42, // ticks per number of the 3-2-1 countdown
  COUNTDOWN: 126,
  KICKOFF_MAX: 600,
  GOAL_PAUSE: 100, // short celebration, then reset + 3-2-1
  GOAL_PAUSE_REPLAY: 330,
  END_HOLD: 150,
};

// Kits: `pattern` drives how the top of a player token is painted.
export const KITS = [
  { id: 'kirmizi', name: 'Kırmızı', primary: '#e8303f', secondary: '#a3172a', text: '#ffffff', pattern: 'stripes' },
  { id: 'turuncu', name: 'Turuncu', primary: '#ff7a1a', secondary: '#c24d00', text: '#1a0d00', pattern: 'solid' },
  { id: 'sari', name: 'Sarı', primary: '#ffd23f', secondary: '#c79a00', text: '#2a1f00', pattern: 'sash' },
  { id: 'mor', name: 'Mor', primary: '#8f5cff', secondary: '#5a2fc2', text: '#ffffff', pattern: 'half' },
  { id: 'mavi', name: 'Mavi', primary: '#2f7bff', secondary: '#1648b8', text: '#ffffff', pattern: 'stripes' },
  { id: 'lacivert', name: 'Lacivert', primary: '#24408f', secondary: '#0f1f52', text: '#ffd23f', pattern: 'hoops' },
  { id: 'turkuaz', name: 'Turkuaz', primary: '#14c9a5', secondary: '#0a8a70', text: '#032b22', pattern: 'solid' },
  { id: 'beyaz', name: 'Beyaz', primary: '#f2f5fa', secondary: '#b9c3d6', text: '#14213d', pattern: 'sash' },
  { id: 'siyah', name: 'Siyah', primary: '#2a2e38', secondary: '#0c0d10', text: '#b6ff3b', pattern: 'stripes' },
  { id: 'pembe', name: 'Pembe', primary: '#ff4fa3', secondary: '#c21f72', text: '#ffffff', pattern: 'half' },
];

export const DEFAULT_SETTINGS = {
  duration: 180,
  teamSize: 3,
  bots: true,
  botLevel: 1,
  field: 'auto',
  goldenGoal: true,
  scoreLimit: 0,
  replays: false,
  powerups: 2,
  kits: [0, 4],
};

export const SETTING_OPTIONS = {
  duration: [60, 120, 180, 300, 420, 600],
  teamSize: [1, 2, 3, 4],
  botLevel: [0, 1, 2],
  field: ['auto', 'small', 'medium', 'large'],
  scoreLimit: [0, 3, 5, 7, 10],
  powerups: [0, 1, 2, 3],
};

export const BOT_NAMES = [
  'Kaya', 'Demir', 'Tuna', 'Aras', 'Deniz', 'Efe', 'Mert', 'Arda',
  'Ozan', 'Bora', 'Kerem', 'Emir', 'Doruk', 'Yağız', 'Alp', 'Çınar',
];

export const EMOTES = ['Pas ver!', 'Güzel!', 'Hadi!', 'Pardon!', 'Vay be!', 'Geri dön!'];

export function fieldForTeamSize(n) {
  if (n <= 2) return 'small';
  if (n === 3) return 'medium';
  return 'large';
}
