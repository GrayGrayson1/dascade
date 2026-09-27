/**
 * Attract mode: tiny procedural pixel animations for cabinet screens, picker
 * tiles and title-screen backdrops.
 *
 * - A *scene* is one game's loop (a pure function of time and canvas size, so a
 *   reduced-motion still is just the scene drawn at a nice moment).
 * - A *playlist* strings scenes together; multi-game cabinets cycle through all
 *   of their games ("channel changes" in between) so you can see what's inside
 *   without walking up to the machine.
 * Scenes adapt to any logical resolution from ~60×45 up to ~200×150.
 */
import type { CabinetId, GameAccent, GameId } from '@dascade/shared';
import { drawStatic, rect, textWidth, drawTextC, type AttractFrame, type Scene } from './attractKit.ts';
import { blackjack, bingo, circuit, dasketch, holdem, quest, slots, wheel } from './scenes/originals.ts';
import { highlow, roulette } from './scenes/casino.ts';
import { checkers, chess, ships } from './scenes/boardroom.ts';
import { deception, masterpiece, survey, trivia, words } from './scenes/party.ts';
import { putt, tanks } from './scenes/sports.ts';
import { asteroids, blocks, bricks, memory, paddle, snake } from './scenes/classics.ts';

export type { AttractFrame, Scene } from './attractKit.ts';

export const SCENES = {
  dasketch,
  holdem,
  blackjack,
  bingo,
  wheel,
  slots,
  roulette,
  highlow,
  circuit,
  quest,
  chess,
  checkers,
  ships,
  trivia,
  deception,
  masterpiece,
  words,
  survey,
  putt,
  tanks,
  paddle,
  snake,
  bricks,
  asteroids,
  memory,
  blocks,
} satisfies Record<string, Scene>;

export type SceneId = keyof typeof SCENES;

/** What each cabinet's screen cycles through (single-game cabinets loop one scene). */
export const CABINET_PLAYLISTS: Record<CabinetId, readonly SceneId[]> = {
  dasketch: ['dasketch'],
  bingo: ['bingo'],
  wheel: ['wheel'],
  dasino: ['slots', 'holdem', 'roulette', 'blackjack', 'highlow'],
  boardroom: ['chess', 'ships', 'checkers'],
  stravaganza: ['trivia', 'deception', 'words', 'masterpiece', 'survey'],
  putt: ['putt'],
  tanks: ['tanks'],
  classics: ['snake', 'bricks', 'paddle', 'asteroids', 'blocks', 'memory'],
  circuit: ['circuit'],
  quest: ['quest'],
};

const DASINO_TABLE_SCENES: Record<string, SceneId> = { roulette: 'roulette', slots: 'slots', dice: 'highlow' };

/** The scene(s) that represent one game (a DASino table variant picks its table). */
export function scenesForGame(gameId: GameId, variant?: string | null): readonly SceneId[] {
  if (gameId === 'dasino') {
    const table = variant ? DASINO_TABLE_SCENES[variant] : undefined;
    return table ? [table] : ['roulette', 'slots', 'highlow'];
  }
  if (gameId === 'tournament') return ['chess', 'putt', 'snake'];
  return gameId in SCENES ? [gameId as SceneId] : ['dasketch'];
}

export interface AttractRequest {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Clock time in seconds (ignored when `still`). */
  t: number;
  active: boolean;
  hud: boolean;
  still: boolean;
  scenes: readonly SceneId[];
  title: string;
  accent: GameAccent;
}

const SWITCH = 0.26;

/** Resolves a playlist position: which scene, its local time, and a stable loop count. */
export function playlistAt(scenes: readonly SceneId[], t: number): { index: number; local: number; loop: number } {
  const lengths = scenes.map((id) => SCENES[id].length);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const loop = Math.floor(t / total);
  let local = t - loop * total;
  for (let i = 0; i < lengths.length; i++) {
    if (local < lengths[i]! || i === lengths.length - 1) return { index: i, local: Math.min(local, lengths[i]!), loop };
    local -= lengths[i]!;
  }
  return { index: 0, local: 0, loop };
}

/** Shortens a marquee title to fit `maxW` pixels at `scale`. */
export function fitTitle(title: string, maxW: number, scale: number): string {
  if (textWidth(title, scale) <= maxW) return title;
  const noDas = title.replace(/^DAS(H)?\s+/i, '');
  if (textWidth(noDas, scale) <= maxW) return noDas;
  const words = title.split(/\s+/);
  const last = words[words.length - 1] ?? title;
  return textWidth(last, scale) <= maxW ? last : last.slice(0, Math.max(3, Math.floor((maxW + scale) / (4 * scale))));
}

function drawHud(f: AttractFrame, label: string | null, index: number, count: number): void {
  if (!f.hud) return;
  const { ctx, W, H, t, active, still } = f;
  const scale = W >= 150 ? 2 : 1;
  const band = 5 * scale + 3;
  const primary = f.accent.primary;
  if (label) {
    // Multi-game cabinet: which game is on screen + a "channel" pager.
    rect(ctx, 0, 0, W, band, 'rgba(6,4,14,0.8)');
    rect(ctx, 0, band, W, 1, primary);
    const pager = count * 3 + 1;
    const text = fitTitle(label, W - pager - 6, scale);
    ctx.globalAlpha = 1;
    drawTextC(ctx, text, (W - pager) / 2, 2, active ? '#ffffff' : primary, scale, '#000000');
    for (let i = 0; i < count; i++)
      rect(ctx, W - pager - 1 + i * 3 + 1, Math.floor(band / 2) - 1, 2, 2, i === index ? primary : 'rgba(255,255,255,0.25)');
  } else if (active && f.title) {
    const title = fitTitle(f.title, W - 6, scale);
    rect(ctx, 0, 0, W, band, 'rgba(6,4,14,0.78)');
    rect(ctx, 0, band, W, 1, primary);
    drawTextC(ctx, title, W / 2, 2, primary, scale, '#000000');
  }
  if (active) {
    if (still || (t * 2.4) % 1 < 0.64) {
      rect(ctx, 0, H - band, W, band, 'rgba(6,4,14,0.78)');
      drawTextC(ctx, 'PRESS START', W / 2, H - band + 2, '#ffffff', scale, '#000000');
    }
  } else if (still || (t * 1.25) % 1 < 0.6) {
    rect(ctx, 0, H - band, W, band, 'rgba(6,4,14,0.72)');
    drawTextC(ctx, 'INSERT COIN', W / 2, H - band + 2, '#ffd23f', scale, '#000000');
  }
}

/** Draws one attract frame (safe to call with any size ≥ 32×24). */
export function drawAttract(r: AttractRequest): void {
  const scenes = r.scenes.length ? r.scenes : (['dasketch'] as const);
  r.ctx.imageSmoothingEnabled = false;
  const multi = scenes.length > 1;
  let index = 0;
  let local: number;
  let sceneT: number;
  if (r.still) {
    local = SCENES[scenes[0]!].still;
    sceneT = local;
  } else if (multi) {
    const at = playlistAt(scenes, r.t);
    index = at.index;
    local = at.local;
    // Scenes that vary per cycle (doodles, wheel results) see a fresh cycle on every loop.
    sceneT = at.loop * SCENES[scenes[index]!].length + local;
  } else {
    local = r.t;
    sceneT = r.t;
  }
  const scene = SCENES[scenes[index]!];
  const frame: AttractFrame = {
    ctx: r.ctx,
    W: r.W,
    H: r.H,
    t: sceneT,
    active: r.active,
    hud: r.hud,
    still: r.still,
    title: r.title,
    accent: r.accent,
    top: r.hud && (multi || (r.active && !!r.title)) ? 5 * (r.W >= 150 ? 2 : 1) + 4 : 0,
  };
  scene.draw(frame);
  if (multi && !r.still && local < SWITCH) drawStatic(r.ctx, r.W, r.H, 1 - local / SWITCH, Math.floor(r.t * 30));
  drawHud({ ...frame, t: r.still ? 0 : r.t }, multi ? scene.label : null, index, scenes.length);
}

/** The still-frame time used for a playlist (its first scene's still). */
export function stillTime(scenes: readonly SceneId[]): number {
  const first = scenes[0];
  return first ? SCENES[first].still : 0;
}
