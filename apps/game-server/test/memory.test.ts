import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { GameOutcome } from '@dascade/shared';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import { MEMORY_MSG, type MemoryFeedback, type MemoryPatternMsg, type MemoryReveal, type MemoryYou } from '@dascade/shared/games/memory';
import { bootTestServer, collect, sleep, waitFor } from './helpers.ts';
import { wireClassics, type ClassicsClient } from './classicsBot.ts';
import { onOutcome } from '../src/platform/hub.ts';
import { highScores } from '../src/rooms/classics/highScores.ts';
import type { MemoryRoom } from '../src/rooms/memory/MemoryRoom.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['memory']));
});
afterEach(async () => {
  await colyseus.cleanup();
  highScores.reset();
});
afterAll(async () => {
  await colyseus.shutdown();
});

interface MemClient extends ClassicsClient {
  patterns: MemoryPatternMsg[];
  feedback: MemoryFeedback[];
  reveals: MemoryReveal[];
  yous: MemoryYou[];
}

const st = (c: ClassicsClient) => c.room.state as any;

function fast(server: MemoryRoom): void {
  const s = server as any;
  s.introMs = 60;
  s.reviewMs = 60;
  s.showLeadMs = 10;
  s.firstRoundDelayMs = 30;
  s.countdownMs = 100;
  s.resultsDelayMs = 30;
}

function wireMem(room: any): MemClient {
  const patterns = collect<MemoryPatternMsg>(room, MEMORY_MSG.pattern);
  const feedback = collect<MemoryFeedback>(room, MEMORY_MSG.feedback);
  const reveals = collect<MemoryReveal>(room, MEMORY_MSG.reveal);
  const yous = collect<MemoryYou>(room, MEMORY_MSG.you);
  return { ...wireClassics(room), patterns, feedback, reveals, yous };
}

async function create(extra: Record<string, unknown> = {}, name = 'Ada') {
  const room = await colyseus.sdk.create('memory', { name, ...extra });
  const client = wireMem(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as MemoryRoom;
  fast(server);
  return { ...client, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const client = wireMem(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  return client;
}

async function waitStage(c: MemClient, stage: string, round?: number, timeout = 8000) {
  await waitFor(() => st(c).stage === stage && (round === undefined || st(c).round === round), timeout, `${stage} ${round ?? ''}`);
}

/** Answer the current round: correctly, or with a deliberate mistake. */
async function answer(c: MemClient, round: number, correct: boolean) {
  await waitFor(() => c.patterns.some((p) => p.round === round), 8000, `pattern ${round}`);
  const p = c.patterns.find((x) => x.round === round)!;
  await waitStage(c, 'input', round);
  if (correct) {
    for (const tile of p.tiles) c.room.send(MEMORY_MSG.tap, { round, tile });
  } else {
    // A tile that isn't in the pattern is wrong for both kinds (sequence: not the first tile either).
    const wrong = [...Array(p.size * p.size).keys()].find((t) => !p.tiles.includes(t))!;
    c.room.send(MEMORY_MSG.tap, { round, tile: wrong });
  }
}

describe('Memory Matrix — solo', () => {
  it('plays server-generated rounds, judges taps privately and ends after three misses', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    await answer(host, 1, true);
    await waitFor(() => host.feedback.some((f) => f.round === 1 && f.done), 3000, 'round 1 done');
    expect(host.feedback.filter((f) => f.round === 1).every((f) => f.ok)).toBe(true);
    await waitFor(() => host.reveals.some((r) => r.round === 1), 3000, 'reveal 1');
    expect(host.reveals.find((r) => r.round === 1)!.results[me]).toBe('done');
    await waitFor(() => st(host).standings.get(me).stat === 1, 2000, 'standing synced');
    expect(st(host).standings.get(me).score).toBeGreaterThan(100);

    // Pattern is never in public state.
    expect(JSON.stringify(st(host).toJSON())).not.toContain('"tiles"');

    for (const r of [2, 3, 4]) await answer(host, r, false);
    await waitFor(() => st(host).standings.get(me)?.status === 'over', 6000, 'over');
    const s = st(host).standings.get(me);
    expect(s.lives).toBe(0);
    expect(s.stat).toBe(1);
    await waitFor(() => host.verdicts.length > 0, 2000, 'verdict');
    const v: RunVerdict = host.verdicts.at(-1)!;
    expect(v.score).toBe(s.score);
    expect(v.rank).toBe(1);
    expect(highScores.top('memory', 'classic').entries[0]?.score).toBe(s.score);
  });

  it('ignores taps outside the input window, for other rounds and off the grid; times out silent players', async () => {
    const host = await create({ solo: true, settings: { rule: 'sudden', variant: 'sequence' } });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    expect(st(host).classics.board).toBe('sequence-sudden');
    host.room.send(CLASSICS_MSG.start, {});
    await waitStage(host, 'show', 1);
    host.room.send(MEMORY_MSG.tap, { round: 1, tile: 0 }); // too early
    await waitStage(host, 'input', 1);
    host.room.send(MEMORY_MSG.tap, { round: 2, tile: 0 }); // wrong round
    host.room.send(MEMORY_MSG.tap, { round: 1, tile: 24 }); // off a 3×3 grid
    await sleep(80);
    expect(host.feedback).toHaveLength(0);
    // Say nothing: the window closes on the server timer; sudden death = out.
    (host.server as any).cancel('memory:stage');
    (host.server as any).closeInput();
    await waitFor(() => st(host).standings.get(me)?.status === 'over', 3000, 'timed out');
    expect(st(host).standings.get(me).lives).toBe(0);
  });

  it('re-sends private progress after a reconnect', async () => {
    const host = await create({ solo: true, settings: { variant: 'sequence', rule: 'lives' } });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => host.patterns.some((p) => p.round === 1), 5000, 'pattern');
    const p = host.patterns.find((x) => x.round === 1)!;
    // Keep the input window open long enough.
    await waitStage(host, 'input', 1);
    (host.server as any).schedule('memory:stage', 60_000, () => (host.server as any).closeInput());
    host.room.send(MEMORY_MSG.tap, { round: 1, tile: p.tiles[0] });
    await waitFor(() => host.feedback.length === 1, 2000, 'first tap');
    host.room.reconnection.minUptime = 0;
    const back = new Promise<void>((r) => host.room.onReconnect(() => r()));
    const before = host.yous.length;
    (host.room as any).connection.transport.ws.close(4010);
    await back;
    await waitFor(() => host.yous.length > before, 3000, 'you');
    expect(host.yous.at(-1)).toMatchObject({ round: 1, progress: 1, found: [p.tiles[0]], state: 'input' });
  });
});

describe('Memory Matrix — multiplayer', () => {
  it('synchronized rounds: same pattern for everyone, private feedback, spectators get no feedback, ranking by score', async () => {
    const outcomes: GameOutcome[] = [];
    const off = onOutcome((o) => outcomes.push(o));
    try {
      const host = await create({ settings: { rule: 'sudden', variant: 'mixed' } }, 'Host');
      const guest = await join(host.room.roomId, 'Guest');
      const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
      host.room.send('lobby:start', {});
      await waitFor(() => st(host).phase === 'PLAYING', 4000, 'playing');
      // Round 1: both right. Round 2: guest misses (out), host right. Round 3: host misses.
      await Promise.all([answer(host, 1, true), answer(guest, 1, true)]);
      await waitFor(() => guest.patterns.some((p) => p.round === 1) && host.patterns.some((p) => p.round === 1), 3000, 'patterns');
      expect(host.patterns[0]!.tiles).toEqual(guest.patterns[0]!.tiles);
      expect(watcher.patterns[0]!.tiles).toEqual(host.patterns[0]!.tiles);
      await Promise.all([answer(host, 2, true), answer(guest, 2, false)]);
      await waitFor(() => st(host).standings.get(guest.me().playerId)?.status === 'over', 6000, 'guest out');
      expect(st(host).marks.get(guest.me().playerId).state).toBe('out');
      await answer(host, 3, false);
      await waitFor(() => st(host).phase === 'RESULTS', 6000, 'results');
      expect(watcher.feedback).toHaveLength(0);
      expect(host.feedback.every((f) => f.round >= 1)).toBe(true);
      expect(guest.feedback.length).toBeGreaterThan(0);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]!.placements).toEqual([[host.me().playerId], [guest.me().playerId]]);
      expect(st(host).standings.get(host.me().playerId).rank).toBe(1);
    } finally {
      off();
    }
  });

  it('duplicate taps never double-score; a leaver is placed last and never stalls the match', async () => {
    const outcomes: GameOutcome[] = [];
    const off = onOutcome((o) => outcomes.push(o));
    try {
      const host = await create({ settings: { rule: 'sudden', variant: 'flash' } }, 'Host');
      const guest = await join(host.room.roomId, 'Leaver');
      const guestId = guest.me().playerId;
      host.room.send('lobby:start', {});
      await waitFor(() => host.patterns.some((p) => p.round === 1), 6000, 'pattern');
      const p = host.patterns[0]!;
      await waitStage(host, 'input', 1);
      (host.server as any).schedule('memory:stage', 60_000, () => (host.server as any).closeInput());
      host.room.send(MEMORY_MSG.tap, { round: 1, tile: p.tiles[0] });
      host.room.send(MEMORY_MSG.tap, { round: 1, tile: p.tiles[0] });
      await waitFor(() => host.feedback.length >= 1, 2000, 'feedback');
      await sleep(100);
      expect(host.feedback).toHaveLength(1);
      expect(st(host).standings.get(host.me().playerId).score).toBe(10);
      await guest.room.leave();
      await waitFor(() => st(host).standings.get(guestId)?.status === 'out', 3000, 'guest out');
      for (const tile of p.tiles.slice(1)) host.room.send(MEMORY_MSG.tap, { round: 1, tile });
      // Host fails round 2 on purpose.
      await answer(host, 2, false);
      await waitFor(() => st(host).phase === 'RESULTS', 6000, 'results');
      expect(outcomes[0]!.placements).toEqual([[host.me().playerId], [guestId]]);
    } finally {
      off();
    }
  });

  it('head-to-head with equal scores is a draw', async () => {
    const outcomes: GameOutcome[] = [];
    const off = onOutcome((o) => outcomes.push(o));
    try {
      const host = await create({ settings: { rule: 'sudden', variant: 'sequence' } }, 'A');
      const guest = await join(host.room.roomId, 'B');
      host.room.send('lobby:start', {});
      await waitFor(() => st(host).phase === 'PLAYING', 4000, 'playing');
      await Promise.all([answer(host, 1, false), answer(guest, 1, false)]);
      await waitFor(() => st(host).phase === 'RESULTS', 6000, 'results');
      expect(outcomes[0]!.placements).toHaveLength(1);
      expect([...outcomes[0]!.placements[0]!].sort()).toEqual([host.me().playerId, guest.me().playerId].sort());
    } finally {
      off();
    }
  });
});
