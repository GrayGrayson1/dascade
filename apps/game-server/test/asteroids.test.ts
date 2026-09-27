import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { GameOutcome, WelcomePayload } from '@dascade/shared';
import { CLASSICS_MSG, type RunVerdict } from '@dascade/shared/games/classics';
import { ASTEROIDS_MSG, packControls, type AsteroidsEventPayload, type ShipControls } from '@dascade/shared/games/asteroids';
import { botFrame, decodeAsteroidsSnapshot, type AsteroidsSnapshot, type World } from '@dascade/game-core/asteroids';
import { onOutcome } from '../src/platform/hub.ts';
import type { AsteroidsRoom } from '../src/rooms/asteroids/AsteroidsRoom.ts';
import { bootTestServer, collect, sleep, waitFor, quiet } from './helpers.ts';

let colyseus: ColyseusTestServer;
const outcomes: Array<{ outcome: GameOutcome; game: string }> = [];
let unsubscribe: () => void = () => undefined;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['asteroids']));
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
const ctl = (c: Partial<ShipControls>) => packControls({ left: false, right: false, thrust: false, fire: false, aim: false, aimDir: 0, ...c });

interface Client {
  room: SdkRoom;
  me: () => WelcomePayload;
  snaps: AsteroidsSnapshot[];
  events: AsteroidsEventPayload[];
  verdicts: RunVerdict[];
  errors: Array<{ code: string; type?: string }>;
  seq: number;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  const events = collect<AsteroidsEventPayload>(room, ASTEROIDS_MSG.event);
  const verdicts = collect<RunVerdict>(room, CLASSICS_MSG.verdict);
  const snaps: AsteroidsSnapshot[] = [];
  room.onMessage(ASTEROIDS_MSG.snap, (bytes: Uint8Array) => {
    const snap = decodeAsteroidsSnapshot(bytes);
    if (snap) snaps.push(snap);
  });
  room.onMessage(CLASSICS_MSG.event, () => undefined);
  quiet(room);
  return { room, me: () => welcomes[welcomes.length - 1]!, snaps, events, verdicts, errors, seq: 1 };
}

async function create(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('asteroids', { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as AsteroidsRoom;
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

const world = (server: AsteroidsRoom) => (server as any).world as World;
const slotOf = (c: Client, host: Client) => st(host.room).pilots.get(c.me().playerId)?.slot as number;

/** Stream frames like the real client: 2 per packet at ~30 packets/s. */
async function fly(c: Client, frame: number | (() => number), ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const a = typeof frame === 'number' ? frame : frame();
    const b = typeof frame === 'number' ? frame : frame();
    if (c.room.connection.isOpen) c.room.send(ASTEROIDS_MSG.input, { seq: c.seq, inputs: [a, b] });
    c.seq += 2;
    await sleep(33);
  }
}

describe('AsteroidsRoom — solo', () => {
  it('flies on server physics, acknowledges input, clears a wave and records a verified score', async () => {
    const host = await create('Solo', { solo: true });
    const me = host.me().playerId;
    await waitFor(() => st(host.room).standings.get(me)?.status === 'ready', 3000, 'instructions');
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => Boolean(world(host.server)), 3000, 'world');
    await waitFor(() => Date.now() >= st(host.room).run.startAt && st(host.room).run.status === 'play', 4000, 'launch');
    const w = world(host.server);
    const ship = w.ships[0]!;
    const x0 = ship.x;
    await fly(host, ctl({ thrust: true, fire: true }), 700);
    await waitFor(() => (host.snaps.at(-1)?.ships[0]?.ack ?? 0) > 10, 2000, 'ack');
    expect(ship.x).toBeGreaterThan(x0); // thrusting along heading 0 (+x)
    expect(host.snaps.some((s) => s.bullets.length > 0)).toBe(true);
    // Clear the field (test only): the wave bonus pays out and wave 2 follows.
    w.rocks = [];
    await waitFor(() => host.events.some((e) => e.kind === 'wave'), 2000, 'wave clear');
    await waitFor(() => st(host.room).run.wave === 2, 5000, 'wave 2');
    expect(st(host.room).pilots.get(me).score).toBeGreaterThanOrEqual(250);
    // Lose the last ship.
    ship.lives = 1;
    ship.shield = 0;
    ship.invuln = 0;
    w.rocks.push({ id: 60000, kind: 'stone', size: 3, hp: 9, x: ship.x, y: ship.y, vx: 0, vy: 0, spin: 0 });
    await waitFor(() => host.verdicts.length > 0, 4000, 'verdict');
    const v = host.verdicts[0]!;
    expect(v.reason).toBe('over');
    expect(v.board).toBe('pilot');
    expect(v.level).toBe(2);
    expect(v.score).toBe(w.ships[0]!.score);
    expect(v.rank).toBe(1);
    expect(host.events.some((e) => e.kind === 'ship-down')).toBe(true);
    await waitFor(() => st(host.room).standings.get(me)?.status === 'over', 2000, 'standing over');
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => st(host.room).run.matchId === 2, 3000, 'retry');
  });

  it('never flies faster than real time, however many frames a client sends', async () => {
    const host = await create('Flood', { solo: true });
    await waitFor(() => st(host.room).standings.get(host.me().playerId)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => Boolean(world(host.server)) && Date.now() >= st(host.room).run.startAt + 50, 4000, 'running');
    const w = world(host.server);
    const t0 = w.tick;
    const frames = Array.from({ length: 8 }, () => ctl({ thrust: true }));
    for (let i = 0; i < 40; i++) host.room.send(ASTEROIDS_MSG.input, { seq: host.seq + i * 8, inputs: frames });
    host.seq += 320;
    await sleep(300);
    const ack = host.snaps.at(-1)!.ships[0]!.ack;
    // Frames consumed ≤ ticks elapsed (+ the credit bank), never the 320 sent.
    expect(ack).toBeLessThanOrEqual(w.tick - t0 + 12);
    for (const bad of [{ seq: 1, inputs: [] }, { seq: 0, inputs: [1] }, { seq: 1, inputs: [1 << 12] }, { seq: 1, inputs: Array(40).fill(1) }, null, 'boom']) {
      host.room.send(ASTEROIDS_MSG.input, bad);
    }
    host.room.send('asteroids:score', { score: 1e6 });
    await sleep(150);
    expect(w.ships[0]!.score).toBeLessThan(1e6);
    expect(host.room.connection.isOpen).toBe(true);
  });

  it('pauses (solo only)', async () => {
    const host = await create('Solo', { solo: true });
    await waitFor(() => st(host.room).standings.get(host.me().playerId)?.status === 'ready', 3000, 'ready');
    host.room.send(CLASSICS_MSG.start, {});
    await waitFor(() => Boolean(world(host.server)) && Date.now() >= st(host.room).run.startAt + 50, 4000, 'running');
    host.room.send(ASTEROIDS_MSG.pause, { paused: true });
    await waitFor(() => st(host.room).run.paused === true, 2000, 'paused');
    const t = world(host.server).tick;
    await sleep(300);
    expect(world(host.server).tick).toBe(t);
    host.room.send(ASTEROIDS_MSG.pause, { paused: false });
    await waitFor(() => world(host.server).tick > t, 3000, 'resumed');
  });
});

describe('AsteroidsRoom — co-op', () => {
  it('three bot pilots clear a wave together, then the run ends when everyone is out', async () => {
    const host = await create('Lead');
    const b = await join(host.room.roomId, 'Wing');
    const c = await join(host.room.roomId, 'Tail');
    const watcher = await join(host.room.roomId, 'Watcher', { spectator: true });
    host.room.send('lobby:settings', { settings: { difficulty: 'cadet' } });
    await sleep(100);
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING' && st(host.room).run.status === 'play', 5000, 'playing');
    expect(st(host.room).run.coop).toBe(true);
    expect(st(host.room).pilots.size).toBe(3);
    const w = world(host.server);
    // Keep the wave short (test only): three small rocks.
    w.rocks = w.rocks.slice(0, 3).map((r) => ({ ...r, size: 1, hp: 1 }));
    const pilots = [host, b, c] as Client[];
    const stop = { on: true };
    const flights = pilots.map((p) => fly(p, () => (stop.on ? botFrame(w, slotOf(p, host)) : 0), 20_000));
    try {
      await waitFor(() => host.events.some((e) => e.kind === 'wave'), 18_000, 'wave cleared');
    } finally {
      stop.on = false;
    }
    await Promise.race([Promise.all(flights), sleep(50)]);
    const bonus = host.events.find((e) => e.kind === 'wave') as Extract<AsteroidsEventPayload, { kind: 'wave' }>;
    expect(bonus.bonus).toBe(250);
    for (const p of pilots) expect(st(host.room).pilots.get(p.me().playerId).score).toBeGreaterThanOrEqual(250);
    expect(watcher.snaps.length).toBeGreaterThan(5);
    watcher.room.send(ASTEROIDS_MSG.input, { seq: 1, inputs: [ctl({ fire: true })] });
    expect(world(host.server).bullets.every((q) => q.owner < 3)).toBe(true);
    // Everyone loses their last ship at once (test only) → run over → RESULTS by score.
    for (const s of w.ships) {
      s.lives = 1;
      s.shield = 0;
      s.invuln = 0;
      s.alive = true;
      s.respawnIn = 0;
      w.rocks.push({ id: 61000 + s.slot, kind: 'iron', size: 3, hp: 9, x: s.x, y: s.y, vx: 0, vy: 0, spin: 0 });
    }
    w.status = 'play';
    await waitFor(() => st(host.room).phase === 'RESULTS', 6000, 'results');
    const out = outcomes.find((o) => o.game === 'asteroids')!;
    expect(out.outcome.placements.flat().sort()).toEqual(pilots.map((p) => p.me().playerId).sort());
    const scores = out.outcome.scores!;
    const first = out.outcome.placements[0]![0]!;
    expect(scores[first]).toBe(Math.max(...Object.values(scores)));
    expect(host.verdicts.at(-1)!.reason).toBe('over');
    // Verdicts are private: each pilot gets their own score, the spectator nothing.
    await waitFor(() => b.verdicts.length > 0, 2000, 'wing verdict');
    expect(b.verdicts.at(-1)!.score).toBe(scores[b.me().playerId]);
    expect(watcher.verdicts).toEqual([]);
  }, 40_000);

  it('a leaving pilot is retired; the last one out ends the run', async () => {
    const host = await create('Lead');
    const b = await join(host.room.roomId, 'Wing');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 4000, 'playing');
    const leaver = b.me().playerId;
    await b.room.leave(true);
    await waitFor(() => st(host.room).pilots.get(leaver)?.active === false, 3000, 'retired');
    expect(st(host.room).phase).toBe('PLAYING');
    const w = world(host.server);
    expect(w.ships[slotOf(b, host)]!.retired).toBe(true);
    const s = w.ships[slotOf(host, host)]!;
    s.lives = 1;
    s.shield = 0;
    s.invuln = 0;
    w.rocks.push({ id: 62000, kind: 'stone', size: 3, hp: 9, x: s.x, y: s.y, vx: 0, vy: 0, spin: 0 });
    await waitFor(() => st(host.room).phase === 'RESULTS', 5000, 'results');
    const out = outcomes.find((o) => o.game === 'asteroids')!;
    expect(out.outcome.placements.at(-1)).toEqual([leaver]);
  });

  it('co-op runs refuse to pause', async () => {
    const host = await create('Lead');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 4000, 'playing');
    host.room.send(ASTEROIDS_MSG.pause, { paused: true });
    await waitFor(() => host.errors.some((e) => e.type === ASTEROIDS_MSG.pause), 2000, 'refused');
    expect(st(host.room).run.paused).toBe(false);
  });
});
