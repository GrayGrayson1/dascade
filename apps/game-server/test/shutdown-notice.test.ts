/**
 * A deploy (SIGTERM → graceful shutdown) warns every room before it disconnects them. Only event rooms
 * (a Survey Showdown with its preset) are told they come back; the game's own shutdown hook (Showdown's
 * black box) still speaks first. This file shuts its own server down, so it boots one of its own.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { RoomMetadata, ToastPayload } from '@dascade/shared';
import { createDascadeServer } from '../src/server.ts';
import { SHUTDOWN_NOTICE, SHUTDOWN_NOTICE_EVENT, setShutdownNoticeMs } from '../src/rooms/BaseGameRoom.ts';
import { TestRoom } from './fixtures/TestRoom.ts';
import { freePort, quiet, waitFor } from './helpers.ts';

/** A TestRoom that behaves like an event room and, like Showdown, speaks in its shutdown hook. */
class EventTestRoom extends TestRoom {
  protected override metadataExtra(): Partial<RoomMetadata> {
    return { event: 'qa-event' };
  }
  protected override onServerShutdown(): void {
    this.toast('all', 'info', 'black box sent');
  }
}

const NOTICE_MS = 400;

afterAll(() => setShutdownNoticeMs(0));

/** Every toast and the close code, in arrival order. */
function watch(room: SdkRoom) {
  const toasts: ToastPayload[] = [];
  room.onMessage('sys:toast', (payload: ToastPayload) => toasts.push(payload));
  quiet(room);
  const left = new Promise<{ code: number; at: number }>((resolve) => room.onLeave((code) => resolve({ code, at: Date.now() })));
  return { toasts, left };
}

describe('graceful shutdown notice', () => {
  it('warns each room, keeps it open for the notice, then closes it with SERVER_SHUTDOWN', async () => {
    setShutdownNoticeMs(NOTICE_MS);
    const port = await freePort();
    const server = await createDascadeServer({ extraRooms: { test: TestRoom, eventTest: EventTestRoom }, games: [] });
    await server.listen(port);
    const colyseus = new ColyseusTestServer(server);

    // Wait for each room's first state right away: waitForInitialState() never resolves once it has arrived.
    const plain = await colyseus.sdk.create('test', { name: 'Host' });
    const plainSeen = watch(plain);
    await plain.waitForInitialState();
    const event = await colyseus.sdk.create('eventTest', { name: 'Presenter' });
    const eventSeen = watch(event);
    await event.waitForInitialState();
    // An empty room has nobody to warn: it goes at once, as before.
    await colyseus.sdk.create('test', { name: 'Leaver' }).then((r) => r.leave(true));

    const started = Date.now();
    const shutdown = colyseus.shutdown();

    await waitFor(() => plainSeen.toasts.length > 0 && eventSeen.toasts.length > 1, 3000, 'shutdown notices');
    // Ordinary rooms are never promised a comeback.
    expect(plainSeen.toasts).toEqual([{ kind: 'warning', text: SHUTDOWN_NOTICE }]);
    expect(SHUTDOWN_NOTICE).not.toMatch(/reconnect|come(s)? back|restored/i);
    // The game's own hook (Showdown's black box) still goes first; then the event copy.
    expect(eventSeen.toasts).toEqual([
      { kind: 'info', text: 'black box sent' },
      { kind: 'warning', text: SHUTDOWN_NOTICE_EVENT },
    ]);

    const [plainLeft, eventLeft] = await Promise.all([plainSeen.left, eventSeen.left]);
    expect(plainLeft.code).toBe(4001);
    expect(eventLeft.code).toBe(4001);
    expect(plainLeft.at - started).toBeGreaterThanOrEqual(NOTICE_MS - 50);
    await shutdown;
  });
});
