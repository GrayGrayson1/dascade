import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { bootTestServer } from './helpers.ts';
import { HighScoreService, highScores } from '../src/rooms/classics/highScores.ts';

describe('HighScoreService', () => {
  it('keeps one best entry per identity, ordered by score then time', () => {
    const hs = new HighScoreService();
    const a1 = hs.record('blocks', 'marathon', { identity: 'g:a', name: 'Ada', score: 500, level: 2, stat: 12 });
    expect(a1).toMatchObject({ rank: 1, improved: true });
    hs.record('blocks', 'marathon', { identity: 'g:b', name: 'Bob', score: 900, level: 3, stat: 20 });
    const worse = hs.record('blocks', 'marathon', { identity: 'g:a', name: 'Ada', score: 100, level: 1, stat: 1 });
    expect(worse).toEqual({ rank: null, entryId: null, improved: false });
    const better = hs.record('blocks', 'marathon', { identity: 'g:a', name: 'Ada', score: 1200, level: 4, stat: 30 });
    expect(better.rank).toBe(1);
    const top = hs.top('blocks', 'marathon');
    expect(top.entries.map((e) => [e.name, e.score])).toEqual([
      ['Ada', 1200],
      ['Bob', 900],
    ]);
    expect(JSON.stringify(top)).not.toContain('g:a');
    expect(hs.bestOf('blocks', 'marathon', 'g:b')).toBe(900);
    expect(hs.record('blocks', '', { identity: 'x', name: 'X', score: 5, level: 1, stat: 1 }).rank).toBeNull();
    expect(hs.record('blocks', 'marathon', { identity: 'x', name: 'X', score: 0, level: 1, stat: 1 }).rank).toBeNull();
    // Boards are independent.
    expect(hs.top('blocks', 'blitz-3').entries).toHaveLength(0);
  });
});

describe('HighScoreService persistence mirror', () => {
  it('hydrates a board once from the mirror and writes improvements back (never blocking)', async () => {
    const saved: Array<{ board: string; score: number }> = [];
    let loads = 0;
    const hs = new HighScoreService();
    hs.setPersistence({
      async load() {
        loads++;
        return [{ id: 'old1', identity: 'g:old', name: 'Legend', score: 5000, level: 9, stat: 80, at: 1 }];
      },
      async save(_g, board, entry) {
        saved.push({ board, score: entry.score });
      },
    });
    expect(hs.top('bricks', 'arcade').entries).toHaveLength(0); // first access starts the load
    await new Promise((r) => setTimeout(r, 0));
    expect(hs.top('bricks', 'arcade').entries[0]).toMatchObject({ name: 'Legend', score: 5000 });
    const res = hs.record('bricks', 'arcade', { identity: 'g:new', name: 'Rookie', score: 1200, level: 2, stat: 30 });
    expect(res.rank).toBe(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toEqual([{ board: 'arcade', score: 1200 }]);
    hs.top('bricks', 'arcade');
    expect(loads).toBe(1);
  });
});

describe('GET /api/classics/scores/:gameId', () => {
  let colyseus: ColyseusTestServer;
  let port: number;
  beforeAll(async () => {
    ({ colyseus, port } = await bootTestServer([]));
    highScores.reset();
    highScores.record('memory', 'classic', { identity: 'g:z', name: 'Zed', score: 777, level: 5, stat: 4 });
  });
  afterAll(async () => {
    highScores.reset();
    await colyseus.shutdown();
  });

  it('serves the default and named boards', async () => {
    const res = await fetch(`http://localhost:${port}/api/classics/scores/memory`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { board: string; entries: Array<{ name: string; score: number }> };
    expect(body.board).toBe('classic');
    expect(body.entries[0]).toMatchObject({ name: 'Zed', score: 777 });
    const empty = await fetch(`http://localhost:${port}/api/classics/scores/bricks?board=blitz-5`);
    expect(((await empty.json()) as { entries: unknown[] }).entries).toEqual([]);
  });

  it('refuses non-Classics games and malformed boards', async () => {
    expect((await fetch(`http://localhost:${port}/api/classics/scores/chess`)).status).toBe(404);
    expect((await fetch(`http://localhost:${port}/api/classics/scores/nope`)).status).toBe(404);
    expect((await fetch(`http://localhost:${port}/api/classics/scores/blocks?board=${encodeURIComponent('<script>')}`)).status).toBe(400);
  });
});
