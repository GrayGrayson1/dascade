/**
 * DASQuest theme adapter (presentation only).
 *
 * The pixel scenes use ~500 hand-picked colours spread over 15 environment painters and 40+
 * props. Instead of forking every painter per theme, all scene colours flow through ONE
 * palette role map — a luminance-preserving "scene grade":
 *
 *   - Delta Neon (no materials): `createSceneGrade` returns null → every colour is drawn exactly
 *     as authored (pixel-identical to the original scenes).
 *   - Any other theme: the theme's materials (screen, sky, ground…, screenGlow) are sorted by
 *     luminance into a tone ramp. Each authored colour is mapped to the ramp at its own
 *     luminance (so light/dark structure and readability survive) and then blended back
 *     toward the original by its chroma (neon light sources — monitors, signs, glitches —
 *     keep most of their hue; greys, walls and floors take on the theme's world).
 *
 * The scene frame (tint glow ring) follows `screenGlow`; the narrative panel follows
 * paper/paperInk/paperEdge in CSS (quest.css, `var(--mat-*, <original>)` + `[data-quest-mat]`).
 */
import { parseCssColor, type MaterialKey, type Rgba, type ThemeEffects } from '@dascade/ui';

export type QuestMaterials = Partial<Record<MaterialKey, string>>;

/** Material roles that make up the scene tone ramp (dark → light once sorted). */
export const SCENE_RAMP_ROLES = ['screen', 'sky', 'groundDeep', 'bezel', 'ground', 'skyHorizon', 'groundEdge', 'screenGlow'] as const satisfies readonly MaterialKey[];

export function hasMaterials(m: QuestMaterials): boolean {
  for (const key in m) if (m[key as MaterialKey]) return true;
  return false;
}

type Rgb = [number, number, number];

const lum = ([r, g, b]: Rgb): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Chroma 0–1 (not HSV saturation, which calls every dark navy "fully saturated"). */
const chroma = ([r, g, b]: Rgb): number => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
function fmt([r, g, b]: Rgb, a: number): string {
  if (a >= 1) return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${Number(a.toFixed(3))})`;
}

export interface SceneGrade {
  /** Maps an authored CSS colour to the themed one (alpha preserved). Unparseable input passes through. */
  map(color: string): string;
  /** Ramp stops actually used (dark → light) — exposed for tests. */
  readonly ramp: readonly string[];
}

/**
 * Builds the scene grade for a theme's materials. Returns null when the theme defines no
 * materials (Delta Neon) or too few ramp roles — callers then draw the authored colours as-is.
 */
export function createSceneGrade(m: QuestMaterials): SceneGrade | null {
  const stops: Array<{ c: Rgb; l: number }> = [];
  for (const role of SCENE_RAMP_ROLES) {
    const raw = m[role];
    const p: Rgba | null = raw ? parseCssColor(raw) : null;
    if (!p) continue;
    const c: Rgb = [p.r, p.g, p.b];
    stops.push({ c, l: lum(c) });
  }
  if (stops.length < 2) return null;
  stops.sort((a, b) => a.l - b.l);
  // Keep stops strictly increasing in luminance (drop near-duplicates).
  const ramp: Array<{ c: Rgb; l: number }> = [];
  for (const s of stops) if (!ramp.length || s.l - ramp[ramp.length - 1]!.l > 0.004) ramp.push(s);
  if (ramp.length < 2) ramp.push({ c: [255, 255, 255], l: 1 });
  const lo = ramp[0]!;
  const hi = ramp[ramp.length - 1]!;

  const toneAt = (l: number): Rgb => {
    if (l <= lo.l) return lo.l <= 0 ? lo.c : mix([0, 0, 0], lo.c, l / lo.l);
    if (l >= hi.l) return hi.l >= 1 ? hi.c : mix(hi.c, [255, 255, 255], (l - hi.l) / (1 - hi.l));
    for (let i = 1; i < ramp.length; i++) {
      const b = ramp[i]!;
      if (l <= b.l) {
        const a = ramp[i - 1]!;
        return mix(a.c, b.c, (l - a.l) / (b.l - a.l));
      }
    }
    return hi.c;
  };

  const cache = new Map<string, string>();
  return {
    ramp: ramp.map((s) => fmt(s.c, 1)),
    map(color: string): string {
      const hit = cache.get(color);
      if (hit !== undefined) return hit;
      const p = parseCssColor(color);
      let out = color;
      if (p) {
        const src: Rgb = [p.r, p.g, p.b];
        // Vivid light sources (monitors, signs, glitches) keep more of their own hue; dark and
        // neutral surfaces (walls, floors, furniture) adopt the theme's world.
        const keep = 0.06 + 0.62 * chroma(src);
        out = fmt(mix(toneAt(lum(src)), src, keep), p.a);
      }
      if (cache.size > 2048) cache.clear();
      cache.set(color, out);
      return out;
    },
  };
}

/** Scene frame accent: the scene's own tint under Delta Neon; leans to the theme's screen glow otherwise. */
export function sceneTint(m: QuestMaterials, tint: string): string {
  const glow = m.screenGlow ? parseCssColor(m.screenGlow) : null;
  const own = parseCssColor(tint);
  if (!glow || !own) return tint;
  return fmt(mix([own.r, own.g, own.b], [glow.r, glow.g, glow.b], 0.65), 1);
}

export interface SceneEffects {
  /** 0–1 scanline strength for the decorative scene overlay (0 = none). */
  crt: number;
  /** 0–1 grain strength for the decorative scene overlay (0 = none). */
  grain: number;
}

/**
 * Decorative frame overlays for themed scenes. Delta Neon (no materials) gets none — its scene
 * already has its own authored vignette — and visual effects "off" disables them everywhere.
 */
export function sceneEffects(m: QuestMaterials, effects: Pick<ThemeEffects, 'crt' | 'grain'>, fx: 'high' | 'low' | 'off'): SceneEffects {
  if (!hasMaterials(m) || fx === 'off') return { crt: 0, grain: 0 };
  const scale = fx === 'low' ? 0.5 : 1;
  const c = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * scale * 100) / 100;
  return { crt: c(effects.crt), grain: c(effects.grain) };
}

/**
 * Routes every colour a 2D context is given through `grade()` (fillStyle and gradient colour
 * stops). With a null grade the value passes through untouched. Returns an uninstaller.
 * The grade is read at draw time, so a theme switch applies on the very next frame — no
 * scene restart, no reset.
 */
export function installGrade(ctx: CanvasRenderingContext2D, grade: () => SceneGrade | null): () => void {
  const proto = Object.getPrototypeOf(ctx) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, 'fillStyle');
  if (!desc?.set || !desc.get) return () => undefined;
  const { get, set } = desc;
  const mapStop = (g: CanvasGradient): CanvasGradient => {
    const add = g.addColorStop.bind(g);
    g.addColorStop = (offset: number, color: string) => {
      const gr = grade();
      add(offset, gr ? gr.map(color) : color);
    };
    return g;
  };
  const radial = ctx.createRadialGradient.bind(ctx);
  const linear = ctx.createLinearGradient.bind(ctx);
  Object.defineProperty(ctx, 'fillStyle', {
    configurable: true,
    get() {
      return get.call(ctx);
    },
    set(v: string | CanvasGradient | CanvasPattern) {
      const gr = typeof v === 'string' ? grade() : null;
      set.call(ctx, gr ? gr.map(v as string) : v);
    },
  });
  Object.defineProperty(ctx, 'createRadialGradient', { configurable: true, value: (...a: Parameters<typeof radial>) => mapStop(radial(...a)) });
  Object.defineProperty(ctx, 'createLinearGradient', { configurable: true, value: (...a: Parameters<typeof linear>) => mapStop(linear(...a)) });
  return () => {
    delete (ctx as unknown as Record<string, unknown>).fillStyle;
    delete (ctx as unknown as Record<string, unknown>).createRadialGradient;
    delete (ctx as unknown as Record<string, unknown>).createLinearGradient;
  };
}
