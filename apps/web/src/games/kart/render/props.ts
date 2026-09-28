/**
 * Scattered biome props: procedural low-poly models (MeshBuilder, vertex colours + glow) placed
 * deterministically from the track's decorSeed and drawn as InstancedMeshes grouped into spatial
 * chunks (each chunk has its own bounding sphere, so three frustum-culls whole chunks).
 */
import { InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material } from 'three';
import type { KartTrack } from '@dascade/game-core/kart';
import { MeshBuilder } from '../art/builder.ts';
import { shadeInt } from '../art/palette.ts';
import type { BiomeStyle, PropKind } from './biomes.ts';
import { mulberry32 } from './rng.ts';
import { container } from './kit.ts';
import type { RoadPath } from './roads.ts';
import type { DistanceField } from './terrain.ts';

type Variant = (b: MeshBuilder, r: () => number, biome: BiomeStyle) => void;

/** Facade box: one texture tile (two windows) per 4 u across and one floor per 3.2 u (the canvas holds 4×4 tiles). */
function facade(b: MeshBuilder, x: number, y: number, z: number, w: number, h: number, d: number, color: number): void {
  b.uvScale = [w / 16, h / 12.8];
  b.box(x, y, z, w, h, d, color);
  b.uvScale = [0, 0];
}

const VARIANTS: Record<PropKind, Variant[]> = {
  building: [
    (b, r, bi) => {
      const w = 10 + r() * 5;
      const h = 22 + r() * 22;
      const body = shadeInt(bi.wallA, -0.2 + r() * 0.12);
      facade(b, 0, h / 2, 0, w, h, w, body);
      b.box(0, h + 0.4, 0, w + 0.4, 0.8, w + 0.4, shadeInt(body, -0.25));
      b.box(0, h + 1.6, 0, w * 0.5, 1.6, w * 0.5, shadeInt(body, 0.1));
      b.box(0, h + 4, 0, 0.3, 4, 0.3, 0x9aa4b8).ball(0, h + 6.2, 0, 0.35, 0xff3048, 0, 1);
      b.box(w / 2 + 0.12, h * 0.62, 0, 0.2, h * 0.5, 1.4, r() < 0.5 ? bi.glowB : bi.glow, 0.95);
      b.box(0, 0.6, w / 2 + 0.05, w * 0.7, 1.2, 0.1, bi.glow, 0.7);
    },
    (b, r, bi) => {
      const w = 16 + r() * 8;
      const d = 12 + r() * 5;
      const h = 10 + r() * 8;
      const body = shadeInt(bi.wallA, -0.1 + r() * 0.1);
      facade(b, 0, h / 2, 0, w, h, d, body);
      b.box(0, 1.4, d / 2 + 0.2, w * 0.9, 2.8, 0.3, shadeInt(body, -0.3));
      b.box(0, 3.2, d / 2 + 0.4, w * 0.92, 0.3, 0.8, bi.glow, 0.9);
      b.box(0, h + 2.2, 0, w * 0.6, 3.4, 0.4, bi.glowB, 0.95);
      b.box(0, h + 2.2, 0.22, w * 0.56, 3, 0.05, shadeInt(bi.glowB, 0.4), 1);
      b.box(0, h + 0.3, 0, w + 0.3, 0.6, d + 0.3, shadeInt(body, -0.3));
    },
    (b, r, bi) => {
      const w = 8 + r() * 3;
      const h = 44 + r() * 26;
      const body = shadeInt(bi.wallA, -0.3);
      facade(b, 0, h * 0.35, 0, w + 2, h * 0.7, w + 2, body);
      facade(b, 0, h * 0.85, 0, w, h * 0.3, w, shadeInt(body, 0.06));
      b.box(0, h * 0.7 + 0.2, 0, w + 2.4, 0.4, w + 2.4, bi.glow, 0.9);
      b.cone(0, h + 3, 0, w * 0.55, 6, shadeInt(body, 0.1), 4);
      b.box(0, h + 7, 0, 0.3, 3, 0.3, 0x9aa4b8).ball(0, h + 8.6, 0, 0.4, bi.glowB, 0, 1);
    },
  ],
  lamp: [
    (b, _r, bi) => {
      b.cyl(0, 3, 0, 0.12, 6, 0x3b4252, 6);
      b.box(0.8, 6, 0, 1.8, 0.16, 0.16, 0x3b4252);
      b.box(1.6, 5.85, 0, 0.7, 0.18, 0.4, bi.glow, 1);
      b.cyl(0, 0.2, 0, 0.3, 0.4, 0x2a2d3a, 6);
    },
  ],
  bush: [
    (b, r, bi) => {
      const c = bi.id === 'carnival' ? 0x2f9e4f : bi.id === 'city' ? 0x2b7a57 : 0x3d8c40;
      b.ball(0, 0.9, 0, 1.2 + r() * 0.4, c, 1, 0, 0.9);
      b.ball(0.8, 0.7, 0.4, 0.8, shadeInt(c, 0.1), 1);
      b.ball(-0.6, 0.6, -0.5, 0.7, shadeInt(c, -0.1), 1);
    },
  ],
  palm: [
    (b, r) => {
      const h = 7 + r() * 3;
      for (let k = 0; k < 6; k++) b.cyl(k * 0.12, (k + 0.5) * (h / 6), 0, 0.28 - k * 0.02, h / 6 + 0.05, k % 2 ? 0x8a5a3a : 0x7a4d30, 6);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        b.push().translate(0.7, h, 0).rotate('y', a).rotate('z', -0.45);
        b.box(1.6, 0, 0, 3.4, 0.12, 0.9, k % 2 ? 0x2fa35a : 0x28914f);
        b.pop();
      }
      b.ball(0.7, h - 0.2, 0, 0.45, 0x6b4a2e, 0);
    },
  ],
  cactus: [
    (b, r) => {
      const h = 3 + r() * 3;
      const c = 0x3f9a4a;
      b.cyl(0, h / 2, 0, 0.45, h, c, 8);
      b.ball(0, h, 0, 0.45, c, 1);
      b.cyl(0.9, h * 0.55, 0, 0.3, 0.3, c, 6, 'x').cyl(1.05, h * 0.7, 0, 0.3, h * 0.35, c, 6).ball(1.05, h * 0.88, 0, 0.3, c, 1);
      if (r() < 0.6) b.cyl(-0.8, h * 0.4, 0, 0.26, 0.3, c, 6, 'x').cyl(-0.95, h * 0.52, 0, 0.26, h * 0.3, c, 6).ball(-0.95, h * 0.68, 0, 0.26, c, 1);
      b.ball(0, h + 0.4, 0, 0.18, 0xff4fd8, 0, 0.4);
    },
  ],
  rock: [
    (b, r, bi) => {
      const c = bi.id === 'desert' ? 0xb8683e : 0x7d7f8c;
      b.ball(0, 0.6, 0, 1.4 + r(), c, 0, 0, 1.0 + r() * 0.6, 1.2 + r() * 0.5);
      b.ball(1.2, 0.4, 0.6, 0.8, shadeInt(c, -0.1), 0);
    },
  ],
  mesa: [
    (b, r) => {
      const w = 20 + r() * 20;
      const h = 18 + r() * 16;
      b.cyl(0, h * 0.45, 0, w * 0.5, h * 0.9, 0xb8683e, 7, 'y', 0, w * 0.42);
      b.cyl(0, h * 0.95, 0, w * 0.42, h * 0.12, 0xc97a4a, 7, 'y', 0, w * 0.4);
      b.cyl(0, h * 0.3, 0, w * 0.51, 1.2, 0x9e5534, 7);
      b.cyl(0, h * 0.6, 0, w * 0.47, 1, 0x9e5534, 7);
    },
  ],
  container: [0xe8364f, 0x2563eb, 0x22c55e, 0xf97316, 0xffd23f, 0x14b8a6].map(
    (c): Variant =>
      (b, r) => {
        const stack = 1 + Math.floor(r() * 3);
        for (let k = 0; k < stack; k++) {
          const cc = k === 0 ? c : [0xe8364f, 0x2563eb, 0xf97316, 0x22c55e][Math.floor(r() * 4)]!;
          container(b, (r() - 0.5) * 0.3, 1.3 + k * 2.55, 0, cc, 6, 2.5, 2.4);
        }
      },
  ),
  bollard: [
    (b) => {
      b.cyl(0, 0.4, 0, 0.3, 0.8, 0x2a2d3a, 8);
      b.cyl(0, 0.85, 0, 0.42, 0.14, 0x2a2d3a, 8);
      b.cyl(0, 0.55, 0, 0.31, 0.12, 0xffd23f, 8);
    },
  ],
  warehouse: [
    (b, r) => {
      const w = 26 + r() * 10;
      const d = 16;
      const h = 9;
      b.box(0, h / 2, 0, w, h, d, 0x8b9bb0);
      b.box(0, 0.4, 0, w + 0.2, 0.8, d + 0.2, 0x5d6b80);
      // corrugated cladding on every wall, a gutter line and a painted number band
      for (let x = -w / 2 + 0.6; x < w / 2; x += 1.1) {
        b.box(x, h / 2 + 0.4, d / 2 + 0.03, 0.18, h - 0.8, 0.05, 0x72839a).box(x, h / 2 + 0.4, -d / 2 - 0.03, 0.18, h - 0.8, 0.05, 0x72839a);
      }
      for (let z = -d / 2 + 0.6; z < d / 2; z += 1.1) {
        b.box(w / 2 + 0.03, h / 2 + 0.4, z, 0.05, h - 0.8, 0.18, 0x72839a).box(-w / 2 - 0.03, h / 2 + 0.4, z, 0.05, h - 0.8, 0.18, 0x72839a);
      }
      b.box(0, h - 0.1, 0, w + 0.3, 0.25, d + 0.3, 0x4b5563);
      for (const sx of [-1, 1]) {
        b.box(sx * (w / 2 + 0.06), h * 0.62, 0, 0.05, 1.6, d * 0.5, 0xffd23f, 0.2);
        for (let k = 0; k < 3; k++) b.box(sx * (w / 2 + 0.08), 1.6, -d / 4 + k * (d / 4), 0.05, 3.2, 2.6, 0x3b4252);
      }
      b.boxR(0, h + 1.6, 4, w, 0.4, 9, 'x', 0.35, 0x5d6b80).boxR(0, h + 1.6, -4, w, 0.4, 9, 'x', -0.35, 0x5d6b80);
      for (let k = -2; k <= 2; k++) b.box(k * 5, 2.5, d / 2 + 0.05, 3.4, 5, 0.1, 0x3b4252);
      b.box(0, h - 1, d / 2 + 0.1, w * 0.6, 1.2, 0.1, 0xffd23f, 0.3);
    },
  ],
  pine: [
    (b, r) => {
      const h = 6 + r() * 6;
      const g = [0x1d6a4c, 0x185c42, 0x237a55][Math.floor(r() * 3)]!;
      b.cyl(0, h * 0.1, 0, 0.32, h * 0.22, 0x5b3a26, 6);
      for (let k = 0; k < 4; k++) {
        const y = h * (0.16 + k * 0.19);
        const rr = h * (0.36 - k * 0.075);
        b.cone(0, y + h * 0.13, 0, rr, h * 0.3, k % 2 ? g : shadeInt(g, -0.08), 6);
        // snow loaded on each tier (offset toward one side like drifted snow)
        b.cone(0.05 * rr, y + h * 0.2, 0.05 * rr, rr * 0.78, h * 0.16, 0xf6f9ff, 6);
      }
      b.cone(0, h * 0.98, 0, h * 0.06, h * 0.1, 0xf6f9ff, 5);
    },
    (b, r) => {
      // slim young fir
      const h = 4 + r() * 3;
      b.cyl(0, h * 0.1, 0, 0.2, h * 0.2, 0x5b3a26, 5);
      b.cone(0, h * 0.55, 0, h * 0.2, h * 0.9, 0x1f6b4a, 6);
      b.cone(0, h * 0.72, 0, h * 0.15, h * 0.4, 0xf6f9ff, 6);
    },
  ],
  snowrock: [
    (b, r) => {
      b.ball(0, 0.6, 0, 1.5 + r(), 0x8a94a6, 0, 0, 1.1, 1.3);
      b.ball(0, 1.3, 0, 1.2 + r() * 0.5, 0xf5f9ff, 1, 0, 0.5, 1.1);
    },
  ],
  cabin: [
    (b) => {
      b.box(0, 2, 0, 7, 4, 5.5, 0x8a5a3a);
      for (let k = 0; k < 6; k++) b.box(0, 0.4 + k * 0.66, 2.78, 7, 0.1, 0.06, 0x6b4430);
      b.boxR(0, 5.1, 1.5, 7.6, 0.4, 3.6, 'x', 0.6, 0xf5f9ff).boxR(0, 5.1, -1.5, 7.6, 0.4, 3.6, 'x', -0.6, 0xf5f9ff);
      b.box(1.5, 2.2, 2.8, 1.4, 1.2, 0.1, 0xffd99a, 0.9).box(-1.8, 1.5, 2.8, 1.2, 2.6, 0.1, 0x4a2e1c);
      b.box(2.5, 6.2, 0, 0.8, 1.8, 0.8, 0x6b6b75);
    },
  ],
  stall: [0xe8364f, 0x2563eb, 0x22c55e, 0xa855f7].map(
    (c): Variant =>
      (b) => {
        b.box(0, 1, 0, 4, 2, 3, 0xfff6e0);
        b.box(0, 1.1, 1.52, 3.6, 0.8, 0.06, 0x3b2a4a);
        for (let k = 0; k < 6; k++) b.boxR(-1.75 + k * 0.7, 3.1, 0, 0.7, 0.2, 3.6, 'x', 0, k % 2 ? c : 0xfff6e0);
        b.cone(0, 4.1, 0, 2.6, 1.6, c, 4);
        b.box(0, 3.4, 1.9, 4, 0.5, 0.06, 0xffd23f, 0.6);
        b.cyl(0, 5.2, 0, 0.05, 1, 0x9aa4b8, 4).box(0.3, 5.5, 0, 0.6, 0.35, 0.03, c);
      },
  ),
  balloons: [
    (b, r) => {
      const cols = [0xff4fd8, 0xffd23f, 0x22d3ee, 0xff5a5f, 0x2de38f];
      for (let k = 0; k < 5; k++) {
        const x = (r() - 0.5) * 1.6;
        const z = (r() - 0.5) * 1.6;
        const y = 4 + r() * 1.6;
        b.cyl(x * 0.5, y / 2, z * 0.5, 0.02, y, 0xf8fafc, 3);
        b.ball(x, y + 0.5, z, 0.55, cols[k % cols.length]!, 1, 0.15, 0.65);
      }
      b.box(0, 0.3, 0, 0.8, 0.6, 0.8, 0x7c2d12);
    },
  ],
  pipes: [
    (b, r) => {
      const h = 6 + r() * 4;
      for (let k = 0; k < 3; k++) b.cyl(k * 1.6 - 1.6, h / 2, 0, 0.6, h, [0x9aa4b8, 0xb45309, 0x64748b][k]!, 8);
      b.cyl(0, h + 0.3, 0, 0.5, 4.6, 0x9aa4b8, 8, 'x');
      b.box(0, 0.4, 0, 5.6, 0.8, 1.8, 0x3b4252);
      b.cyl(0, h * 0.6, 0, 0.66, 0.3, 0xffd23f, 8, 'x');
    },
  ],
  tank: [
    (b, r) => {
      const h = 8 + r() * 6;
      b.cyl(0, h / 2, 0, 4, h, 0xc0c7d2, 12);
      b.cone(0, h + 1, 0, 4, 2, 0xa9b0bb, 12);
      b.cyl(0, h * 0.3, 0, 4.05, 0.6, 0xff8a1f, 12);
      b.cyl(0, h * 0.7, 0, 4.05, 0.3, 0x64748b, 12);
      b.box(4.1, h / 2, 0, 0.2, h, 0.5, 0x64748b);
    },
  ],
  crates: [
    (b, r) => {
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const s = 1.1 + r() * 0.4;
        const x = (k % 2) * 1.3 - 0.6;
        const y = k >= 2 ? s * 1.5 : s / 2;
        b.box(x, y, (k % 3) * 0.2, s, s, s, 0xb7864f);
        b.box(x, y, (k % 3) * 0.2, s * 1.02, 0.18, s * 1.02, 0x8a5a3a);
        b.boxR(x, y, (k % 3) * 0.2 + s * 0.51, s * 1.2, 0.16, 0.04, 'z', 0.78, 0x8a5a3a);
      }
    },
  ],
  cloud: [
    (b, r) => {
      const n = 4 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) b.ball((k - n / 2) * 3 + r() * 2, r() * 2, (r() - 0.5) * 5, 3 + r() * 2.5, 0xffffff, 1, 0.25, 2 + r() * 1.5);
      b.ball(0, -1.2, 0, n * 1.6, 0xe6f0ff, 1, 0.15, 1.2, 4);
    },
  ],
  floatrock: [
    (b, r) => {
      const w = 8 + r() * 6;
      b.cone(0, -w * 0.45, 0, w * 0.6, w * 0.9, 0x8a6a52, 7, 'y', 0, true);
      b.cyl(0, 0, 0, w * 0.62, 1.2, 0x5fbf62, 7);
      b.ball(w * 0.2, 1.8, 0, 1.6, 0x3d8c40, 1);
      b.ball(-w * 0.25, 1.4, w * 0.2, 1.2, 0x3d8c40, 1);
    },
  ],
  server: [
    (b, r, bi) => {
      const h = 12 + r() * 22;
      const w = 5 + r() * 3;
      facade(b, 0, h / 2, 0, w, h, w, 0x243052);
      const c = r() < 0.5 ? bi.glow : bi.glowB;
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) b.box((x * w) / 2, h / 2, (z * w) / 2, 0.16, h, 0.16, c, 1);
      b.box(0, h + 0.2, 0, w + 0.4, 0.4, w + 0.4, 0x10172e);
      b.box(0, h + 0.45, 0, w * 0.6, 0.1, w * 0.6, c, 1);
    },
  ],
  pillar: [
    (b, _r, bi) => {
      b.box(0, 3, 0, 1.2, 6, 1.2, 0x10172e);
      b.box(0, 3, 0.62, 0.2, 5.6, 0.04, bi.glow, 1).box(0, 3, -0.62, 0.2, 5.6, 0.04, bi.glow, 1);
      b.octa(0, 7, 0, 0.7, bi.glowB, 1, 1.4);
    },
  ],
  crag: [
    (b, r) => {
      // faceted rock outcrop with a snow cap and a couple of boulders
      const w = 3 + r() * 2.5;
      b.cone(0, w * 0.55, 0, w, w * 1.3, 0x6e7890, 6, 'y', 0, false);
      b.cone(w * 0.5, w * 0.3, w * 0.3, w * 0.55, w * 0.7, 0x5c6680, 5);
      b.cone(-w * 0.45, w * 0.25, -w * 0.25, w * 0.5, w * 0.55, 0x7b86a0, 5);
      b.cone(0, w * 0.98, 0, w * 0.46, w * 0.42, 0xf6f9ff, 6);
      b.ball(w * 0.9, 0.3, -w * 0.6, 0.7, 0x6e7890, 0);
      b.ball(w * 0.9, 0.62, -w * 0.6, 0.45, 0xf6f9ff, 0, 0, 0.3);
    },
  ],
  tyres: [
    (b) => {
      for (let k = 0; k < 3; k++) {
        b.torus(0, 0.25 + k * 0.42, 0, 0.5, 0.22, 0x1f2028, 5, 10, 0, 'y');
        b.torus(0, 0.25 + k * 0.42, 0, 0.5, 0.05, k % 2 ? 0xe8364f : 0xf1f5f9, 3, 10, 0, 'y');
      }
      for (let k = 0; k < 2; k++) b.torus(1.05, 0.25 + k * 0.42, 0.2, 0.5, 0.22, 0x1f2028, 5, 10, 0, 'y');
    },
  ],
};

/** Props placed at a regular cadence along the edge instead of scattered. */
const ALONG = new Set<PropKind>(['lamp', 'bollard', 'tyres']);

interface Placement {
  kind: PropKind;
  variant: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface PropSet {
  meshes: InstancedMesh[];
  geometries: BufferGeometry[];
  count: number;
}

export interface PropContext {
  track: KartTrack;
  paths: readonly RoadPath[];
  field: DistanceField;
  biome: BiomeStyle;
  heightAt: (x: number, y: number) => number;
  /** Extra clearance from the road edge (walls). */
  clearance: number;
  /** 0..1 prop density multiplier (quality). */
  density: number;
  /** Clearings (landmark footprints): no props inside. */
  clearings?: readonly { x: number; y: number; r: number }[];
}

const CHUNK = 180;

export function scatterProps(ctx: PropContext): Placement[] {
  const { track, paths, field, biome } = ctx;
  const r = mulberry32(track.def.decorSeed * 7919 + 13);
  const out: Placement[] = [];
  const main = paths[0]!;
  const EDGE_DROP = 1;
  biome.props.forEach((rule, ri) => {
    const variants = VARIANTS[rule.kind].length;
    if (ALONG.has(rule.kind)) {
      const spacing = Math.max(8, 30 / Math.max(0.05, rule.density * ctx.density));
      const tyre = rule.kind === 'tyres';
      for (let sPos = (ri * 7) % spacing; sPos < main.length; sPos += spacing) {
        const i = Math.min(main.n - 1, Math.floor(sPos / (main.length / main.n)));
        if (tyre && Math.abs(main.curvature[i]!) < 0.015) continue;
        const sides: (1 | -1)[] = tyre ? [main.curvature[i]! > 0 ? -1 : 1] : [1, -1];
        for (const side of sides) {
          if ((side > 0 ? main.edgeL[i] : main.edgeR[i]) === EDGE_DROP || main.noGround[i]) continue;
          const off = (side > 0 ? main.hwL[i]! : main.hwR[i]!) + main.shoulder + ctx.clearance + rule.near + 0.6;
          const x = main.xs[i]! - main.ty[i]! * side * off;
          const y = main.ys[i]! + main.tx[i]! * side * off;
          if (field.at(x, y) < rule.near + ctx.clearance - 0.3) continue;
          const heading = Math.atan2(main.ty[i]!, main.tx[i]!);
          // local +X of lamps points toward the road
          const yaw = heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
          out.push({ kind: rule.kind, variant: Math.floor(r() * variants), x, y, z: main.zs[i]! - 0.02, yaw, scale: 1 });
        }
      }
      return;
    }
    const span = rule.far - rule.near;
    // hero forests keep most of their density on medium (they carry the biome)
    const dens = rule.cluster ? (ctx.density >= 0.7 ? 1 : Math.min(1, ctx.density * 1.35)) : ctx.density;
    const count = Math.round(rule.density * dens * (main.length * span * 2) / 1000);
    const maxSlope = rule.slope ?? 1.8;
    const cloudy = rule.kind === 'cloud' || rule.kind === 'floatrock';
    const minDist = rule.near + ctx.clearance + (rule.kind === 'mesa' ? 20 : rule.kind === 'building' ? 8 : 1);
    const tryPlace = (x: number, y: number, zRoad: number): boolean => {
      const dist = field.at(x, y);
      if (dist < minDist) return false;
      if (ctx.clearings) for (const c of ctx.clearings) if ((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) < c.r * c.r) return false;
      let z: number;
      if (cloudy) z = zRoad + (r() < 0.75 ? -12 - r() * 30 : 14 + r() * 26);
      else {
        if (field.dropAt(x, y)) return false;
        const h0 = ctx.heightAt(x, y);
        const steep = Math.max(Math.abs(ctx.heightAt(x + 5, y) - h0), Math.abs(ctx.heightAt(x - 5, y) - h0), Math.abs(ctx.heightAt(x, y + 5) - h0), Math.abs(ctx.heightAt(x, y - 5) - h0));
        if (steep > maxSlope) return false;
        if (biome.id === 'harbor' && h0 < ctx.heightAt(x, y) - 0.01) return false;
        // sink into slopes so trunks never float on the downhill side
        z = h0 - 0.05 - steep * 0.25;
      }
      const s0 = rule.scale[0] + r() * (rule.scale[1] - rule.scale[0]);
      out.push({ kind: rule.kind, variant: Math.floor(r() * variants), x, y, z, yaw: r() * Math.PI * 2, scale: s0 });
      return true;
    };
    for (let k = 0; k < count; k++) {
      const p = paths[r() < 0.9 || paths.length === 1 ? 0 : 1 + Math.floor(r() * (paths.length - 1))]!;
      const i = Math.floor(r() * p.n);
      const side = r() < 0.5 ? 1 : -1;
      const t = Math.pow(r(), 1.6);
      const off = (side > 0 ? p.hwL[i]! : p.hwR[i]!) + p.shoulder + ctx.clearance + rule.near + t * span;
      const x = p.xs[i]! - p.ty[i]! * side * off + (r() - 0.5) * 4;
      const y = p.ys[i]! + p.tx[i]! * side * off + (r() - 0.5) * 4;
      if (!tryPlace(x, y, p.zs[i]!)) continue;
      if (rule.cluster) {
        const n = rule.cluster[0] + Math.floor(r() * (rule.cluster[1] - rule.cluster[0] + 1));
        const cr = rule.clusterR ?? 6;
        for (let c = 0; c < n; c++) {
          const a = r() * Math.PI * 2;
          const d = cr * (0.35 + r() * 0.65);
          tryPlace(x + Math.cos(a) * d, y + Math.sin(a) * d, p.zs[i]!);
        }
      }
    }
  });
  return out;
}

/** Kinds drawn with the window-facade material. */
const TEXTURED = new Set<PropKind>(['building', 'server']);

export function buildProps(ctx: PropContext, material: Material, facadeMaterial: Material): PropSet {
  const placements = scatterProps(ctx);
  const geos = new Map<string, BufferGeometry>();
  const groups = new Map<string, Placement[]>();
  for (const p of placements) {
    const gk = `${p.kind}:${p.variant}`;
    const ck = `${gk}@${Math.floor(p.x / CHUNK)},${Math.floor(p.y / CHUNK)}`;
    if (!geos.has(gk)) {
      const b = new MeshBuilder();
      b.ao = 0.3;
      if (TEXTURED.has(p.kind)) b.uvScale = [0, 0];
      VARIANTS[p.kind][p.variant]!(b, mulberry32(ctx.track.def.decorSeed + p.variant * 31 + p.kind.length), ctx.biome);
      geos.set(gk, b.build());
    }
    let arr = groups.get(ck);
    if (!arr) groups.set(ck, (arr = []));
    arr.push(p);
  }
  const meshes: InstancedMesh[] = [];
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scl = new Vector3();
  for (const [ck, arr] of groups) {
    const gk = ck.split('@')[0]!;
    const geo = geos.get(gk)!;
    const im = new InstancedMesh(geo, TEXTURED.has(arr[0]!.kind) ? facadeMaterial : material, arr.length);
    arr.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      pos.set(p.x, p.z, -p.y);
      scl.set(p.scale, p.scale, p.scale);
      im.setMatrixAt(i, m4.compose(pos, q, scl));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.matrixAutoUpdate = false;
    im.updateMatrix();
    meshes.push(im);
  }
  return { meshes, geometries: [...geos.values()], count: placements.length };
}
