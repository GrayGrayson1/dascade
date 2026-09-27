import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescedWriter } from './coalescedWriter.ts';

describe('createCoalescedWriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes only the last value of a burst, after the quiet period', async () => {
    const writes: number[] = [];
    const w = createCoalescedWriter(async (v: number) => void writes.push(v), 500);
    for (let v = 1; v <= 20; v++) {
      w.schedule(v / 20);
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toEqual([1]);
    expect(w.busy()).toBe(false);
  });

  it('never overlaps writes, so a slow request cannot land after a newer one', async () => {
    const log: string[] = [];
    const resolvers: Array<() => void> = [];
    const w = createCoalescedWriter(
      (v: string) =>
        new Promise<void>((resolve) => {
          log.push(`start ${v}`);
          resolvers.push(() => {
            log.push(`done ${v}`);
            resolve();
          });
        }),
      100,
    );
    w.schedule('a');
    await vi.advanceTimersByTimeAsync(100);
    w.schedule('b');
    await vi.advanceTimersByTimeAsync(100); // quiet period over, but 'a' is still in flight
    expect(log).toEqual(['start a']);
    resolvers.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['start a', 'done a', 'start b']);
    resolvers.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(['start a', 'done a', 'start b', 'done b']);
  });

  it('flush() writes the pending value immediately; a failed write does not wedge the queue', async () => {
    const writes: string[] = [];
    let fail = true;
    const w = createCoalescedWriter(async (v: string) => {
      if (fail) {
        fail = false;
        throw new Error('offline');
      }
      writes.push(v);
    }, 500);
    w.schedule('x');
    w.flush();
    await vi.advanceTimersByTimeAsync(0);
    w.schedule('y');
    w.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(['y']);
  });

  it('flush(true) does not wait for an in-flight write (page is going away)', async () => {
    const started: string[] = [];
    const w = createCoalescedWriter((v: string) => {
      started.push(v);
      return new Promise<void>(() => undefined); // never settles
    }, 500);
    w.schedule('first');
    w.flush();
    await vi.advanceTimersByTimeAsync(0);
    w.schedule('last');
    w.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['first']);
    w.flush(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['first', 'last']);
  });
});
