/**
 * 3D item models (our own designs). All built with MeshBuilder around the origin, ~1 unit across,
 * +X forward. Cached; call `clearItemArtCache()` on dispose.
 *
 *  - prism cube: faceted translucent cube shell (`prismShell`) + an inner glowing four-point star
 *    glyph (`prismGlyph`) — two meshes so the glyph can counter-rotate. NOT a question block.
 *  - turbo cell, bounce puck, seeker drone, glitch mine, fizz puddle, bubble shield, magnet,
 *    pulse ring, warp streak.
 */
import type { BufferGeometry } from 'three';
import type { KartItemId } from '@dascade/shared/games/kart';
import { MeshBuilder } from './builder.ts';
import { ITEM_COLORS, PRISM, mixInt, shadeInt } from './palette.ts';

export type ItemModelId =
  | 'prismShell'
  | 'prismGlyph'
  | 'turbo'
  | 'puck'
  | 'seeker'
  | 'mine'
  | 'fizz'
  | 'shield'
  | 'magnet'
  | 'pulse'
  | 'warp';

const cache = new Map<ItemModelId, BufferGeometry>();

const build: Record<ItemModelId, (b: MeshBuilder) => void> = {
  prismShell(b) {
    // A chamfered cube: 6 faces + 12 edge bevels + 8 corner facets, tinted in a cyan→magenta→gold sweep.
    const tint = (x: number, y: number) => {
      const t = Math.max(0, Math.min(1, (x + y + 1.2) / 2.4));
      return t < 0.5 ? mixInt(PRISM.a, PRISM.b, t * 2) : mixInt(PRISM.b, PRISM.c, (t - 0.5) * 2);
    };
    const s = 0.5;
    const e = 0.12;
    for (const [ax, ay, az] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      const w = ax ? 0.02 : 2 * (s - e);
      const h = ay ? 0.02 : 2 * (s - e);
      const d = az ? 0.02 : 2 * (s - e);
      b.box(ax * s, ay * s, az * s, w, h, d, tint(ax, ay), 0.35);
    }
    // edge bevels (thin rotated slabs)
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        b.boxR(sx * (s - e / 2), sy * (s - e / 2), 0, e * 1.3, e * 1.3, 2 * (s - e), 'z', Math.PI / 4, tint(sx, sy), 0.6);
        b.boxR(sx * (s - e / 2), 0, sy * (s - e / 2), e * 1.3, 2 * (s - e), e * 1.3, 'y', Math.PI / 4, tint(sx, 0), 0.6);
        b.boxR(0, sx * (s - e / 2), sy * (s - e / 2), 2 * (s - e), e * 1.3, e * 1.3, 'x', Math.PI / 4, tint(0, sx), 0.6);
      }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) b.octa(sx * (s - e * 0.6), sy * (s - e * 0.6), sz * (s - e * 0.6), e, 0xffffff, 0.9);
  },
  prismGlyph(b) {
    // four-point star (two flattened octahedra) + a tiny core
    b.octa(0, 0, 0, 0.3, PRISM.glyph, 1, 0.28);
    b.push().rotate('z', Math.PI / 2);
    b.octa(0, 0, 0, 0.3, PRISM.glyph, 1, 0.28);
    b.pop();
    b.ball(0, 0, 0, 0.09, PRISM.c, 1, 1);
  },
  turbo(b) {
    const c = ITEM_COLORS.turbo;
    b.cyl(0, 0, 0, 0.26, 0.8, c.main, 10, 'x');
    b.cyl(0.42, 0, 0, 0.16, 0.08, 0xd6dde8, 10, 'x');
    b.cyl(-0.42, 0, 0, 0.26, 0.06, 0xd6dde8, 10, 'x');
    b.cyl(0.05, 0, 0, 0.27, 0.24, c.accent, 10, 'x', 0.9);
    // lightning bolt on the side
    for (const z of [-0.27, 0.27]) {
      b.boxR(0.1, 0.1, z, 0.22, 0.06, 0.02, 'z', -0.9, c.glow, 1);
      b.boxR(-0.02, -0.08, z, 0.22, 0.06, 0.02, 'z', -0.9, c.glow, 1);
      b.box(0.04, 0.0, z, 0.14, 0.05, 0.02, c.glow, 1);
    }
  },
  puck(b) {
    const c = ITEM_COLORS.puck;
    b.cyl(0, 0, 0, 0.42, 0.2, c.main, 14);
    b.torus(0, 0, 0, 0.42, 0.05, c.glow, 4, 18, 1, 'y');
    b.cyl(0, 0.105, 0, 0.26, 0.02, c.accent, 14, 'y', 0.3);
    b.box(0, 0.12, 0, 0.3, 0.02, 0.06, c.main).box(0, 0.12, 0, 0.06, 0.02, 0.3, c.main);
  },
  seeker(b) {
    const c = ITEM_COLORS.seeker;
    b.box(0, 0, 0, 0.5, 0.18, 0.36, c.main);
    b.box(0.26, 0, 0, 0.06, 0.12, 0.2, c.accent, 1);
    b.cone(0.22, 0, 0, 0.12, 0.14, c.main, 6, 'x');
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        b.box(sx * 0.24, 0.02, sz * 0.24, 0.3, 0.04, 0.05, 0x3b4252);
        b.cyl(sx * 0.36, 0.08, sz * 0.36, 0.16, 0.02, 0xd6dde8, 8);
        b.cyl(sx * 0.36, 0.05, sz * 0.36, 0.04, 0.08, 0x3b4252, 6);
      }
    b.box(-0.2, 0.12, 0, 0.14, 0.06, 0.04, c.glow, 1);
  },
  mine(b) {
    const c = ITEM_COLORS.mine;
    b.box(0, 0, 0, 0.5, 0.5, 0.5, c.main);
    // pixel spikes on every face
    for (const [x, y, z] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      b.box(x * 0.32, y * 0.32, z * 0.32, x ? 0.14 : 0.16, y ? 0.14 : 0.16, z ? 0.14 : 0.16, c.accent, 0.5);
      b.box(x * 0.42, y * 0.42, z * 0.42, 0.08, 0.08, 0.08, c.accent, 0.7);
    }
    b.box(0, 0, 0, 0.52, 0.18, 0.18, c.glow, 1).box(0, 0, 0, 0.18, 0.52, 0.18, c.glow, 1).box(0, 0, 0, 0.18, 0.18, 0.52, c.glow, 1);
  },
  fizz(b) {
    const c = ITEM_COLORS.fizz;
    // irregular puddle of blobs + bubbles
    const blobs = [
      [0, 0, 1],
      [0.5, 0.2, 0.6],
      [-0.45, 0.3, 0.7],
      [0.2, -0.55, 0.65],
      [-0.35, -0.4, 0.55],
    ] as const;
    for (const [x, z, r] of blobs) b.cyl(x, 0.02, z, r, 0.04, c.main, 12, 'y', 0.35);
    for (const [x, z, r] of blobs) b.cyl(x * 0.9, 0.045, z * 0.9, r * 0.6, 0.01, c.accent, 12, 'y', 0.4);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996;
      const r = 0.2 + (i % 4) * 0.2;
      b.ball(Math.cos(a) * r, 0.08 + (i % 3) * 0.04, Math.sin(a) * r, 0.05 + (i % 2) * 0.03, 0xfff6e0, 1, 0.6);
    }
  },
  shield(b) {
    const c = ITEM_COLORS.shield;
    b.sphere(0, 0, 0, 1, c.main, 18, 12, 0.5);
  },
  magnet(b) {
    const c = ITEM_COLORS.magnet;
    // horseshoe: a half torus + two legs with silver tips
    b.push().rotate('z', 0);
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (i / 8);
      b.boxR(Math.sin(a) * 0.32 + 0.0, 0, Math.cos(a) * 0.32, 0.16, 0.2, 0.16, 'y', a, c.main);
    }
    b.box(-0.2, 0, -0.32, 0.4, 0.2, 0.16, c.main).box(-0.2, 0, 0.32, 0.4, 0.2, 0.16, c.main);
    b.box(-0.46, 0, -0.32, 0.14, 0.22, 0.18, c.accent, 0.3).box(-0.46, 0, 0.32, 0.14, 0.22, 0.18, c.accent, 0.3);
    b.pop();
  },
  pulse(b) {
    const c = ITEM_COLORS.pulse;
    b.torus(0, 0, 0, 1, 0.06, c.main, 4, 36, 1, 'y');
    b.torus(0, 0, 0, 0.9, 0.03, c.accent, 3, 36, 1, 'y');
  },
  warp(b) {
    const c = ITEM_COLORS.warp;
    // long tapered ribbon along −X (the trail behind a warping kart)
    for (let i = 0; i < 8; i++) {
      const t = i / 8;
      const w = 0.9 * (1 - t);
      b.box(-i * 0.5 - 0.25, 0, 0, 0.5, 0.04, w, i % 2 ? c.main : shadeInt(c.glow, 0.1), 1);
    }
  },
};

export function itemModel(id: ItemModelId): BufferGeometry {
  let g = cache.get(id);
  if (!g) {
    const b = new MeshBuilder();
    build[id](b);
    g = b.build();
    cache.set(id, g);
  }
  return g;
}

/** Which model represents an item held/trailed or in the HUD 3D spin. */
export function modelForItem(item: KartItemId): ItemModelId {
  switch (item) {
    case 'turbo':
    case 'turbo3':
      return 'turbo';
    case 'puck':
    case 'puck3':
      return 'puck';
    default:
      return item;
  }
}

export function clearItemArtCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
