import { describe, expect, it } from 'vitest';
import { CLASSICS } from '@dascade/shared/games/classics';
import { decodeEvents, encodeEvents, type InputEvent } from '@dascade/game-core/classics/shared';
import { MAX_CARRY, takeTick } from './tickQueue.ts';

const CAP = CLASSICS.maxEventsPerTick;

/** Drive takeTick like VerifiedRunClient.step: returns the recorded log. */
function run(ticks: number[][], accept: (code: number) => boolean = () => true): InputEvent[] {
  const log: InputEvent[] = [];
  let carry: number[] = [];
  for (let tick = 0; tick < ticks.length || carry.length > 0; tick++) {
    const queue = [...carry, ...(ticks[tick] ?? [])];
    carry = takeTick(queue, (code) => {
      if (!accept(code)) return false;
      log.push({ tick, code });
      return true;
    });
    if (tick > 1000) throw new Error('backlog never drained');
  }
  return log;
}

describe('takeTick (verified-run flood guard, client side)', () => {
  it('applies everything when a tick is within the cap', () => {
    const applied: number[] = [];
    expect(takeTick([1, 2, 3], (c) => (applied.push(c), true))).toEqual([]);
    expect(applied).toEqual([1, 2, 3]);
  });

  it('never records more than the cap on one tick; the rest carries over in order', () => {
    const burst = [2, 1, 2, 4, 3, 4, 6, 5, 6, 7, 8]; // what a stalled frame can sample (> cap)
    const log = run([burst]);
    const perTick = new Map<number, number>();
    for (const ev of log) perTick.set(ev.tick, (perTick.get(ev.tick) ?? 0) + 1);
    expect(Math.max(...perTick.values())).toBeLessThanOrEqual(CAP);
    expect(log.map((e) => e.code)).toEqual(burst);
    // The server's structural check accepts the resulting log.
    const upTo = log[log.length - 1]!.tick + 1;
    expect(decodeEvents(encodeEvents(log, 0), 0, upTo, 10)).toMatchObject({ ok: true });
  });

  it('refused codes do not use the budget', () => {
    const log = run([[9, 9, 9, 9, 9, 9, 9, 9, 9, 1, 2]], (c) => c !== 9);
    expect(log).toEqual([
      { tick: 0, code: 1 },
      { tick: 0, code: 2 },
    ]);
  });

  it('collapses back-to-back repeats in the carried part and bounds the backlog', () => {
    const queue = [...Array.from({ length: CAP }, (_, i) => i + 1), 7, 7, 7, 8, 8];
    expect(takeTick(queue, () => true)).toEqual([7, 8]);
    const huge = Array.from({ length: CAP + MAX_CARRY * 2 }, (_, i) => i % 5);
    const rest = takeTick(huge, () => true);
    expect(rest).toHaveLength(MAX_CARRY);
    expect(rest[rest.length - 1]).toBe(huge[huge.length - 1]);
  });
});
