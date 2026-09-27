/**
 * Landmark models keyed by `Landmark.kind` (see .scratch/kart/LANDMARKS.md). Each is a merged static
 * mesh plus up to a few animated parts (ferris wheel, lighthouse beam, gears, blimp, radar…), all on
 * the shared voxel material (vertex colours + glow). Models face local +Z; the renderer turns them
 * toward the road. Unknown kinds fall back to `tower`.
 */
import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial, SphereGeometry, type BufferGeometry, type Material } from 'three';
import type { BiomeStyle } from './biomes.ts';
import { MeshBuilder } from '../art/builder.ts';
import { shadeInt } from '../art/palette.ts';

export const LANDMARK_KINDS = [
  'arcade-cabinet',
  'billboard',
  'tower',
  'arch',
  'radar-dish',
  'mesa-arch',
  'lighthouse',
  'crane',
  'cargo-ship',
  'ice-castle',
  'frozen-joystick',
  'ferris-wheel',
  'circus-tent',
  'gears',
  'smokestack',
  'blimp',
  'cpu-tower',
  'data-spire',
  'cloud-island',
  'hot-air-balloon',
] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

/** Ground footprint radius at scale 1 (0 = floats; no clearing). */
export const LANDMARK_FOOTPRINT: Record<LandmarkKind, number> = {
  'arcade-cabinet': 12,
  billboard: 9,
  tower: 11,
  arch: 16,
  'radar-dish': 10,
  'mesa-arch': 22,
  lighthouse: 8,
  crane: 12,
  'cargo-ship': 0,
  'ice-castle': 20,
  'frozen-joystick': 10,
  'ferris-wheel': 14,
  'circus-tent': 16,
  gears: 18,
  smokestack: 9,
  blimp: 0,
  'cpu-tower': 14,
  'data-spire': 8,
  'cloud-island': 0,
  'hot-air-balloon': 0,
};

export interface LandmarkInstance {
  group: Group;
  /** Materials this instance owns (dispose with it). */
  materials: Material[];
  /** Animate (t = seconds). Reduced motion calls it with a frozen t. */
  update(t: number): void;
  geometries: BufferGeometry[];
}

interface Parts {
  /** `span` = half-width between pillars (arches only; sized to the road when spanning it). */
  base: (b: MeshBuilder, bi: BiomeStyle, span?: number) => void;
  /** Animated sub-parts: builder + pivot + animation. */
  anim?: {
    build: (b: MeshBuilder, bi: BiomeStyle) => void;
    pivot: [number, number, number];
    update: (m: Mesh, t: number) => void;
    /** Draw with an additive, translucent material (light beams). */
    additive?: boolean;
  }[];
}

const STEEL = 0x9aa4b8;
const DARK = 0x1c1f2b;
const NEON_C = 0x22d3ee;
const NEON_M = 0xff4fd8;
const GOLD = 0xffd23f;

const DEFS: Record<LandmarkKind, Parts> = {
  'arcade-cabinet': {
    base(b) {
      // giant DASCADE cabinet: body, marquee, CRT, control deck, joystick, buttons, coin door
      const W = 16;
      const D = 11;
      b.box(0, 10, 0, W, 20, D, 0x3b1d6e);
      b.box(0, 10, D / 2 + 0.05, W - 1.5, 19, 0.1, 0x2a1450);
      b.box(-W / 2 - 0.05, 18, 0, 0.1, 36, D, NEON_C, 0.9).box(W / 2 + 0.05, 18, 0, 0.1, 36, D, NEON_M, 0.9);
      b.box(0, 27, -1, W, 14, D - 2, 0x3b1d6e);
      b.boxR(0, 21.5, 3.2, W, 2.5, 6, 'x', 0.35, 0x4c2a88);
      // control deck
      b.box(0, 20.8, 4.8, W - 1, 0.6, 3, 0x1e1038);
      b.cyl(-3.5, 22.3, 5, 0.35, 3, STEEL, 8).ball(-3.5, 24, 5, 1.1, 0xff3048, 1, 0.3);
      for (let k = 0; k < 4; k++) b.cyl(1 + k * 1.7, 21.25, 5 + (k % 2) * 0.6, 0.55, 0.35, [NEON_C, GOLD, NEON_M, 0x2de38f][k]!, 10, 'y', 0.8);
      // screen bezel
      b.box(0, 28.5, 4.05, W - 2.5, 10, 0.3, DARK);
      // marquee
      b.box(0, 35.5, 0.5, W, 3.8, D - 1, 0x1e1038);
      b.box(0, 35.5, 5.05, W - 1.2, 3, 0.1, GOLD, 0.95);
      // coin door
      b.box(0, 8, D / 2 + 0.12, 5, 5, 0.1, DARK).box(-1, 8.8, D / 2 + 0.2, 0.9, 1.4, 0.05, 0xff3048, 1).box(1, 8.8, D / 2 + 0.2, 0.9, 1.4, 0.05, 0xff3048, 1);
      b.box(0, 0.3, 0, W + 2, 0.6, D + 2, 0x10091f);
    },
    anim: [
      {
        // the glowing screen (flickers between two neon tints)
        build(b) {
          b.box(0, 0, 0, 12.5, 8.5, 0.2, 0x0b1a3a, 0.9);
          for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) if ((r * 3 + c) % 4 === 0) b.box(-5 + c * 1.45, -3 + r * 1.5, 0.12, 0.9, 0.9, 0.05, [NEON_C, NEON_M, GOLD][(r + c) % 3]!, 1);
          b.box(0, -3.6, 0.12, 12, 0.25, 0.05, 0x2de38f, 1);
        },
        pivot: [0, 28.5, 4.25],
        update(m, t) {
          m.scale.y = 1 + 0.01 * Math.sin(t * 30);
        },
      },
    ],
  },
  billboard: {
    base(b) {
      b.box(-5, 5, 0, 0.8, 10, 0.8, STEEL).box(5, 5, 0, 0.8, 10, 0.8, STEEL);
      b.box(0, 12, 0, 18, 8, 0.8, DARK);
      b.box(0, 12, 0.45, 17, 7, 0.1, 0x3b1d6e, 0.4);
      // chunky "DAS" pixel letters
      const px = (x: number, y: number, c: number) => b.box(x, y, 0.55, 0.9, 0.9, 0.1, c, 1);
      const D = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 4], [2, 1], [2, 2], [2, 3]];
      const A = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 2], [1, 4], [2, 0], [2, 1], [2, 2], [2, 3]];
      const S = [[0, 0], [1, 0], [2, 1], [1, 2], [0, 3], [1, 4], [2, 4], [2, 0], [0, 2], [2, 2], [0, 4]];
      [D, A, S].forEach((L, li) => L.forEach(([x, y]) => px(-6 + li * 4.5 + x! * 1, 10 + y!, [NEON_C, NEON_M, GOLD][li]!)));
      b.box(0, 16.2, 0, 18.4, 0.4, 1, NEON_C, 0.9);
      b.box(0, 7.8, 0, 18.4, 0.4, 1, NEON_M, 0.9);
    },
  },
  tower: {
    base(b, bi) {
      const c = shadeInt(bi.wallA, -0.2);
      b.box(0, 12, 0, 16, 24, 16, c);
      b.box(0, 32, 0, 12, 16, 12, shadeInt(c, 0.06));
      b.box(0, 45, 0, 8, 10, 8, shadeInt(c, 0.12));
      for (let y = 2; y < 50; y += 3) {
        const w = y < 24 ? 16 : y < 40 ? 12 : 8;
        b.box(0, y, w / 2 + 0.05, w * 0.85, 0.5, 0.08, bi.glow, 0.9);
        b.box(w / 2 + 0.05, y, 0, 0.08, 0.5, w * 0.85, bi.glowB, 0.9);
      }
      b.cyl(0, 55, 0, 0.3, 10, STEEL, 6).ball(0, 60.5, 0, 0.8, 0xff3048, 1, 1);
    },
  },
  arch: {
    // built across local Z (pillars at z = ±span) so it can straddle the road
    base(b, bi, span = 14) {
      for (const z of [-span, span]) {
        b.box(0, 7, z, 2.4, 14, 2.4, DARK);
        b.box(1.25, 7, z, 0.1, 13, 0.4, bi.glow, 1).box(-1.25, 7, z, 0.1, 13, 0.4, bi.glow, 1);
        b.box(0, 0.4, z, 3.4, 0.8, 3.4, shadeInt(DARK, 0.2));
      }
      b.box(0, 14.5, 0, 2.4, 3, span * 2 + 3, DARK);
      b.box(1.25, 14.5, 0, 0.1, 1.6, span * 2 + 1, bi.glowB, 0.95).box(-1.25, 14.5, 0, 0.1, 1.6, span * 2 + 1, bi.glowB, 0.95);
      const n = Math.max(4, Math.round(span / 1.1));
      for (let k = -n; k <= n; k++) b.box(0, 16.3, (k * span) / n, 1, 0.6, 1, k % 2 ? GOLD : bi.glow, 1);
    },
  },
  'radar-dish': {
    base(b) {
      b.box(0, 0.5, 0, 8, 1, 8, 0xc7a27a);
      for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]] as const) b.boxR(x * 0.6, 5, z * 0.6, 0.5, 10, 0.5, 'x', z * 0.03, 0xd6dde8);
      b.box(0, 10, 0, 3, 2, 3, 0xe5e7eb);
      b.box(0, 1.5, 3.2, 3, 2, 0.2, 0xff5a5f);
    },
    anim: [
      {
        build(b) {
          b.cyl(0, 0, 0, 1, 1.2, 0xc0c7d2, 8);
          b.push().translate(0, 3, 0).rotate('x', -0.9);
          b.cyl(0, 0, 0, 8, 0.6, 0xf1f5f9, 16, 'y', 0, 8);
          b.cone(0, -1.4, 0, 8, 2.6, 0xe5e7eb, 16, 'y', 0, true);
          b.cyl(0, 2.2, 0, 0.2, 4.4, STEEL, 6);
          b.ball(0, 4.5, 0, 0.5, 0xff3048, 1, 1);
          b.pop();
        },
        pivot: [0, 11, 0],
        update(m, t) {
          m.rotation.y = t * 0.25;
        },
      },
    ],
  },
  'mesa-arch': {
    base(b, _bi, span = 15) {
      const c = 0xb8683e;
      const band = 0x9e5534;
      for (const z of [-span, span]) {
        b.cyl(0, 9, z, 6, 18, c, 7, 'y', 0, 4.8);
        b.cyl(0, 5, z, 6.1, 1.2, band, 7);
        b.cyl(0, 12, z, 5.3, 1, band, 7);
      }
      b.push().translate(0, 22, 0).scale(1, 0.7, 1);
      b.cyl(0, 0, 0, 7, span * 2 + 6, c, 8, 'z');
      b.pop();
      b.box(0, 26, 0, 9, 3, span * 2 - 2, 0xc97a4a);
      b.ball(0, 26, span * 0.8, 6, c, 1, 0, 4, 5).ball(0, 26, -span * 0.8, 6, c, 1, 0, 4, 5);
      b.cyl(0, 28.8, -span * 0.5, 0.35, 2.5, 0x3f9a4a, 6);
    },
  },
  lighthouse: {
    base(b) {
      b.cyl(0, 1.5, 0, 7, 3, 0x7d848c, 10);
      for (let k = 0; k < 6; k++) b.cyl(0, 4.5 + k * 4, 0, 3.6 - k * 0.3, 4, k % 2 ? 0xf8fafc : 0xe8364f, 12, 'y', 0, 3.3 - k * 0.3);
      b.cyl(0, 28.6, 0, 3, 0.6, DARK, 12);
      b.cyl(0, 30.2, 0, 2.2, 2.8, 0xfff6c8, 12, 'y', 0.9);
      b.cone(0, 32.8, 0, 2.6, 2.4, 0xe8364f, 12);
      b.cyl(0, 28.9, 0, 3.4, 0.2, STEEL, 12);
      b.box(0, 6, 3.3, 1.4, 2.4, 0.3, 0x4a2e1c);
    },
    anim: [
      {
        // two soft light cones sweeping the harbour
        build(b) {
          for (const dir of [1, -1]) b.cone(dir * 14, 0, 0, 3.2, 26, 0x2e2a1c, 12, 'x', 0, dir < 0);
        },
        pivot: [0, 30.2, 0],
        additive: true,
        update(m, t) {
          m.rotation.y = t * 1.2;
        },
      },
    ],
  },
  crane: {
    base(b) {
      for (const x of [-5, 5]) for (const z of [-4, 4]) b.box(x, 11, z, 0.9, 22, 0.9, 0xf2a900);
      for (const y of [6, 14, 22]) {
        b.box(0, y, 4, 11, 0.6, 0.6, 0xf2a900).box(0, y, -4, 11, 0.6, 0.6, 0xf2a900);
        b.box(5, y, 0, 0.6, 0.6, 9, 0xf2a900).box(-5, y, 0, 0.6, 0.6, 9, 0xf2a900);
      }
      b.box(0, 23, 6, 3, 2, 30, 0xf2a900);
      b.box(0, 24.5, -8, 6, 4, 5, 0xe8364f);
      b.box(0, 24.5, -5.4, 4, 1.4, 0.1, 0x9be7ff, 0.5);
      b.box(0, 18, 20, 0.2, 10, 0.2, DARK);
      b.box(0, 12.5, 20, 6, 2.6, 2.4, 0x2563eb);
      for (const x of [-5, 5]) for (const z of [-4, 4]) b.box(x, 0.4, z, 1.6, 0.8, 1.6, DARK);
    },
  },
  'cargo-ship': {
    base(b) {
      b.box(0, 3, 0, 60, 6, 14, 0x1f3b63);
      b.box(0, 0.8, 0, 60.2, 1.6, 14.2, 0xe8364f);
      b.cone(33, 3, 0, 7, 6, 0x1f3b63, 4, 'x');
      const cols = [0xe8364f, 0x2563eb, 0x22c55e, 0xf97316, 0xffd23f];
      for (let i = 0; i < 8; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 2; k++) b.box(-18 + i * 5.2, 7.3 + k * 2.6, -4.2 + j * 4.2, 5, 2.5, 4, cols[(i + j * 2 + k) % cols.length]!);
      b.box(-26, 10, 0, 6, 8, 12, 0xf1f5f9);
      b.box(-26, 12, 6.05, 5, 1.2, 0.1, 0x9be7ff, 0.6);
      b.cyl(-27, 16, 0, 1, 4, 0xe8364f, 8);
    },
  },
  'ice-castle': {
    base(b) {
      const ice = 0xbfe9ff;
      const deep = 0x7cc7f0;
      b.box(0, 5, 0, 30, 10, 18, ice, 0.12);
      for (let k = -7; k <= 7; k++) b.box(k * 2, 10.8, 9, 1.2, 1.6, 0.8, deep, 0.1);
      for (const [x, z, h] of [[-15, 9, 20], [15, 9, 20], [-15, -9, 16], [15, -9, 16], [0, -4, 28]] as const) {
        b.cyl(x, h / 2, z, 3.2, h, ice, 8, 'y', 0.15);
        b.cone(x, h + 3, z, 3.8, 6, 0xf1f5f9, 8, 'y', 0.1);
        b.octa(x, h + 6.8, z, 0.8, NEON_C, 1, 1.8);
      }
      b.box(0, 4, 9.1, 6, 8, 0.4, 0x3b5f8a);
      b.cyl(0, 8, 9.1, 3, 0.4, 0x3b5f8a, 10, 'z');
      for (let k = 0; k < 8; k++) b.octa(-12 + k * 3.4, 1, 10 + (k % 2), 0.9 + (k % 3) * 0.3, deep, 0.4, 2.5);
    },
  },
  'frozen-joystick': {
    base(b) {
      b.box(0, 2, 0, 14, 4, 12, 0x1e1038);
      b.box(0, 4.2, 0, 13, 0.4, 11, 0x3b1d6e);
      b.cyl(0, 12, 0, 0.9, 16, 0xc0c7d2, 10);
      b.ball(0, 21, 0, 3.4, 0xff3048, 2, 0.35);
      b.box(0, 11, 0, 9, 20, 9, 0xbfe9ff, 0.15);
      for (let k = 0; k < 6; k++) b.octa(-5 + k * 2, 21.8 + (k % 2), (k % 3) - 1, 1 + (k % 2) * 0.4, 0xe0f6ff, 0.3, 2);
      b.cyl(4.5, 4.6, 3, 1, 0.5, GOLD, 10, 'y', 0.8).cyl(-4.5, 4.6, 3, 1, 0.5, NEON_C, 10, 'y', 0.8);
      for (let k = 0; k < 5; k++) b.cone(-6 + k * 3, 0.4, 6.4, 0.5, 2.4, 0xe0f6ff, 4, 'y', 0.2, true);
    },
  },
  'ferris-wheel': {
    base(b) {
      for (const z of [-3, 3]) {
        b.boxR(-7, 11, z, 1, 24, 1, 'z', -0.32, 0xf8fafc);
        b.boxR(7, 11, z, 1, 24, 1, 'z', 0.32, 0xf8fafc);
      }
      b.cyl(0, 22, 0, 0.8, 7, STEEL, 8, 'z');
      b.box(0, 0.5, 0, 22, 1, 10, 0x7c2d12);
      b.box(0, 2, 5.2, 8, 3, 0.4, 0xe8364f).box(0, 2.6, 5.45, 7, 1, 0.1, GOLD, 0.9);
    },
    anim: [
      {
        build(b) {
          const R = 18;
          b.torus(0, 0, 2.6, R, 0.35, NEON_M, 4, 40, 0.8);
          b.torus(0, 0, -2.6, R, 0.35, NEON_C, 4, 40, 0.8);
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            b.push().rotate('z', a);
            b.box(R / 2, 0, 2.6, R, 0.3, 0.3, 0xf8fafc).box(R / 2, 0, -2.6, R, 0.3, 0.3, 0xf8fafc);
            b.ball(R, 0, 2.6, 0.45, GOLD, 0, 1).ball(R, 0, -2.6, 0.45, GOLD, 0, 1);
            b.pop();
          }
        },
        pivot: [0, 22, 0],
        update(m, t) {
          m.rotation.z = t * 0.12;
        },
      },
    ],
  },
  'circus-tent': {
    base(b) {
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        b.push().rotate('y', a);
        b.box(0, 5, 14.4, 7.6, 10, 0.4, k % 2 ? 0xe8364f : 0xfff6e0);
        b.pop();
      }
      b.cone(0, 14, 0, 16, 8, 0xe8364f, 12);
      b.cone(0, 13.6, 0, 15.2, 7.4, 0xfff6e0, 12, 'y', 0, false);
      b.cone(0, 18, 0, 8, 4, 0xe8364f, 12);
      b.cyl(0, 20.5, 0, 0.2, 3, STEEL, 4).box(0.9, 21.3, 0, 1.8, 1, 0.05, GOLD, 0.6);
      b.box(0, 3.5, 14.6, 5, 7, 0.3, 0x3b1d6e);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        b.ball(Math.sin(a) * 14.6, 10.3, Math.cos(a) * 14.6, 0.35, [GOLD, NEON_C, NEON_M][k % 3]!, 0, 1);
      }
    },
  },
  gears: {
    base(b) {
      b.box(0, 12, -2, 40, 24, 2, 0x4b5160);
      for (let x = -18; x <= 18; x += 6) b.box(x, 12, -0.9, 0.4, 24, 0.2, 0x3b4252);
      b.box(0, 0.5, 0, 42, 1, 6, 0x2a2d3a);
      b.box(0, 24.5, -1, 42, 1, 4, 0xffd23f);
    },
    anim: [
      { build: (b) => gear(b, 9, 16, 0xb45309), pivot: [-8, 13, 0], update: (m, t) => void (m.rotation.z = t * 0.4) },
      { build: (b) => gear(b, 6, 11, 0x9aa4b8), pivot: [7.4, 9, 0.5], update: (m, t) => void (m.rotation.z = -t * 0.6 + 0.14) },
      { build: (b) => gear(b, 4.5, 8, 0xffd23f), pivot: [9.5, 19.5, 1], update: (m, t) => void (m.rotation.z = t * 0.8) },
    ],
  },
  smokestack: {
    base(b) {
      b.box(0, 4, 0, 16, 8, 10, 0x6b4a3a);
      for (const x of [-4, 4]) {
        b.cyl(x, 24, 0, 2.2, 36, 0x8a5a4a, 10, 'y', 0, 1.8);
        b.cyl(x, 32, 0, 2.05, 2, 0xf8fafc, 10);
        b.cyl(x, 36, 0, 1.95, 2, 0xe8364f, 10);
        b.cyl(x, 42.2, 0, 2.1, 0.6, DARK, 10);
        b.ball(x, 42.4, 0, 1.2, 0xff8a1f, 0, 0.9, 0.3);
      }
      for (let k = 0; k < 4; k++) b.box(-6 + k * 4, 5, 5.05, 2, 2.5, 0.1, 0xffd99a, 0.8);
    },
    anim: [
      {
        build(b) {
          for (let k = 0; k < 4; k++) b.ball(k * 1.2, k * 3, 0, 2 + k * 0.8, 0xbdb3ad, 1, 0.1);
        },
        pivot: [-4, 45, 0],
        update(m, t) {
          const p = (t * 0.3) % 1;
          m.position.y = 45 + p * 6;
          m.scale.setScalar(0.8 + p * 0.6);
        },
      },
    ],
  },
  blimp: {
    base() {},
    anim: [
      {
        build(b) {
          b.push().scale(3.4, 1, 1);
          b.sphere(0, 0, 0, 7, 0xf1f5f9, 18, 10);
          b.pop();
          b.box(0, -7.4, 0, 8, 2.6, 3.4, 0x1e2a4a);
          b.box(0, -7.4, 1.75, 6, 1, 0.05, 0x9be7ff, 0.8);
          b.box(-22, 0, 0, 5, 0.4, 12, NEON_M).box(-22, 0, 0, 5, 12, 0.4, NEON_M);
          b.box(0, 0, 6.95, 26, 3.2, 0.2, 0x3b1d6e, 0.2);
          b.box(0, 0, 7.06, 24, 2, 0.05, NEON_C, 1);
          b.box(0, 0, -6.95, 26, 3.2, 0.2, 0x3b1d6e, 0.2);
          b.box(0, 0, -7.06, 24, 2, 0.05, GOLD, 1);
        },
        pivot: [0, 40, 0],
        update(m, t) {
          m.position.x = Math.sin(t * 0.05) * 30;
          m.position.y = 40 + Math.sin(t * 0.4) * 1.2;
          m.rotation.y = Math.cos(t * 0.05) > 0 ? 0 : Math.PI;
        },
      },
    ],
  },
  'cpu-tower': {
    base(b) {
      b.box(0, 3, 0, 6, 6, 6, 0x10172e);
      b.box(0, 6.5, 0, 20, 1, 20, 0x0e1428);
      b.box(0, 14, 0, 22, 14, 3, 0x1e2a4a);
      b.box(0, 14, 1.6, 16, 9, 0.2, 0x0b1020);
      b.box(0, 14, 1.75, 6, 5, 0.1, NEON_C, 1);
      for (let k = -9; k <= 9; k += 2) {
        b.box(k, 21.6, 0, 0.5, 1.4, 1.2, GOLD, 0.8).box(k, 6.4 + 0.2, 0, 0.5, 1.4, 1.2, GOLD, 0.8);
        b.box(11.6, 14 + k * 0.6, 0, 1.4, 0.5, 1.2, GOLD, 0.8).box(-11.6, 14 + k * 0.6, 0, 1.4, 0.5, 1.2, GOLD, 0.8);
      }
      for (let k = 0; k < 6; k++) b.box(-6 + k * 2.4, 12 - (k % 2) * 2, 1.8, 0.2, 3 + (k % 3), 0.05, 0xa3e635, 1);
    },
  },
  'data-spire': {
    base(b) {
      b.cyl(0, 1, 0, 6, 2, 0x10172e, 8);
      b.octa(0, 22, 0, 4, 0x22d3ee, 0.7, 6);
      b.octa(0, 22, 0, 2, 0xe0faff, 1, 7);
      b.cyl(0, 2.2, 0, 5, 0.3, NEON_C, 8, 'y', 1);
    },
    anim: [
      {
        build(b) {
          b.torus(0, 0, 0, 7, 0.3, NEON_C, 3, 32, 1, 'y');
          b.torus(0, 8, 0, 5.5, 0.25, 0xa3e635, 3, 32, 1, 'y');
          b.torus(0, 16, 0, 4, 0.2, NEON_M, 3, 32, 1, 'y');
        },
        pivot: [0, 14, 0],
        update(m, t) {
          m.rotation.y = t * 0.5;
          m.position.y = 14 + Math.sin(t * 0.8) * 1.2;
        },
      },
    ],
  },
  'cloud-island': {
    base(b) {
      b.cone(0, -8, 0, 16, 16, 0x8a6a52, 8, 'y', 0, true);
      b.cyl(0, 0.5, 0, 17, 2, 0x5fbf62, 9);
      b.ball(6, 4, 3, 4, 0x3d8c40, 1).ball(-7, 3.5, -2, 3.2, 0x3d8c40, 1);
      b.cyl(6, 1.5, 3, 0.5, 3, 0x6b4a2e, 6);
      b.box(13, -4, 0, 2.4, 14, 1, 0x9be7ff, 0.5);
      b.ball(0, -18, 0, 10, 0xffffff, 1, 0.2, 3);
    },
  },
  'hot-air-balloon': {
    base() {},
    anim: [
      {
        build(b) {
          // striped envelope: colour by longitude (8 gores), gold band at the equator
          const stripe = (p: { x: number; y: number; z: number }) => {
            const a = Math.atan2(p.z, p.x) + Math.PI;
            if (Math.abs(p.y) < 0.5) return 0xffd23f;
            return Math.floor((a / (Math.PI * 2)) * 8) % 2 ? 0xff4fd8 : 0x22d3ee;
          };
          b.push().translate(0, 1.5, 0).scale(5, 5.8, 5);
          const sg = new SphereGeometry(1, 16, 12);
          b.add(sg, (pp) => stripe({ x: pp.x, y: pp.y - 1.5, z: pp.z }));
          sg.dispose();
          b.pop();
          b.cone(0, -4.6, 0, 1.6, 2.2, 0xff4fd8, 10, 'y', 0, true);
          b.box(0, -8, 0, 2.2, 1.5, 2.2, 0x8a5a3a);
          b.box(0, -7.2, 0, 2.3, 0.2, 2.3, 0xc0875a);
          for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) b.box(x, -6.2, z, 0.08, 2.4, 0.08, 0x3b2a1a);
          b.ball(0, -6.4, 0, 0.5, 0xff8a1f, 0, 1);
        },
        pivot: [0, 25, 0],
        update(m, t) {
          m.position.y = 25 + Math.sin(t * 0.6) * 1.5;
          m.rotation.y = t * 0.05;
        },
      },
    ],
  },
};

function gear(b: MeshBuilder, r: number, teeth: number, c: number): void {
  b.cyl(0, 0, 0, r, 1.4, c, teeth * 2, 'z');
  b.cyl(0, 0, 0.1, r * 0.3, 1.5, shadeInt(c, -0.3), 10, 'z');
  for (let k = 0; k < teeth; k++) {
    const a = (k / teeth) * Math.PI * 2;
    b.boxR(Math.cos(a) * (r + 0.6), Math.sin(a) * (r + 0.6), 0, 1.4, 1.2, 1.4, 'z', a, c);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    b.boxR(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, 0.72, r * 0.5, r * 0.25, 0.1, 'z', a, shadeInt(c, -0.2));
  }
}

const cache = new Map<string, BufferGeometry>();

function geo(key: string, build: (b: MeshBuilder) => void): BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    const b = new MeshBuilder();
    build(b);
    g = b.build();
    cache.set(key, g);
  }
  return g;
}

export function isLandmarkKind(k: string): k is LandmarkKind {
  return (LANDMARK_KINDS as readonly string[]).includes(k);
}

/** Kinds built with a pillar span (they can straddle the road). */
export const ARCH_KINDS: ReadonlySet<string> = new Set(['arch', 'mesa-arch']);

/**
 * Build a landmark (geometry cached per biome/span; groups are fresh). `span` (arches only) is the
 * half-width between the pillars in model units.
 */
export function buildLandmark(kind: string, biome: BiomeStyle, material: Material, span?: number): LandmarkInstance {
  const k: LandmarkKind = isLandmarkKind(kind) ? kind : 'tower';
  const def = DEFS[k];
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const sp = span !== undefined && ARCH_KINDS.has(k) ? Math.round(span * 4) / 4 : undefined;
  const baseGeo = geo(`${k}|${biome.id}|base|${sp ?? ''}`, (b) => def.base(b, biome, sp));
  if (baseGeo.getAttribute('position').count > 0) {
    group.add(new Mesh(baseGeo, material));
    geometries.push(baseGeo);
  }
  const anims: { m: Mesh; u: (m: Mesh, t: number) => void }[] = [];
  const materials: Material[] = [];
  def.anim?.forEach((a, i) => {
    const g = geo(`${k}|${biome.id}|a${i}`, (b) => a.build(b, biome));
    let mat = material;
    if (a.additive) {
      mat = new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
      materials.push(mat);
    }
    const m = new Mesh(g, mat);
    m.position.set(a.pivot[0], a.pivot[1], a.pivot[2]);
    group.add(m);
    geometries.push(g);
    anims.push({ m, u: a.update });
  });
  return {
    group,
    materials,
    geometries,
    update(t) {
      for (const a of anims) a.u(a.m, t);
    },
  };
}

export function clearLandmarkCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
