/**
 * Celebration confetti a skin can provide (ThemeSkin.celebration): extra colours and tiny pixel sprites
 * mixed into Wheel of DAStiny landings and claw-machine wins. Absent = the built-in confetti, unchanged.
 */

/** A pixel sprite: rows of one-letter cells ('.' = clear) and the colour (#rrggbb) of each letter. ≤ 12×12. */
export interface CelebrationSprite {
  rows: readonly string[];
  ink: Readonly<Record<string, string>>;
}

export interface SkinCelebration {
  /** Confetti colours (#rrggbb), mixed in after the winner's own colour. */
  colors: readonly string[];
  sprites?: readonly CelebrationSprite[];
  /** Share of particles drawn as sprites, 0–0.5 (default 0.25). */
  spriteShare?: number;
}

const HEX = /^#[0-9a-f]{6}$/i;
const canvases = new WeakMap<CelebrationSprite, HTMLCanvasElement | null>();

/** The sprite drawn one pixel per cell (cached per sprite). Null without a DOM canvas (tests, SSR). */
export function celebrationSpriteCanvas(sprite: CelebrationSprite): HTMLCanvasElement | null {
  if (canvases.has(sprite)) return canvases.get(sprite) ?? null;
  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = sprite.rows[0]?.length ?? 1;
    canvas.height = sprite.rows.length || 1;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      sprite.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const ink = row[x] === '.' ? undefined : sprite.ink[row[x]!];
          if (!ink) continue;
          ctx.fillStyle = ink;
          ctx.fillRect(x, y, 1, 1);
        }
      });
    } else canvas = null;
  }
  canvases.set(sprite, canvas);
  return canvas;
}

/** Every problem with a skin's celebration (empty = valid). */
export function celebrationProblems(c: SkinCelebration): string[] {
  const out: string[] = [];
  if (!Array.isArray(c.colors) || c.colors.length === 0) out.push('colors must be a non-empty list');
  else c.colors.forEach((color, i) => HEX.test(color) || out.push(`colors[${i}] must be #rrggbb`));
  if (c.spriteShare !== undefined && !(c.spriteShare >= 0 && c.spriteShare <= 0.5)) out.push('spriteShare must be 0–0.5');
  (c.sprites ?? []).forEach((s, i) => {
    const w = s.rows[0]?.length ?? 0;
    if (s.rows.length < 1 || s.rows.length > 12 || w < 1 || w > 12 || s.rows.some((r) => r.length !== w)) {
      out.push(`sprites[${i}] must be a rectangle of 1–12 × 1–12 cells`);
    }
    for (const row of s.rows) {
      for (const ch of row) if (ch !== '.' && !HEX.test(s.ink[ch] ?? '')) out.push(`sprites[${i}] letter "${ch}" needs a #rrggbb ink`);
    }
  });
  return [...new Set(out)];
}
