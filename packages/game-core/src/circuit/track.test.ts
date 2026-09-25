import { describe, expect, it } from 'vitest';
import { CIRCUIT_TRACK_IDS } from '@dascade/shared/games/circuit';
import { buildTrack, GRID_SLOTS, levelAt, pointAt, projectOnTrack, type TrackDef } from './track.ts';
import { getTrack, TRACK_DEFS } from './tracks.ts';
import { generateDecor } from './decor.ts';
import { loopDelta, mod, wrapAngle } from './math.ts';

describe('track geometry', () => {
  it.each(CIRCUIT_TRACK_IDS)('%s builds an evenly sampled closed centerline', (id) => {
    const t = getTrack(id);
    expect(t.length).toBeGreaterThan(8000);
    expect(t.n).toBeGreaterThan(900);
    for (let i = 0; i < t.n; i++) {
      expect(t.segLen[i]).toBeGreaterThan(t.spacing * 0.8);
      expect(t.segLen[i]).toBeLessThan(t.spacing * 1.2);
      expect(Math.hypot(t.tx[i]!, t.ty[i]!)).toBeCloseTo(1, 6);
    }
    // Closed: the last segment ends back at the first sample.
    const last = t.n - 1;
    expect(Math.hypot(t.xs[last]! - t.xs[0]!, t.ys[last]! - t.ys[0]!)).toBeLessThan(t.spacing * 1.2);
    expect(t.s[0]).toBe(0);
  });

  it.each(CIRCUIT_TRACK_IDS)('%s has ordered, evenly spaced gates starting at the finish line', (id) => {
    const t = getTrack(id);
    expect(t.gates[0]).toBe(0);
    expect(t.gates.length).toBe(TRACK_DEFS[id].gates);
    for (let g = 1; g < t.gates.length; g++) {
      expect(t.gates[g]! - t.gates[g - 1]!).toBeCloseTo(t.length / t.gates.length, 3);
    }
  });

  it.each(CIRCUIT_TRACK_IDS)('%s places 20 non-overlapping grid slots on the road behind the line', (id) => {
    const t = getTrack(id);
    expect(t.grid.length).toBe(GRID_SLOTS);
    for (const [i, slot] of t.grid.entries()) {
      const p = projectOnTrack(t, slot.x, slot.y);
      expect(Math.abs(p.d)).toBeLessThan(t.halfWidth - 20);
      expect(loopDelta(slot.s, 0, t.length)).toBeGreaterThan(0); // the line is ahead
      expect(loopDelta(slot.s, 0, t.length)).toBeLessThan(900);
      const dir = pointAt(t, slot.s);
      expect(Math.abs(wrapAngle(slot.heading - Math.atan2(dir.ty, dir.tx)))).toBeLessThan(1e-6);
      for (const other of t.grid.slice(i + 1)) expect(Math.hypot(other.x - slot.x, other.y - slot.y)).toBeGreaterThan(52);
    }
    // Pole position is the slot closest to the line.
    const gaps = t.grid.map((g) => loopDelta(g.s, 0, t.length));
    expect(Math.min(...gaps)).toBe(gaps[0]);
  });

  it.each(CIRCUIT_TRACK_IDS)('%s corridors never overlap except at a bridge, and corners stay driveable', (id) => {
    const t = getTrack(id);
    const gap = Math.ceil((t.wall * 3.2) / t.spacing);
    for (let i = 0; i < t.n; i += 3) {
      for (let j = i + gap; j < t.n; j += 3) {
        if (t.n - j + i < gap) continue;
        const nearBridge = t.bridges.some((b) => Math.hypot(t.xs[i]! - b.x, t.ys[i]! - b.y) < t.wall * 3);
        if (nearBridge) continue;
        expect(Math.hypot(t.xs[i]! - t.xs[j]!, t.ys[i]! - t.ys[j]!)).toBeGreaterThan(t.wall * 2 + 20);
      }
    }
    const minRadius = 1 / Math.max(...Array.from(t.curvature, Math.abs));
    expect(minRadius).toBeGreaterThan(140);
  });

  it('projects points onto the centerline with signed lateral offsets', () => {
    const t = getTrack('neon-loop');
    for (let k = 0; k < 40; k++) {
      const sPos = (k / 40) * t.length + 3.7;
      const p = pointAt(t, sPos);
      const onLine = projectOnTrack(t, p.x, p.y);
      expect(Math.abs(onLine.d)).toBeLessThan(0.5);
      expect(Math.abs(loopDelta(onLine.s, sPos, t.length))).toBeLessThan(1);
      const off = projectOnTrack(t, p.x - p.ty * 60, p.y + p.tx * 60, onLine.seg);
      expect(off.d).toBeGreaterThan(58);
      expect(off.d).toBeLessThan(62);
    }
  });

  it('keeps projection on the correct pass through the crossover when a hint is supplied', () => {
    const t = getTrack('skyline-switchback');
    expect(t.bridges.length).toBe(1);
    const bridge = t.bridges[0]!;
    // Drive along the elevated pass through the crossing in small steps.
    let seg = projectOnTrack(t, pointAt(t, bridge.sUpper - 400).x, pointAt(t, bridge.sUpper - 400).y).seg;
    let prevS = mod(bridge.sUpper - 400, t.length);
    for (let d = -400; d <= 400; d += 6) {
      const p = pointAt(t, bridge.sUpper + d);
      const proj = projectOnTrack(t, p.x, p.y, seg);
      const ds = loopDelta(prevS, proj.s, t.length);
      expect(ds).toBeGreaterThanOrEqual(-0.5);
      expect(ds).toBeLessThan(12);
      prevS = proj.s;
      seg = proj.seg;
    }
    expect(levelAt(t, bridge.sUpper)).toBe(1);
    expect(levelAt(t, bridge.sLower)).toBe(0);
    expect(levelAt(getTrack('neon-loop'), 1234)).toBe(0);
  });

  it('rejects degenerate definitions', () => {
    const def: TrackDef = { ...TRACK_DEFS['neon-loop'], points: [[0, 0], [100, 0], [100, 100]] };
    expect(() => buildTrack(def)).toThrow();
  });
});

describe('scenery', () => {
  it.each(CIRCUIT_TRACK_IDS)('%s scenery is deterministic and keeps the corridor clear', (id) => {
    const t = getTrack(id);
    const a = generateDecor(t);
    const b = generateDecor(t);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.buildings.length).toBeGreaterThan(100);
    expect(a.gantries.length).toBe(t.gates.length);
    expect(a.stands.length).toBeGreaterThan(4);
    for (const bld of a.buildings) {
      for (const [x, y] of [
        [bld.x, bld.y],
        [bld.x + bld.w, bld.y],
        [bld.x, bld.y + bld.h],
        [bld.x + bld.w, bld.y + bld.h],
        [bld.x + bld.w / 2, bld.y + bld.h / 2],
      ] as const) {
        expect(Math.abs(projectOnTrack(t, x, y).d)).toBeGreaterThan(t.wall);
      }
    }
  });
});
