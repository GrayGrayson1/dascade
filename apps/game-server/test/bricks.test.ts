import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { GameOutcome } from '@dascade/shared';
import { CLASSICS, CLASSICS_MSG } from '@dascade/shared/games/classics';
import { CODE, FIELD_W, MAX_CODE, createBricksSim, type BricksSim } from '@dascade/game-core/bricks';
import { bootTestServer, sleep, waitFor } from './helpers.ts';
import { nextTicket, playRun, waitVerdict, wireClassics, type ClassicsClient } from './classicsBot.ts';
import { onOutcome } from '../src/platform/hub.ts';
import { highScores } from '../src/rooms/classics/highScores.ts';
import type { BricksRoom } from '../src/rooms/bricks/BricksRoom.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['bricks']));
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
  const room = await colyseus.sdk.create('bricks', { name, ...extra });
  const client = wireClassics(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as BricksRoom;
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

function unthrottle(server: BricksRoom, playerId: string): void {
  (server as any).runs.get(playerId).startAt = Date.now() - 30 * 60_000;
}

/** Tracks the ball (with a per-bot lean) so bots break bricks before they run out of lives. */
function tracker(lean: number) {
  let last = -1;
  return (sim: BricksSim) => {
    const codes: number[] = [];
    const falling = sim.balls.filter((b) => !b.stuck && b.vy > 0).sort((a, b) => b.y - a.y)[0] ?? sim.balls[0];
    if (falling) {
      const x = Math.max(0, Math.min(FIELD_W, Math.round(falling.x + lean)));
      if (x !== last) {
        codes.push(x);
        last = x;
      }
    }
    if (sim.phase === 'serve' && sim.tick % 20 === 0) codes.push(CODE.action);
    return codes;
  };
}

/** Parks the paddle in a corner: loses every life quickly. */
function loser() {
  return (sim: BricksSim) => (sim.tick === 0 ? [0, CODE.action] : sim.phase === 'serve' && sim.tick % 20 === 0 ? [CODE.action] : []);
}

describe('Brick Blitz — verified runs', () => {
  it('solo: Start issues a private ticket; live progress is the server replay of the log', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    expect(ticket.board).toBe('arcade');
    expect(ticket.limitTicks).toBe(0);
    unthrottle(host.server, me);
    const { sim } = await playRun(host, ticket, createBricksSim, { policy: tracker(9), stopAt: 3000 });
    expect(sim.over).toBe(false);
    await waitFor(() => st(host).standings.get(me).ticks === 3000, 5000, 'verified 3000');
    const standing = st(host).standings.get(me);
    expect(standing.score).toBe(sim.score);
    expect(standing.stat).toBe(sim.bricksBroken);
    expect(standing.lives).toBe(sim.lives);
    expect(sim.bricksBroken).toBeGreaterThan(0);
    // Quitting abandons the run without recording it.
    host.room.send(CLASSICS_MSG.quit, {});
    await waitFor(() => st(host).standings.get(me).status === 'ready', 2000, 'ready again');
    expect(highScores.top('bricks', 'arcade').entries).toHaveLength(0);
  });

  it('a parked paddle loses all three lives and the server agrees', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    unthrottle(host.server, me);
    const { sim } = await playRun(host, ticket, createBricksSim, { policy: loser() });
    expect(sim.over).toBe(true);
    const verdict = await waitVerdict(host, ticket.runId);
    expect(verdict.reason).toBe('over');
    expect(verdict.lives).toBe(0);
    expect(verdict.score).toBe(sim.score);
    expect(verdict.ticks).toBe(sim.tick);
  });

  it('rejects impossible input codes (tampered log)', async () => {
    const host = await create({ solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    const ticket = await nextTicket(host);
    unthrottle(host.server, me);
    host.room.send(CLASSICS_MSG.input, { runId: ticket.runId, seq: 1, upTo: 20, events: [1, 700] });
    const verdict = await waitVerdict(host, ticket.runId);
    expect(verdict.reason).toBe('rejected');
    expect(highScores.top('bricks', 'arcade').entries).toHaveLength(0);
    // And codes above the whole code space fail schema validation before reaching the run.
    host.room.send(CLASSICS_MSG.input, { runId: ticket.runId, seq: 2, upTo: 30, events: [1, MAX_CODE + 99_999_999] });
    await sleep(100);
  });

  it('blitz: runs end on the tick limit (time), same levels for everyone in a race', async () => {
    const outcomes: GameOutcome[] = [];
    const off = onOutcome((o) => outcomes.push(o));
    try {
      const host = await create({ settings: { mode: 'blitz', blitzSeconds: 180 } }, 'Host');
      const guest = await join(host.room.roomId, 'Guest');
      expect(st(host).classics.board).toBe('blitz-3');
      host.room.send('lobby:start', {});
      const t1 = await nextTicket(host);
      const t2 = await nextTicket(guest);
      expect(t1.seed).toBe(t2.seed);
      expect(t1.limitTicks).toBe(180 * CLASSICS.tickHz);
      await waitFor(() => st(host).phase === 'PLAYING', 3000, 'playing');
      unthrottle(host.server, host.me().playerId);
      unthrottle(host.server, guest.me().playerId);
      const [a, b] = await Promise.all([
        playRun(host, t1, createBricksSim, { policy: tracker(7), batchEvery: 120 }),
        playRun(guest, t2, createBricksSim, { policy: loser(), batchEvery: 120 }),
      ]);
      const va = await waitVerdict(host, t1.runId, 10_000);
      const vb = await waitVerdict(guest, t2.runId, 10_000);
      expect(va.score).toBe(a.sim.score);
      expect(vb.score).toBe(b.sim.score);
      expect(va.reason === 'time' || va.reason === 'over').toBe(true);
      if (!a.sim.over) expect(va.ticks).toBe(180 * CLASSICS.tickHz);
      await waitFor(() => st(host).phase === 'RESULTS', 5000, 'results');
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]!.scores).toMatchObject({ [host.me().playerId]: a.sim.score, [guest.me().playerId]: b.sim.score });
      expect(Object.keys(st(host).fields.toJSON()).length).toBe(2);
      expect(st(host).fields.get(host.me().playerId)).toMatch(/^\d+:\d+:[.NAXSP]+$/);
    } finally {
      off();
    }
  });
});
