import { describe, expect, it } from 'vitest';
import { KART_TRACK_IDS } from '@dascade/shared/games/kart';
import { KART_TRACK_DEFS, buildTrack, createKartState, type KartTrack } from '@dascade/game-core/kart';
import type { BufferGeometry } from 'three';
import { BIOMES, OFFROAD, paletteSig, worldPalette } from './biomes.ts';
import { LANDMARK_KINDS, buildLandmark } from './landmarks.ts';
import { emptyPose, poseFromState } from './pose.ts';
import { scatterProps } from './props.ts';
import { RoadIndex, curbMask, roadPaths } from './roads.ts';
import { DistanceField, terrainHeightFn } from './terrain.ts';
import { KF } from './types.ts';
import {
  WALL_PROFILES,
  buildBoostPads,
  buildCurbs,
  buildDropLips,
  buildGridMarks,
  buildRamps,
  buildRoad,
  buildShoulders,
  buildSkirts,
  buildStartLine,
  buildWalls,
  wallMasks,
} from './worldGeom.ts';
import { makeVoxelMaterial } from '../art/materials.ts';
import { linRGB } from './geo.ts';

const tracks: KartTrack[] = KART_TRACK_IDS.map((id) => buildTrack(KART_TRACK_DEFS[id]));

function finite(g: BufferGeometry | null): boolean {
  if (!g) return true;
  const p = g.getAttribute('position').array;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i]!)) return false;
  return true;
}

describe('biome palettes + theme adapter', () => {
  it('every biome is defined and Delta Neon (no materials) returns the exact biome colours', () => {
    for (const b of Object.values(BIOMES)) {
      for (const kind of Object.keys(OFFROAD) as (keyof typeof OFFROAD)[]) {
        const p = worldPalette(b, kind, null);
        expect(p.themed).toBe(false);
        expect(p.asphalt).toBe(b.asphalt);
        expect(p.asphaltSpeck).toBe(b.asphaltSpeck);
        expect(p.lane).toBe(b.lane);
        expect(p.curbA).toBe(b.curbA);
        expect(p.curbB).toBe(b.curbB);
        expect(p.skyTop).toBe(b.skyTop);
        expect(p.skyHorizon).toBe(b.skyHorizon);
        expect(p.fog).toBe(b.fog);
        expect(p.offroad).toBe(OFFROAD[kind]);
        expect(worldPalette(b, kind, {})).toEqual(p);
      }
    }
  });
  it('theme materials tint the road and lean the sky, but never replace the biome sky', () => {
    const b = BIOMES.desert;
    const p = worldPalette(b, 'sand', { asphalt: '#101010', asphaltLine: '#ffffff', curbA: '#ff0000', curbB: '#00ff00', sky: '#000000', skyHorizon: '#000000', offroad: '#224422' });
    expect(p.themed).toBe(true);
    expect(p.asphalt).toBe(0x101010);
    expect(p.curbA).toBe(0xff0000);
    expect(p.lane).toBe(0xffffff);
    expect(p.skyTop).not.toBe(0x000000);
    expect(p.skyTop).not.toBe(b.skyTop);
    expect(p.offroad.base).toBe(0x224422);
    expect(paletteSig(p)).not.toBe(paletteSig(worldPalette(b, 'sand', null)));
  });
});

describe('road paths + index', () => {
  it('wraps main + branches and finds road edges', () => {
    for (const t of tracks) {
      const paths = roadPaths(t);
      expect(paths[0]!.closed).toBe(true);
      expect(paths.length).toBe(1 + t.branches.length);
      const idx = new RoadIndex(paths);
      // centreline is on the road; far away is not
      expect(idx.edgeDistance(t.xs[0]!, t.ys[0]!, 40)).toBeLessThan(0);
      expect(idx.edgeDistance(t.bounds.maxX + 500, t.bounds.maxY + 500, 40)).toBe(40);
      const m = curbMask(paths[0]!);
      expect(m.length).toBe(t.n);
    }
  });
});

describe('world geometry (every track)', () => {
  for (const t of tracks) {
    it(`${t.id}: builds finite road/shoulder/wall/skirt geometry`, () => {
      const biome = BIOMES[t.def.biome];
      const paths = roadPaths(t);
      const idx = new RoadIndex(paths);
      const road = buildRoad(paths, 'road');
      expect(road).not.toBeNull();
      expect(finite(road)).toBe(true);
      const masks = wallMasks(paths, idx, biome.wall);
      const walls = buildWalls(paths, masks, biome.wall);
      expect(finite(walls)).toBe(true);
      // walls never stand where the edge is a drop or where there is no ground
      const main = paths[0]!;
      for (let i = 0; i < main.n; i++) {
        if (main.edgeL[i] === 1 || main.noGround[i]) expect(masks[0]!.left[i]).toBe(0);
        if (main.edgeR[i] === 1 || main.noGround[i]) expect(masks[0]!.right[i]).toBe(0);
      }
      for (const g of [
        buildRoad(paths, 'dirt'),
        buildShoulders(paths),
        buildCurbs(paths),
        buildDropLips(paths),
        buildSkirts(paths, masks, { groundY: t.bounds.minZ - 0.35, dropDepth: 30, floating: biome.id === 'sky', sloped: biome.slopedSkirts, wall: biome.wall, color: linRGB(0x808080), cliff: linRGB(0x404040) }),
        buildStartLine(t),
        buildGridMarks(t),
        buildBoostPads(t),
        buildRamps(t),
      ])
        expect(finite(g)).toBe(true);
      // road triangles face up
      const n = road!.getAttribute('normal');
      let up = 0;
      for (let i = 0; i < n.count; i++) if (n.getY(i) > 0.5) up++;
      expect(up / n.count).toBeGreaterThan(0.95);
    });
  }
  it('wall profiles start at the road face and have height', () => {
    for (const pr of Object.values(WALL_PROFILES)) {
      expect(pr[0]).toEqual([0, 0]);
      expect(Math.max(...pr.map((p) => p[1]))).toBeGreaterThan(0.7);
    }
  });
});

describe('terrain', () => {
  it('never rises above the road it meets', () => {
    for (const t of tracks) {
      if (t.def.biome === 'sky') continue;
      const paths = roadPaths(t);
      const field = new DistanceField(paths, t.bounds, 6, 100, 200);
      const h = terrainHeightFn(field, { groundY: t.bounds.minZ - 0.35, dropDepth: 30, hills: 40, extent: 100, res: 10 }, t.def.decorSeed);
      for (let i = 0; i < t.n; i += 7) {
        const z = h(t.xs[i]!, t.ys[i]!);
        expect(z).toBeLessThan(t.zs[i]! - 0.1);
      }
    }
  });
});

describe('props + landmarks', () => {
  it('scatter is deterministic per track and keeps off the road', () => {
    for (const t of tracks) {
      const biome = BIOMES[t.def.biome];
      const paths = roadPaths(t);
      const field = new DistanceField(paths, t.bounds, 6, 200, 250);
      const ctx = { track: t, paths, field, biome, heightAt: () => 0, clearance: 1, density: 1 };
      const a = scatterProps(ctx);
      const b = scatterProps(ctx);
      expect(a).toEqual(b);
      for (const p of a) if (p.kind !== 'cloud' && p.kind !== 'floatrock') expect(field.at(p.x, p.y)).toBeGreaterThan(0);
    }
  });
  it('every landmark kind builds (unknown kinds fall back)', () => {
    const mat = makeVoxelMaterial();
    for (const k of [...LANDMARK_KINDS, 'no-such-kind']) {
      const l = buildLandmark(k, BIOMES.city, mat);
      expect(l.group.children.length).toBeGreaterThan(0);
      l.update(1.5);
      for (const g of l.geometries) expect(finite(g)).toBe(true);
    }
  });
  it('every track landmark kind is one the renderer knows', () => {
    for (const t of tracks) for (const lm of t.landmarks) expect(LANDMARK_KINDS as readonly string[]).toContain(lm.kind);
  });
});

describe('pose adapter', () => {
  it('maps engine state to renderer flags', () => {
    const t = tracks[0]!;
    const st = createKartState(t, 0);
    const p = poseFromState(emptyPose(0), 0, st, null, null);
    expect(p.active).toBe(true);
    expect(p.flags & KF.airborne).toBe(st.grounded ? 0 : KF.airborne);
    st.driftDir = 1;
    st.boostTicks = 5;
    st.shieldTicks = 10;
    const q = poseFromState(emptyPose(0), 0, st, null, { throttle: 1, brake: 0, steer: 0.5, drift: true, item: false, back: false });
    expect(q.flags & KF.drifting).toBeTruthy();
    expect(q.flags & KF.driftLeft).toBeTruthy();
    expect(q.flags & KF.boosting).toBeTruthy();
    expect(q.flags & KF.shield).toBeTruthy();
    expect(q.steer).toBe(0.5);
  });
});
