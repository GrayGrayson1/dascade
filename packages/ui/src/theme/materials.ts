/**
 * Theme MATERIALS: the physical stuff game art is made of (felt, board squares, water, grass,
 * asphalt, card stock…). Chrome tokens (panels, buttons, HUD) restyle the UI; materials restyle
 * the playfield itself, so Chess in Executive Edition sits on mahogany and Tanks in Space Casino
 * 2088 fights on alien terrain — with the same engine, rules and state.
 *
 * How games use them
 *   - DOM/CSS games:   background: var(--mat-board-light, #c9c2f0);   ← fallback = the game's own look
 *   - Canvas / Phaser: const m = useThemeTokens(ref).materials;  m.boardLight ?? '#c9c2f0'
 *
 * Delta Neon defines NO materials, so every game keeps its own hand-tuned palette in the default
 * theme (the fallback in each var()). Every other theme defines ALL of them (validateTheme enforces
 * it) so all games inherit a coherent treatment. A theme may nudge one game with
 * `gameMaterials[gameId]` (emitted on that game's <GameStage data-game>).
 *
 * Values are plain CSS colours (hex / rgb[a]) so canvas renderers can use them directly.
 */

export const MATERIAL_GROUPS = {
  /** Card/casino tables (Hold'em, Blackjack, DASino, Bingo cards on a table). */
  table: ['felt', 'feltDeep', 'feltLine', 'rail', 'railHighlight'],
  /** Square boards (Chess, Checkers, Ships grids use `grid*`), pieces and move highlights. */
  board: ['boardLight', 'boardDark', 'boardFrame', 'boardHighlight', 'pieceLight', 'pieceDark', 'pieceEdge'],
  /** Naval / radar grids (Ships). */
  sea: ['water', 'waterDeep', 'gridLine', 'radar'],
  /** Mini golf (Putt). */
  course: ['grass', 'grassDeep', 'sand', 'hazard', 'wall', 'wallTop'],
  /** Artillery terrain (Tanks) and outdoor skies. */
  terrain: ['sky', 'skyHorizon', 'ground', 'groundDeep', 'groundEdge'],
  /** Racing (DASh Circuit). */
  track: ['asphalt', 'asphaltLine', 'curbA', 'curbB', 'offroad'],
  /** Playing cards, answer cards, prompt cards, tiles (Words), bingo balls. */
  card: ['cardFace', 'cardInk', 'cardBack', 'cardBackInk'],
  /** Paper-like surfaces: DASketch canvas frame, DASterpiece prompt cards, DASQuest narrative panel. */
  paper: ['paper', 'paperInk', 'paperEdge'],
  /** Party/game-show stage (Trivia, Survey, Wheel stage, results podium). */
  stage: ['stage', 'stageLight', 'podium'],
  /** Screens inside the playfield: Classics bezels/screens, cabinet CRTs, Quest scene frame. */
  screen: ['screen', 'screenGlow', 'bezel'],
  /** Hardware: wheel hub/pointer, chrome trim, status LEDs. */
  hardware: ['metal', 'metalHighlight', 'led', 'ledOff'],
} as const;

export type MaterialGroup = keyof typeof MATERIAL_GROUPS;
export type MaterialKey = (typeof MATERIAL_GROUPS)[MaterialGroup][number];
export type ThemeMaterials = Record<MaterialKey, string>;

export const MATERIAL_KEYS: readonly MaterialKey[] = Object.values(MATERIAL_GROUPS).flat() as MaterialKey[];

/** camelCase material key → CSS custom property (`boardLight` → `--mat-board-light`). */
export function materialVar(key: MaterialKey): `--mat-${string}` {
  return `--mat-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Stylistic hints for renderers (canvas/Phaser games, the jukebox visualizer, environments).
 * Purely presentational; every renderer must look fine at the neutral values.
 */
export interface ThemeEffects {
  /** How playfield surfaces are finished. Renderers may add a bevel, sheen or grain to match. */
  surface: 'glass' | 'bevel' | 'flat' | 'plastic' | 'wood' | 'chrome' | 'paper' | 'felt';
  /** CRT curvature/scanline flavour for screens drawn in canvases, 0–1 (scaled by fx). */
  crt: number;
  /** Film grain / dither, 0–1 (scaled by fx). */
  grain: number;
  /** Analog tape wobble/chroma used ONLY on transitions and decorative screens, 0–1. Never on boards. */
  analog: number;
  /** Ambient weather/particles for backdrops (never over a board). */
  ambient: 'none' | 'rain' | 'stars' | 'dust' | 'confetti' | 'fog' | 'sparkle';
  /** Preferred jukebox visualizer drawing style (the visualizer component implements each). */
  visualizer: 'neon-bars' | 'pixel-bars' | 'lcd' | 'spectrum' | 'bubbles' | 'reels' | 'hologram' | 'oscilloscope' | 'blocks' | 'vu-meter' | 'glass-wave';
  /** Theme-transition flavour (the transition layer implements each; reduced motion = fade). */
  transition: 'power' | 'boot' | 'shutter' | 'fluorescent' | 'tracking' | 'warp' | 'crt-off' | 'wipe' | 'fade';
}

export const DEFAULT_EFFECTS: ThemeEffects = {
  surface: 'glass',
  crt: 0.35,
  grain: 0.15,
  analog: 0,
  ambient: 'sparkle',
  visualizer: 'neon-bars',
  transition: 'power',
};
