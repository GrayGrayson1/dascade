import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { GameOutcome } from '@dascade/shared';
import { CLASSICS, CLASSICS_MSG, type HighScoreBoardView, type RunTicket } from '@dascade/shared/games/classics';
import { CODE, MAX_CODE, createBlocksSim, type BlocksSim } from '@dascade/game-core/blocks';
import { decodeEvents, seeded } from '@dascade/game-core/classics/shared';
import { bootTestServer, sleep, waitFor } from './helpers.ts';
import { nextTicket, playRun, waitVerdict, wireClassics, type ClassicsClient } from './classicsBot.ts';
import { onOutcome } from '../src/platform/hub.ts';
import { highScores } from '../src/rooms/classics/highScores.ts';
import type { BlocksRoom } from '../src/rooms/blocks/BlocksRoom.ts';

let colyseus: ColyseusTestServer;
let port: number;

beforeAll(async () => {
  ({ colyseus, port } = await bootTestServer(['blocks']));
});
afterEach(async () => {
  await colyseus.cleanup();
  highScores.reset();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const st = (c: ClassicsClient) => c.room.state as any;

async function create(extra: Record<string, unknown> = {}, name = 'Ada') {
  const room = await colyseus.sdk.create('blocks', { name, ...extra });
  const client = wireClassics(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as BlocksRoom;
  (server as any).soloLeadMs = 0;
  (server as any).countdownMs = 150;
  (server as any).resultsDelayMs = 50;
  return { ...client, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const client = wireClassics(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  return client;
}

/** Let a bot run far ahead of real time (tests only): move the run clock into the past. */
function unthrottle(server: BlocksRoom, playerId: string): void {
  const run = (server as any).runs.get(playerId);
  run.startAt = Date.now() - 30 * 60_000;
}

/** Drops a piece every few ticks with a little random shuffling: tops out in a few hundred pieces at most. */
function dropper(seed: string, rate = 6) {
  const rng = seeded(seed);
  return (sim: BlocksSim) => {
    if (sim.tick % rate !== 0) return [];
    const r = rng.int(10);
    if (r < 3) return [CODE.leftDown, CODE.leftUp, CODE.hardDrop];
    if (r < 6) return [CODE.rightDown, CODE.rightUp, CODE.hardDrop];
    if (r < 8) return [CODE.rotateCW, CODE.hardDrop];
    return [CODE.hardDrop];
  };
}

/** Moves each new piece to a different column (round robin) and lets gravity drop it. */
function spreader(softFirst = false) {
  const offsets = [-3, 3, -1, 1, -4, 4, -2, 2, 0];
  let seen = -1;
  let n = 0;
  return (sim: BlocksSim) => {
    const codes: number[] = [];
    if (softFirst && sim.tick === 0) codes.push(CODE.softDown);
    if (softFirst && sim.tick === 30) codes.push(CODE.softUp);
    if (sim.piece && sim.pieces !== seen) {
      seen = sim.pieces;
      const off = offsets[n++ % offsets.length]!;
      for (let i = 0; i < Math.abs(off); i++) codes.push(off < 0 ? CODE.leftDown : CODE.rightDown, off < 0 ? CODE.leftUp : CODE.rightUp);
    }
    return codes;
  };
}

describe('Block Drop — solo verified runs', () => {
  it('starts instantly, issues a private ticket on Start, and verifies the replayed run', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).phase === 'PLAYING', 3000, 'auto start');
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    expect(st(host).classics.solo).toBe(true);
    expect(host.tickets).toHaveLength(0);

    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    expect(ticket.seed.length).toBeGreaterThan(8);
    expect(ticket.board).toBe('marathon');
    await waitFor(() => st(host).standings.get(me)?.status === 'playing', 3000, 'playing');
    unthrottle(host.server, me);

    const { sim } = await playRun(host, ticket, createBlocksSim, { policy: dropper('solo') });
    expect(sim.over).toBe(true);
    const verdict = await waitVerdict(host, ticket.runId);
    expect(verdict.reason).toBe('over');
    expect(verdict.score).toBe(sim.score);
    expect(verdict.stat).toBe(sim.lines);
    expect(verdict.lives).toBe(0);
    expect(verdict.ticks).toBe(sim.tick);
    expect(verdict.rank).toBe(1);
    const standing = st(host).standings.get(me);
    await waitFor(() => st(host).standings.get(me)?.status === 'over', 2000, 'over');
    expect(standing.score).toBe(sim.score);
    expect(standing.best).toBe(sim.score);

    // Only verified results reach the public board.
    const res = await fetch(`http://localhost:${port}/api/classics/scores/blocks?board=marathon`);
    const board = (await res.json()) as HighScoreBoardView;
    expect(board.entries[0]).toMatchObject({ name: 'Ada', score: sim.score, stat: sim.lines, id: verdict.entryId });
    expect(JSON.stringify(board)).not.toContain(me);

    // Retry = a fresh run with a fresh seed, still inside PLAYING.
    host.room.send(CLASSICS_MSG.start, {});
    const again = await nextTicket(host, 1);
    expect(again.runId).not.toBe(ticket.runId);
    expect(again.seed).not.toBe(ticket.seed);
    await waitFor(() => st(host).standings.get(me)?.runs === 2, 2000, 'second run');
    expect(st(host).phase).toBe('PLAYING');
  });

  it('rejects a tampered log (invalid code) and never records it', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    unthrottle(host.server, me);
    host.room.send(CLASSICS_MSG.input, { runId: ticket.runId, seq: 1, upTo: 30, events: [5, CODE.hardDrop, 3, MAX_CODE + 7] });
    const verdict = await waitVerdict(host, ticket.runId);
    expect(verdict.reason).toBe('rejected');
    expect(verdict.rank).toBeNull();
    expect(highScores.top('blocks', 'marathon').entries).toHaveLength(0);
  });

  it('a client claiming scores it did not earn gets the server replay instead', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    unthrottle(host.server, me);
    // No inputs at all, then "final" with a huge claimed score.
    host.room.send(CLASSICS_MSG.input, { runId: ticket.runId, seq: 1, upTo: 120, events: [], final: true, clientScore: 999_999 });
    const verdict = await waitVerdict(host, ticket.runId);
    expect(verdict.score).toBe(0);
    expect(st(host).standings.get(me).score).toBe(0);
  });

  it('throttles a sped-up client to real time (resync) and ignores duplicate batches', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    // Far ahead of the wall clock: refused with a resync ack, nothing applied.
    host.room.send(CLASSICS_MSG.input, { runId: ticket.runId, seq: 1, upTo: 60 * 60, events: [0, CODE.hardDrop] });
    await waitFor(() => host.acks.some((a) => a.resync), 2000, 'resync');
    expect(host.acks.at(-1)).toMatchObject({ runId: ticket.runId, seq: 0, upTo: 0, resync: true });
    expect(st(host).standings.get(me).score).toBe(0);
    // A legitimate batch, then the same batch again: applied once.
    unthrottle(host.server, me);
    const batch = { runId: ticket.runId, seq: 1, upTo: 10, events: [2, CODE.hardDrop] };
    host.room.send(CLASSICS_MSG.input, batch);
    host.room.send(CLASSICS_MSG.input, batch);
    await waitFor(() => st(host).standings.get(me).score > 0, 2000, 'scored');
    const score = st(host).standings.get(me).score;
    await sleep(150);
    expect(st(host).standings.get(me).score).toBe(score);
    expect((host.server as any).runs.get(me).ackSeq).toBe(1);
  });

  it('resends the verified log after a reconnect so the client can resume', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    unthrottle(host.server, me);
    const { sim } = await playRun(host, ticket, createBlocksSim, { policy: spreader(), stopAt: 600 });
    expect(sim.over).toBe(false);
    await waitFor(() => (host.server as any).runs.get(me).upTo === 600, 3000, 'verified 600');

    host.room.reconnection.minUptime = 0;
    const back = new Promise<void>((r) => host.room.onReconnect(() => r()));
    const before = host.tickets.length;
    (host.room as any).connection.transport.ws.close(4010);
    await back;
    const resumed: RunTicket = await nextTicket(host, before);
    expect(resumed.runId).toBe(ticket.runId);
    expect(resumed.resume?.upTo).toBe(600);
    // Rebuilding from the resume log reproduces the local state exactly.
    const decoded = decodeEvents(resumed.resume!.events, 0, 600, MAX_CODE);
    expect(decoded.ok).toBe(true);
    const rebuilt = createBlocksSim(resumed.seed, resumed.options);
    if (decoded.ok) {
      let i = 0;
      while (rebuilt.tick < 600) {
        while (i < decoded.events.length && decoded.events[i]!.tick === rebuilt.tick) rebuilt.input(decoded.events[i++]!.code);
        rebuilt.step();
      }
    }
    expect(rebuilt.preview()).toBe(sim.preview());
    expect(rebuilt.score).toBe(sim.score);
  });

  it('quit abandons the run without recording and returns to the start card', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    await nextTicket(host);
    host.room.send(CLASSICS_MSG.quit, {});
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 2000, 'back to ready');
    expect(highScores.top('blocks', 'marathon').entries).toHaveLength(0);
  });

  it('solo players can switch to Blitz between runs; blitz runs end on the tick limit', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send('lobby:settings', { settings: { mode: 'blitz', blitzSeconds: 120 } });
    await waitFor(() => st(host).classics.board === 'blitz-2', 2000, 'blitz board');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    expect(ticket.limitTicks).toBe(120 * CLASSICS.tickHz);
    expect(ticket.board).toBe('blitz-2');
    unthrottle(host.server, me);
    // Patient player: spreads pieces across the well at gravity speed — never tops out in 2 minutes.
    const { sim } = await playRun(host, ticket, createBlocksSim, { policy: spreader(true) });
    expect(sim.over).toBe(false);
    const verdict = await waitVerdict(host, ticket.runId);
    expect(verdict.ticks).toBe(120 * CLASSICS.tickHz);
    expect(['time', 'over']).toContain(verdict.reason);
    expect(verdict.score).toBe(sim.score);
    expect(highScores.top('blocks', 'blitz-2').entries[0]?.score).toBe(sim.score);
  });

  it('a higher start level (it multiplies scores) files runs on its own board', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send('lobby:settings', { settings: { startLevel: 5 } });
    await waitFor(() => st(host).classics.board === 'marathon-l5', 2000, 'level board');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    expect(ticket.board).toBe('marathon-l5');
    expect(ticket.options).toMatchObject({ startLevel: 5 });
    unthrottle(host.server, me);
    const { sim } = await playRun(host, ticket, createBlocksSim, { policy: dropper('lvl5') });
    const verdict = await waitVerdict(host, ticket.runId);
    expect(verdict.board).toBe('marathon-l5');
    expect(verdict.score).toBe(sim.score);
    expect(highScores.top('blocks', 'marathon').entries).toHaveLength(0);
    expect(highScores.top('blocks', 'marathon-l5').entries[0]?.score).toBe(sim.score);
  });
});

describe('Block Drop — multiplayer score race', () => {
  it('gives everyone the same seed, keeps tickets private, ranks by verified score and reports the outcome', async () => {
    const outcomes: GameOutcome[] = [];
    const off = onOutcome((o) => outcomes.push(o));
    try {
      const host = await create({}, 'Host');
      const guest = await join(host.room.roomId, 'Guest');
      const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
      host.room.send('lobby:start', {});
      const t1 = await nextTicket(host);
      const t2 = await nextTicket(guest);
      expect(t1.seed).toBe(t2.seed);
      expect(t1.runId).not.toBe(t2.runId);
      await waitFor(() => st(host).classics.matchNo === t1.matchNo, 2000, 'matchNo');
      await sleep(100);
      expect(watcher.tickets).toHaveLength(0);
      expect(host.tickets).toHaveLength(1);
      expect(guest.tickets).toHaveLength(1);
      await waitFor(() => st(host).phase === 'PLAYING', 3000, 'playing');
      unthrottle(host.server, host.me().playerId);
      unthrottle(host.server, guest.me().playerId);

      // Spectators can't send runs.
      watcher.room.send(CLASSICS_MSG.input, { runId: t1.runId, seq: 1, upTo: 10, events: [0, CODE.hardDrop] });

      const [a, b] = await Promise.all([
        playRun(host, t1, createBlocksSim, { policy: dropper('host-strategy', 7) }),
        playRun(guest, t2, createBlocksSim, { policy: dropper('guest-strategy', 5) }),
      ]);
      await waitFor(() => st(host).phase === 'RESULTS', 8000, 'results');
      const hostId = host.me().playerId;
      const guestId = guest.me().playerId;
      expect(st(host).standings.get(hostId).score).toBe(a.sim.score);
      expect(st(host).standings.get(guestId).score).toBe(b.sim.score);
      expect(outcomes).toHaveLength(1);
      const expected = a.sim.score === b.sim.score ? [[hostId, guestId]] : a.sim.score > b.sim.score ? [[hostId], [guestId]] : [[guestId], [hostId]];
      expect(outcomes[0]!.placements.map((g) => [...g].sort())).toEqual(expected.map((g) => [...g].sort()));
      expect(outcomes[0]!.scores).toMatchObject({ [hostId]: a.sim.score, [guestId]: b.sim.score });
      const winner = expected[0]![0]!;
      expect(st(host).standings.get(winner).rank).toBe(1);
      // Multiplayer players can't restart runs on their own.
      host.room.send(CLASSICS_MSG.start, {});
      await sleep(100);
      expect(host.tickets).toHaveLength(1);
    } finally {
      off();
    }
  });

  it('a player who leaves mid-race is placed last and never stalls the match', async () => {
    const outcomes: GameOutcome[] = [];
    const off = onOutcome((o) => outcomes.push(o));
    try {
      const host = await create({}, 'Host');
      const guest = await join(host.room.roomId, 'Quitter');
      const guestId = guest.me().playerId;
      host.room.send('lobby:start', {});
      const t1 = await nextTicket(host);
      await nextTicket(guest);
      await waitFor(() => st(host).phase === 'PLAYING', 3000, 'playing');
      await guest.room.leave();
      await waitFor(() => st(host).standings.get(guestId)?.status === 'out', 3000, 'out');
      unthrottle(host.server, host.me().playerId);
      await playRun(host, t1, createBlocksSim, { policy: dropper('solo-left', 6) });
      await waitFor(() => st(host).phase === 'RESULTS', 6000, 'results');
      expect(outcomes[0]!.placements).toEqual([[host.me().playerId], [guestId]]);
    } finally {
      off();
    }
  });

  it('a player who finished their run and then leaves keeps their verified place', async () => {
    const outcomes: GameOutcome[] = [];
    const off = onOutcome((o) => outcomes.push(o));
    try {
      const host = await create({}, 'Host');
      const guest = await join(host.room.roomId, 'Early');
      const hostId = host.me().playerId;
      const guestId = guest.me().playerId;
      host.room.send('lobby:start', {});
      const t1 = await nextTicket(host);
      const t2 = await nextTicket(guest);
      await waitFor(() => st(host).phase === 'PLAYING', 3000, 'playing');
      unthrottle(host.server, hostId);
      unthrottle(host.server, guestId);
      const b = await playRun(guest, t2, createBlocksSim, { policy: dropper('early-finisher', 5) });
      await waitFor(() => st(host).standings.get(guestId)?.status === 'over', 4000, 'guest run over');
      await guest.room.leave();
      await sleep(150);
      expect(st(host).standings.get(guestId)?.status).toBe('over');
      const a = await playRun(host, t1, createBlocksSim, { policy: dropper('late-finisher', 7) });
      await waitFor(() => st(host).phase === 'RESULTS', 8000, 'results');
      const expected = a.sim.score === b.sim.score ? [[hostId, guestId]] : a.sim.score > b.sim.score ? [[hostId], [guestId]] : [[guestId], [hostId]];
      expect(outcomes[0]!.placements.map((g) => [...g].sort())).toEqual(expected.map((g) => [...g].sort()));
      expect(outcomes[0]!.scores).toMatchObject({ [guestId]: b.sim.score });
    } finally {
      off();
    }
  });

  it('host rematch starts a new match with a new shared seed', async () => {
    const host = await create({}, 'Host');
    const guest = await join(host.room.roomId, 'Guest');
    host.room.send('lobby:start', {});
    const t1 = await nextTicket(host);
    const g1 = await nextTicket(guest);
    await waitFor(() => st(host).phase === 'PLAYING', 3000, 'playing');
    unthrottle(host.server, host.me().playerId);
    unthrottle(host.server, guest.me().playerId);
    await Promise.all([playRun(host, t1, createBlocksSim, { policy: dropper('x', 4) }), playRun(guest, g1, createBlocksSim, { policy: dropper('y', 4) })]);
    await waitFor(() => st(host).phase === 'RESULTS', 6000, 'results');
    guest.room.send(CLASSICS_MSG.rematch, {});
    await sleep(100);
    expect(st(host).phase).toBe('RESULTS');
    host.room.send(CLASSICS_MSG.rematch, {});
    const t2 = await nextTicket(host, 1);
    expect(t2.seed).not.toBe(t1.seed);
    expect(t2.matchNo).toBe(t1.matchNo + 1);
    await waitFor(() => st(host).phase === 'PLAYING', 3000, 'playing again');
  });

  it('publishes live stack previews for rivals and spectators', async () => {
    const host = await create({}, 'Host');
    const guest = await join(host.room.roomId, 'Guest');
    host.room.send('lobby:start', {});
    const t1 = await nextTicket(host);
    await nextTicket(guest);
    await waitFor(() => st(host).phase === 'PLAYING', 3000, 'playing');
    unthrottle(host.server, host.me().playerId);
    await playRun(host, t1, createBlocksSim, { policy: dropper('preview', 8), stopAt: 300 });
    await waitFor(() => typeof st(guest).boards.get(host.me().playerId) === 'string', 3000, 'preview');
    expect(st(guest).boards.get(host.me().playerId)).toMatch(/^[0-7]{200}$/);
  });
});
