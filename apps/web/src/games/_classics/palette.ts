/**
 * Theme materials for the Classics screens (render-only).
 *
 * Every Classics game keeps its own hand-tuned art under Delta Neon (no materials defined). Other
 * themes supply `screen` (the CRT/playfield background), `screenGlow` (lattice, rims, glow) and
 * `bezel`; the helpers below turn those into the colours a renderer needs. Sprites (players,
 * bricks, pieces, pickups) keep their identity colours in every theme.
 *
 * Colours never touch the deterministic simulation, its inputs or replays: renderers receive a
 * new palette through `setMaterials()` and simply draw with it on the next frame.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { formatColor, parseCssColor, watchThemeTokens, type ThemeTokens } from '@dascade/ui';

export type Materials = ThemeTokens['materials'];

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };

function rgb(color: string) {
  return parseCssColor(color) ?? BLACK;
}

/** `color` (hex / rgb / rgba) with alpha `a` as an rgba() string. */
export function tint(color: string, a: number): string {
  const c = rgb(color);
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/** Linear mix of two colours (t = 0 → a, 1 → b), as #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  return formatColor({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k, a: 1 });
}

/** Darken towards black (0..1). */
export const deepen = (color: string, t: number): string => mix(formatColor(rgb(color)), formatColor(BLACK), t);
/** Lighten towards white (0..1). */
export const lighten = (color: string, t: number): string => mix(formatColor(rgb(color)), formatColor(WHITE), t);

/** Relative luminance 0..1 (sRGB approximation; used to keep screen ink readable). */
export function luminance(color: string): number {
  const c = rgb(color);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export interface ScreenColors {
  /** Top of the playfield background gradient. */
  top: string;
  /** Bottom of the playfield background gradient. */
  bottom: string;
  /** Lattice / rim / glow colour. */
  glow: string;
}

/**
 * Playfield background + glow from theme materials, falling back to the game's own art.
 * A theme's `screen` becomes the top of the gradient and a deeper shade of it the bottom.
 */
export function screenColors(m: Materials, fallback: ScreenColors): ScreenColors {
  return {
    top: m.screen ?? fallback.top,
    bottom: m.screen ? deepen(m.screen, 0.45) : fallback.bottom,
    glow: m.screenGlow ?? fallback.glow,
  };
}

/** True when the theme defines any screen material (Delta Neon: false → keep the game's art verbatim). */
export const hasScreenMaterials = (m: Materials): boolean => Boolean(m.screen || m.screenGlow || m.bezel);

/**
 * Calls `apply(materials)` now and whenever the theme / fx / reduced motion changes (coalesced per
 * frame), reading from `ref` (inside the game's <GameStage data-game>, so per-game nudges apply).
 * The latest `apply` is always used; the subscription is disposed on unmount.
 */
export function useLiveMaterials(ref: RefObject<Element | null>, apply: (m: Materials) => void): void {
  const cb = useRef(apply);
  cb.current = apply;
  useEffect(() => watchThemeTokens(() => ref.current, (t) => cb.current(t.materials)), [ref]);
}
