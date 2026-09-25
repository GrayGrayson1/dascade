import net from 'node:net';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameId } from '@dascade/shared';
import { createDascadeServer } from '../src/server.ts';
import { TestRoom } from './fixtures/TestRoom.ts';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Boots an in-process server. Pass `games` to load only your game's room (keeps tests isolated from other cabinets). */
export async function bootTestServer(games: GameId[] = []): Promise<{ colyseus: ColyseusTestServer; port: number }> {
  // Note: @colyseus/testing's boot() ignores the port for Server instances (always 2568),
  // which makes parallel test files collide — so listen on a free port ourselves, retrying
  // if another process grabs the port between probing and binding.
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePort();
    const server = await createDascadeServer({ extraRooms: { test: TestRoom }, games });
    try {
      await server.listen(port);
      return { colyseus: new ColyseusTestServer(server), port };
    } catch (err) {
      lastError = err;
      await server.gracefullyShutdown(false).catch(() => undefined);
    }
  }
  throw lastError;
}

export function collect<T = unknown>(room: SdkRoom, type: string): T[] {
  const out: T[] = [];
  room.onMessage(type, (payload: T) => out.push(payload));
  return out;
}

export async function waitFor(predicate: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Registers no-op handlers for platform messages so the SDK doesn't warn about unhandled types. */
export function quiet(room: SdkRoom): SdkRoom {
  for (const type of ['sys:welcome', 'sys:toast', 'sys:error', 'sys:removed', 'sys:time', 'chat:msg', 'chat:history']) {
    room.onMessage(type, () => undefined);
  }
  room.onMessage('*', () => undefined);
  return room;
}
