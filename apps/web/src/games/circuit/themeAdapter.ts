/**
 * Theme adapter for DASh Circuit's world art (presentation only — never physics, net or timing).
 *
 * `circuitWorldPalette(trackTheme, materials)` resolves every WORLD colour the procedural art
 * uses. With no materials (Delta Neon) it returns exactly the hand-tuned constants the art has
 * always used, so the default theme is pixel-identical. With a theme's materials the asphalt,
 * paint, curbs, run-off, barriers, city blocks, parks, lots, grandstands and backdrop follow the
 * theme (asphalt / asphaltLine / curbA / curbB / offroad + ground / sky / metal / grass).
 *
 * Meaning is preserved: the track's own neon (edge tube, lamps, gantry, minimap ribbon), car
 * colours, start lights and the chequered line are never re-coloured, and curbs / paint are
 * pushed apart from the asphalt when a theme's colours would collide.
 */
import type { TrackTheme } from '@dascade/game-core/circuit';
import { parseCssColor, type MaterialKey } from '@dascade/ui';
import { luminance, mix, rgba, rgbToHex, shade } from './art/palette.ts';

export type Materials = Partial<Record<MaterialKey, string>>;

export interface CircuitWorldPalette {
  /** True when a theme supplied materials (false = Delta Neon / the game's own look). */
  themed: boolean;
  /** Stable signature of the palette (texture keys / change detection). '' when unthemed. */
  sig: string;
  /** The TrackTheme the art draws with (the track's own, or a themed copy). */
  track: TrackTheme;
  /** Alternate curb block colour (the art historically used the track's neonB). */
  curbAlt: string;
  roadEdge: string;
  edgeLine: string;
  racingLine: string;
  chevronBg: string;
  plazaEdge: string;
  plazaA: string;
  plazaB: string;
  deckGirder: string;
  street: string;
  streetSpeck: string;
  laneDash: string;
  crosswalk: string;
  sidewalk: string;
  sidewalkEdge: string;
  block: string;
  blockSpeck: string;
  parkGrass: string;
  parkSpeck: string;
  parkPath: string;
  pond: string;
  treeA: string;
  treeB: string;
  treeC: string;
  lot: string;
  standBase: string;
  standRowA: string;
  standRowB: string;
  standWall: string;
  /** Roof / wall tones for 2.5D buildings (6 tones). */
  roofTones: readonly string[];
  /** Camera clear colour beyond the city. */
  background: string;
  /** Gantry / lamp structure (Phaser ints). */
  steelDark: number;
  steel: number;
  steelLight: number;
  steelBody: number;
}

/** Today's exact world constants (Delta Neon). */
export const DEFAULT_WORLD = {
  roadEdge: '#e6ebff',
  edgeLine: 'rgba(230,235,255,0.55)',
  racingLine: 'rgba(0,0,0,0.2)',
  chevronBg: '#0b0914',
  plazaEdge: '#232a44',
  plazaA: '#121728',
  plazaB: '#161c30',
  deckGirder: '#1a1830',
  street: '#0c0f1c',
  streetSpeck: '#0f1322',
  laneDash: 'rgba(255,210,63,0.35)',
  crosswalk: 'rgba(230,235,255,0.22)',
  sidewalk: '#1a2036',
  sidewalkEdge: '#232a44',
  block: '#0e1120',
  blockSpeck: '#12162a',
  parkGrass: '#0d2219',
  parkSpeck: '#10291e',
  parkPath: '#2a2d3e',
  pond: '#0b2a3c',
  treeA: '#174d33',
  treeB: '#1f6b44',
  treeC: '#2d8a57',
  lot: '#15182a',
  standBase: '#141828',
  standRowA: '#1d2236',
  standRowB: '#20263c',
  standWall: '#2a3350',
  roofTones: ['#2a2f47', '#342f4c', '#243a46', '#3b2d40', '#2c3a33', '#3e3833'] as readonly string[],
  background: '#070814',
  steelDark: 0x0b0914,
  steel: 0x3a4262,
  steelLight: 0x2a3350,
  steelBody: 0x151a2c,
} as const;

const DEFAULT_PALETTE_CACHE = new WeakMap<TrackTheme, CircuitWorldPalette>();

/** Opaque #rrggbb for a material (alpha dropped); null when missing / unparseable. */
function hex(value: string | undefined): string | null {
  if (!value) return null;
  const c = parseCssColor(value);
  return c ? rgbToHex(c.r, c.g, c.b) : null;
}

/** WCAG-style contrast ratio between two opaque colours (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Pushes `fg` lighter/darker (away from `bg`) until their contrast ratio is at least `min`. */
export function separate(fg: string, bg: string, min: number): string {
  let out = fg;
  const darken = luminance(bg) > 0.3;
  for (let i = 0; i < 8 && contrast(out, bg) < min; i++) out = shade(out, darken ? -0.3 : 0.3);
  return out;
}

const int = (h: string) => parseInt(h.slice(1), 16);

/**
 * Resolves the world palette for a track. Missing material → exact default; present → used
 * (with derived shades). Pure: same inputs, same output.
 */
export function circuitWorldPalette(trackTheme: TrackTheme, materials: Materials = {}): CircuitWorldPalette {
  const asphalt = hex(materials.asphalt);
  const line = hex(materials.asphaltLine);
  const curbA = hex(materials.curbA);
  const curbB = hex(materials.curbB);
  const offroad = hex(materials.offroad);
  const ground = hex(materials.ground);
  const groundDeep = hex(materials.groundDeep);
  const sky = hex(materials.sky);
  const metal = hex(materials.metal);
  const grass = hex(materials.grassDeep) ?? hex(materials.grass);
  const water = hex(materials.water);
  const any = asphalt || line || curbA || curbB || offroad || ground || groundDeep || sky || metal || grass || water;
  if (!any) {
    let cached = DEFAULT_PALETTE_CACHE.get(trackTheme);
    if (!cached) {
      cached = { themed: false, sig: '', track: trackTheme, curbAlt: trackTheme.neonB, ...DEFAULT_WORLD };
      DEFAULT_PALETTE_CACHE.set(trackTheme, cached);
    }
    return cached;
  }

  const D = DEFAULT_WORLD;
  const road = asphalt ?? trackTheme.road;
  const paint = separate(line ?? D.roadEdge, road, 3);
  const g = ground ?? mix(road, D.sidewalk, 0.5);
  const gd = groundDeep ?? shade(g, -0.4);
  const runoff = offroad ?? trackTheme.runoff;
  const curb = separate(curbA ?? trackTheme.curb, road, 1.8);
  const curbAlt = separate(curbB ?? trackTheme.neonB, curb, 1.6);
  const steel = metal ? shade(metal, -0.45) : '#3a4262';
  const track: TrackTheme = {
    ...trackTheme,
    road,
    runoff,
    curb,
    ground: g,
    barrier: metal ? mix(shade(metal, -0.55), gd, 0.35) : trackTheme.barrier,
  };
  const park = grass ? mix(shade(grass, -0.45), gd, 0.35) : mix(D.parkGrass, gd, 0.4);
  const palette: CircuitWorldPalette = {
    themed: true,
    sig: '',
    track,
    curbAlt,
    roadEdge: paint,
    edgeLine: rgba(paint, 0.55),
    racingLine: luminance(road) > 0.4 ? 'rgba(0,0,0,0.12)' : D.racingLine,
    chevronBg: shade(gd, -0.5),
    plazaEdge: shade(g, 0.12),
    plazaA: shade(g, -0.18),
    plazaB: shade(g, -0.08),
    deckGirder: shade(gd, -0.2),
    street: shade(gd, -0.25),
    streetSpeck: shade(gd, -0.1),
    laneDash: rgba(curbAlt, 0.35),
    crosswalk: rgba(paint, 0.22),
    sidewalk: g,
    sidewalkEdge: shade(g, 0.15),
    block: gd,
    blockSpeck: shade(gd, 0.1),
    parkGrass: park,
    parkSpeck: shade(park, 0.12),
    parkPath: shade(g, 0.1),
    pond: water ? shade(water, -0.3) : D.pond,
    treeA: grass ? shade(grass, -0.3) : D.treeA,
    treeB: grass ?? D.treeB,
    treeC: grass ? shade(grass, 0.25) : D.treeC,
    lot: shade(road, -0.15),
    standBase: shade(gd, -0.2),
    standRowA: gd,
    standRowB: shade(gd, 0.08),
    standWall: shade(g, 0.1),
    roofTones: D.roofTones.map((t, i) => mix(t, i % 2 ? g : gd, 0.55)),
    background: sky ? shade(sky, -0.3) : shade(gd, -0.5),
    steelDark: int(shade(gd, -0.6)),
    steel: int(steel),
    steelLight: int(shade(steel, 0.12)),
    steelBody: int(shade(gd, -0.3)),
  };
  palette.sig = signature(palette);
  return palette;
}

function signature(p: CircuitWorldPalette): string {
  const t = p.track;
  const s = [t.road, t.runoff, t.curb, t.barrier, p.curbAlt, p.roadEdge, p.sidewalk, p.block, p.parkGrass, p.treeB, p.pond, p.background, ...p.roofTones].join('');
  // FNV-1a → short base36 key.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
