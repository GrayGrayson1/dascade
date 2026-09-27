/**
 * Biome styles (pure data + the theme adapter). No three.js here — unit tested.
 *
 * Each biome fixes the WORLD look: sky gradient, fog, lights, terrain, asphalt/curbs, wall style,
 * scattered props. Themes may tint a few world materials (asphalt, lane paint, curbs, sky) with the
 * EXACT biome colour as fallback (`materials.<key> ?? ORIG`), so Delta Neon (no materials) renders
 * the hand-tuned biome palette unchanged. Meaningful colours (paint, items, drift stages, hazards'
 * danger glow, start lights) never come from here.
 */
import type { BiomeId, OffroadKind } from '@dascade/game-core/kart';
import { matOr, mixInt } from '../art/palette.ts';

export type WallStyle = 'neon' | 'sandstone' | 'dock' | 'snowbank' | 'bumper' | 'hazard' | 'glass' | 'data';
export type PropKind =
  | 'building'
  | 'lamp'
  | 'bush'
  | 'palm'
  | 'cactus'
  | 'rock'
  | 'mesa'
  | 'container'
  | 'bollard'
  | 'warehouse'
  | 'pine'
  | 'snowrock'
  | 'cabin'
  | 'stall'
  | 'balloons'
  | 'pipes'
  | 'tank'
  | 'crates'
  | 'cloud'
  | 'floatrock'
  | 'server'
  | 'pillar'
  | 'tyres'
  | 'crag';

export interface PropRule {
  kind: PropKind;
  /** Instances per 1000 u² of free land near the track (before rejection). */
  density: number;
  /** Min / max distance from the road edge (u). */
  near: number;
  far: number;
  /** Scale range. */
  scale: [number, number];
  /** Forest clustering: extra instances [min, max] within `clusterR` u of each accepted one. */
  cluster?: [number, number];
  clusterR?: number;
  /** Max ground height change over 5 u (steep slopes are rejected; default 1.8). */
  slope?: number;
}

export interface BiomeStyle {
  id: BiomeId;
  night: boolean;
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunIntensity: number;
  /** Sun direction (three space, toward the light). */
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ground: number;
  groundAlt: number;
  asphalt: number;
  asphaltSpeck: number;
  lane: number;
  edgeLine: number;
  curbA: number;
  curbB: number;
  wall: WallStyle;
  wallA: number;
  wallB: number;
  /** Neon/glow accent for walls, lamps, gantry trim. */
  glow: number;
  glowB: number;
  props: readonly PropRule[];
  /** Water plane around the track (harbor), height below the lowest road. */
  water?: { color: number; below: number };
  /** Cloud sea far below (sky). No terrain. */
  cloudSea?: { color: number; below: number };
  stars?: boolean;
  /** Sky dressing: sun disc size, horizon haze, clouds (cover = fbm threshold; higher = fewer). */
  skyLook: { sunSize: number; haze: number; hazeAmt: number; cover: number; cloud: number; shade: number; cirrus: number; moon?: boolean };
  /** Colour ambient occlusion darkens toward (baked into road/wall/skirt vertex colours). Black = neutral. */
  aoTint: number;
  /** Embankments slope outward (natural) or drop vertically (built). */
  slopedSkirts: boolean;
}

const P = (kind: PropKind, density: number, near: number, far: number, s0 = 0.8, s1 = 1.3, cluster?: [number, number], clusterR?: number, slope?: number): PropRule => ({
  kind,
  density,
  near,
  far,
  scale: [s0, s1],
  cluster,
  clusterR,
  slope: slope ?? (cluster ? 6 : undefined),
});

export const BIOMES: Record<BiomeId, BiomeStyle> = {
  city: {
    id: 'city',
    skyLook: { sunSize: 0, haze: 0xff5fb8, hazeAmt: 0.5, cover: 0.64, cloud: 0x6a4a8e, shade: 0x1e1438, cirrus: 0.25, moon: true },
    aoTint: 0x1a1030,
    night: true,
    skyTop: 0x0b0a2a,
    skyHorizon: 0x7b2d8f,
    skyBottom: 0x1a1030,
    fog: 0x3a1e5c,
    fogNear: 90,
    fogFar: 420,
    sun: 0xffc9f0,
    sunIntensity: 1.5,
    sunDir: [-0.4, 0.7, 0.55],
    hemiSky: 0x9aa7ff,
    hemiGround: 0x2a1840,
    hemiIntensity: 1.35,
    ground: 0x262a3c,
    groundAlt: 0x2d3246,
    asphalt: 0x2b2d3e,
    asphaltSpeck: 0x3a3d52,
    lane: 0xffd23f,
    edgeLine: 0xe6ebff,
    curbA: 0xff3d8b,
    curbB: 0xf1f5f9,
    wall: 'neon',
    wallA: 0x3a3d56,
    wallB: 0x22d3ee,
    glow: 0x22d3ee,
    glowB: 0xff4fd8,
    props: [P('building', 0.9, 22, 150, 0.8, 1.25), P('lamp', 0.5, 2, 5, 1, 1), P('bush', 0.5, 4, 40), P('palm', 0.35, 3, 30)],
    stars: true,
    slopedSkirts: false,
  },
  desert: {
    id: 'desert',
    skyLook: { sunSize: 0.0035, haze: 0xffc890, hazeAmt: 0.6, cover: 0.62, cloud: 0xfff4e6, shade: 0xd89878, cirrus: 0.3 },
    aoTint: 0x5a2418,
    night: false,
    skyTop: 0x2f7fd8,
    skyHorizon: 0xffd3a1,
    skyBottom: 0xe8b27a,
    fog: 0xf2c89a,
    fogNear: 140,
    fogFar: 620,
    sun: 0xfff1d6,
    sunIntensity: 2.4,
    sunDir: [0.5, 0.75, 0.3],
    hemiSky: 0xbfe0ff,
    hemiGround: 0xc98a52,
    hemiIntensity: 1.2,
    ground: 0xe0a768,
    groundAlt: 0xd09257,
    asphalt: 0x4a4550,
    asphaltSpeck: 0x5c5662,
    lane: 0xfff6e0,
    edgeLine: 0xfff6e0,
    curbA: 0xe8364f,
    curbB: 0xfff6e0,
    wall: 'sandstone',
    wallA: 0xc7784a,
    wallB: 0x9e5534,
    glow: 0xffb04a,
    glowB: 0xff5a5f,
    props: [P('cactus', 0.5, 4, 70), P('rock', 0.6, 3, 90, 0.6, 1.8), P('mesa', 0.06, 60, 220, 1, 2.2), P('tyres', 0.12, 1, 3, 1, 1)],
    slopedSkirts: true,
  },
  harbor: {
    id: 'harbor',
    skyLook: { sunSize: 0.0028, haze: 0xdcefff, hazeAmt: 0.45, cover: 0.52, cloud: 0xffffff, shade: 0x9fb4d0, cirrus: 0.25 },
    aoTint: 0x0c1830,
    night: false,
    skyTop: 0x3a7bd5,
    skyHorizon: 0xcfe8ff,
    skyBottom: 0x9cc9ee,
    fog: 0xbcdaf2,
    fogNear: 110,
    fogFar: 520,
    sun: 0xfff4e0,
    sunIntensity: 2.2,
    sunDir: [-0.5, 0.7, -0.4],
    hemiSky: 0xcfe4ff,
    hemiGround: 0x51606e,
    hemiIntensity: 1.3,
    ground: 0x8d949c,
    groundAlt: 0x7d848c,
    asphalt: 0x3c4048,
    asphaltSpeck: 0x4b505a,
    lane: 0xffd23f,
    edgeLine: 0xf1f5f9,
    curbA: 0xffd23f,
    curbB: 0x1f2937,
    wall: 'dock',
    wallA: 0xa9b0b8,
    wallB: 0xffd23f,
    glow: 0xffd23f,
    glowB: 0xff5a5f,
    props: [P('container', 0.9, 4, 60, 1, 1), P('bollard', 0.4, 1, 3, 1, 1), P('warehouse', 0.12, 34, 120, 1, 1.3), P('crates', 0.4, 3, 30)],
    water: { color: 0x1f6fa8, below: 1.6 },
    slopedSkirts: false,
  },
  snow: {
    id: 'snow',
    skyLook: { sunSize: 0.004, haze: 0xffd8b8, hazeAmt: 0.55, cover: 0.6, cloud: 0xfff2e6, shade: 0x8f9bd0, cirrus: 0.5 },
    aoTint: 0x3a3f98,
    night: false,
    skyTop: 0x1f56c8,
    skyHorizon: 0xe4eefc,
    skyBottom: 0xe6eef9,
    fog: 0xd4e2f6,
    fogNear: 110,
    fogFar: 520,
    sun: 0xffd2a0,
    sunIntensity: 2.4,
    sunDir: [0.55, 0.3, -0.62],
    hemiSky: 0xc4d8ff,
    hemiGround: 0x6a6cb4,
    hemiIntensity: 1.15,
    ground: 0xf6f9ff,
    groundAlt: 0xe4ecfa,
    asphalt: 0x363d52,
    asphaltSpeck: 0x475070,
    lane: 0xbfe9ff,
    edgeLine: 0xf8fafc,
    curbA: 0xe8364f,
    curbB: 0xf8fafc,
    wall: 'snowbank',
    wallA: 0xf7faff,
    wallB: 0xcfdaf2,
    glow: 0x7df3ff,
    glowB: 0x60a5fa,
    props: [P('pine', 1.6, 3, 150, 0.8, 1.8, [3, 7], 7), P('crag', 0.18, 8, 140, 0.8, 1.8, undefined, undefined, 5), P('snowrock', 0.3, 3, 60), P('cabin', 0.04, 16, 70, 1, 1.2)],
    slopedSkirts: true,
  },
  carnival: {
    id: 'carnival',
    skyLook: { sunSize: 0.003, haze: 0xffc0e0, hazeAmt: 0.5, cover: 0.56, cloud: 0xffeaf6, shade: 0xc08ad6, cirrus: 0.35 },
    aoTint: 0x3a1040,
    night: false,
    skyTop: 0x5a3fd1,
    skyHorizon: 0xffb3d9,
    skyBottom: 0xf5a3c8,
    fog: 0xf2b7d9,
    fogNear: 110,
    fogFar: 480,
    sun: 0xfff0f6,
    sunIntensity: 2.1,
    sunDir: [0.4, 0.7, 0.5],
    hemiSky: 0xffd9f0,
    hemiGround: 0x3f7d4f,
    hemiIntensity: 1.3,
    ground: 0x46b35f,
    groundAlt: 0x3ea255,
    asphalt: 0x3d3350,
    asphaltSpeck: 0x4d4264,
    lane: 0xffd23f,
    edgeLine: 0xfff6e0,
    curbA: 0xff3d8b,
    curbB: 0xffd23f,
    wall: 'bumper',
    wallA: 0xe8364f,
    wallB: 0xf8fafc,
    glow: 0xffd23f,
    glowB: 0xff4fd8,
    props: [P('stall', 0.35, 5, 50, 1, 1.2), P('balloons', 0.3, 3, 40), P('bush', 0.6, 4, 60), P('lamp', 0.35, 2, 5, 1, 1)],
    slopedSkirts: true,
  },
  factory: {
    id: 'factory',
    skyLook: { sunSize: 0.0045, haze: 0xf09060, hazeAmt: 0.65, cover: 0.48, cloud: 0xe0a078, shade: 0x6a4640, cirrus: 0.1 },
    aoTint: 0x2a1408,
    night: false,
    skyTop: 0x3b3346,
    skyHorizon: 0xd98b52,
    skyBottom: 0x6d4a3a,
    fog: 0x8a6250,
    fogNear: 80,
    fogFar: 380,
    sun: 0xffc48a,
    sunIntensity: 2.0,
    sunDir: [-0.3, 0.6, 0.7],
    hemiSky: 0xffd2a8,
    hemiGround: 0x3a3230,
    hemiIntensity: 1.25,
    ground: 0x55504c,
    groundAlt: 0x4a4541,
    asphalt: 0x383a40,
    asphaltSpeck: 0x474a52,
    lane: 0xffd23f,
    edgeLine: 0xffd23f,
    curbA: 0xffd23f,
    curbB: 0x1f2937,
    wall: 'hazard',
    wallA: 0x6b7280,
    wallB: 0xffd23f,
    glow: 0xff8a1f,
    glowB: 0xffd23f,
    props: [P('pipes', 0.35, 6, 70, 1, 1.4), P('tank', 0.2, 10, 90, 1, 1.5), P('crates', 0.5, 3, 40), P('tyres', 0.15, 1, 3, 1, 1)],
    slopedSkirts: false,
  },
  sky: {
    id: 'sky',
    skyLook: { sunSize: 0.003, haze: 0xffffff, hazeAmt: 0.4, cover: 0.52, cloud: 0xffffff, shade: 0xb6cdee, cirrus: 0.35 },
    aoTint: 0x1a2a60,
    night: false,
    skyTop: 0x1e6fe0,
    skyHorizon: 0xbfe6ff,
    skyBottom: 0xffffff,
    fog: 0xd6efff,
    fogNear: 160,
    fogFar: 700,
    sun: 0xfffaf0,
    sunIntensity: 2.4,
    sunDir: [0.4, 0.8, 0.3],
    hemiSky: 0xe0f2ff,
    hemiGround: 0x9fb8d6,
    hemiIntensity: 1.4,
    ground: 0x6fcf6f,
    groundAlt: 0x5fbf62,
    asphalt: 0x3b4458,
    asphaltSpeck: 0x4a556c,
    lane: 0xffffff,
    edgeLine: 0x7df3ff,
    curbA: 0x22d3ee,
    curbB: 0xf8fafc,
    wall: 'glass',
    wallA: 0xdff6ff,
    wallB: 0x22d3ee,
    glow: 0x22d3ee,
    glowB: 0xffd23f,
    props: [P('cloud', 0.3, 18, 200, 0.6, 1.5), P('floatrock', 0.06, 40, 180, 0.8, 1.6)],
    cloudSea: { color: 0xffffff, below: 38 },
    slopedSkirts: false,
  },
  cyber: {
    id: 'cyber',
    skyLook: { sunSize: 0, haze: 0x1a9fd0, hazeAmt: 0.5, cover: 0.72, cloud: 0x103a5c, shade: 0x040c18, cirrus: 0.0, moon: true },
    aoTint: 0x02081a,
    night: true,
    skyTop: 0x02030c,
    skyHorizon: 0x0b2a4a,
    skyBottom: 0x050814,
    fog: 0x071427,
    fogNear: 70,
    fogFar: 360,
    sun: 0xe4ecff,
    sunIntensity: 1.9,
    sunDir: [0.2, 0.8, -0.4],
    hemiSky: 0x8fb0e8,
    hemiGround: 0x101428,
    hemiIntensity: 1.3,
    ground: 0x0b1020,
    groundAlt: 0x0e1630,
    asphalt: 0x161a2c,
    asphaltSpeck: 0x20263e,
    lane: 0x22d3ee,
    edgeLine: 0x22d3ee,
    curbA: 0x22d3ee,
    curbB: 0x0b1020,
    wall: 'data',
    wallA: 0x10172e,
    wallB: 0x22d3ee,
    glow: 0x22d3ee,
    glowB: 0xa3e635,
    props: [P('server', 0.8, 14, 130, 0.8, 1.5), P('pillar', 0.4, 4, 40), P('lamp', 0.3, 2, 5, 1, 1)],
    stars: true,
    slopedSkirts: false,
  },
};

export interface OffroadStyle {
  base: number;
  speck: number;
  stripe: number;
}

export const OFFROAD: Record<OffroadKind, OffroadStyle> = {
  grass: { base: 0x3fa55a, speck: 0x5cc473, stripe: 0x379650 },
  sand: { base: 0xe6b579, speck: 0xf3cf98, stripe: 0xd9a669 },
  snow: { base: 0xf3f7fc, speck: 0xdfe9f5, stripe: 0xe9f0f8 },
  dirt: { base: 0x8a5a3a, speck: 0xa06d48, stripe: 0x7c5033 },
  gravel: { base: 0x8c8c94, speck: 0xa7a7b0, stripe: 0x7e7e86 },
  metal: { base: 0x4b5160, speck: 0x5d6475, stripe: 0x3f4452 },
};

/** Everything the world art colours with, after the theme adapter. */
export interface WorldPalette {
  themed: boolean;
  asphalt: number;
  asphaltSpeck: number;
  lane: number;
  edgeLine: number;
  curbA: number;
  curbB: number;
  offroad: OffroadStyle;
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  fog: number;
  metal: number;
}

type Mats = Partial<Record<string, string>> | null | undefined;

/**
 * Resolve the world palette for a biome + theme materials. With no materials this returns exactly
 * the biome's own colours (Delta Neon stays identical). With materials, asphalt/lane/curbs follow
 * the theme and the sky/fog lean 30% toward the theme's sky so the biome stays recognisable.
 */
export function worldPalette(biome: BiomeStyle, offroad: OffroadKind, materials: Mats): WorldPalette {
  const has = !!materials && Object.values(materials).some((v) => typeof v === 'string' && v.length > 0);
  const asphalt = matOr(materials, 'asphalt', biome.asphalt);
  const asphaltThemed = asphalt !== biome.asphalt;
  const base = OFFROAD[offroad];
  const off = matOr(materials, 'offroad', base.base);
  const lean = (key: string, orig: number) => {
    const v = matOr(materials, key, orig);
    return v === orig ? orig : mixInt(orig, v, 0.3);
  };
  return {
    themed: has,
    asphalt,
    asphaltSpeck: asphaltThemed ? mixInt(asphalt, 0xffffff, 0.08) : biome.asphaltSpeck,
    lane: matOr(materials, 'asphaltLine', biome.lane),
    edgeLine: matOr(materials, 'asphaltLine', biome.edgeLine),
    curbA: matOr(materials, 'curbA', biome.curbA),
    curbB: matOr(materials, 'curbB', biome.curbB),
    offroad: off === base.base ? base : { base: off, speck: mixInt(off, 0xffffff, 0.12), stripe: mixInt(off, 0x000000, 0.08) },
    skyTop: lean('sky', biome.skyTop),
    skyHorizon: lean('skyHorizon', biome.skyHorizon),
    skyBottom: biome.skyBottom,
    fog: lean('skyHorizon', biome.fog),
    metal: matOr(materials, 'metal', 0x9aa4b8),
  };
}

/** Stable signature of a palette (skip redundant texture redraws). */
export function paletteSig(p: WorldPalette): string {
  return [p.asphalt, p.asphaltSpeck, p.lane, p.edgeLine, p.curbA, p.curbB, p.offroad.base, p.skyTop, p.skyHorizon, p.fog, p.metal].join(',');
}
