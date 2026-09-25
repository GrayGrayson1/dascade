import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  SLOT_LINE_OPTIONS,
  SLOT_PAYLINES,
  SLOT_PAYTABLE,
  SLOT_REELS,
  SLOT_SYMBOLS,
  evaluateLine,
  evaluateSpin,
  isValidSlotBet,
  isValidStops,
  slotStats,
  slotStripComposition,
  slotWindow,
  spinSlotStops,
  spinSlots,
  type SlotStops,
  type SlotSymbol,
} from './slots.ts';

/** Find the first stop on a reel whose middle symbol is `symbol`. */
function stopFor(reel: number, symbol: SlotSymbol): number {
  const i = SLOT_REELS[reel]!.indexOf(symbol);
  if (i < 0) throw new Error(`no ${symbol} on reel ${reel}`);
  return i;
}

describe('slot reels', () => {
  it('has three 32-stop strips of known symbols', () => {
    expect(SLOT_REELS).toHaveLength(3);
    for (const strip of SLOT_REELS) {
      expect(strip).toHaveLength(32);
      for (const s of strip) expect(SLOT_SYMBOLS).toContain(s);
    }
  });

  it('matches the published strip composition', () => {
    expect(slotStripComposition()).toEqual([
      { cherry: 5, joystick: 7, floppy: 5, bell: 4, coin: 4, rocket: 3, seven: 2, das: 2 },
      { cherry: 5, joystick: 6, floppy: 5, bell: 5, coin: 4, rocket: 3, seven: 2, das: 2 },
      { cherry: 6, joystick: 6, floppy: 6, bell: 5, coin: 4, rocket: 2, seven: 2, das: 1 },
    ]);
  });

  it('never puts the same premium symbol on neighbouring stops', () => {
    for (const strip of SLOT_REELS) {
      for (let i = 0; i < strip.length; i++) {
        const a = strip[i]!;
        const b = strip[(i + 1) % strip.length]!;
        if (['das', 'seven', 'rocket', 'coin'].includes(a)) expect(b).not.toBe(a);
      }
    }
  });

  it('shows the stop on the middle row with wrap-around neighbours', () => {
    const grid = slotWindow([0, 31, 5]);
    expect(grid[0]).toEqual([SLOT_REELS[0]![31], SLOT_REELS[0]![0], SLOT_REELS[0]![1]]);
    expect(grid[1]).toEqual([SLOT_REELS[1]![30], SLOT_REELS[1]![31], SLOT_REELS[1]![0]]);
    expect(grid[2]).toEqual([SLOT_REELS[2]![4], SLOT_REELS[2]![5], SLOT_REELS[2]![6]]);
  });

  it('validates stops', () => {
    expect(isValidStops([0, 0, 0])).toBe(true);
    expect(isValidStops([31, 31, 31])).toBe(true);
    expect(isValidStops([32, 0, 0])).toBe(false);
    expect(isValidStops([-1, 0, 0])).toBe(false);
    expect(isValidStops([0.5, 0, 0])).toBe(false);
    expect(isValidStops([0, 0])).toBe(false);
  });

  it('draws each reel independently and uniformly from the injected RNG', () => {
    const rng = createSeededRng('slots');
    const counts = [new Array(32).fill(0), new Array(32).fill(0), new Array(32).fill(0)];
    const spins = 32_000;
    for (let i = 0; i < spins; i++) {
      const stops = spinSlotStops(rng);
      expect(isValidStops(stops)).toBe(true);
      stops.forEach((s, r) => counts[r]![s]++);
    }
    for (const reel of counts) {
      const expected = spins / 32;
      const chi2 = reel.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
      expect(chi2).toBeLessThan(62); // 31 dof, p = 0.001
    }
    const a = createSeededRng(99);
    const b = createSeededRng(99);
    for (let i = 0; i < 10; i++) expect(spinSlotStops(a)).toEqual(spinSlotStops(b));
  });
});

describe('slot paylines', () => {
  it('defines five paylines: three rows and two diagonals', () => {
    expect(SLOT_PAYLINES).toEqual([
      [1, 1, 1],
      [0, 0, 0],
      [2, 2, 2],
      [0, 1, 2],
      [2, 1, 0],
    ]);
    expect(SLOT_LINE_OPTIONS).toEqual([1, 3, 5]);
  });

  it('pays three of a kind from the paytable', () => {
    for (const s of SLOT_SYMBOLS) {
      expect(evaluateLine([s, s, s]), s).toEqual({ symbol: s, count: 3, multiplier: SLOT_PAYTABLE[s][3] });
    }
  });

  it('lets the DAS wild substitute and pays the highest combination only', () => {
    expect(evaluateLine(['das', 'das', 'das'])).toEqual({ symbol: 'das', count: 3, multiplier: 300 });
    expect(evaluateLine(['das', 'das', 'seven'])).toEqual({ symbol: 'seven', count: 3, multiplier: 100 });
    expect(evaluateLine(['bell', 'das', 'bell'])).toEqual({ symbol: 'bell', count: 3, multiplier: 12 });
    expect(evaluateLine(['das', 'rocket', 'das'])).toEqual({ symbol: 'rocket', count: 3, multiplier: 40 });
    expect(evaluateLine(['das', 'cherry', 'bell'])).toEqual({ symbol: 'cherry', count: 2, multiplier: 2 });
    // Wild on reel 1 counts as a lone cherry when nothing better lines up.
    expect(evaluateLine(['das', 'bell', 'cherry'])).toEqual({ symbol: 'cherry', count: 1, multiplier: 1 });
    // Two wilds + a joystick: joystick×3 (6) beats seven×2 (5) and cherry×2 (2).
    expect(evaluateLine(['das', 'das', 'joystick'])).toEqual({ symbol: 'joystick', count: 3, multiplier: 6 });
    // Two wilds + a cherry: cherry×3 (5) ties seven×2 (5); the first best found is kept.
    expect(evaluateLine(['das', 'das', 'cherry'])?.multiplier).toBe(5);
  });

  it('pays sevens and cherries from the left only', () => {
    expect(evaluateLine(['seven', 'seven', 'bell'])).toEqual({ symbol: 'seven', count: 2, multiplier: 5 });
    expect(evaluateLine(['cherry', 'cherry', 'bell'])).toEqual({ symbol: 'cherry', count: 2, multiplier: 2 });
    expect(evaluateLine(['cherry', 'bell', 'cherry'])).toEqual({ symbol: 'cherry', count: 1, multiplier: 1 });
    expect(evaluateLine(['bell', 'cherry', 'cherry'])).toBeNull();
    expect(evaluateLine(['bell', 'seven', 'seven'])).toBeNull();
    expect(evaluateLine(['joystick', 'floppy', 'das'])).toBeNull();
    expect(evaluateLine(['coin', 'coin', 'bell'])).toBeNull();
  });

  it('evaluates only the played lines and pays line bet × multiplier', () => {
    // Middle row: seven · seven · seven.
    const stops: SlotStops = [stopFor(0, 'seven'), stopFor(1, 'seven'), stopFor(2, 'seven')];
    const one = evaluateSpin(stops, 10, 1);
    expect(one.totalBet).toBe(10);
    expect(one.wins[0]).toMatchObject({ line: 0, symbol: 'seven', count: 3, multiplier: 100, pay: 1000 });
    expect(one.wins[0]!.cells).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(one.wins.every((w) => w.line < 1)).toBe(true);
    const five = evaluateSpin(stops, 10, 5);
    expect(five.totalBet).toBe(50);
    expect(five.wins.every((w) => w.line < 5)).toBe(true);
    expect(five.totalWin).toBe(five.wins.reduce((s, w) => s + w.pay, 0));
    expect(five.totalWin).toBeGreaterThanOrEqual(1000);
  });

  it('matches a brute-force re-evaluation for every line of many spins', () => {
    const rng = createSeededRng('cross-check');
    for (let i = 0; i < 2000; i++) {
      const outcome = spinSlots(rng, 3, 5);
      let total = 0;
      SLOT_PAYLINES.forEach((rows, line) => {
        const symbols = rows.map((row, reel) => outcome.grid[reel]![row]!);
        const hit = evaluateLine(symbols);
        const win = outcome.wins.find((w) => w.line === line);
        expect(win?.pay ?? 0).toBe((hit?.multiplier ?? 0) * 3);
        total += (hit?.multiplier ?? 0) * 3;
      });
      expect(outcome.totalWin).toBe(total);
    }
  });

  it('rejects invalid bets', () => {
    expect(isValidSlotBet(1, 5)).toBe(true);
    expect(isValidSlotBet(0, 5)).toBe(false);
    expect(isValidSlotBet(1.5, 5)).toBe(false);
    expect(isValidSlotBet(1, 2)).toBe(false);
    expect(isValidSlotBet(1, 6)).toBe(false);
    expect(() => evaluateSpin([0, 0, 0], 0, 5)).toThrow();
    expect(() => evaluateSpin([0, 0, 40] as SlotStops, 1, 5)).toThrow();
  });
});

describe('slot RTP (exhaustive)', () => {
  it('enumerates all 32,768 stop combinations and lands between 92% and 97%', () => {
    const stats = slotStats();
    expect(stats.combinations).toBe(32 ** 3);
    expect(stats.rtp).toBeGreaterThan(0.92);
    expect(stats.rtp).toBeLessThan(0.97);
    expect(stats.rtp).toBe(stats.totalReturn / (32 ** 3 * 5));
    // Exact published value (shown on the info screen).
    expect(stats.totalReturn).toBe(157_665);
    expect(stats.rtp).toBeCloseTo(0.962311, 6);
    expect(stats.lineHitRate).toBeGreaterThan(0.2);
    expect(stats.spinHitRate).toBeGreaterThan(stats.lineHitRate);
    expect(stats.bigWinRate).toBeGreaterThan(0);
  });

  it('agrees with an independent calculation from symbol frequencies', () => {
    const comp = slotStripComposition();
    let ev = 0;
    for (const a of SLOT_SYMBOLS) {
      for (const b of SLOT_SYMBOLS) {
        for (const c of SLOT_SYMBOLS) {
          const p = (comp[0]![a] / 32) * (comp[1]![b] / 32) * (comp[2]![c] / 32);
          if (p > 0) ev += p * (evaluateLine([a, b, c])?.multiplier ?? 0);
        }
      }
    }
    expect(ev).toBeCloseTo(slotStats().rtp, 12);
  });

  it('has the same RTP for 1, 3 and 5 lines', () => {
    for (const lines of SLOT_LINE_OPTIONS) {
      let ret = 0;
      for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) for (let k = 0; k < 32; k++) ret += evaluateSpin([i, j, k], 1, lines).totalWin;
      expect(ret / (32 ** 3 * lines)).toBeCloseTo(slotStats().rtp, 12);
    }
  });
});
