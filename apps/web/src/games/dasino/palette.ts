/**
 * Theme-material palettes for DASino's canvas art (roulette wheel, slot reels).
 *
 * Each colour is `materials.<key>` when the active theme defines it, otherwise the original
 * DASino colour (Delta Neon defines no materials, so it renders exactly as before). Pocket
 * colours (red / black / green), the numbers and the winning-pocket highlight are game meaning
 * and never come from a theme.
 */
import { parseCssColor, type ThemeTokens } from '@dascade/ui';

export type Materials = ThemeTokens['materials'];

/** Mixes `color` toward black (amount < 0) or white (amount > 0). Unparseable input is returned as-is. */
export function shade(color: string, amount: number): string {
  const c = parseCssColor(color);
  if (!c) return color;
  const target = amount < 0 ? 0 : 255;
  const t = Math.min(1, Math.abs(amount));
  const mix = (v: number) => Math.round(v + (target - v) * t);
  return `rgb(${mix(c.r)}, ${mix(c.g)}, ${mix(c.b)})`;
}

/** Same colour with a new alpha. Unparseable input is returned as-is. */
export function alpha(color: string, a: number): string {
  const c = parseCssColor(color);
  if (!c) return color;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

export interface WheelPalette {
  rim: [string, string, string];
  track: [string, string];
  apron: string;
  goldRing: string;
  goldRingSoft: string;
  goldBright: string;
  neon: string;
  outerRing: string;
  cone: [string, string, string];
  turret: [string, string, string];
  dome: [string, string, string];
  capInset: string;
  bulbLit: string;
  bulbA: string;
  bulbB: string;
}

export function wheelPalette(m: Materials): WheelPalette {
  const rail = m.rail;
  const metal = m.metal;
  const metalHi = m.metalHighlight;
  return {
    rim: [m.railHighlight ?? '#1d0f36', rail ?? '#140a26', rail ? shade(rail, -0.6) : '#07040f'],
    track: [rail ? shade(rail, -0.45) : '#0a0614', rail ?? '#1a1030'],
    apron: rail ? shade(rail, -0.3) : '#110922',
    goldRing: metal ?? '#e3b341',
    goldRingSoft: metal ? alpha(metal, 0.55) : 'rgba(227,179,65,0.55)',
    goldBright: metalHi ?? '#ffd23f',
    neon: m.led ?? '#c084fc',
    outerRing: metal ? alpha(metal, 0.35) : 'rgba(255,210,63,0.35)',
    cone: [m.railHighlight ?? '#8b5cf6', rail ?? '#4c1d95', rail ? shade(rail, -0.5) : '#1e0b3d'],
    turret: [metalHi ?? '#fff1a8', metal ?? '#ffd23f', metal ? shade(metal, -0.35) : '#b7791f'],
    dome: [metalHi ?? '#fff6cf', metal ?? '#ffd23f', metal ? shade(metal, -0.45) : '#9a6512'],
    capInset: rail ?? '#2e1065',
    bulbLit: metalHi ?? '#fff4c2',
    bulbA: m.led ? alpha(m.led, 0.55) : 'rgba(192,132,252,0.55)',
    bulbB: metal ? alpha(metal, 0.45) : 'rgba(255,210,63,0.45)',
  };
}

/** Cheap identity for "did the wheel palette change?" (rebuild the pre-rendered layers only then). */
export function paletteKey(p: object): string {
  return JSON.stringify(p);
}

export interface ReelPalette {
  /** Reel body gradient stops at 0 / 0.3 / 0.5 (mirrored to 0.7 / 1). */
  body: [string, string, string];
  separator: string;
}

export function reelPalette(m: Materials): ReelPalette {
  const screen = m.screen;
  return {
    body: [screen ?? '#07040f', screen ? shade(screen, 0.08) : '#1c1036', screen ? shade(screen, 0.14) : '#27164a'],
    separator: m.screenGlow ? alpha(m.screenGlow, 0.12) : 'rgba(192,132,252,0.10)',
  };
}
