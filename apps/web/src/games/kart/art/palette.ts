/**
 * DASphalt GP art palette + colour helpers (pure: no three.js, no DOM). Unit tested.
 *
 * Meaningful colours (player paint, racer identity, item/threat colours, drift stages) are fixed
 * here and never follow the theme.
 */
import type { KartItemId, KartRacerId } from '@dascade/shared/games/kart';
import { KART_RACERS } from '@dascade/shared/games/kart';

/** Parse #rgb / #rrggbb → 0xRRGGBB. Invalid input returns `fallback`. */
export function hexToInt(hex: string | null | undefined, fallback = 0xffffff): number {
  if (typeof hex !== 'string') return fallback;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return fallback;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return parseInt(h, 16);
}

export function intToHex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

const ch = (n: number, s: number) => (n >> s) & 255;

/** Mix two 0xRRGGBB colours (t = 0 → a, 1 → b). */
export function mixInt(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** Lighten (amt > 0, toward white) or darken (amt < 0, toward black). */
export function shadeInt(c: number, amt: number): number {
  return amt >= 0 ? mixInt(c, 0xffffff, amt) : mixInt(c, 0x000000, -amt);
}

/** Relative luminance 0..1 (sRGB approximation, good enough for contrast decisions). */
export function lumInt(c: number): number {
  return (0.2126 * ch(c, 16) + 0.7152 * ch(c, 8) + 0.0722 * ch(c, 0)) / 255;
}

/** Parse any CSS colour a theme might supply (#hex, rgb(), rgba()) → 0xRRGGBB, or null. */
export function cssToInt(css: string | null | undefined): number | null {
  if (typeof css !== 'string') return null;
  const s = css.trim();
  if (s.startsWith('#')) {
    const v = hexToInt(s, -1);
    return v < 0 ? null : v;
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (!m) return null;
  const c = (v: string | undefined) => Math.max(0, Math.min(255, Math.round(Number(v))));
  return (c(m[1]) << 16) | (c(m[2]) << 8) | c(m[3]);
}

/**
 * Theme fallback rule: `material ?? ORIGINAL`. Returns the EXACT original when the theme gives
 * nothing (Delta Neon defines no materials) or an unparsable value.
 */
export function matOr(materials: Partial<Record<string, string>> | null | undefined, key: string, orig: number): number {
  const v = materials ? cssToInt(materials[key]) : null;
  return v ?? orig;
}

/** Drift charge stage colours (meaningful: fixed). Index = stage 1..3 (0 unused). */
export const DRIFT_STAGE_COLORS = [0xffffff, 0x38e8ff, 0xffc82e, 0xff3df2] as const;

/** Item identity colours (meaningful: fixed). */
export const ITEM_COLORS: Record<KartItemId, { main: number; accent: number; glow: number }> = {
  turbo: { main: 0x1b2a4a, accent: 0x35e0ff, glow: 0x7df3ff },
  turbo3: { main: 0x1b2a4a, accent: 0x35e0ff, glow: 0x7df3ff },
  puck: { main: 0xff3d8b, accent: 0xffd6e8, glow: 0xff7ab0 },
  puck3: { main: 0xff3d8b, accent: 0xffd6e8, glow: 0xff7ab0 },
  seeker: { main: 0x2a2f45, accent: 0xff4040, glow: 0xff6b5a },
  mine: { main: 0x1a1030, accent: 0xa3ff3a, glow: 0xff2e5b },
  fizz: { main: 0xff8a1f, accent: 0xffe08a, glow: 0xffb04a },
  shield: { main: 0x7cd8ff, accent: 0xe8fbff, glow: 0x9be7ff },
  magnet: { main: 0xe8364f, accent: 0xdfe6f2, glow: 0xff7a8a },
  warp: { main: 0x8b5cff, accent: 0xe9ddff, glow: 0xb99bff },
  pulse: { main: 0xffd23f, accent: 0xfff6c8, glow: 0xffe27a },
};

/** Prism item cube colours (fixed). */
export const PRISM = { a: 0x39e6ff, b: 0xff4fd8, c: 0xffd23f, glyph: 0xffffff } as const;

export interface RacerArt {
  main: number;
  trim: number;
  /** Extra colours used by the voxel character. */
  dark: number;
  light: number;
  eye: number;
  accent: number;
}

const racerExtra: Record<KartRacerId, { dark: number; light: number; eye: number; accent: number }> = {
  byte: { dark: 0x1e293b, light: 0xf1f5f9, eye: 0x9ff7ff, accent: 0xff4f6d },
  nova: { dark: 0x1e2a4a, light: 0xffffff, eye: 0x7cc7ff, accent: 0x38bdf8 },
  rex: { dark: 0x14532d, light: 0xfef9c3, eye: 0x111111, accent: 0xffffff },
  mochi: { dark: 0x3b0a2e, light: 0xfff1f2, eye: 0x22d3ee, accent: 0xffb3c7 },
  brick: { dark: 0x2e1065, light: 0xede9fe, eye: 0xfbbf24, accent: 0x7c3aed },
  glitch: { dark: 0x1e1b4b, light: 0xecfccb, eye: 0x1e1b4b, accent: 0x22d3ee },
  quack: { dark: 0x7c2d12, light: 0xfff7cc, eye: 0x111111, accent: 0x38bdf8 },
  coin: { dark: 0x7c2d12, light: 0xfff3c4, eye: 0x111111, accent: 0xf8fafc },
};

export const RACER_ART: Record<KartRacerId, RacerArt> = Object.fromEntries(
  (Object.keys(KART_RACERS) as KartRacerId[]).map((id) => [
    id,
    { main: hexToInt(KART_RACERS[id].colors.main), trim: hexToInt(KART_RACERS[id].colors.trim), ...racerExtra[id] },
  ]),
) as Record<KartRacerId, RacerArt>;

/** Pick a readable trim for a kart body given its paint (keeps stripes visible on any paint). */
export function trimFor(paint: number, racerTrim: number): number {
  const d = Math.abs(lumInt(paint) - lumInt(racerTrim));
  if (d >= 0.18) return racerTrim;
  return lumInt(paint) > 0.5 ? 0x1f2937 : 0xf8fafc;
}
