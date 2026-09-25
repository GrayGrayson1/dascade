import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import { CIRCUIT_MSG, packInput, type CircuitEvent } from '@dascade/shared/games/circuit';
import { createCar, decodeSnapshot, pointAt, type RaceSim, type Snapshot } from '@dascade/game-core/circuit';
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
  snaps: Snapshot[];
  events: CircuitEvent[];
  errors: Array<{ code: string; type?: string }>;
  seq: number;
}

function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  const events = collect<CircuitEvent>(room, CIRCUIT_MSG.event);
  const snaps: Snapshot[] = [];
  room.onMessage(CIRCUIT_MSG.snap, (bytes: Uint8Array) => {
    const snap = decodeSnapshot(bytes);
    if (snap) snaps.push(snap);
  });
  quiet(room);
  return { room, me: () => welcomes[welcomes.length - 1]!, snaps, events, errors, seq: 1 };
}

async function createHost(name = 'Host', extra: Record<string, unknown> = {}) {
  const room = await colyseus.sdk.create('circuit', { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  const server = colyseus.getRoomById(room.roomId) as unknown as CircuitRoom;
  (server as any).countdownMs = 250;
  (server as any).resultsDelayMs = 150;
  return { ...client, server };
}

async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
  const room = await colyseus.sdk.joinById(code, { name, ...extra });
  const client = wire(room);
  await room.waitForInitialState();
  await waitFor(() => Boolean(client.me()), 3000, 'welcome');
  return client;
}

const sim = (server: CircuitRoom) => (server as any).sim as RaceSim;
const racer = (c: Client, id = c.me().playerId) => st(c.room).racers.get(id);

/** Stream inputs like the real client: 2 frames per packet at ~30 packets/s. */
async function drive(c: Client, input: number | ((c: Client) => number), ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const a = typeof input === 'number' ? input : input(c);
    const b = typeof input === 'number' ? input : input(c);
    c.room.send(CIRCUIT_MSG.input, { seq: c.seq, inputs: [a, b] });
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
  await waitFor(() => st(host.room).phase === 'COUNTDOWN' || st(host.room).phase === 'PLAYING', 3000, 'countdown');
}

/** Test-only shortcut: put a car just before the finish line on its final lap. */
function placeBeforeFinish(server: CircuitRoom, slot: number, distanceBefore: number, lateral = 0) {
  const s = sim(server);
  const car = s.car(slot)!;
  const track = s.track;
  const sPos = track.length - distanceBefore;
  const p = pointAt(track, sPos);
  car.state = createCar(p.x - p.ty * lateral, p.y + p.tx * lateral, Math.atan2(p.ty, p.tx), track, 0);
  car.progress.lap = s.opts.laps;
  car.progress.lapStarts = Array.from({ length: s.opts.laps }, (_, i) => i * 1000);
  car.progress.lapTimes = Array.from({ length: s.opts.laps - 1 }, () => 1000);
  car.progress.nextGate = 0;
  car.progress.s = sPos;
  car.info = { ...car.info, s: sPos };
}

describe('CircuitRoom', () => {
  it('stores validated car setups and sanitizes nameplates', async () => {
    const host = await createHost('Speedy');
    const cars = () => st(host.room).cars.get(host.me().playerId);
    await waitFor(() => Boolean(cars()), 2000, 'default car');
    expect(cars().nameplate.length).toBeLessThanOrEqual(8);
    host.room.send(CIRCUIT_MSG.car, {
      chassis: 'comet',
      primary: '#FF4FD8',
      secondary: '#22d3ee',
      decal: 'flames',
      wheels: 'turbo',
      number: 42,
      nameplate: '  zoom​zoom racer!!  ',
    });
    await waitFor(() => cars().chassis === 'comet', 2000, 'car update');
    expect(cars()).toMatchObject({ chassis: 'comet', primary: '#ff4fd8', decal: 'flames', wheels: 'turbo', number: 42 });
    expect(cars().nameplate).toBe('ZOOMZOOM');
    host.room.send(CIRCUIT_MSG.car, { chassis: 'tank', primary: 'red', secondary: '#000000', decal: 'none', wheels: 'spoke', number: 420, nameplate: 'x' });
    await waitFor(() => host.errors.some((e) => e.code === 'invalid_payload'), 2000, 'reject');
    expect(cars().chassis).toBe('comet');
  });

  it('builds a locked grid on countdown, acknowledges inputs, then races on server physics', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Guest');
    await startRace(host);
    await waitFor(() => host.snaps.length > 0, 2000, 'first snapshot');
    expect(st(host.room).racers.size).toBe(2);
    const first = host.snaps[host.snaps.length - 1]!;
    expect(first.cars.length).toBe(2);
    const mySlot = racer(host).slot;
    const gridX = first.cars.find((c) => c.slot === mySlot)!.state.x;

    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'green light');
    expect(st(host.room).race.status).toBe('racing');
    expect(host.events.some((e) => e.kind === 'go')).toBe(true);
    const before = racer(host).distance;
    await Promise.all([drive(host, GAS, 1500), drive(guest, packInput({ throttle: 0, brake: 0, steer: 0, drift: false, boost: false }), 1500)]);
    await waitFor(() => racer(host).distance > before + 300, 2000, 'progress');
    const latest = host.snaps[host.snaps.length - 1]!;
    const mine = latest.cars.find((c) => c.slot === mySlot)!;
    expect(mine.ack).toBeGreaterThan(20);
    expect(Math.hypot(mine.state.x - gridX, mine.state.y - first.cars.find((c) => c.slot === mySlot)!.state.y)).toBeGreaterThan(300);
    expect(latest.status).toBe(1);
    expect(racer(host).lap).toBe(1);
    expect(racer(host).position).toBe(1);
    expect(racer(guest).position).toBe(2);
  });

  it('only accepts inputs: clients cannot teleport, claim checkpoints or finish', async () => {
    const host = await createHost();
    const cheater = await join(host.room.roomId, 'Cheater');
    await startRace(host, { laps: 1 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const cheaterId = cheater.me().playerId;
    const slot = racer(cheater).slot;
    const car = sim(host.server).car(slot)!;
    const startX = car.state.x;
    const startY = car.state.y;
    // Extra fields in an input packet are stripped: no teleporting, no lap claims.
    cheater.room.send(CIRCUIT_MSG.input, { seq: 1, inputs: [0], x: 99999, y: 99999, lap: 9, finished: true, gate: 7 });
    await sleep(250);
    expect(car.state.x).toBeCloseTo(startX, 0);
    expect(car.state.y).toBeCloseTo(startY, 0);
    // Invented message types are never handled (Colyseus drops the offending client).
    cheater.room.send('circuit:lap', { lap: 3 });
    cheater.room.send('circuit:finish', {});
    cheater.room.send('circuit:checkpoint', { gate: 7 });
    await sleep(300);
    const serverRacer = host.server.state.racers.get(cheaterId)!;
    expect(serverRacer.lap).toBeLessThanOrEqual(1);
    expect(serverRacer.finished).toBe(false);
    expect(serverRacer.finishOrder).toBe(0);
    expect(car.progress.finished).toBe(false);
    expect(car.progress.lapTimes).toEqual([]);
    // The honest racer and the race itself are unaffected.
    expect(host.server.state.phase).toBe('PLAYING');
    expect(host.room.connection.isOpen).toBe(true);
    await drive(host, GAS, 400);
    expect(racer(host).distance).toBeGreaterThan(-300);
  });

  it('rejects malformed and oversized input packets without disconnecting', async () => {
    const host = await createHost();
    await startRace(host);
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const server = host.server;
    const before = server.stats.inputPackets;
    const bad: unknown[] = [
      { seq: 1, inputs: Array.from({ length: 500 }, () => GAS) },
      { seq: 1, inputs: [] },
      { seq: 0, inputs: [GAS] },
      { seq: -5, inputs: [GAS] },
      { seq: 1.5, inputs: [GAS] },
      { seq: 1, inputs: [1 << 20] },
      { seq: 1, inputs: [-1] },
      { seq: 1, inputs: ['gas'] },
      { seq: 1, inputs: [0.5] },
      { seq: '1', inputs: [GAS] },
      { seq: 1, inputs: 'x'.repeat(60_000) },
      'x'.repeat(100_000),
      null,
      42,
    ];
    for (const payload of bad) host.room.send(CIRCUIT_MSG.input, payload);
    await sleep(300);
    expect(server.stats.inputPackets).toBe(before);
    expect(host.errors.filter((e) => e.type === CIRCUIT_MSG.input)).toEqual([]); // silent stream
    expect(host.room.connection.isOpen).toBe(true);
    // A valid packet still works afterwards.
    host.room.send(CIRCUIT_MSG.input, { seq: 1, inputs: [GAS, GAS] });
    await waitFor(() => server.stats.inputPackets === before + 1, 2000, 'valid packet');
  });

  it('rate-limits input packets and cannot be sped up by flooding', async () => {
    const host = await createHost();
    await startRace(host);
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const server = host.server;
    const before = server.stats.inputPackets;
    for (let i = 0; i < 100; i++) {
      host.room.send(CIRCUIT_MSG.input, { seq: host.seq, inputs: Array.from({ length: 8 }, () => GAS) });
      host.seq += 8;
    }
    await sleep(400);
    const accepted = server.stats.inputPackets - before;
    expect(accepted).toBeGreaterThan(10);
    expect(accepted).toBeLessThanOrEqual(50);
    expect(host.room.connection.isOpen).toBe(true);
    // Simulation credit: the car never ran more frames than server ticks elapsed.
    const car = sim(server).car(0)!;
    expect(car.applied).toBeLessThanOrEqual(sim(server).tick + 12);
  });

  it('decides the finish order on the server and ends in RESULTS', async () => {
    const host = await createHost('Ann');
    const guest = await join(host.room.roomId, 'Ben');
    await startRace(host, { laps: 1, finishWindowSec: 10 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const hostSlot = racer(host).slot;
    const guestSlot = racer(guest).slot;
    // Guest is closer to the line, so the server must award them P1.
    placeBeforeFinish(host.server, guestSlot, 220, 40);
    placeBeforeFinish(host.server, hostSlot, 420, -40);
    await Promise.all([drive(host, GAS, 2500), drive(guest, GAS, 2500)]);
    await waitFor(() => st(host.room).phase === 'RESULTS', 4000, 'results');
    expect(racer(guest).finishOrder).toBe(1);
    expect(racer(host).finishOrder).toBe(2);
    expect(racer(guest).finished).toBe(true);
    expect(racer(host).finishMs).toBeGreaterThan(racer(guest).finishMs);
    const finishes = host.events.filter((e) => e.kind === 'finish');
    expect(finishes.map((e) => (e as { playerId: string }).playerId)).toEqual([guest.me().playerId, host.me().playerId]);
    expect(st(host.room).race.status).toBe('done');
    expect(st(host.room).players.get(guest.me().playerId).score).toBeGreaterThan(st(host.room).players.get(host.me().playerId).score);
  });

  it('starts a solo time trial immediately', async () => {
    const solo = await createHost('Solo', { solo: true });
    await waitFor(() => st(solo.room).phase === 'COUNTDOWN' || st(solo.room).phase === 'PLAYING', 3000, 'auto start');
    expect(st(solo.room).locked).toBe(true);
    expect(st(solo.room).race.solo).toBe(true);
    await waitFor(() => st(solo.room).racers.size === 1, 2000, 'racer');
    await waitFor(() => st(solo.room).phase === 'PLAYING', 6000, 'playing');
    await drive(solo, GAS, 800);
    await waitFor(() => racer(solo).distance > -200, 2000, 'moving');
    await expect(colyseus.sdk.joinById(solo.room.roomId, { name: 'Intruder' })).rejects.toBeTruthy();
  });

  it('a disconnected racer never stalls the race', async () => {
    const host = await createHost('Stay');
    const guest = await join(host.room.roomId, 'Drop');
    await startRace(host, { laps: 1, finishWindowSec: 90 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const guestId = guest.me().playerId;
    const guestSlot = racer(guest).slot;
    guest.room.reconnection.enabled = false;
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => st(host.room).players.get(guestId)?.connected === false, 3000, 'drop');
    expect(sim(host.server).car(guestSlot)!.connected).toBe(false);
    // Fast-forward the disconnect so the race stops waiting for them.
    sim(host.server).car(guestSlot)!.disconnectedTicks = 10_000;
    placeBeforeFinish(host.server, racer(host).slot, 200);
    await drive(host, GAS, 1500);
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'results despite the drop');
    expect(st(host.room).racers.get(guestId).dnf).toBe(true);
    expect(racer(host).finishOrder).toBe(1);
  });

  it('a racer leaving mid-race is retired and the race goes on', async () => {
    const host = await createHost('Stay');
    const guest = await join(host.room.roomId, 'Quit');
    await startRace(host, { laps: 2 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const guestId = guest.me().playerId;
    await guest.room.leave(true);
    await waitFor(() => st(host.room).racers.get(guestId)?.dnf === true, 3000, 'dnf');
    expect(st(host.room).racers.get(guestId).active).toBe(false);
    expect(st(host.room).phase).toBe('PLAYING');
    await drive(host, GAS, 600);
    const latest = host.snaps[host.snaps.length - 1]!;
    expect(latest.cars.map((c) => c.slot)).toEqual([racer(host).slot]);
  });

  it('late joiners spectate and their inputs are ignored', async () => {
    const host = await createHost();
    await startRace(host);
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const late = await join(host.room.roomId, 'Late');
    expect(st(late.room).players.get(late.me().playerId).spectator).toBe(true);
    const before = host.server.stats.inputPackets;
    late.room.send(CIRCUIT_MSG.input, { seq: 1, inputs: [GAS, GAS] });
    await sleep(200);
    expect(host.server.stats.inputPackets).toBe(before);
    expect(st(host.room).racers.has(late.me().playerId)).toBe(false);
    await waitFor(() => late.snaps.length > 0, 2000, 'spectator snapshots');
  });

  it('reconnecting racers keep their car and can drive again', async () => {
    const host = await createHost();
    const guest = await join(host.room.roomId, 'Flaky');
    await startRace(host);
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const slot = racer(guest).slot;
    guest.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((r) => guest.room.onReconnect(() => r()));
    (guest.room as any).connection.transport.ws.close(4010);
    await waitFor(() => sim(host.server).car(slot)!.connected === false, 3000, 'dropped');
    await reconnected;
    await waitFor(() => sim(host.server).car(slot)!.connected === true, 3000, 'back');
    const ack = sim(host.server).car(slot)!.ackSeq;
    await drive(guest, GAS, 600);
    await waitFor(() => sim(host.server).car(slot)!.ackSeq > ack, 2000, 'inputs after reconnect');
  });

  it('the host can rematch straight from the results', async () => {
    const host = await createHost();
    await startRace(host, { laps: 1 });
    await waitFor(() => st(host.room).phase === 'PLAYING', 3000, 'playing');
    const firstRace = st(host.room).race.raceId;
    placeBeforeFinish(host.server, 0, 150);
    await drive(host, GAS, 1200);
    await waitFor(() => st(host.room).phase === 'RESULTS', 3000, 'results');
    host.room.send(CIRCUIT_MSG.rematch, {});
    await waitFor(() => st(host.room).phase === 'COUNTDOWN' || st(host.room).phase === 'PLAYING', 3000, 'rematch');
    await waitFor(() => st(host.room).race.raceId !== firstRace, 2000, 'new race id');
    expect(st(host.room).racers.get(host.me().playerId).finished).toBe(false);
  });
});
