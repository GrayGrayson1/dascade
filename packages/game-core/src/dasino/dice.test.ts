import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  DICE_PICKS,
  diceMinStake,
  diceOdds,
  diceOutcome,
  diceReturn,
  diceStakeRtp,
  formatMultiplier,
  isDiceStakeOk,
  isPickOpen,
  pickMultiplier100,
  pickProbability,
  pickRtp,
  pickWays,
  rollDice,
  totalWays,
} from './dice.ts';

const POINTS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe('dice probabilities', () => {
  it('counts the ways to roll each total with two dice', () => {
    expect(POINTS.map(totalWays)).toEqual([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);
    expect(POINTS.reduce((s, t) => s + totalWays(t), 0)).toBe(36);
    expect(totalWays(1)).toBe(0);
    expect(totalWays(13)).toBe(0);
  });

  it('matches brute force over all 36 dice combinations', () => {
    for (const point of POINTS) {
      for (const pick of DICE_PICKS) {
        let ways = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (diceOutcome(point, a + b) === pick) ways++;
        expect(pickWays(point, pick), `${pick} vs ${point}`).toBe(ways);
      }
      expect(DICE_PICKS.reduce((s, p) => s + pickWays(point, p), 0)).toBe(36);
    }
  });

  it('knows the classic 7 odds', () => {
    expect(pickWays(7, 'higher')).toBe(15);
    expect(pickWays(7, 'lower')).toBe(15);
    expect(pickWays(7, 'same')).toBe(6);
    expect(pickProbability(7, 'same')).toBeCloseTo(1 / 6, 12);
  });

  it('rejects invalid points', () => {
    expect(() => pickWays(1, 'higher')).toThrow();
    expect(() => pickWays(13, 'lower')).toThrow();
  });

  it('rolls two fair dice with the injected RNG', () => {
    const rng = createSeededRng('dice');
    const totals = new Array(13).fill(0);
    const n = 72_000;
    for (let i = 0; i < n; i++) {
      const [a, b] = rollDice(rng);
      expect(a >= 1 && a <= 6 && b >= 1 && b <= 6).toBe(true);
      totals[a + b]++;
    }
    let chi2 = 0;
    for (const t of POINTS) {
      const expected = (n * totalWays(t)) / 36;
      chi2 += (totals[t] - expected) ** 2 / expected;
    }
    expect(chi2).toBeLessThan(29.6); // 10 dof, p = 0.001
  });
});

describe('dice payouts', () => {
  it('derives multipliers from the true odds with a 3% edge, rounded down', () => {
    expect(pickMultiplier100(7, 'higher')).toBe(232); // 0.97 × 36/15 = 2.328
    expect(pickMultiplier100(7, 'same')).toBe(582); // 0.97 × 6 = 5.82
    expect(pickMultiplier100(2, 'same')).toBe(3492); // 0.97 × 36 = 34.92
    expect(pickMultiplier100(3, 'higher')).toBe(105); // 0.97 × 36/33 = 1.058
    expect(pickMultiplier100(10, 'higher')).toBe(1164); // 3 ways → 11.64
    expect(formatMultiplier(582)).toBe('5.82×');
    for (const point of POINTS) {
      for (const pick of DICE_PICKS) {
        const ways = pickWays(point, pick);
        const m = pickMultiplier100(point, pick);
        if (m === 0) continue;
        expect(m).toBe(Math.floor((97 * 36) / ways));
      }
    }
  });

  it('closes picks that cannot win or cannot pay more than the stake', () => {
    expect(isPickOpen(12, 'higher')).toBe(false); // impossible
    expect(isPickOpen(2, 'lower')).toBe(false); // impossible
    expect(isPickOpen(2, 'higher')).toBe(false); // 35/36 → 0.99×
    expect(isPickOpen(12, 'lower')).toBe(false);
    expect(isPickOpen(3, 'higher')).toBe(true);
    expect(isPickOpen(11, 'lower')).toBe(true);
    for (const point of POINTS) expect(isPickOpen(point, 'same')).toBe(true);
    for (const point of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      expect(isPickOpen(point, 'higher')).toBe(true);
      expect(isPickOpen(point, 'lower')).toBe(true);
    }
  });

  it('keeps every open pick at a 3.0–3.75% house edge (exact)', () => {
    for (const point of POINTS) {
      for (const pick of DICE_PICKS) {
        if (!isPickOpen(point, pick)) continue;
        const edge = 1 - pickRtp(point, pick);
        expect(edge, `${pick} vs ${point}`).toBeGreaterThanOrEqual(0.03 - 1e-12);
        expect(edge, `${pick} vs ${point}`).toBeLessThanOrEqual(0.0375 + 1e-12);
      }
    }
  });

  it('exhaustively returns at most 97% of stakes for every point and pick', () => {
    for (const point of POINTS) {
      for (const pick of DICE_PICKS) {
        if (!isPickOpen(point, pick)) continue;
        let returned = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) returned += diceReturn(point, pick, a + b, 1000);
        const rtp = returned / (36 * 1000);
        expect(rtp).toBeLessThanOrEqual(0.97 + 1e-12);
        expect(rtp).toBeGreaterThanOrEqual(0.9625 - 1e-12);
      }
    }
  });

  it('pays winners and nothing to losers, rounding down to whole chips', () => {
    expect(diceReturn(7, 'higher', 8, 100)).toBe(232);
    expect(diceReturn(7, 'higher', 7, 100)).toBe(0); // ties lose HIGHER/LOWER
    expect(diceReturn(7, 'lower', 6, 100)).toBe(232);
    expect(diceReturn(7, 'same', 7, 100)).toBe(582);
    expect(diceReturn(7, 'same', 8, 100)).toBe(0);
    expect(diceReturn(3, 'higher', 12, 5)).toBe(5); // 5 × 1.05 = 5.25 → 5
    expect(diceReturn(3, 'higher', 12, 7)).toBe(7); // 7.35 → 7
    expect(diceReturn(3, 'higher', 12, 20)).toBe(21);
    expect(diceReturn(2, 'higher', 12, 100)).toBe(0); // closed pick never pays
    expect(() => diceReturn(7, 'higher', 13, 100)).toThrow();
    expect(() => diceReturn(7, 'higher', 8, 0)).toThrow();
  });

  it('describes the odds for the UI', () => {
    const odds = diceOdds(7);
    expect(odds.map((o) => o.pick)).toEqual(['higher', 'same', 'lower']);
    expect(odds[0]).toMatchObject({ open: true, ways: 15, multiplier100: 232 });
    expect(odds[1]).toMatchObject({ open: true, ways: 6, multiplier100: 582 });
    expect(diceOdds(12)[0]).toMatchObject({ open: false, ways: 0, multiplier100: 0, houseEdge: 0 });
    expect(diceOutcome(5, 9)).toBe('higher');
    expect(diceOutcome(5, 4)).toBe('lower');
    expect(diceOutcome(5, 5)).toBe('same');
  });
});

describe('dice whole-chip stakes', () => {
  it('computes probabilities independently by enumerating all 36 rolls', () => {
    for (const point of POINTS) {
      for (const pick of DICE_PICKS) {
        let wins = 0;
        for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (diceOutcome(point, a + b) === pick) wins++;
        expect(pickWays(point, pick), `${pick} vs ${point}`).toBe(wins);
      }
    }
  });

  it('only accepts stakes whose win pays more than the stake', () => {
    expect(diceMinStake(3, 'higher')).toBe(20); // 1.05×
    expect(diceMinStake(4, 'higher')).toBe(7); // 1.16×
    expect(diceMinStake(5, 'higher')).toBe(3); // 1.34×
    expect(diceMinStake(6, 'higher')).toBe(2); // 1.66×
    expect(diceMinStake(7, 'higher')).toBe(1); // 2.32×
    expect(diceMinStake(12, 'higher')).toBe(0); // closed
    expect(diceMinStake(2, 'higher')).toBe(0); // closed (0.99×)
    for (const point of POINTS) {
      for (const pick of DICE_PICKS) {
        const min = diceMinStake(point, pick);
        if (min === 0) {
          expect(isPickOpen(point, pick)).toBe(false);
          continue;
        }
        const win = pick === 'higher' ? 12 : pick === 'lower' ? 2 : point;
        // The minimum profits; one chip less would only lose or push.
        expect(diceReturn(point, pick, win, min), `${pick} vs ${point}`).toBeGreaterThan(min);
        if (min > 1) expect(diceReturn(point, pick, win, min - 1)).toBe(min - 1);
        expect(isDiceStakeOk(point, pick, min)).toBe(true);
        expect(isDiceStakeOk(point, pick, min - 1)).toBe(false);
        for (let a = min; a < min + 300; a++) expect(diceReturn(point, pick, win, a)).toBeGreaterThan(a);
      }
    }
  });

  it('reports the exact return of a whole-chip stake (never above 97%)', () => {
    expect(diceStakeRtp(4, 'higher', 5)).toBeCloseTo((30 / 36) * (5 / 5), 12); // 5 × 1.16 → 5: a win only pushes
    expect(diceStakeRtp(4, 'higher', 100)).toBeCloseTo(pickRtp(4, 'higher'), 12);
    for (const point of POINTS) {
      for (const pick of DICE_PICKS) {
        for (const a of [1, 5, 7, 20, 25, 99, 100, 1000]) {
          const rtp = diceStakeRtp(point, pick, a);
          expect(rtp).toBeLessThanOrEqual(pickRtp(point, pick) + 1e-12);
          if (!isPickOpen(point, pick)) {
            expect(rtp).toBe(0);
            continue;
          }
          let returned = 0;
          for (let x = 1; x <= 6; x++) for (let y = 1; y <= 6; y++) returned += diceReturn(point, pick, x + y, a);
          expect(rtp).toBeCloseTo(returned / (36 * a), 12);
        }
      }
    }
  });
});
