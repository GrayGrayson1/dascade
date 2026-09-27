/**
 * Room DJ integration: synchronized jukebox state through BaseGameRoom with real SDK clients.
 * Uses the platform TestRoom ('test'): reconnect grace 1 s, host migration 300 ms.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { DJ, DJ_MAX_TRACK_SECONDS, djPositionAt, type DjState } from '@dascade/shared/jukebox';
import type { WelcomePayload } from '@dascade/shared';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';
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

interface Peer {
  room: SdkRoom;
  dj: DjState[];
  errors: { type?: string; code: string }[];
  welcomes: WelcomePayload[];
  last: () => DjState | undefined;
  me: () => string;
}

function wire(room: SdkRoom): Peer {
  const dj = collect<DjState>(room, DJ.state);
  const errors = collect<{ type?: string; code: string }>(room, 'sys:error');
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  quiet(room);
  return { room, dj, errors, welcomes, last: () => dj[dj.length - 1], me: () => welcomes[welcomes.length - 1]!.playerId };
}

async function host(name = 'Host') {
  const peer = wire(await colyseus.sdk.create('test', { name }));
  await peer.room.waitForInitialState();
  await waitFor(() => peer.welcomes.length > 0, 3000, 'welcome');
  const server = colyseus.getRoomById(peer.room.roomId) as unknown as TestRoom;
  return { ...peer, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}) {
  const peer = wire(await colyseus.sdk.joinById(code, { name, ...extra }));
  await peer.room.waitForInitialState();
  await waitFor(() => peer.welcomes.length > 0, 3000, 'welcome');
  return peer;
}

const A = { trackId: 'neon-cruising', duration: 180 };
const B = { trackId: 'cyberbro', duration: 120 };
const st = (room: SdkRoom) => room.state as any;
const serverDj = (server: TestRoom): DjState => (server as any).dj.state();

function dropAndReconnectLater(room: SdkRoom, delayMs: number): Promise<void> {
  room.reconnection.minUptime = 0;
  room.reconnection.delay = delayMs;
  room.reconnection.minDelay = delayMs;
  room.reconnection.maxDelay = delayMs;
  const reconnected = new Promise<void>((r) => room.onReconnect(() => r()));
  (room as any).connection.transport.ws.close(4010);
  return reconnected;
}

async function enable(h: Awaited<ReturnType<typeof host>>, config: Record<string, boolean> = {}) {
  h.room.send(DJ.config, { enabled: true, ...config });
  await waitFor(() => h.last()?.enabled === true, 3000, 'dj enabled');
}

describe('Room DJ', () => {
  it('sends nothing until enabled; disabled DJ ignores commands', async () => {
    const h = await host();
    const g = await join(h.room.roomId, 'Guest');
    h.room.send(DJ.command, { op: 'play', track: A });
    await waitFor(() => h.errors.some((e) => e.type === DJ.command && e.code === 'not_allowed'));
    await sleep(100);
    expect(h.dj).toHaveLength(0);
    expect(g.dj).toHaveLength(0);
    expect(serverDj(h.server).current).toBeNull();
  });

  it('host plays a track: every client gets the same track and anchor; seek re-anchors; pause/resume', async () => {
    const h = await host();
    const g1 = await join(h.room.roomId, 'G1');
    const g2 = await join(h.room.roomId, 'G2');
    await enable(h);
    await waitFor(() => g1.last()?.enabled === true && g2.last()?.enabled === true);
    expect(g1.last()!.djId).toBe(h.me());

    const before = Date.now();
    h.room.send(DJ.command, { op: 'play', track: A, position: 10 });
    await waitFor(() => [h, g1, g2].every((p) => p.last()?.current?.trackId === A.trackId), 3000, 'play A');
    const s = g2.last()!;
    expect(s).toMatchObject({ playing: true, position: 10, current: { trackId: A.trackId, duration: 180, addedBy: h.me() } });
    expect(s.anchorServerTime).toBeGreaterThanOrEqual(before - 5);
    expect(g1.last()).toEqual(s);
    expect(djPositionAt(s, s.anchorServerTime + 2500)).toBeCloseTo(12.5);

    h.room.send(DJ.command, { op: 'seek', position: 95 });
    await waitFor(() => g1.last()?.position === 95, 3000, 'seek');
    expect(g1.last()!.anchorServerTime).toBeGreaterThanOrEqual(s.anchorServerTime);
    expect(g1.last()!.version).toBeGreaterThan(s.version);

    h.room.send(DJ.command, { op: 'pause' });
    await waitFor(() => g1.last()?.playing === false, 3000, 'pause');
    const paused = g1.last()!;
    expect(djPositionAt(paused, paused.anchorServerTime + 60_000)).toBeCloseTo(paused.position);
    expect(paused.position).toBeGreaterThanOrEqual(95);
    h.room.send(DJ.command, { op: 'resume' });
    await waitFor(() => g1.last()?.playing === true, 3000, 'resume');
    expect(g1.last()!.position).toBeCloseTo(paused.position);
    // Versions only ever increase.
    const versions = g1.dj.map((d) => d.version);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });

  it('rejects non-host playback and config, allows guest queueing only when permitted', async () => {
    const h = await host();
    const g = await join(h.room.roomId, 'Guest');
    g.room.send(DJ.config, { enabled: true });
    await waitFor(() => g.errors.some((e) => e.type === DJ.config && e.code === 'not_host'));
    await enable(h);
    h.room.send(DJ.command, { op: 'play', track: A });
    await waitFor(() => g.last()?.current?.trackId === A.trackId);
    for (const cmd of [{ op: 'pause' }, { op: 'seek', position: 3 }, { op: 'next' }, { op: 'play', track: B }]) g.room.send(DJ.command, cmd);
    await waitFor(() => g.errors.filter((e) => e.type === DJ.command && e.code === 'not_host').length === 4, 3000, 'guest refused');
    g.room.send(DJ.command, { op: 'enqueue', track: B });
    await waitFor(() => g.errors.some((e) => e.type === DJ.command && e.code === 'not_allowed'));
    expect(serverDj(h.server)).toMatchObject({ playing: true, queue: [] });

    h.room.send(DJ.config, { allowQueue: true });
    await waitFor(() => g.last()?.allowQueue === true);
    g.room.send(DJ.command, { op: 'enqueue', track: B });
    await waitFor(() => g.last()?.queue.length === 1, 3000, 'guest enqueue');
    const entry = g.last()!.queue[0]!;
    expect(entry).toMatchObject({ trackId: B.trackId, addedBy: g.me() });
    g.room.send(DJ.command, { op: 'dequeue', entryId: entry.entryId });
    await waitFor(() => g.last()?.queue.length === 0, 3000, 'guest dequeue');
  });

  it('spectators receive DJ state but cannot queue or vote', async () => {
    const h = await host();
    await enable(h, { allowQueue: true, allowSkipVote: true });
    h.room.send(DJ.command, { op: 'play', track: A });
    const spec = await join(h.room.roomId, 'Watcher', { spectator: true });
    await waitFor(() => spec.last()?.current?.trackId === A.trackId, 3000, 'spectator state');
    spec.room.send(DJ.command, { op: 'enqueue', track: B });
    spec.room.send(DJ.skipVote, {});
    await waitFor(() => spec.errors.filter((e) => e.code === 'not_allowed').length === 2, 3000, 'spectator refused');
    expect(serverDj(h.server)).toMatchObject({ queue: [], skipVotes: 0, current: { trackId: A.trackId } });
  });

  it('a late joiner receives the current track and position', async () => {
    const h = await host();
    await enable(h);
    h.room.send(DJ.command, { op: 'play', track: A, position: 40 });
    await waitFor(() => h.last()?.current?.trackId === A.trackId);
    await sleep(300);
    const late = await join(h.room.roomId, 'Late');
    await waitFor(() => late.last()?.current?.trackId === A.trackId, 3000, 'late state');
    const s = late.last()!;
    expect(s.playing).toBe(true);
    const at = djPositionAt(s, Date.now());
    expect(at).toBeGreaterThan(40.2);
    expect(at).toBeLessThan(42);
  });

  it('a reconnecting client gets the DJ state again (including changes made while it was away)', async () => {
    const h = await host();
    const g = await join(h.room.roomId, 'Flaky');
    await enable(h);
    h.room.send(DJ.command, { op: 'play', track: A });
    await waitFor(() => g.last()?.current?.trackId === A.trackId);
    const reconnected = dropAndReconnectLater(g.room, 400);
    await sleep(50);
    h.room.send(DJ.command, { op: 'play', track: B, position: 5 });
    await waitFor(() => h.last()?.current?.trackId === B.trackId);
    const count = g.dj.length;
    await reconnected;
    await waitFor(() => g.dj.length > count && g.last()?.current?.trackId === B.trackId, 3000, 'state after reconnect');
    expect(g.last()!.version).toBe(serverDj(h.server).version);
  });

  it('host migration keeps the music and moves DJ authority', async () => {
    const h = await host();
    const g = await join(h.room.roomId, 'Heir');
    await enable(h);
    h.room.send(DJ.command, { op: 'play', track: A, position: 20 });
    await waitFor(() => g.last()?.current?.trackId === A.trackId);
    const anchor = g.last()!.anchorServerTime;
    await h.room.leave(true);
    await waitFor(() => g.last()?.djId === g.me(), 3000, 'dj moved');
    await waitFor(() => st(g.room).hostId === g.me(), 3000, 'host moved');
    expect(g.last()).toMatchObject({ enabled: true, playing: true, position: 20, anchorServerTime: anchor, current: { trackId: A.trackId } });
    g.room.send(DJ.command, { op: 'pause' });
    await waitFor(() => g.last()?.playing === false, 3000, 'new host pauses');
  });

  it('skip vote needs an exact strict majority of connected seated listeners', async () => {
    const h = await host();
    const g1 = await join(h.room.roomId, 'V1');
    const g2 = await join(h.room.roomId, 'V2');
    const g3 = await join(h.room.roomId, 'V3');
    await enable(h, { allowSkipVote: true });
    h.room.send(DJ.command, { op: 'play', track: A });
    h.room.send(DJ.command, { op: 'enqueue', track: B });
    await waitFor(() => g3.last()?.queue.length === 1);
    expect(g3.last()!.skipNeeded).toBe(3); // 4 listeners
    g1.room.send(DJ.skipVote, {});
    g1.room.send(DJ.skipVote, {}); // duplicate
    g2.room.send(DJ.skipVote, {});
    await waitFor(() => g3.last()?.skipVotes === 2, 3000, '2 votes');
    await waitFor(() => g1.errors.some((e) => e.type === DJ.skipVote), 3000, 'duplicate refused');
    expect(g3.last()!.current!.trackId).toBe(A.trackId);
    g3.room.send(DJ.skipVote, {});
    await waitFor(() => g3.last()?.current?.trackId === B.trackId, 3000, 'skipped');
    expect(g3.last()).toMatchObject({ skipVotes: 0, skipVoters: [] });

    // A voter leaving drops their vote and the threshold follows the room.
    g1.room.send(DJ.skipVote, {});
    await waitFor(() => h.last()?.skipVotes === 1);
    await g1.room.leave(true);
    await waitFor(() => h.last()?.skipNeeded === 2 && h.last()?.skipVotes === 0, 3000, 'vote removed');
    expect(h.last()!.current!.trackId).toBe(B.trackId);
  });

  it('auto-advances the queue when a track ends (server clock timer)', async () => {
    const h = await host();
    const g = await join(h.room.roomId, 'Listener');
    await enable(h);
    h.room.send(DJ.command, { op: 'play', track: { trackId: 'short-one', duration: 1 }, position: 0.4 });
    h.room.send(DJ.command, { op: 'enqueue', track: { trackId: 'short-two', duration: 1 } });
    await waitFor(() => g.last()?.queue.length === 1);
    await waitFor(() => g.last()?.current?.trackId === 'short-two', 3000, 'advanced');
    expect(g.last()).toMatchObject({ playing: true, position: 0, queue: [] });
    await waitFor(() => g.last()?.current === null, 3000, 'idle after the last track');
    expect(g.last()!.playing).toBe(false);
  });

  it('a game resetting its own timers does not stop DJ auto-advance', async () => {
    const h = await host();
    await enable(h);
    h.room.send(DJ.command, { op: 'play', track: { trackId: 'short-one', duration: 1 }, position: 0.3 });
    await waitFor(() => h.last()?.current?.trackId === 'short-one');
    h.room.send('test:clearTimers', {});
    await waitFor(() => h.last()?.current === null, 3000, 'advanced despite clearAllTimers');
  });

  it('rejects garbage and oversized payloads without disconnecting', async () => {
    const h = await host();
    await enable(h);
    const garbage: unknown[] = [
      null,
      'play',
      { op: 'explode' },
      { op: 'play', track: { trackId: '../../etc/passwd', duration: 10 } },
      { op: 'play', track: { trackId: 'ok', duration: -5 } },
      { op: 'play', track: { trackId: 'ok', duration: DJ_MAX_TRACK_SECONDS + 1 } },
      { op: 'seek', position: Number.NaN },
      { op: 'seek', position: -1 },
      { op: 'dequeue', entryId: 'x'.repeat(40) },
      { op: 'enqueue', track: { trackId: 'a'.repeat(300), duration: 5 } },
      { op: 'play', track: { trackId: 'ok', duration: 10 }, padding: 'x'.repeat(2000) },
    ];
    for (const g of garbage) h.room.send(DJ.command, g);
    h.room.send(DJ.config, { enabled: 'yes' });
    await waitFor(() => h.errors.filter((e) => e.code === 'invalid_payload').length === garbage.length + 1, 4000, 'all refused');
    expect(serverDj(h.server).current).toBeNull();
    expect(h.server.clients.length).toBe(1);
  });

  it('command spam is rate limited: bounded broadcasts, no disconnect, the room stays responsive', async () => {
    const h = await host();
    const g = await join(h.room.roomId, 'Listener');
    await enable(h, { allowSkipVote: true });
    h.room.send(DJ.command, { op: 'play', track: A });
    await waitFor(() => g.last()?.current?.trackId === A.trackId);
    const before = g.dj.length;
    for (let i = 0; i < 80; i++) h.room.send(DJ.command, { op: 'seek', position: i });
    for (let i = 0; i < 20; i++) g.room.send(DJ.skipVote, {});
    await waitFor(() => h.errors.filter((e) => e.type === DJ.command && e.code === 'rate_limited').length > 0, 3000, 'host limited');
    await waitFor(() => g.errors.some((e) => e.type === DJ.skipVote && e.code === 'rate_limited'), 3000, 'voter limited');
    await sleep(300);
    // burst 12 (+ a few refills) — nowhere near 80 broadcasts to every client.
    expect(g.dj.length - before).toBeLessThanOrEqual(20);
    expect(h.server.clients.length).toBe(2);
    // Duplicate skip votes never counted twice (1 vote of 2 needed → still playing A).
    expect(serverDj(h.server).skipVotes).toBe(1);
    expect(serverDj(h.server).current?.trackId).toBe(A.trackId);
    // After the bucket refills, commands work again.
    await sleep(1100);
    h.room.send(DJ.command, { op: 'pause' });
    await waitFor(() => g.last()?.playing === false, 3000, 'responsive after spam');
  });

  it('is off in tournament matches', async () => {
    const h = await host();
    (h.server as any).tournamentInfo = { code: 'T', matchId: 'm', participants: [] };
    h.room.send(DJ.config, { enabled: true });
    await waitFor(() => h.errors.some((e) => e.type === DJ.config && e.code === 'not_allowed'));
    expect(serverDj(h.server).enabled).toBe(false);
  });

  it('a DJ fault never breaks the room: the game keeps playing and people keep joining', async () => {
    const h = await host();
    const g = await join(h.room.roomId, 'Player');
    await enable(h);
    const dj = (h.server as any).dj;
    dj.command = () => {
      throw new Error('dj exploded');
    };
    dj.setListeners = () => {
      throw new Error('dj exploded again');
    };
    h.room.send(DJ.command, { op: 'play', track: A });
    // Joining, starting and playing still work while every DJ path throws.
    const late = await join(h.room.roomId, 'Late');
    await waitFor(() => st(g.room).players.size === 3);
    h.room.send('lobby:start', {});
    await waitFor(() => st(h.room).phase === 'PLAYING', 3000, 'match started');
    g.room.send('test:inc', { by: 2 });
    await waitFor(() => st(late.room).counter === 2, 3000, 'game still plays');
    expect(h.server.clients.length).toBe(3);
  });
});
