/**
 * The six tracks-lane tracks (harbor-hairpins … midnight-mainframe): they build, their content is placed where a
 * player can use it, they are distinct from each other, each keeps its advertised personality, and a hard bot laps
 * each one close to its par. (Builder mechanics and the reference tracks are covered by ../track.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import type { KartRacerId, KartTrackId } from '@dascade/shared/games/kart';
import { createSeededRng } from '@dascade/shared/random';
import { KartSim } from '../sim.ts';
import { buildTrack, EDGE_DROP, groundAt, KART_GRID_SLOTS, pointAtS, type KartTrack } from '../track.ts';
import type { KartTrackDef } from '../trackdef.ts';
import { KART_PLACEHOLDER_TRACKS, KART_TRACK_DEFS } from './index.ts';

const IDS = [
  'harbor-hairpins',
  'frostbyte-pass',
  'pinball-park',
  'gearworks',
  'skyway-sprint',
  'midnight-mainframe',
] as const satisfies readonly KartTrackId[];

const built = new Map<KartTrackId, KartTrack>();
function track(id: KartTrackId): KartTrack {
  let t = built.get(id);
  if (!t) {
    t = buildTrack(KART_TRACK_DEFS[id]);
    built.set(id, t);
  }
  return t;
}
const def = (id: KartTrackId): KartTrackDef => KART_TRACK_DEFS[id];

/** Landmark footprints at scale 1 (render lane, LANDMARKS.md); floating kinds have none. */
const FOOTPRINT: Record<string, number> = {
  'arcade-cabinet': 12,
  billboard: 9,
  tower: 10,
  'radar-dish': 10,
  lighthouse: 7,
  crane: 12,
  'cargo-ship': 30,
  'ice-castle': 20,
  'frozen-joystick': 9,
  'ferris-wheel': 14,
  'circus-tent': 16,
  gears: 16,
  smokestack: 8,
  'cpu-tower': 14,
  'data-spire': 8,
  'cloud-island': 20,
};
const FLOATING = new Set(['blimp', 'hot-air-balloon']);

/** Distance from (x, y) to the nearest road edge + shoulder of the main line or any branch (negative = on it). */
function clearance(t: KartTrack, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < t.n; i++) best = Math.min(best, Math.hypot(x - t.xs[i]!, y - t.ys[i]!) - Math.max(t.hwL[i]!, t.hwR[i]!) - t.shoulder);
  for (const b of t.branches)
    for (let i = 0; i < b.n; i++) best = Math.min(best, Math.hypot(x - b.xs[i]!, y - b.ys[i]!) - b.hwL[i]! - t.shoulder);
  return best;
}

/** Radius of the main centreline around s, measured over ±6 u (Infinity on a straight). */
function radiusAt(t: KartTrack, s: number): number {
  const a = pointAtS(t, s - 6);
  const b = pointAtS(t, s + 6);
  let da = Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx);
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  return Math.abs(da) < 1e-6 ? Infinity : 12 / Math.abs(da);
}

function meanHalfWidth(t: KartTrack): number {
  let sum = 0;
  for (let i = 0; i < t.n; i++) sum += (t.hwL[i]! + t.hwR[i]!) / 2;
  return sum / t.n;
}

function dropShare(t: KartTrack): number {
  let drops = 0;
  for (let i = 0; i < t.n; i++) drops += (t.edgeL[i] === EDGE_DROP ? 1 : 0) + (t.edgeR[i] === EDGE_DROP ? 1 : 0);
  return drops / (2 * t.n);
}

function zRange(t: KartTrack): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < t.n; i++) {
    lo = Math.min(lo, t.zs[i]!);
    hi = Math.max(hi, t.zs[i]!);
  }
  return hi - lo;
}

const kinds = (id: KartTrackId, kind: string) => (def(id).hazards ?? []).filter((h) => h.kind === kind);

describe.each(IDS)('%s', (id) => {
  it('is registered, not a placeholder, and builds', () => {
    expect(KART_TRACK_DEFS[id].id).toBe(id);
    expect(KART_PLACEHOLDER_TRACKS.has(id)).toBe(false);
    expect(() => track(id)).not.toThrow();
  });

  it('has a lap of ~1,100–1,550 u (≈ 35–55 s)', () => {
    const t = track(id);
    expect(t.length).toBeGreaterThan(1_100);
    expect(t.length).toBeLessThan(1_550);
    expect(def(id).parLapMs).toBeGreaterThanOrEqual(35_000);
    expect(def(id).parLapMs).toBeLessThanOrEqual(55_000);
  });

  it('has at least four item rows, none in a tight corner, every cube on the road', () => {
    const t = track(id);
    expect((def(id).itemRows ?? []).length).toBeGreaterThanOrEqual(4);
    for (const row of def(id).itemRows ?? []) expect(radiusAt(t, row.at * t.length)).toBeGreaterThan(35);
    expect(t.itemBoxes.length).toBeGreaterThanOrEqual(12);
    for (const box of t.itemBoxes) {
      const g = groundAt(t, box.x, box.y);
      expect(g.onRoad && g.hasGround).toBe(true);
    }
  });

  it('puts all 30 grid slots on solid road, before the line and facing forward', () => {
    const t = track(id);
    expect(t.grid).toHaveLength(KART_GRID_SLOTS);
    for (const slot of t.grid) {
      const g = groundAt(t, slot.x, slot.y);
      expect(g.onRoad && g.hasGround && g.branch === -1).toBe(true);
      expect(Math.cos(slot.heading) * g.tx + Math.sin(slot.heading) * g.ty).toBeGreaterThan(0.95);
    }
  });

  it('keeps landmarks off the road (footprint + 4 u clear) and features on it', () => {
    const t = track(id);
    for (const lm of t.landmarks) {
      if (FLOATING.has(lm.kind)) continue;
      const foot = (FOOTPRINT[lm.kind] ?? 10) * lm.scale;
      expect(clearance(t, lm.x, lm.y), `${lm.kind} at ${(lm.s / t.length).toFixed(3)}`).toBeGreaterThan(foot + 4);
    }
    for (const h of t.hazards) {
      if (h.kind === 'laser') continue;
      const g = groundAt(t, h.x, h.y);
      expect(g.onRoad, `${h.kind} ${h.index}`).toBe(true);
    }
    for (const p of t.boostPads) expect(groundAt(t, p.x, p.y).onRoad).toBe(true);
    for (const r of t.ramps) expect(groundAt(t, r.x, r.y).onRoad).toBe(true);
    // Landmarks exist: each track has at least two set pieces.
    expect(t.landmarks.length).toBeGreaterThanOrEqual(2);
  });

  it('a hard bot laps it near par without falling off repeatedly', () => {
    const t = track(id);
    const racers: KartRacerId[] = ['nova', 'brick', 'quack'];
    const bests: number[] = [];
    for (const racer of racers) {
      const sim = new KartSim(
        t,
        { laps: 2, items: false, collisions: false, finishWindowMs: 60_000, maxRaceMs: 240_000 },
        createSeededRng(`${id}-${racer}`),
        1,
      );
      const k = sim.addRacer(0, 'bot', racer, 'hard');
      sim.go();
      let falls = 0;
      for (let i = 0; i < 60 * 240 && sim.status !== 'done'; i++) {
        for (const e of sim.step()) if (e.type === 'hit' && e.cause === 'fall') falls++;
      }
      expect(k.progress.finished, `${racer} finished`).toBe(true);
      // Drops are part of some tracks; a hard bot may slip off once, never repeatedly.
      expect(falls, `${racer} falls`).toBeLessThanOrEqual(1);
      bests.push(k.progress.bestLapMs);
    }
    const best = Math.min(...bests);
    // Par is the hard bot's best clean lap (lab/pars.ts); the band leaves room for other racers, hazards and
    // physics tuning.
    expect(best).toBeGreaterThan(def(id).parLapMs * 0.9);
    expect(best).toBeLessThan(def(id).parLapMs * 1.25);
  }, 60_000);
});

describe('track personalities', () => {
  it('harbor-hairpins: narrow, tight hairpins, crane sweepers, water drops, a lighthouse', () => {
    const t = track('harbor-hairpins');
    expect(meanHalfWidth(t)).toBeLessThan(7);
    expect(kinds('harbor-hairpins', 'sweeper').length).toBeGreaterThanOrEqual(2);
    expect(dropShare(t)).toBeGreaterThan(0.05);
    expect(t.landmarks.some((l) => l.kind === 'lighthouse')).toBe(true);
    let tight = 0;
    for (let s = 0; s < t.length; s += 4) if (radiusAt(t, s) < 14) tight++;
    expect(tight).toBeGreaterThan(4);
  });

  it('frostbyte-pass: a big climb, ice on the way down, snowballs rolling at you', () => {
    const t = track('frostbyte-pass');
    expect(zRange(t)).toBeGreaterThan(35);
    expect((def('frostbyte-pass').zones ?? []).some((z) => z.kind === 'ice')).toBe(true);
    expect(kinds('frostbyte-pass', 'roller').length).toBeGreaterThanOrEqual(2);
    // Rollers roll down the climb: the road rises in the direction of travel under every roller.
    for (const h of t.hazards.filter((hz) => hz.kind === 'roller'))
      expect(pointAtS(t, h.s).z).toBeGreaterThan(pointAtS(t, h.s - h.amp).z + 3);
    expect(t.landmarks.some((l) => l.kind === 'frozen-joystick' || l.kind === 'ice-castle')).toBe(true);
  });

  it('pinball-park: wide, lots of bumpers in the road, a jump, a ferris wheel', () => {
    const t = track('pinball-park');
    expect(meanHalfWidth(t)).toBeGreaterThan(11);
    expect(kinds('pinball-park', 'bumper').length).toBeGreaterThanOrEqual(8);
    expect(t.ramps.length).toBeGreaterThanOrEqual(1);
    expect((def('pinball-park').itemRows ?? []).length).toBeGreaterThanOrEqual(6);
    expect(t.landmarks.some((l) => l.kind === 'ferris-wheel')).toBe(true);
  });

  it('gearworks: conveyors both ways, a stomper line, and a longer way round it', () => {
    const t = track('gearworks');
    const pushes = (def('gearworks').zones ?? []).filter((z) => z.kind === 'conveyor').map((z) => Math.sign(z.push ?? 0));
    expect(pushes).toContain(1);
    expect(pushes).toContain(-1);
    const stompers = t.hazards.filter((h) => h.kind === 'stomper');
    expect(stompers.length).toBeGreaterThanOrEqual(3);
    const b = t.branches[0]!;
    expect(b.surface).toBe('road');
    // The branch skips every stomper and is the longer way round.
    for (const h of stompers) expect(h.s > b.from && h.s < b.to).toBe(true);
    expect(b.length).toBeGreaterThan((b.to - b.from) * 1.05);
  });

  it('skyway-sprint: fast, drops almost everywhere, a big jump over a gap, boost chains, a blimp', () => {
    const t = track('skyway-sprint');
    expect(dropShare(t)).toBeGreaterThan(0.6);
    expect(t.gaps.length).toBeGreaterThanOrEqual(1);
    expect(t.ramps.some((r) => r.launch >= 12)).toBe(true);
    // A chain: three or more pads within 60 u.
    const pads = t.boostPads.map((p) => p.s).sort((a, b) => a - b);
    expect(pads.some((s, i) => i + 2 < pads.length && pads[i + 2]! - s < 60)).toBe(true);
    expect(t.landmarks.some((l) => l.kind === 'blimp')).toBe(true);
    expect(zRange(t)).toBeGreaterThan(15);
  });

  it('midnight-mainframe: narrow, laser gates, and a shorter bypass that skips some of them', () => {
    const t = track('midnight-mainframe');
    expect(meanHalfWidth(t)).toBeLessThan(7);
    const lasers = t.hazards.filter((h) => h.kind === 'laser');
    expect(lasers.length).toBeGreaterThanOrEqual(3);
    const b = t.branches[0]!;
    expect(b.surface).toBe('road');
    expect(b.length).toBeLessThan(b.to - b.from);
    expect(b.length).toBeGreaterThan((b.to - b.from) * 0.65);
    expect(lasers.some((h) => h.s < b.from)).toBe(true);
    expect(lasers.some((h) => h.s > b.from && h.s < b.to)).toBe(true);
    expect(t.landmarks.some((l) => l.kind === 'cpu-tower' || l.kind === 'data-spire')).toBe(true);
  });

  it('the six tracks are distinct (length, width, height and edge profiles)', () => {
    const profile = IDS.map((id) => {
      const t = track(id);
      return { id, length: t.length, hw: meanHalfWidth(t), z: zRange(t), drops: dropShare(t) };
    });
    for (let i = 0; i < profile.length; i++) {
      for (let j = i + 1; j < profile.length; j++) {
        const a = profile[i]!;
        const b = profile[j]!;
        const same =
          Math.abs(a.length - b.length) < 40 &&
          Math.abs(a.hw - b.hw) < 0.75 &&
          Math.abs(a.z - b.z) < 4 &&
          Math.abs(a.drops - b.drops) < 0.1;
        expect(same, `${a.id} vs ${b.id}`).toBe(false);
      }
    }
    // Every track uses its own biome and decor seed.
    expect(new Set(IDS.map((id) => def(id).biome)).size).toBe(IDS.length);
    expect(new Set(IDS.map((id) => def(id).decorSeed)).size).toBe(IDS.length);
  });
});
