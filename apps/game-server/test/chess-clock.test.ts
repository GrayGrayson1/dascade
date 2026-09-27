/** DAS Boardroom kit — ServerClock unit tests (fake scheduler + fake time; no room needed). */
import { describe, expect, it } from 'vitest';
import { clockRemaining, type BoardClockView, type BoardSide } from '@dascade/shared/games/boardroom';
import { FLAG_GRACE_MS, ServerClock } from '../src/rooms/boardroom/clock.ts';
import { BoardClockState } from '../src/rooms/boardroom/schema.ts';

function harness(baseMs: number, incrementMs = 0) {
  let now = 1_000_000;
  const timers = new Map<string, { at: number; fn: () => void }>();
  const flags: BoardSide[] = [];
  const view = new BoardClockState();
  const clock = new ServerClock(
    view,
    {
      schedule: (key, ms, fn) => timers.set(key, { at: now + ms, fn }),
      cancel: (key) => timers.delete(key),
    },
    (side) => flags.push(side),
    () => now,
  );
  clock.configure({ baseMs, incrementMs });
  const advance = (ms: number) => {
    now += ms;
    for (const [key, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(key);
        t.fn();
      }
    }
  };
  const json = () => view.toJSON() as unknown as BoardClockView;
  return { clock, view, flags, advance, timers, now: () => now, json };
}

describe('ServerClock', () => {
  it('runs only the side to move and adds the Fischer increment after each move', () => {
    const h = harness(60_000, 2_000);
    h.clock.start('first');
    h.advance(5_000);
    expect(h.clock.remaining('first')).toBe(55_000);
    expect(h.clock.remaining('second')).toBe(60_000);
    h.clock.switchAfterMove('first');
    expect(h.view.firstMs).toBe(57_000);
    expect(h.view.running).toBe('second');
    h.advance(10_000);
    expect(h.clock.remaining('second')).toBe(50_000);
    expect(h.clock.remaining('first')).toBe(57_000);
    // The published view extrapolates the same way on clients.
    expect(clockRemaining(h.json(), 'second', h.now())).toBe(50_000);
    expect(clockRemaining(h.json(), 'first', h.now())).toBe(57_000);
  });

  it('flags on the scheduled timer at the flag moment plus the network grace', () => {
    const h = harness(1_000);
    h.clock.start('first');
    h.advance(1_000);
    expect(h.flags).toEqual([]);
    expect(h.clock.overdue()).toBeNull(); // within the grace
    h.advance(FLAG_GRACE_MS);
    expect(h.flags).toEqual(['first']);
    expect(h.view.flagged).toBe('first');
    expect(h.view.firstMs).toBe(0);
    expect(h.view.running).toBe('');
  });

  it('reports overdue before a late timer fires, and accepts a move inside the grace (floored at 0)', () => {
    const h = harness(1_000, 500);
    h.clock.start('first');
    h.advance(1_000 + FLAG_GRACE_MS / 2);
    expect(h.clock.overdue()).toBeNull();
    h.clock.switchAfterMove('first');
    expect(h.view.firstMs).toBe(500); // 0 + increment
    const late = harness(1_000);
    late.clock.start('first');
    // Simulate a delayed timer: time passes but no tick runs.
    late.timers.clear();
    late.advance(1_000 + FLAG_GRACE_MS + 1);
    expect(late.clock.overdue()).toBe('first');
  });

  it('stop() charges the running side; handTo() moves the clock without increment; untimed never runs', () => {
    const h = harness(30_000, 5_000);
    h.clock.start('first');
    h.advance(4_000);
    h.clock.handTo('second');
    expect(h.view.firstMs).toBe(26_000);
    expect(h.view.running).toBe('second');
    h.advance(1_000);
    h.clock.stop();
    expect(h.view.secondMs).toBe(29_000);
    expect(h.view.running).toBe('');
    expect(h.timers.size).toBe(0);

    const u = harness(0);
    expect(u.view.enabled).toBe(false);
    u.clock.start('first');
    u.advance(10 * 60_000);
    expect(u.view.running).toBe('');
    expect(u.flags).toEqual([]);
    expect(u.clock.overdue()).toBeNull();
  });

  it('re-arms instead of flagging when the timer fires early', () => {
    const h = harness(2_000);
    h.clock.start('first');
    const t = [...h.timers.values()][0]!;
    t.fn(); // fire "early" (time has not advanced)
    expect(h.flags).toEqual([]);
    expect(h.timers.size).toBe(1);
    h.advance(2_000 + FLAG_GRACE_MS);
    expect(h.flags).toEqual(['first']);
  });
});
