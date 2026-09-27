/**
 * HTTP matchmaking surface: rooms are reachable only by code. Colyseus also exposes
 * POST /matchmake/{join,joinOrCreate} (seat a caller in ANY open room of a game); DASCADE turns those
 * off and marks every room private, so a stranger can't land in someone's room without its code.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import { matchMaker } from '@colyseus/core';
import { bootTestServer, quiet } from './helpers.ts';

let colyseus: ColyseusTestServer;
let port = 0;

beforeAll(async () => {
  ({ colyseus, port } = await bootTestServer());
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

async function post(method: string, room: string, body: Record<string, unknown>) {
  const res = await fetch(`http://localhost:${port}/matchmake/${method}/${room}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

describe('matchmaking surface', () => {
  it('join / joinOrCreate never reach an existing room (HTTP, SDK or server-side)', async () => {
    const host = quiet(await colyseus.sdk.create('test', { name: 'Host' }));
    await host.waitForInitialState();
    const code = host.roomId;
    const server = colyseus.getRoomById(code);
    expect(server.clients.length).toBe(1);

    for (const method of ['join', 'joinOrCreate']) {
      const res = await post(method, 'test', { name: 'Stranger' });
      expect(res.status).not.toBe(200);
      expect(res.body.roomId).toBeUndefined();
      expect(res.body.sessionId).toBeUndefined();
    }
    await expect(colyseus.sdk.join('test', { name: 'Stranger' })).rejects.toBeTruthy();
    await expect(colyseus.sdk.joinOrCreate('test', { name: 'Stranger' })).rejects.toBeTruthy();
    // Even an in-process join by room name can't pick it: every room is private.
    await expect(matchMaker.join('test', { name: 'Stranger' })).rejects.toThrow(/no rooms found/);
    expect(server.clients.length).toBe(1);
    expect((await matchMaker.query({ name: 'test' })).length).toBe(1); // joinOrCreate created nothing either
  });

  it('create, join by code, the code lookup and reconnection still work', async () => {
    const created = await post('create', 'test', { name: 'Host' });
    expect(created.status).toBe(200);
    const host = quiet(await colyseus.sdk.create('test', { name: 'Host2' }));
    await host.waitForInitialState();
    const lookup = (await (await fetch(`http://localhost:${port}/api/rooms/${host.roomId}`)).json()) as { exists: boolean };
    expect(lookup.exists).toBe(true);
    const guest = quiet(await colyseus.sdk.joinById(host.roomId, { name: 'Guest' }));
    await guest.waitForInitialState();
    expect(colyseus.getRoomById(host.roomId).clients.length).toBe(2);
    const token = guest.reconnectionToken;
    guest.reconnection.enabled = false;
    (guest as unknown as { connection: { transport: { ws: { close(code: number): void } } } }).connection.transport.ws.close(4010);
    const back = quiet(await colyseus.sdk.reconnect(token));
    expect(back.roomId).toBe(host.roomId);
  });
});
