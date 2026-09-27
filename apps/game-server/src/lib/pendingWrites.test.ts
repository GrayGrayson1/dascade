import { describe, expect, it } from 'vitest';
import { drainWrites, pendingWriteCount, trackWrite } from './pendingWrites.ts';

const later = <T>(ms: number, value: T, fail = false) =>
  new Promise<T>((resolve, reject) => setTimeout(() => (fail ? reject(new Error('db down')) : resolve(value)), ms));

describe('pending writes (shutdown drain)', () => {
  it('waits for tracked writes and started flushes; failures still count as settled', async () => {
    let flushed = false;
    void trackWrite(later(20, 'a'));
    trackWrite(later(10, 'b', true)).catch(() => undefined);
    expect(pendingWriteCount()).toBe(2);
    const settled = await drainWrites(1000, [
      async () => {
        await later(15, null);
        flushed = true;
      },
      () => {
        throw new Error('sync failure');
      },
    ]);
    expect(settled).toBe(true);
    expect(flushed).toBe(true);
    expect(pendingWriteCount()).toBe(0);
  });

  it('never waits longer than the bound', async () => {
    void trackWrite(later(500, 'slow'));
    const start = Date.now();
    expect(await drainWrites(30)).toBe(false);
    expect(Date.now() - start).toBeLessThan(300);
  });
});
