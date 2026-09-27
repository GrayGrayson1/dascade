/**
 * DASCADE theme → battlefield palette. The server picks a battle theme (dusk / night / aurora /
 * ember); the player's local DASCADE theme then re-presents it with its terrain MATERIALS
 * (`sky`, `skyHorizon`, `ground`, `groundDeep`, `groundEdge`), so Space Casino 2088 fights on
 * alien terrain and Shareware '97 on a CD-ROM landscape — same engine, same state.
 *
 * Delta Neon defines no materials → the battle theme's own palette is returned untouched (the
 * very same object), so the default look is unchanged. A little of the battle theme is blended
 * back in so the four battlefields still read as different places inside every theme.
 * Presentation only: nothing here touches the simulation.
 */
import { parseCssColor, type MaterialKey, type ThemeEffects } from '@dascade/ui';
import type { ThemePalette } from './themes.ts';

export type Materials = Partial<Record<MaterialKey, string>>;

/** Terrain + sky materials this game reads. */
export const TANKS_MATERIAL_KEYS = ['sky', 'skyHorizon', 'ground', 'groundDeep', 'groundEdge'] as const satisfies readonly MaterialKey[];

/** How much of the server's battle theme survives inside a themed palette (keeps battles distinct). */
const BATTLE_TINT = 0.2;

type Rgb = [number, number, number];

function rgbOf(css: string | undefined): Rgb | null {
  if (!css) return null;
  const c = parseCssColor(css);
  return c ? [c.r, c.g, c.b] : null;
}

const hex = ([r, g, b]: Rgb): string => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** Stable key for "which materials are active" (cheap change detection per frame). */
export function materialsSignature(m: Materials, effects?: Pick<ThemeEffects, 'ambient'>): string {
  return TANKS_MATERIAL_KEYS.map((k) => m[k] ?? '').join('|') + (effects ? `|${effects.ambient}` : '');
}

/**
 * The palette the battlefield is drawn with. Missing materials fall back to the battle theme's
 * exact colours; with none present the base palette object itself is returned.
 */
export function themedPalette(base: ThemePalette, m: Materials, effects?: Pick<ThemeEffects, 'ambient'>): ThemePalette {
  const sky = rgbOf(m.sky);
  const horizon = rgbOf(m.skyHorizon);
  const ground = rgbOf(m.ground);
  const deep = rgbOf(m.groundDeep);
  const edge = rgbOf(m.groundEdge);
  if (!sky && !horizon && !ground && !deep && !edge) return base;

  const b = (css: string): Rgb => rgbOf(css) ?? BLACK;
  // Blend a material with the battle theme's colour for the same role.
  const blend = (mat: Rgb | null, baseCss: string): string => (mat ? hex(mix(mat, b(baseCss), BATTLE_TINT)) : baseCss);

  const skyTop = sky ?? b(base.sky[0]);
  const skyLow = horizon ?? b(base.sky[2]);
  const gTop = ground ?? b(base.topsoil);
  const gDeep = deep ?? b(base.rock);
  const gEdge = edge ?? b(base.rim);

  const out: ThemePalette = {
    ...base,
    sky: [blend(sky, base.sky[0]), hex(mix(mix(skyTop, skyLow, 0.5), b(base.sky[1]), BATTLE_TINT)), blend(horizon, base.sky[2])],
    // Distant ridges and the skyline sit between the horizon and the ground, lit by the edge colour.
    far: hex(mix(mix(skyLow, gDeep, 0.6), b(base.far), BATTLE_TINT)),
    farRim: hex(mix(gEdge, skyLow, 0.35)),
    mid: hex(mix(mix(gDeep, BLACK, 0.45), b(base.mid), BATTLE_TINT)),
    haze: hex(mix(skyLow, b(base.haze), BATTLE_TINT)),
    cloud: hex(mix(mix(skyLow, WHITE, 0.3), b(base.cloud), BATTLE_TINT)),
    // Terrain body: edge (glowing rim) → ground → deep ground, by depth.
    rim: blend(edge, base.rim),
    rimGlow: hex(mix(gEdge, BLACK, 0.12)),
    topsoil: blend(ground, base.topsoil),
    soil: hex(mix(mix(gTop, gDeep, 0.5), b(base.soil), BATTLE_TINT)),
    rock: blend(deep, base.rock),
    deep: hex(mix(gDeep, BLACK, 0.5)),
    strata: hex(mix(mix(gTop, gDeep, 0.35), BLACK, 0.18)),
    scorch: hex(mix(gDeep, BLACK, 0.72)),
  };
  if (effects?.ambient === 'stars') out.stars = Math.max(base.stars, 160);
  if (effects?.ambient === 'rain') {
    out.weather = 'rain';
    out.motes = hex(mix(skyLow, WHITE, 0.55));
  }
  return out;
}

/** Colour of the void behind / below the field (camera clear colour). */
export function voidColor(p: ThemePalette, themed: boolean): string {
  return themed ? hex(mix(b0(p.deep), BLACK, 0.4)) : '#05040b';
}

function b0(css: string): Rgb {
  return rgbOf(css) ?? BLACK;
}
