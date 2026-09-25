/** Curated avatar glyphs players can pick. Rendered as pixel badges by the UI. */
export const AVATARS = [
  'rocket',
  'ghost',
  'cat',
  'robot',
  'alien',
  'crown',
  'bolt',
  'star',
  'heart',
  'skull',
  'frog',
  'coffee',
  'pizza',
  'cactus',
  'disk',
  'joystick',
] as const;
export type Avatar = (typeof AVATARS)[number];

/** Player colors assigned by the server (distinct, readable on dark UI). */
export const PLAYER_COLORS = [
  '#ff4fd8',
  '#22d3ee',
  '#ffd23f',
  '#2de38f',
  '#ff8a3d',
  '#a78bfa',
  '#ff5a5f',
  '#7dd3fc',
  '#f472b6',
  '#bef264',
  '#fdba74',
  '#c4b5fd',
  '#5eead4',
  '#fca5a5',
  '#fde047',
  '#93c5fd',
] as const;
