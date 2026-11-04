// Shared game constants. Imported by both the Node server and the browser client.
// Units: 1 world unit = 1 px at zoom 1. Velocities are units per tick (60 ticks/s).

export const PROTOCOL_VERSION = 1;
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
  POWER: 10.5,
  CARRY: 0.4, // share of the player's velocity added to the kick
  KICK_CD: 8,
};

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
  COUNTDOWN: 180,
  KICKOFF_MAX: 600,
  GOAL_PAUSE: 200,
  GOAL_PAUSE_REPLAY: 360,
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
  replays: true,
  kits: [0, 4],
};

export const SETTING_OPTIONS = {
  duration: [60, 120, 180, 300, 420, 600],
  teamSize: [1, 2, 3, 4],
  botLevel: [0, 1, 2],
  field: ['auto', 'small', 'medium', 'large'],
  scoreLimit: [0, 3, 5, 7, 10],
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
