/**
 * Balance. Solo: every racer, driven alone by the hard bot (no items), laps each reference track
 * within a few percent of the others. Pack: 8-kart hard-bot races with one of each racer and the
 * grid rotated per race — no racer dominates or is hopeless. (The full measurement, 512 races with
 * and without items, is `lab/pack.ts` / `lab/packsearch.ts`; this seeded subset keeps the suite fast.)
 * Coefficients live in spec.ts (BALANCE).
 */
import { describe, expect, it } from 'vitest';
import { KART_RACER_IDS } from '@dascade/shared/games/kart';
import { getKartTrack } from './index.ts';
import { balanceTable } from './lab/balance.ts';
import { packBalance } from './lab/pack.ts';
import { statValue } from './lab/statvalue.ts';
import { racerSpec } from './spec.ts';

describe('racer balance', () => {
  it.each(['pixel-plaza', 'dune-drift'] as const)('%s: solo flying laps within 4 percent across racers', (id) => {
    const t = balanceTable(getKartTrack(id), [1, 2]);
    const v = KART_RACER_IDS.map((r) => t[r]);
    const min = Math.min(...v);
    const max = Math.max(...v);
    expect((max - min) / min).toBeLessThan(0.04);
  });

  it('8-kart pack races (all tracks, rotated grid, items on): mean places close together, no runaway winner', () => {
    // The full measurement (lab/pack.ts, 512 races with and without items) puts every racer's mean place
    // within 4.14–4.89 and win rates within 9–16 %. This seeded 64-race subset keeps the suite fast: a mean
    // place's standard error here is ~0.28, so the band is ~3σ around 4.5 ± 0.4.
    const res = packBalance({ seeds: 8, items: true, laps: 2 });
    expect(res.races).toBe(64);
    for (const r of KART_RACER_IDS) {
      expect(res.place[r], r).toBeGreaterThan(3.6);
      expect(res.place[r], r).toBeLessThan(5.4);
      expect(res.wins[r], r).toBeLessThan(0.3);
    }
  }, 60_000);

  it('every stat is worth something; handling matters but does not decide races (solo lap value, stat 1 → 5)', () => {
    // A neutral racer with one stat at 1 vs 5, alone on every track (lab/statvalue.ts). Speed sets the
    // 4 % top-speed spread; handling (yaw rate, drift charge) is worth well under that; grip and accel count.
    const v = statValue(undefined, [1]);
    expect(v.speed).toBeGreaterThan(3.5);
    expect(v.speed).toBeLessThan(5.5);
    expect(v.handling).toBeGreaterThan(1.2);
    expect(v.handling).toBeLessThan(v.speed * 0.75);
    expect(v.grip).toBeGreaterThan(1);
    expect(v.accel).toBeGreaterThan(0.5);
    expect(Math.abs(v.weight)).toBeLessThan(0.5); // weight only matters in contact
  }, 30_000);

  it('the Speed stat is visible: top speeds spread ~4–5 % from Speed 2 to Speed 5', () => {
    const tops = KART_RACER_IDS.map((r) => racerSpec(r).topSpeed);
    const spread = (Math.max(...tops) - Math.min(...tops)) / Math.min(...tops);
    expect(spread).toBeGreaterThan(0.035);
    expect(spread).toBeLessThan(0.06);
  });
});
