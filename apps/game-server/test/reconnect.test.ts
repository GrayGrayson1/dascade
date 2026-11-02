/**
 * Reconnects after a half-open drop (the Oct 29 finding): the client's side of the socket died, but the
 * server still sees it open until the heartbeat ends it. The SDK's auto-reconnect then arrives while the
 * old socket is "connected", and Colyseus parks it until that socket is gone — for at most the room's
 * seat reservation, which must outlast the heartbeat (else close 4003, which the SDK never retries).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { HEARTBEAT_WINDOW_MS, SEAT_RESERVATION_SECONDS, type WelcomePayload } from '@dascade/shared';
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

async function createRoom(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('test', { name, ...extra });
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  quiet(room);
  await room.waitForInitialState();
  await waitFor(() => welcomes.length > 0, 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as TestRoom;
  return { room, server, me: () => welcomes[welcomes.length - 1]! };
}

const st = (room: SdkRoom) => room.state as any;

/**
 * Kills the client's side of the socket the way a dead network does: the SDK sees an abnormal close and
 * starts reconnecting, while the server's side stays open (and keeps answering pings). Returns the stale
 * socket, which the test closes to play the heartbeat ending it.
 */
function dropHalfOpen(room: SdkRoom): WebSocket {
  const connection = (room as any).connection;
  const stale = connection.transport.ws as WebSocket;
  stale.onclose = null;
  stale.onmessage = null;
  stale.onerror = null;
  room.reconnection.minUptime = 0;
  room.reconnection.delay = 50;
  room.reconnection.minDelay = 50;
  room.reconnection.maxDelay = 50;
  connection.events.onclose({ code: 1006, reason: 'network lost' });
  return stale;
}

describe('reconnect after a half-open drop', () => {
  it('every room reserves seats for longer than the heartbeat takes to end a dead socket', async () => {
    expect(SEAT_RESERVATION_SECONDS * 1000).toBeGreaterThan(HEARTBEAT_WINDOW_MS);
    const host = await createRoom();
    expect(host.server.seatReservationTimeout).toBe(SEAT_RESERVATION_SECONDS);
  });

  it('a reconnect that arrives while the server still sees the old socket waits for it, then resumes the same session', async () => {
    const host = await createRoom();
    const guest = await join(host.room.roomId, 'Bob');
    const playerId = guest.me().playerId;
    const sessionId = guest.room.sessionId;
    let landed = false;
    const reconnected = new Promise<void>((resolve) =>
      guest.room.onReconnect(() => {
        landed = true;
        resolve();
      }),
    );

    const stale = dropHalfOpen(guest.room);
    // Parked: the server still counts the old socket as the player's.
    await waitFor(() => Object.keys((host.server as any)._reconnectionAttempts).length === 1, 3000, 'parked reconnect');
    await sleep(300);
    expect(landed).toBe(false);
    expect(st(host.room).players.get(playerId)?.connected).toBe(true);

    // The heartbeat ends the stale socket: the parked reconnect lands on the same session and seat.
    stale.close();
    await reconnected;
    expect(guest.room.sessionId).toBe(sessionId);
    await waitFor(() => st(host.room).players.get(playerId)?.connected === true, 3000, 'reconnected seat');
    expect(st(host.room).players.size).toBe(2);
    expect(host.server.clients.length).toBe(2);
  });
});
