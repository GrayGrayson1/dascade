/**
 * Battlefield art direction. One palette per theme (the server picks a theme per battle);
 * all game-art colours live here so a future theme pass can override them in one place.
 */
import type { BattleTheme } from '@dascade/shared/games/tanks';

export interface ThemePalette {
  name: string;
  /** Sky gradient stops top → horizon. */
  sky: [string, string, string];
  /** Big celestial body. */
  sun: { kind: 'sun' | 'moon' | 'giant'; color: string; glow: string; x: number; y: number; r: number };
  stars: number;
  aurora: boolean;
  /** Far and mid silhouette layers. */
  far: string;
  farRim: string;
  mid: string;
  midLights: string[];
  haze: string;
  /** Terrain. */
  rim: string;
  rimGlow: string;
  topsoil: string;
  soil: string;
  rock: string;
  deep: string;
  strata: string;
  ore: string[];
  scorch: string;
  /** Ambient floating particles (embers, snow, fireflies, falling leaves). */
  motes: string;
  moteKind: 'ember' | 'snow' | 'spark' | 'ash' | 'leaf';
  /** Decorative weather drawn by the background sky only (set by DASCADE themes, e.g. Neon Noir rain). */
  weather?: 'rain';
  cloud: string;
}

export const THEMES: Record<BattleTheme, ThemePalette> = {
  dusk: {
    name: 'Neon Dusk',
    sky: ['#12061f', '#4a0f45', '#ff6a3d'],
    sun: { kind: 'sun', color: '#ffb347', glow: '#ff4fd8', x: 0.68, y: 0.56, r: 0.16 },
    stars: 70,
    aurora: false,
    far: '#3a0d3e',
    farRim: '#ff4fd8',
    mid: '#200826',
    midLights: ['#ffd23f', '#ff8a3d', '#ff4fd8'],
    haze: '#ff6a3d',
    rim: '#ffb347',
    rimGlow: '#ff8a3d',
    topsoil: '#b8471f',
    soil: '#6e2618',
    rock: '#3a1420',
    deep: '#1a0913',
    strata: '#50182a',
    ore: ['#ffd23f', '#ff4fd8'],
    scorch: '#1b0c0c',
    motes: '#ffd23f',
    moteKind: 'ember',
    cloud: '#ff9ad5',
  },
  night: {
    name: 'Midnight Grid',
    sky: ['#02030d', '#081036', '#162a66'],
    sun: { kind: 'moon', color: '#e7f3ff', glow: '#7cf5ff', x: 0.22, y: 0.3, r: 0.07 },
    stars: 180,
    aurora: false,
    far: '#0d1638',
    farRim: '#22d3ee',
    mid: '#070b22',
    midLights: ['#22d3ee', '#a78bfa', '#ffd23f', '#f8f6ff'],
    haze: '#2a58c9',
    rim: '#5ef0ff',
    rimGlow: '#22d3ee',
    topsoil: '#2f78ad',
    soil: '#1e3f7a',
    rock: '#15204d',
    deep: '#090d28',
    strata: '#26408a',
    ore: ['#22d3ee', '#a78bfa'],
    scorch: '#05060d',
    motes: '#9ff3ff',
    moteKind: 'spark',
    cloud: '#5a6fb8',
  },
  aurora: {
    name: 'Aurora Ice',
    sky: ['#010812', '#062a36', '#0f5a5a'],
    sun: { kind: 'moon', color: '#f0fff9', glow: '#2de38f', x: 0.8, y: 0.24, r: 0.05 },
    stars: 140,
    aurora: true,
    far: '#0b2b35',
    farRim: '#2de38f',
    mid: '#06171f',
    midLights: ['#2de38f', '#7cf5ff'],
    haze: '#2de38f',
    rim: '#c8fff0',
    rimGlow: '#2de38f',
    topsoil: '#7fb7c9',
    soil: '#2f5f73',
    rock: '#173744',
    deep: '#08171e',
    strata: '#22505e',
    ore: ['#7cf5ff', '#2de38f'],
    scorch: '#0a1418',
    motes: '#f0fffb',
    moteKind: 'snow',
    cloud: '#9fd8d0',
  },
  ember: {
    name: 'Ember Wastes',
    sky: ['#0d0203', '#3d0707', '#a3260b'],
    sun: { kind: 'giant', color: '#ff5a1f', glow: '#ffb347', x: 0.3, y: 0.62, r: 0.22 },
    stars: 30,
    aurora: false,
    far: '#2c0706',
    farRim: '#ff5a1f',
    mid: '#170404',
    midLights: ['#ff8a3d', '#ffd23f'],
    haze: '#ff3d1f',
    rim: '#ffcf5a',
    rimGlow: '#ff5a1f',
    topsoil: '#8a4a26',
    soil: '#55281c',
    rock: '#321518',
    deep: '#16090a',
    strata: '#4a1f14',
    ore: ['#ff5a1f', '#ffd23f'],
    scorch: '#070303',
    motes: '#ff8a3d',
    moteKind: 'ash',
    cloud: '#6a2a1e',
  },
  harvest: {
    name: 'Harvest Moon',
    sky: ['#070a1c', '#2b1838', '#9a5520'],
    sun: { kind: 'moon', color: '#ffb84d', glow: '#ff8a3d', x: 0.72, y: 0.5, r: 0.13 },
    stars: 90,
    aurora: false,
    far: '#2a1424',
    farRim: '#ff9a3d',
    mid: '#140a12',
    midLights: ['#ffd23f', '#ff8a3d'],
    haze: '#ff8a3d',
    rim: '#ffd27a',
    rimGlow: '#ff9a3d',
    topsoil: '#b07a2a',
    soil: '#6a3f1c',
    rock: '#3a2416',
    deep: '#1a0f0a',
    strata: '#4e3018',
    ore: ['#ffd23f', '#ff8a3d'],
    scorch: '#120a06',
    motes: '#ffb062',
    moteKind: 'leaf',
    cloud: '#8a5a4a',
  },
};

/** Projectile glow / trail colour per projectile kind (weapon ids plus sub-munitions). */
export const WEAPON_TINT: Record<string, number> = {
  shell: 0xfff1c1,
  heavy: 0xffb347,
  mininuke: 0xfff6a8,
  nuke: 0xffffff,
  airburst: 0x7cf5ff,
  cluster: 0xff4fd8,
  bomblet: 0xff8ae6,
  mirv: 0xff6a8a,
  warhead: 0xff8a6a,
  popper: 0xffd23f,
  confetti: 0xffffff,
  roller: 0xd3cdf0,
  heavyroller: 0xb9a8ff,
  rolling: 0xd3cdf0,
  leapfrog: 0x2de38f,
  hop: 0x2de38f,
  napalm: 0xff7a1f,
  hotnapalm: 0x9fd8ff,
  driller: 0xa3e635,
  seeker: 0xff5a5f,
  railgun: 0x7cf5ff,
  skylance: 0xc4a5ff,
  warp: 0xd98bff,
  tracer: 0x9df7ff,
  excavator: 0xffcf8a,
  dirtclod: 0xc58b52,
  dirtball: 0xc58b52,
  tonofdirt: 0xa8703c,
  mudslide: 0x9a6a3a,
  meteor: 0xff6a1f,
};

/** Popper confetti colours (picked by projectile id). */
export const CONFETTI_TINTS = [0xff4fd8, 0xffd23f, 0x22d3ee, 0x2de38f, 0xff8a3d, 0xa78bfa] as const;

/** Shield bubble colour per kind. */
export const SHIELD_TINT: Record<'shield' | 'heavyshield' | 'deflector', number> = {
  shield: 0x5ef0ff,
  heavyshield: 0xffd23f,
  deflector: 0xff4fd8,
};

/** Beam core / glow colours. */
export const BEAM_TINT: Record<'railgun' | 'skylance' | 'lightning', { core: number; glow: number }> = {
  railgun: { core: 0xffffff, glow: 0x22d3ee },
  skylance: { core: 0xffffff, glow: 0xa78bfa },
  lightning: { core: 0xf4f9ff, glow: 0x7cb8ff },
};

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1]!, 16) : 0xff8a3d;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function hexToInt(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (r << 16) | (g << 8) | b;
}

export function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function rgbCss([r, g, b]: [number, number, number], alpha = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`;
}

export function shade(hex: string, amt: number): string {
  const c = hexToRgb(hex);
  const t: [number, number, number] = amt >= 0 ? [255, 255, 255] : [0, 0, 0];
  const [r, g, b] = mixRgb(c, t, Math.abs(amt));
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Tiny deterministic hash → [0,1) for decorative art (never gameplay). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const DISPLAY_FONT = "'Tiny5', 'Silkscreen', ui-monospace, monospace";
export const PIXEL_FONT = "'Silkscreen', 'Tiny5', ui-monospace, monospace";
export const NUM_FONT = "'Space Grotesk Variable', 'Inter Variable', system-ui, sans-serif";

export async function ensureArtFonts(timeoutMs = 1500): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const load = Promise.all([
    document.fonts.load("16px 'Tiny5'"),
    document.fonts.load("8px 'Silkscreen'"),
    document.fonts.load("600 16px 'Space Grotesk Variable'"),
  ]).then(() => undefined);
  await Promise.race([load.catch(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

/** Team accent colours (game art). */
export const TEAM_TINT = ['#ff8a3d', '#22d3ee'] as const;
