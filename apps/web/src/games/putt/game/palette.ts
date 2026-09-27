/**
 * DAS Putt course art palette (declared once so a future theme can override it) + tiny colour
 * helpers. UI chrome uses design tokens (CSS vars); only the course ART lives here.
 */

export const ART = {
  voidTop: '#07060f',
  voidBottom: '#0b0a1c',
  gridLine: 'rgba(163, 230, 53, 0.07)',
  star: '#c9f5a0',
  plinth: '#0d2a10',
  plinthEdge: '#1d4a1c',
  turfLight: '#47b23c',
  turfMid: '#2a8a30',
  turfDark: '#155a26',
  stripe: 'rgba(255, 255, 255, 0.045)',
  wallTop: '#262b45',
  wallFace: '#161a2e',
  wallFaceDark: '#0a0c17',
  wallGlow: '#a3e635',
  bankGlow: '#fde047',
  kickerGlow: '#ff4fd8',
  sandLight: '#f3d9a0',
  sandDark: '#c9a063',
  sandRim: '#9c7843',
  waterDeep: '#062a3a',
  waterMid: '#0b5a73',
  waterLight: '#3fd6f0',
  slopeUp: 'rgba(255, 255, 255, 0.10)',
  slopeDown: 'rgba(0, 0, 0, 0.16)',
  chevron: 'rgba(253, 224, 71, 0.55)',
  cupRim: '#f8f6ff',
  cupHole: '#040308',
  flagPole: '#e5e7eb',
  flag: '#fde047',
  tee: '#1f5c1a',
  teeEdge: '#bef264',
  post: '#94a3b8',
  postTop: '#e2e8f0',
  bumper: '#ff4fd8',
  bumperCore: '#ffe4f6',
  blade: '#fb923c',
  bladeTop: '#fed7aa',
  hub: '#7c2d12',
  portal: { cyan: '#22d3ee', magenta: '#ff4fd8', amber: '#fbbf24' } as Record<string, string>,
  ball: '#fbfbff',
  ballShade: '#b9bdd6',
  aim: '#fde047',
  aimPreview: '#f8f6ff',
} as const;

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1]!, 16) : 0xa3e635;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Mix a colour toward white (amt > 0) or black (amt < 0). */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Deterministic PRNG for decorative art only (never gameplay). */
export function artRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export const DISPLAY_FONT = "'Tiny5', 'Silkscreen', ui-monospace, monospace";
export const NUM_FONT = "'Space Grotesk Variable', 'Inter Variable', system-ui, sans-serif";

let fontsReady: Promise<void> | null = null;
/** Resolve once the pixel display font is available for canvas text (never blocks > 1.2 s). */
export function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  if (typeof document === 'undefined' || !document.fonts) return (fontsReady = Promise.resolve());
  const load = Promise.all([document.fonts.load("16px 'Tiny5'"), document.fonts.load("16px 'Space Grotesk Variable'")]).then(() => undefined);
  fontsReady = Promise.race([load.catch(() => undefined), new Promise<void>((r) => setTimeout(r, 1200))]);
  return fontsReady;
}
