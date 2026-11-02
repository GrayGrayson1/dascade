/**
 * What the server tells its operator: room lifecycle logs (Render's logs are the only server-side view
 * of a drop) and GET /api/health, whose newer fields the arcade floor reads (frozen contract: `clients`,
 * `commit`, `rssMb`, `games`; `ok`, `uptimeSeconds` and `rooms` unchanged).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import { bootTestServer, collect, waitFor, quiet } from './helpers.ts';
import type { TestRoom } from './fixtures/TestRoom.ts';
import { log } from '../src/lib/log.ts';
import { summarizeRooms, type HealthReport } from '../src/http/health.ts';

let colyseus: ColyseusTestServer;
let port = 0;

beforeAll(async () => {
  ({ colyseus, port } = await bootTestServer());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  return { room, me: () => welcomes[welcomes.length - 1]! };
}

async function createRoom(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('test', { name, ...extra });
  quiet(room);
  await room.waitForInitialState();
  const server = colyseus.getRoomById(room.roomId) as unknown as TestRoom;
  return { room, server };
}

async function health(): Promise<HealthReport> {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  expect(res.ok).toBe(true);
  return (await res.json()) as HealthReport;
}

function dropForGood(room: SdkRoom): void {
  room.reconnection.enabled = false;
  (room as any).connection.transport.ws.close(4010);
}

type InfoCall = [string, Record<string, unknown> | undefined];
const logged = (spy: { mock: { calls: unknown[][] } }, msg: string) =>
  (spy.mock.calls as InfoCall[]).filter(([m]) => m === msg).map(([, data]) => data ?? {});

describe('room lifecycle logs', () => {
  it('logs create, drop, reconnect, grace expiry, seat rebinds and dispose', async () => {
    const info = vi.spyOn(log, 'info');
    const host = await createRoom();
    const code = host.room.roomId;
    expect(logged(info, 'room created')).toContainEqual({ room: code, game: 'wheel', solo: false, restored: false });

    // A drop that comes back: dropped, then reconnected with how long it took.
    const bob = await join(code, 'Bob');
    const bobId = bob.me().playerId;
    bob.room.reconnection.minUptime = 0;
    const back = new Promise<void>((r) => bob.room.onReconnect(() => r()));
    (bob.room as any).connection.transport.ws.close(4010);
    await back;
    expect(logged(info, 'player dropped')).toContainEqual({ room: code, game: 'wheel', player: bobId, graceSeconds: 1 });
    const reconnected = logged(info, 'player reconnected').find((d) => d.player === bobId);
    expect(reconnected?.afterMs).toEqual(expect.any(Number));

    // A drop that never comes back (TestRoom holds seats for 1 s): the grace expires; a lobby seat goes.
    const cleo = await join(code, 'Cleo');
    const cleoId = cleo.me().playerId;
    dropForGood(cleo.room);
    await waitFor(() => logged(info, 'reconnect grace expired').some((d) => d.player === cleoId), 4000, 'grace expiry');
    expect(logged(info, 'reconnect grace expired').find((d) => d.player === cleoId)).toMatchObject({ seatKept: false, afterMs: expect.any(Number) });

    // A seat token taking over a socket the server still thinks is live (a second tab, or the Oct 29 half-open drop).
    const bobAgain = await join(code, 'Bob', { seatToken: bob.me().seatToken });
    expect(bobAgain.me().playerId).toBe(bobId);
    expect(logged(info, 'seat rebound')).toContainEqual(expect.objectContaining({ room: code, player: bobId, pushedOutLiveSocket: true }));

    // Everyone leaves: the room is disposed with its lifetime and its busiest moment.
    await waitFor(() => host.server.clients.length === 2, 3000, 'old tab closed');
    await bobAgain.room.leave(true);
    await host.room.leave(true);
    await waitFor(() => logged(info, 'room disposed').some((d) => d.room === code), 4000, 'dispose');
    expect(logged(info, 'room disposed').find((d) => d.room === code)).toMatchObject({
      game: 'wheel',
      lifetimeSeconds: expect.any(Number),
      peakPlayers: expect.any(Number),
    });
    expect(logged(info, 'room disposed').find((d) => d.room === code)!.peakPlayers).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /api/health', () => {
  it('keeps its original fields and adds clients, commit, memory and per-game multiplayer load', async () => {
    const empty = await health();
    expect(empty).toMatchObject({ ok: true, rooms: 0, clients: 0, games: {} });
    expect(empty.uptimeSeconds).toEqual(expect.any(Number));
    expect(empty.rssMb).toBeGreaterThan(0);
    expect(empty.commit === null || typeof empty.commit === 'string').toBe(true);

    // One multiplayer room (host, a player, a spectator) and one solo room.
    const host = await createRoom();
    await join(host.room.roomId, 'Bob');
    await join(host.room.roomId, 'Watcher', { spectator: true });
    await createRoom('Solo', { solo: true });

    // Room metadata (where `players` comes from) is published once a second.
    let report = await health();
    const started = Date.now();
    while (report.games.wheel?.players !== 2 && Date.now() - started < 4000) {
      await new Promise((r) => setTimeout(r, 100));
      report = await health();
    }
    expect(report.rooms).toBe(2);
    expect(report.clients).toBe(4);
    // Solo rooms aren't counted; spectators aren't players.
    expect(report.games).toEqual({ wheel: { rooms: 1, players: 2 } });
  });

  it('reports the running commit when the platform provides one', async () => {
    const prev = process.env.GIT_COMMIT;
    process.env.GIT_COMMIT = 'abcdef1234567890';
    try {
      expect((await health()).commit).toBe('abcdef123456');
    } finally {
      if (prev === undefined) delete process.env.GIT_COMMIT;
      else process.env.GIT_COMMIT = prev;
    }
  });

  it('summarizeRooms keys games by catalog id and skips solo rooms', () => {
    expect(
      summarizeRooms([
        { name: 'chess', clients: 3, metadata: { gameId: 'chess', players: 2, solo: false } },
        { name: 'chess', clients: 1, metadata: { gameId: 'chess', players: 1, solo: false } },
        { name: 'snake', clients: 1, metadata: { gameId: 'snake', players: 1, solo: true } },
        { name: 'bingo', clients: 0 },
      ]),
    ).toEqual({ rooms: 4, clients: 5, games: { chess: { rooms: 2, players: 3 }, bingo: { rooms: 1, players: 0 } } });
  });
});
