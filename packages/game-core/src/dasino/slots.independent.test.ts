/**
 * Independent cross-check of the Neon 7s pay evaluation and RTP.
 *
 * Wild handling is re-derived from its definition: a DAS may stand for any
 * symbol (or stay a DAS), and a line pays the best "N identical from the left"
 * combination over every possible substitution. That is compared with the
 * engine's evaluateLine for all 8³ symbol triples, and the RTP is then
 * recomputed exactly (as a rational) from raw reel-stop enumeration.
 */
import { describe, expect, it } from 'vitest';
import { DasinoSettingsSchema, SlotSpinSchema, slotLineBets, tableChips } from '@dascade/shared/games/dasino';
import { SLOT_PAYLINES, SLOT_PAYTABLE, SLOT_REELS, SLOT_SYMBOLS, SLOT_WILD, evaluateLine, evaluateSpin, slotStats, type SlotSymbol } from './slots.ts';

function plainLinePay(line: readonly SlotSymbol[]): number {
  const first = line[0]!;
  let n = 1;
  while (n < line.length && line[n] === first) n++;
  // A paytable entry for fewer symbols also applies to a longer run of the same symbol.
  let best = 0;
  for (let k = 1; k <= n; k++) best = Math.max(best, SLOT_PAYTABLE[first][k as 1 | 2 | 3] ?? 0);
  return best;
}

function wildLinePay(line: readonly SlotSymbol[]): number {
  let best = 0;
  const rec = (i: number, acc: SlotSymbol[]) => {
    if (i === line.length) {
      best = Math.max(best, plainLinePay(acc));
      return;
    }
    const s = line[i]!;
    if (s !== SLOT_WILD) return rec(i + 1, [...acc, s]);
    for (const sub of SLOT_SYMBOLS) rec(i + 1, [...acc, sub]);
  };
  rec(0, []);
  return best;
}

describe('Neon 7s: independent evaluation', () => {
  it('matches "best substitution" wild semantics for every one of the 512 symbol triples', () => {
    for (const a of SLOT_SYMBOLS) {
      for (const b of SLOT_SYMBOLS) {
        for (const c of SLOT_SYMBOLS) {
          expect(evaluateLine([a, b, c])?.multiplier ?? 0, `${a} ${b} ${c}`).toBe(wildLinePay([a, b, c]));
        }
      }
    }
  });

  it('reads each payline from the right cells (top = stop−1, middle = stop, bottom = stop+1)', () => {
    for (let i = 0; i < 32; i += 5) {
      for (let j = 0; j < 32; j += 7) {
        for (let k = 0; k < 32; k += 3) {
          const cell = (reel: number, stop: number, row: number) => SLOT_REELS[reel]![(stop + row - 1 + 32) % 32]!;
          const out = evaluateSpin([i, j, k], 1, 5);
          SLOT_PAYLINES.forEach((rows, line) => {
            const symbols = rows.map((row, reel) => cell(reel, [i, j, k][reel]!, row));
            const pay = wildLinePay(symbols);
            expect(out.wins.find((w) => w.line === line)?.pay ?? 0).toBe(pay);
          });
        }
      }
    }
  });

  it('recomputes the published RTP exactly: 157,665 line bets returned per 163,840 wagered', () => {
    let total = 0;
    for (let i = 0; i < 32; i++) {
      for (let j = 0; j < 32; j++) {
        for (let k = 0; k < 32; k++) {
          for (const rows of SLOT_PAYLINES) {
            const symbols = rows.map((row, reel) => SLOT_REELS[reel]![([i, j, k][reel]! + row - 1 + 32) % 32]!);
            total += wildLinePay(symbols);
          }
        }
      }
    }
    expect(total).toBe(157_665);
    expect(total).toBe(slotStats().totalReturn);
    expect(total / (32 ** 3 * 5)).toBeCloseTo(0.96231, 5);
    // House edge ~3.77%: the machine never favours the player.
    expect(total).toBeLessThan(32 ** 3 * 5);
  });

  it('pays integer multiples of the line bet', () => {
    for (const lineBet of [1, 3, 7, 20_000]) {
      const out = evaluateSpin([0, 5, 11], lineBet, 5);
      for (const w of out.wins) expect(Number.isInteger(w.pay) && w.pay === w.multiplier * lineBet).toBe(true);
      expect(out.totalBet).toBe(lineBet * 5);
    }
  });
});

describe('Neon 7s: bet options for any valid table limits', () => {
  it('always offers at least one spin the server accepts, and never one it rejects', () => {
    const limits = [1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 25, 99, 100, 101, 999, 5_000, 99_999, 100_000];
    for (const minBet of limits) {
      for (const maxBet of limits) {
        const ok = DasinoSettingsSchema.safeParse({ startingBalance: 1_000_000, minBet, maxBet, rouletteBettingSeconds: 15, diceBettingSeconds: 12, allowRefills: true });
        if (!ok.success) continue;
        const all = [1, 3, 5].flatMap((lines) => slotLineBets({ minBet, maxBet }, lines).map((lineBet) => ({ lineBet, lines })));
        // Some spin is legal iff the smallest qualifying line bet fits the schema cap and the table max.
        const possible = [1, 3, 5].some((l) => Math.ceil(minBet / l) <= 20_000 && Math.ceil(minBet / l) * l <= maxBet);
        expect(all.length > 0, `min ${minBet} max ${maxBet}`).toBe(possible);
        for (const b of all) {
          expect(SlotSpinSchema.safeParse(b).success).toBe(true);
          expect(b.lineBet * b.lines).toBeGreaterThanOrEqual(minBet);
          expect(b.lineBet * b.lines).toBeLessThanOrEqual(maxBet);
        }
        for (const lines of [1, 3, 5]) {
          const steps = slotLineBets({ minBet, maxBet }, lines);
          expect([...steps].sort((a, b) => a - b)).toEqual(steps);
        }
        for (const c of tableChips({ minBet, maxBet })) {
          expect(c).toBeGreaterThanOrEqual(minBet);
          expect(c).toBeLessThanOrEqual(maxBet);
        }
      }
    }
  });
});
