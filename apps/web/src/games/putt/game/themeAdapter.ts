/**
 * DASCADE theme → mini-golf course art. The local theme's course MATERIALS (`grass`,
 * `grassDeep`, `sand`, `hazard`, `wall`, `wallTop`) plus `sky` / `stage` for the surroundings
 * re-present every hole — a 1997 shareware CD course, a Space Casino deck, a mahogany green —
 * with the same holes, physics and state.
 *
 * Delta Neon defines no materials → `PUTT_DEFAULT_ART` (today's exact colours) is returned.
 * Meaning colours are never themed: the cup, flag, ball, aim line, bumpers, blades, portals and
 * the bank / kicker cushion glows keep their identity in every theme.
 */
import { parseCssColor, type MaterialKey } from '@dascade/ui';
import { ART } from './palette.ts';

export type Materials = Partial<Record<MaterialKey, string>>;

export const PUTT_MATERIAL_KEYS = ['grass', 'grassDeep', 'sand', 'hazard', 'wall', 'wallTop', 'sky', 'stage'] as const satisfies readonly MaterialKey[];

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends string ? string : T[K] };

/** Every colour the course renderer paints with (ART + the few inline neon details it had). */
export interface PuttArt extends Mutable<Omit<typeof ART, 'portal'>> {
  portal: Record<string, string>;
  /** Horizon halo behind the course (two stops). */
  halo: string;
  halo2: string;
  /** Inner shade along the turf outline, and its tight core. */
  turfShade: string;
  turfShadeTight: string;
  /** Lit lip on the decks' open edges. */
  turfLip: string;
  /** Collar around the cup (inner stop; the outer stop is the same colour at alpha 0). */
  collar: string;
  collarOut: string;
  /** Cup wall colour at the rim. */
  cupWall: string;
  /** Lamp posts / rail undersides. */
  lampPost: string;
}

export const PUTT_DEFAULT_ART: PuttArt = {
  ...ART,
  portal: ART.portal,
  halo: 'rgba(163, 230, 53, 0.10)',
  halo2: 'rgba(34, 211, 238, 0.04)',
  turfShade: 'rgba(0, 18, 6, 0.85)',
  turfShadeTight: 'rgba(0, 18, 6, 0.55)',
  turfLip: 'rgba(214, 255, 170, 0.55)',
  collar: 'rgba(190, 255, 120, 0.22)',
  collarOut: 'rgba(190, 255, 120, 0)',
  cupWall: '#1b2a1e',
  lampPost: '#1b1b2e',
};

type Rgb = [number, number, number];
const rgbOf = (css: string | undefined): Rgb | null => {
  if (!css) return null;
  const c = parseCssColor(css);
  return c ? [c.r, c.g, c.b] : null;
};
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const lighten = (c: Rgb, t: number) => mix(c, WHITE, t);
const dist = (a: Rgb, b: Rgb) => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]));
const darken = (c: Rgb, t: number) => mix(c, BLACK, t);

/** Stable key of the materials this game reads (cheap change detection). */
export function puttMaterialsSignature(m: Materials): string {
  return PUTT_MATERIAL_KEYS.map((k) => m[k] ?? '').join('|');
}

/** Course art for the active theme; missing materials fall back per role to today's colours. */
export function puttArt(m: Materials): PuttArt {
  const grass = rgbOf(m.grass);
  const grassDeep = rgbOf(m.grassDeep);
  const sand = rgbOf(m.sand);
  const hazard = rgbOf(m.hazard);
  const wall = rgbOf(m.wall);
  const wallTop = rgbOf(m.wallTop);
  const sky = rgbOf(m.sky);
  const stage = rgbOf(m.stage);
  if (!grass && !grassDeep && !sand && !hazard && !wall && !wallTop && !sky && !stage) return PUTT_DEFAULT_ART;

  const a: PuttArt = { ...PUTT_DEFAULT_ART };
  if (grass || grassDeep) {
    const g = grass ?? lighten(grassDeep!, 0.25);
    const d = grassDeep ?? darken(grass!, 0.3);
    a.turfLight = hex(lighten(g, 0.14));
    a.turfMid = hex(g);
    a.turfDark = hex(d);
    a.plinth = hex(darken(d, 0.62));
    a.plinthEdge = hex(darken(d, 0.35));
    a.tee = hex(darken(d, 0.2));
    a.teeEdge = hex(lighten(g, 0.55));
    a.turfShade = rgba(darken(d, 0.85), 0.85);
    a.turfShadeTight = rgba(darken(d, 0.85), 0.55);
    a.turfLip = rgba(lighten(g, 0.6), 0.55);
    a.collar = rgba(lighten(g, 0.45), 0.22);
    a.collarOut = rgba(lighten(g, 0.45), 0);
    a.cupWall = hex(darken(d, 0.7));
    a.halo = rgba(lighten(g, 0.2), 0.1);
    a.gridLine = rgba(lighten(g, 0.35), 0.07);
    a.star = hex(lighten(g, 0.7));
  }
  if (sand) {
    a.sandLight = hex(lighten(sand, 0.08));
    a.sandDark = hex(darken(sand, 0.2));
    a.sandRim = hex(darken(sand, 0.38));
  }
  if (hazard) {
    a.waterMid = hex(hazard);
    a.waterDeep = hex(darken(hazard, 0.55));
    a.waterLight = hex(lighten(hazard, 0.55));
  }
  if (wall || wallTop) {
    const face = wall ?? darken(wallTop!, 0.35);
    const top = wallTop ?? lighten(wall!, 0.25);
    a.wallFace = hex(face);
    a.wallFaceDark = hex(darken(face, 0.5));
    a.wallTop = hex(mix(face, top, 0.45));
    // The inlaid rail tube takes the wall-top colour (the neon lime is Delta Neon's own look) —
    // unless that would pass for a bank (yellow) or kicker (magenta) cushion: then a neutral tube.
    let tube = lighten(top, 0.12);
    const bank = rgbOf(ART.bankGlow)!;
    const kicker = rgbOf(ART.kickerGlow)!;
    if (dist(tube, bank) < 110 || dist(tube, kicker) < 110) {
      const l = 0.2126 * tube[0] + 0.7152 * tube[1] + 0.0722 * tube[2];
      tube = lighten([l, l, l], 0.35);
    }
    a.wallGlow = hex(tube);
    a.lampPost = hex(darken(face, 0.4));
  }
  if (sky || stage) {
    const top = sky ?? stage!;
    const low = stage ?? sky!;
    a.voidTop = hex(top);
    a.voidBottom = hex(mix(top, low, 0.7));
    a.halo2 = rgba(lighten(low, 0.3), 0.05);
  }
  return a;
}
