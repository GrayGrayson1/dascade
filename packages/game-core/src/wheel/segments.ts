/**
 * Segment normalization: turns whatever is in settings (or arrives from a client)
 * into the list of ACTIVE segments the wheel actually shows and draws from.
 *
 * Rules
 *  - disabled segments are dropped;
 *  - weights must be finite and > 0 (zero / negative / NaN / non-numbers drop the
 *    segment), and are clamped to WHEEL_LIMITS.weightMax;
 *  - labels are cleaned and bounded; a segment needs a label or an icon;
 *  - invalid colors fall back to the palette, invalid or duplicate ids are repaired;
 *  - at most WHEEL_LIMITS.segments active segments.
 */
import type { Rng } from '@dascade/shared';
import {
  HEX_COLOR_RE,
  WHEEL_LIMITS,
  WHEEL_PALETTE,
  WHEEL_SEGMENT_ID_RE,
  cleanWheelEmoji,
  cleanWheelLabel,
  type WheelSnapshotSegment,
} from '@dascade/shared/games/wheel';

/** A segment that is on the wheel (enabled, positive weight, drawable). */
export type ActiveSegment = WheelSnapshotSegment;

/** Loosely typed segment input (anything may arrive; nothing is trusted). */
export interface SegmentLike {
  id?: unknown;
  label?: unknown;
  weight?: unknown;
  color?: unknown;
  emoji?: unknown;
  enabled?: unknown;
}

/** Hard cap on how many raw entries normalization will even look at. */
const SCAN_LIMIT = 2_000;

/** Returns a usable weight in (0, weightMax], or 0 when the value is invalid / non-positive. */
export function sanitizeWeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(WHEEL_LIMITS.weightMax, value);
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

/** Palette color for a position, used as a fallback. */
export function paletteColor(index: number): string {
  const n = WHEEL_PALETTE.length;
  return WHEEL_PALETTE[((Math.trunc(index) % n) + n) % n] as string;
}

/** Text shown for a segment (label, else the icon). */
export function displayLabel(segment: { label: string; emoji: string }): string {
  return segment.label || segment.emoji;
}

export function normalizeSegments(input: unknown): ActiveSegment[] {
  if (!Array.isArray(input)) return [];
  const out: ActiveSegment[] = [];
  const seen = new Set<string>();
  const limit = Math.min(input.length, SCAN_LIMIT);
  for (let i = 0; i < limit && out.length < WHEEL_LIMITS.segments; i++) {
    const raw = input[i] as SegmentLike | null | undefined;
    if (!raw || typeof raw !== 'object') continue;
    if (raw.enabled === false) continue;
    const weight = sanitizeWeight(raw.weight);
    if (weight <= 0) continue;
    const label = cleanWheelLabel(raw.label);
    const emoji = cleanWheelEmoji(raw.emoji);
    if (!label && !emoji) continue;
    const color = isHexColor(raw.color) ? raw.color.toLowerCase() : paletteColor(i);
    let id = typeof raw.id === 'string' && WHEEL_SEGMENT_ID_RE.test(raw.id) ? raw.id : `seg-${i}`;
    if (seen.has(id)) {
      let n = 2;
      const base = id.slice(0, 20);
      while (seen.has(`${base}~${n}`)) n++;
      id = `${base}~${n}`;
    }
    seen.add(id);
    out.push({ id, label, emoji, color, weight });
  }
  return out;
}

export function totalWeight(segments: readonly { weight: number }[]): number {
  let total = 0;
  for (const s of segments) total += sanitizeWeight(s.weight);
  return total;
}

/** Selection probability of each segment (weights normalized to sum 1). */
export function probabilities(segments: readonly { weight: number }[]): number[] {
  const total = totalWeight(segments);
  if (total <= 0) return segments.map(() => 0);
  return segments.map((s) => sanitizeWeight(s.weight) / total);
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/**
 * Assigns palette colors to `count` slices in a shuffled order such that no two
 * neighbours (including last → first, since the wheel wraps) share a color
 * whenever that is possible (count ≥ 2 and palette ≥ 3).
 */
export function assignColors(count: number, rng: Rng, palette: readonly string[] = WHEEL_PALETTE): string[] {
  const n = Math.max(0, Math.min(Math.trunc(count), 10_000));
  if (n === 0 || palette.length === 0) return [];
  const order = [...palette];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(order[i % order.length] as string);
  if (palette.length >= 3 && n >= 2) {
    // The cyclic walk keeps neighbours distinct; only the wrap-around can collide.
    const first = out[0];
    const last = out[n - 1];
    if (first === last) {
      const prev = out[n - 2];
      const replacement = order.find((c) => c !== first && c !== prev);
      if (replacement) out[n - 1] = replacement;
    }
  }
  return out;
}

function rgbOf(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Perceptually weighted RGB distance ("redmean"), good enough to tell palette colors apart. */
export function colorDistance(a: string, b: string): number {
  if (!isHexColor(a) || !isHexColor(b)) return 0;
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/**
 * Picks a palette color for a new slice that stands out from its neighbours:
 * one of the few palette entries most distant from both (never an exact match).
 */
export function colorBetween(prev: string | undefined, next: string | undefined, rng: Rng, palette: readonly string[] = WHEEL_PALETTE): string {
  if (palette.length === 0) return '#ffb020';
  const neighbours = [prev, next].filter(isHexColor).map((c) => c.toLowerCase());
  if (neighbours.length === 0) return palette[rng.int(palette.length)] as string;
  const scored = palette
    .map((c) => ({ c, d: Math.min(...neighbours.map((n) => colorDistance(c, n))) }))
    .sort((x, y) => y.d - x.d);
  const pool = scored.filter((x) => x.d > 0).slice(0, 4);
  const pick = pool.length ? pool : scored;
  return (pick[rng.int(pick.length)] as { c: string }).c;
}

function channel(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

/** WCAG relative luminance of a #rrggbb color (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) return 0;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(channel(hex, 1)) + 0.7152 * lin(channel(hex, 3)) + 0.0722 * lin(channel(hex, 5));
}

/** Best text color (near-black or white) on top of a slice color. */
export function readableTextColor(hex: string): '#140a00' | '#ffffff' {
  const l = relativeLuminance(hex);
  const contrastDark = (l + 0.05) / (0.0045 + 0.05);
  const contrastLight = 1.05 / (l + 0.05);
  return contrastDark >= contrastLight ? '#140a00' : '#ffffff';
}

/** Mixes a #rrggbb color toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  if (!isHexColor(hex)) return hex;
  const t = Math.max(-1, Math.min(1, amount));
  const target = t > 0 ? 255 : 0;
  const mix = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(c + (target - c) * Math.abs(t))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}
