/**
 * DASh Circuit adversarial / robustness tests (room level): reconnects after long
 * outages, hostile payloads, host migration, stray timers and leaving at bad moments.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import { CIRCUIT_MSG, packInput, type CircuitEvent } from '@dascade/shared/games/circuit';
import { createCar, pointAt, type RaceSim } from '@dascade/game-core/circuit';
import { bootTestServer, collect, sleep, waitFor, quiet } from './helpers.ts';
import type { CircuitRoom } from '../src/rooms/circuit/CircuitRoom.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  ({ colyseus } = await bootTestServer(['circuit']));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

const st = (room: SdkRoom) => room.state as any;
const GAS = packInput({ throttle: 1, brake: 0, steer: 0, drift: false, boost: false });

interface Client {
  room: SdkRoom;
  me: () => WelcomePayload;
  events: CircuitEvent[];
  errors: Array<{ code: string; type?: string }>;
  seq: number;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  const events = collect<CircuitEvent>(room, CIRCUIT_MSG.event);
  room.onMessage(CIRCUIT_MSG.snap, () => undefined);
  quiet(room);
  return { room, me: () => welcomes[welcomes.length - 1]!, events, errors, seq: 1 };
}

async function createHost(name = 'Host') {
  const room = await colyseus.sdk.create('circuit', { name });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as CircuitRoom;
  (server as any).countdownMs = 250;
  (server as any).resultsDelayMs = 150;
  return { ...client, server };
}

async function join(code: string, name: string): Promise<Client> {
  const room = await colyseus.sdk.joinById(code, { name });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  return client;
}

const sim = (server: CircuitRoom) => (server as any).sim as RaceSim;
const racer = (c: Client, id = c.me().playerId) => st(c.room).racers.get(id);

async function drive(c: Client, ms: number, input = GAS): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    c.room.send(CIRCUIT_MSG.input, { seq: c.seq, inputs: [input, input] });
    c.seq += 2;
    await sleep(33);
  }
}

async function startRace(host: Awaited<ReturnType<typeof createHost>>, settings: Record<string, unknown> = {}) {
  if (Object.keys(settings).length) {
    host.room.send('lobby:settings', { settings });
    await waitFor(() => Object.entries(settings).every(([k, v]) => JSON.parse(st(host.room).settingsJson)[k] === v), 3000, 'settings');
  }
  host.room.send('lobby:start', {});
  await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
}

function placeBeforeFinish(server: CircuitRoom, slot: number, distanceBefore: number) {
  const s = sim(server);
  const car = s.car(slot)!;
  const sPos = s.track.length - distanceBefore;
  const p = pointAt(s.track, sPos);
  car.state = createCar(p.x, p.y, Math.atan2(p.ty, p.tx), s.track, 0);
  car.progress.lap = s.opts.laps;
  car.progress.lapStarts = Array.from({ length: s.opts.laps }, (_, i) => i * 1000);
  car.progress.lapTimes = Array.from({ length: s.opts.laps - 1 }, () => 1000);
  car.progress.nextGate = 0;
  car.progress.s = sPos;
  car.info = { ...car.info, s: sPos };
}

describe('CircuitRoom under adversarial conditions', () => {
  it('a racer whose client kept numbering frames through a long outage drives again after reconnecting', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Flaky');
    await startRace(host);
    const slot = racer(guest).slot;
    await drive(guest, 300);
    const car = () => sim(host.server).car(slot)!;
    await waitFor(() => car().ackSeq > 5, 2000, 'driving');
    guest.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => car().connected === false, 3000, 'dropped');
    await reconnected;
    await waitFor(() => car().connected === true, 3000, 'back');
    // ~20 s of held-back frames: the real client keeps predicting (and numbering) while stalled.
    guest.seq += 60 * 20;
    const applied = car().applied;
    await drive(guest, 700);
    await waitFor(() => car().applied > applied + 15, 2000, 'inputs accepted after the outage');
    expect(car().ackSeq).toBeGreaterThan(1000);
  });

  it('NaN / Infinity / out-of-range packets are dropped silently and never touch the car', async () => {
    const host = await createHost();
    await startRace(host);
    const before = host.server.stats.inputPackets;
    const car = sim(host.server).car(0)!;
    const state = { ...car.state };
    for (const payload of [
      { seq: Number.NaN, inputs: [GAS] },
      { seq: Number.POSITIVE_INFINITY, inputs: [GAS] },
      { seq: 2 ** 31, inputs: [GAS] },
      { seq: 1, inputs: [Number.NaN] },
      { seq: 1, inputs: [Number.POSITIVE_INFINITY] },
      { seq: 1, inputs: [Number.NEGATIVE_INFINITY] },
      { seq: 1, inputs: { length: 3, 0: GAS } },
    ]) {
      host.room.send(CIRCUIT_MSG.input, payload);
    }
    await sleep(250);
    expect(host.server.stats.inputPackets).toBe(before);
    expect(Number.isFinite(car.state.x) && Number.isFinite(car.state.y)).toBe(true);
    expect(Math.hypot(car.state.x - state.x, car.state.y - state.y)).toBeLessThan(40); // coasting only
    expect(host.room.connection.isOpen).toBe(true);
  });

  it('the host leaving mid-race migrates the host; the race finishes and the new host can rematch', async () => {
    const host = await createHost('Old');
    const guest = await join(host.room.roomId, 'New');
    await startRace(host, { laps: 1 });
    const oldId = host.me().playerId;
    await host.room.leave(true);
    await waitFor(() => st(guest.room).hostId === guest.me().playerId, 3000, 'migration');
    await waitFor(() => racer(guest, oldId)?.dnf === true, 3000, 'old host retired');
    const server = colyseus.getRoomById(guest.room.roomId) as unknown as CircuitRoom;
    placeBeforeFinish(server, racer(guest).slot, 150);
    await drive(guest, 1200);
    await waitFor(() => st(guest.room).phase === 'RESULTS', 3000, 'results');
    expect(racer(guest).finishOrder).toBe(1);
    guest.room.send(CIRCUIT_MSG.rematch, {});
    await waitFor(() => st(guest.room).phase === 'COUNTDOWN' || st(guest.room).phase === 'PLAYING', 3000, 'rematch by the new host');
    // The grid is built on the first countdown tick.
    await waitFor(() => st(guest.room).racers.size === 1, 2000, 'new grid');
    expect(racer(guest).finishOrder).toBe(0);
  });

  it('returning to the lobby during the finish cool-down cancels the pending results (no stray timer)', async () => {
    const host = await createHost();
    (host.server as any).resultsDelayMs = 600;
    await startRace(host, { laps: 1 });
    placeBeforeFinish(host.server, 0, 150);
    await drive(host, 800);
    await waitFor(() => st(host.room).race.status === 'done', 3000, 'race decided');
    expect(st(host.room).phase).toBe('PLAYING');
    host.room.send('lobby:toLobby', {});
    await waitFor(() => st(host.room).phase === 'LOBBY', 2000, 'lobby');
    expect(st(host.room).racers.size).toBe(0);
    // Start the next race right away: the old results timer must not end it.
    (host.server as any).countdownMs = 100;
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'next race');
    await drive(host, 900);
    expect(st(host.room).phase).toBe('PLAYING');
    expect(st(host.room).race.status).toBe('racing');
  });

  it('a racer leaving on the grid is retired; the last racer leaving ends the match cleanly', async () => {
    const host = await createHost();
    (host.server as any).countdownMs = 1500;
    const guest = await join(host.room.roomId, 'Quitter');
    host.room.send('lobby:start', {});
    await waitFor(() => st(host.room).phase === 'COUNTDOWN' && st(host.room).racers.size === 2, 3000, 'grid');
    const guestId = guest.me().playerId;
    await guest.room.leave(true);
    await waitFor(() => racer(host, guestId)?.active === false, 2000, 'retired on the grid');
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'green light anyway');
    expect(racer(host, guestId).dnf).toBe(true);
    expect(st(host.room).race.status).toBe('racing');
    // A spectator stays; the last racer leaves → back to the lobby rather than a dead race.
    const watcher = await join(host.room.roomId, 'Watcher');
    expect(st(watcher.room).players.get(watcher.me().playerId).spectator).toBe(true);
    await host.room.leave(true);
    await waitFor(() => st(watcher.room).phase === 'LOBBY', 3000, 'empty match returns to lobby');
    expect(st(watcher.room).racers.size).toBe(0);
  });
});
