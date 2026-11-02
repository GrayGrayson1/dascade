/**
 * The server side of the client's seat-token fallback (apps/web/src/net/reconnectPolicy.ts): when a
 * session can't come back, the client rejoins its seat by token. A late reconnect of the old session
 * must then be closed without consent — a consented leave gives the seat up before the rejoin lands.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import { bootTestServer, collect, sleep, waitFor, quiet } from './helpers.ts';
import type { TestRoom } from './fixtures/TestRoom.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer());
});
afterEach(async () => {
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

async function createRoom(name = 'Host') {
  const room = await colyseus.sdk.create('test', { name });
  quiet(room);
  await room.waitForInitialState();
  const server = colyseus.getRoomById(room.roomId) as unknown as TestRoom;
  return { room, server };
}

const st = (room: SdkRoom) => room.state as any;

/** The client's side of the socket dies the way a dead network kills it; the server's side stays open. */
function dropHalfOpen(room: SdkRoom): void {
  const connection = (room as any).connection;
  const stale = connection.transport.ws as WebSocket;
  stale.onclose = null;
  stale.onmessage = null;
  stale.onerror = null;
  connection.events.onclose({ code: 1006, reason: 'network lost' });
}

describe('the seat-token fallback', () => {
  it('a late session the client closes without consent keeps the seat for its seat-token rejoin', async () => {
    const host = await createRoom();
    host.server['reconnectGraceSeconds'] = 10;
    const guest = await join(host.room.roomId, 'Bob');
    const { playerId, seatToken } = guest.me();

    // The tab is rejoining this room by seat token when its old auto-reconnect lands: it closes that
    // session without consent (as session.ts does), so the server only sees a drop…
    guest.room.reconnection.maxRetries = 0;
    await guest.room.leave(false);
    await waitFor(() => st(host.room).players.get(playerId)?.connected === false, 3000, 'drop');
    expect(st(host.room).players.has(playerId)).toBe(true);

    // …and the rejoin takes the same seat back.
    const again = await join(host.room.roomId, 'Bob', { seatToken });
    expect(again.me().playerId).toBe(playerId);
    expect(again.me().rejoined).toBe(true);
    await waitFor(() => st(host.room).players.get(playerId)?.connected === true, 3000, 'rejoined seat');
    expect(st(host.room).players.size).toBe(2);
  });

  it('a consented leave gives the seat up at once, so a rejoin after it is a new player (the race the client avoids)', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const { playerId, seatToken } = guest.me();
    await guest.room.leave(true);
    await waitFor(() => !st(host.room).players.has(playerId), 3000, 'seat removed');
    const again = await join(host.room.roomId, 'Bob', { seatToken });
    expect(again.me().playerId).not.toBe(playerId);
    expect(again.me().rejoined).toBe(false);
  });

  it('a seat-token rejoin while the server still sees the old socket takes the seat over without duplicating the player', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const { playerId, seatToken } = guest.me();
    await waitFor(() => st(host.room).players.get(playerId)?.connected === true, 3000, 'guest seated');
    // Half-open and never noticed (as if a proxy kept the server's side alive), so the client falls back.
    guest.room.reconnection.enabled = false;
    dropHalfOpen(guest.room);
    await sleep(200);
    expect(st(host.room).players.get(playerId)?.connected).toBe(true);

    const again = await join(host.room.roomId, 'Bob', { seatToken });
    expect(again.me().playerId).toBe(playerId);
    await waitFor(() => host.server.clients.length === 2, 3000, 'old socket pushed out');
    expect(st(host.room).players.size).toBe(2);
    expect(st(host.room).players.get(playerId)?.connected).toBe(true);
  });
});
