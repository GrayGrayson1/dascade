import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import { SNAKE_MSG, type SnakeEventPayload } from '@dascade/shared/games/snake';
import { botDirection, cellX, cellY, decodeSnakeSnapshot, type SnakeGame, type SnakeSnapshot } from '@dascade/game-core/snake';
import { onOutcome } from '../src/platform/hub.ts';
import type { SnakeRoom } from '../src/rooms/snake/SnakeRoom.ts';
import { bootTestServer, collect, sleep, waitFor, quiet } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; game: string }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['snake']));
  unsubscribe = onOutcome((outcome, ctx) => outcomes.push({ outcome, game: ctx.gameId }));
});
afterEach(async () => {
  await colyseus.cleanup();
  outcomes.length = 0;
});
afterAll(async () => {
  unsubscribe();
  await colyseus.shutdown();
});

const st = (room: SdkRoom) => room.state as any;

interface Client {
  room: SdkRoom;
  me: () => WelcomePayload;
  snaps: SnakeSnapshot[];
  events: SnakeEventPayload[];
  verdicts: RunVerdict[];
  errors: Array<{ code: string; type?: string }>;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  const events = collect<SnakeEventPayload>(room, SNAKE_MSG.event);
  const verdicts = collect<RunVerdict>(room, CLASSICS_MSG.verdict);
  const snaps: SnakeSnapshot[] = [];
  room.onMessage(SNAKE_MSG.snap, (bytes: Uint8Array) => {
    const snap = decodeSnakeSnapshot(bytes);
    if (snap) snaps.push(snap);
  });
  room.onMessage(CLASSICS_MSG.event, () => undefined);
  quiet(room);
  return { room, me: () => welcomes[welcomes.length - 1]!, snaps, events, verdicts, errors };
}

async function create(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('snake', { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as SnakeRoom;
  (server as any).countdownMs = 200;
  (server as any).resultsDelayMs = 100;
  return { ...client, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  return client;
}

async function settle(host: Awaited<ReturnType<typeof create>>, settings: Record<string, unknown>) {
  host.room.send('lobby:settings', { settings });
  await waitFor(() => Object.entries(settings).every(([k, v]) => JSON.parse(st(host.room).settingsJson)[k] === v), 3000, 'settings');
}

const game = (server: SnakeRoom) => (server as any).game as SnakeGame;
const mySnake = (c: Client, snap = c.snaps.at(-1)) => {
  const slot = st(c.room).snakes.get(c.me().playerId)?.slot;
  return snap?.snakes.find((s) => s.slot === slot);
};

/** Input bot: decides with the autopilot and sends turns over the network (like a player). */
function autopilot(c: Client, server: SnakeRoom): () => void {
  let on = true;
  void (async () => {
    while (on) {
      const g = game(server);
      const slot = st(c.room).snakes.get(c.me().playerId)?.slot;
      if (g && slot !== undefined && c.room.connection.isOpen) {
        const d = botDirection(g, slot);
        if (d !== null && d !== g.snakes[slot]!.dir) c.room.send(SNAKE_MSG.turn, { dir: d });
      }
      await sleep(25);
    }
  })();
  return () => {
    on = false;
  };
}

describe('SnakeRoom — solo score attack', () => {
  it('starts instantly, turns with buffered input, crashes into a wall and records a verified score', async () => {
    const host = await create('Solo', { solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host.room).standings.get(me)?.status === 'ready', 3000, 'instructions');
    await settle(host, { speed: 'fast' });
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => host.snaps.length > 0 && st(host.room).match.status === 'running', 4000, 'running');
    expect(st(host.room).match.solo).toBe(true);
    const g = game(host.server);
    const s0 = g.snakes[0]!;
    // Up then left in quick succession: both are applied (one per step), no reversal.
    const dirBefore = s0.dir;
    expect(dirBefore).toBe(1);
    host.room.send(SNAKE_MSG.turn, { dir: 0 });
    host.room.send(SNAKE_MSG.turn, { dir: 3 });
    host.room.send(SNAKE_MSG.turn, { dir: 1 }); // reversal of the buffered "left": ignored
    await waitFor(() => s0.dir === 3, 2000, 'double turn');
    const head = mySnake(host)!.body[0]!;
    expect(head).toBeTruthy();
    // Head for the top wall and wait for the crash.
    host.room.send(SNAKE_MSG.turn, { dir: 0 });
    await waitFor(() => host.verdicts.length > 0, 8000, 'verdict');
    const v = host.verdicts[0]!;
    expect(v.reason).toBe('over');
    expect(v.board).toBe('solo-fast');
    expect(host.events.some((e) => e.kind === 'death' && e.cause === 'wall')).toBe(true);
    await waitFor(() => st(host.room).standings.get(me)?.status === 'over', 2000, 'standing over');
    // Retry.
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(host.room).standings.get(me)?.status === 'playing', 3000, 'retry');
    expect(st(host.room).match.matchId).toBe(2);
  });

  it('pauses (solo only) and resumes', async () => {
    const host = await create('Solo', { solo: true });
    await waitFor(() => st(host.room).standings.get(host.me().playerId)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(host.room).match.status === 'running', 4000, 'running');
    host.room.send(SNAKE_MSG.pause, { paused: true });
    await waitFor(() => st(host.room).match.paused === true, 2000, 'paused');
    const t = game(host.server).tick;
    await sleep(400);
    expect(game(host.server).tick).toBe(t);
    host.room.send(SNAKE_MSG.pause, { paused: false });
    await waitFor(() => game(host.server).tick > t, 3000, 'resumed');
  });
});

describe('SnakeRoom — arena', () => {
  it('survival with 3 bots: last snake alive wins; placements follow survival order', async () => {
    const host = await create('Host');
    const b = await join(host.room.roomId, 'Bravo');
    const c = await join(host.room.roomId, 'Charlie');
    const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
    await settle(host, { speed: 'fast', powerUps: false });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 4000, 'playing');
    await waitFor(() => st(host.room).match.status === 'running', 3000, 'running');
    expect(st(host.room).snakes.size).toBe(3);
    // Charlie flies the autopilot; Host and Bravo just go straight (into a wall).
    const stop = autopilot(c, host.server);
    // Spectators can't steer.
    watcher.room.send(SNAKE_MSG.turn, { dir: 0 });
    try {
      await waitFor(() => st(host.room).phase === 'RESULTS', 30_000, 'results');
    } finally {
      stop();
    }
    const charlie = c.me().playerId;
    const out = outcomes.find((o) => o.game === 'snake')!;
    expect(out.outcome.placements[0]).toEqual([charlie]);
    expect(out.outcome.reason).toBe('survival');
    await waitFor(() => st(host.room).standings.get(charlie)?.rank === 1, 2000, 'final rank');
    expect(out.outcome.placements.flat().sort()).toEqual([host.me().playerId, b.me().playerId, charlie].sort());
    expect(st(host.room).snakes.get(charlie).place).toBe(1);
    expect(JSON.parse(st(host.room).match.winnersJson)).toEqual([charlie]);
    expect(watcher.snaps.length).toBeGreaterThan(5);
    expect(watcher.errors.filter((e) => e.type === SNAKE_MSG.turn)).toEqual([]);
  }, 45_000);

  it('frenzy: crashed snakes respawn and the round ends on the clock, ranked by score', async () => {
    const host = await create('Host');
    const guest = await join(host.room.roomId, 'Guest');
    await settle(host, { mode: 'frenzy', speed: 'fast', powerUps: false });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).match.status === 'running', 5000, 'running');
    // Shorten the clock (test only) and let both snakes crash into walls and respawn.
    const g = game(host.server);
    g.rules.maxTicks = g.tick + 110;
    await waitFor(() => host.events.some((e) => e.kind === 'respawn'), 12_000, 'respawn');
    expect(host.events.some((e) => e.kind === 'death')).toBe(true);
    await waitFor(() => st(host.room).phase === 'RESULTS', 15_000, 'results');
    const out = outcomes.find((o) => o.game === 'snake')!;
    const scores = out.outcome.scores!;
    const [first] = out.outcome.placements;
    const ids = [host.me().playerId, guest.me().playerId];
    expect(first!.every((id) => ids.includes(id))).toBe(true);
    expect(scores[first![0]!]).toBe(Math.max(...ids.map((id) => scores[id] ?? 0)));
  }, 40_000);

  it('a player leaving mid-round is retired (a crash) and placed last', async () => {
    const host = await create('Host');
    const guest = await join(host.room.roomId, 'Leaver');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).match.status === 'running', 5000, 'running');
    const leaver = guest.me().playerId;
    await guest.room.leave(true);
    await waitFor(() => st(host.room).phase === 'RESULTS', 6000, 'results');
    const out = outcomes.find((o) => o.game === 'snake')!;
    expect(out.outcome.placements).toEqual([[host.me().playerId], [leaver]]);
  });

  it('keeps a dropped snake in play and hands it back on reconnect', async () => {
    const host = await create('Host');
    const guest = await join(host.room.roomId, 'Flaky');
    await settle(host, { speed: 'relaxed', arena: 'large' });
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).match.status === 'running', 5000, 'running');
    const slot = st(host.room).snakes.get(guest.me().playerId).slot;
    guest.room.reconnection.minUptime = 0;
    guest.room.reconnection.delay = 400;
    guest.room.reconnection.minDelay = 400;
    guest.room.reconnection.maxDelay = 400;
    const back = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    (guest.room as any).connection.transport.ws.close(4010);
    await back;
    const g = game(host.server);
    expect(st(host.room).phase).toBe('PLAYING');
    const s = g.snakes[slot]!;
    expect(s.alive).toBe(true);
    const turn = s.dir === 0 || s.dir === 2 ? 1 : 0;
    guest.room.send(SNAKE_MSG.turn, { dir: turn });
    await waitFor(() => s.dir === turn || !s.alive, 2000, 'turn after reconnect');
    expect(cellX(g, s.body[0] ?? 0)).toBeGreaterThanOrEqual(0);
    expect(cellY(g, s.body[0] ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it('ignores malformed turns without disconnecting and never lets a client move a snake directly', async () => {
    const host = await create('Host');
    await join(host.room.roomId, 'Guest');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).match.status === 'running', 5000, 'running');
    const g = game(host.server);
    const mine = g.snakes[st(host.room).snakes.get(host.me().playerId).slot]!;
    const q = mine.queue.length;
    for (const bad of [{ dir: 4 }, { dir: -1 }, { dir: 1.5 }, { dir: 'up' }, null, { x: 3, y: 3 }, 'x'.repeat(4000)]) host.room.send(SNAKE_MSG.turn, bad);
    await sleep(150);
    expect(mine.queue.length).toBe(q);
    host.room.send('snake:eat', { cell: 5 });
    host.room.send('snake:score', { score: 9999 });
    await sleep(150);
    expect(mine.score).toBeLessThan(9999);
    expect(host.room.connection.isOpen).toBe(true);
  });

  it('duplicate start/turn messages are idempotent and a reconnect re-sends the private verdict', async () => {
    const host = await create('Solo', { solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host.room).standings.get(me)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(host.room).match.status === 'running', 4000, 'running');
    expect(st(host.room).match.matchId).toBe(1);
    const g = game(host.server);
    const s0 = g.snakes[0]!;
    host.room.send(SNAKE_MSG.turn, { dir: 0 });
    host.room.send(SNAKE_MSG.turn, { dir: 0 });
    await waitFor(() => s0.dir === 0, 2000, 'turn');
    expect(s0.queue.length).toBe(0);
    await waitFor(() => host.verdicts.length === 1, 8000, 'verdict');
    const first = host.verdicts[0]!;
    host.room.reconnection.minUptime = 0;
    host.room.reconnection.delay = 300;
    host.room.reconnection.minDelay = 300;
    host.room.reconnection.maxDelay = 300;
    const back = new Promise<void>((r) => host.room.onReconnect(() => r()));
    (host.room as any).connection.transport.ws.close(4010);
    await back;
    await waitFor(() => host.verdicts.length === 2, 3000, 'verdict re-sent');
    expect(host.verdicts[1]).toEqual(first);
  });
});
