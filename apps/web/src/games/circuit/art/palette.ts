/** Colour helpers for procedural art (canvas + Phaser). */

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1]!, 16) : 0x22d3ee;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function hexToInt(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (r << 16) | (g << 8) | b;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix a colour toward white (amt > 0) or black (amt < 0). */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  const k = 1 + amt;
  return rgbToHex(r * k, g * k, b * k);
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Relative luminance 0..1 (for picking readable text colours). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function readableOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#07050f' : '#f8f6ff';
}

/** Tiny deterministic PRNG for decorative art (never gameplay). */
export function artRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

export const NEON = ['#22d3ee', '#f97316', '#ff4fd8', '#ffd23f'] as const;
/** Small caps / labels (matches --font-pixel). */
export const PIXEL_FONT = "'Silkscreen', 'Tiny5', ui-monospace, monospace";
/** Display face (matches --font-display): unambiguous C/O and 5/S. */
export const DISPLAY_FONT = "'Tiny5', 'Silkscreen', ui-monospace, monospace";

/** Make sure the pixel fonts are ready before we bake them into canvases (with a timeout fallback). */
export async function ensureArtFonts(timeoutMs = 1500): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const load = Promise.all([document.fonts.load("16px 'Tiny5'"), document.fonts.load("8px 'Silkscreen'")]).then(() => undefined);
  await Promise.race([load.catch(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
