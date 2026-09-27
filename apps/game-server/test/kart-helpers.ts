/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers reach into room internals (like the *.test.ts files) */
/** Shared helpers for the DASphalt GP room tests. */
import type { ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import type { WelcomePayload } from '@dascade/shared';
import { KART_MSG, packKartInput, type KartEvent } from '@dascade/shared/games/kart';
import { KartBot, decodeKartOwn, decodeKartSnapshot, type KartOwn, type KartSim, type KartSnapshot } from '@dascade/game-core/kart';
import { collect, sleep, waitFor, quiet } from './helpers.ts';
import type { KartRoom } from '../src/rooms/kart/KartRoom.ts';

export const st = (room: SdkRoom) => room.state as any;
export const GAS = packKartInput({ throttle: 1, brake: 0, steer: 0, drift: false, item: false, back: false });
export const IDLE = packKartInput({ throttle: 0, brake: 0, steer: 0, drift: false, item: false, back: false });

export interface Client {
  room: SdkRoom;
  me: () => WelcomePayload;
  snaps: KartSnapshot[];
  owns: KartOwn[];
  events: KartEvent[];
  errors: Array<{ code: string; type?: string }>;
  seq: number;
}

export function wire(room: SdkRoom): Client {
  const welcomes = collect<WelcomePayload>(room, 'sys:welcome');
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  const events = collect<KartEvent>(room, KART_MSG.event);
  const snaps: KartSnapshot[] = [];
  room.onMessage(KART_MSG.snap, (bytes: Uint8Array) => {
    const snap = decodeKartSnapshot(bytes);
    if (snap) snaps.push(snap);
    if (snaps.length > 400) snaps.splice(0, 200);
  });
  const owns: KartOwn[] = [];
  room.onMessage(KART_MSG.own, (bytes: Uint8Array) => {
    const own = decodeKartOwn(bytes);
    if (own) owns.push(own);
    if (owns.length > 400) owns.splice(0, 200);
  });
  room.onMessage('kart:diag', () => undefined);
  quiet(room);
  return { room, me: () => welcomes[welcomes.length - 1]!, snaps, owns, events, errors, seq: 1 };
}

export type Host = Client & { server: KartRoom };

export function kartHelpers(get: () => ColyseusTestServer) {
  async function createHost(name = 'Host', extra: Record<string, unknown> = {}): Promise<Host> {
    const room = await get().sdk.create('kart', { name, ...extra });
    const client = wire(room);
    await room.waitForInitialState();
    await waitFor(() => Boolean(client.me()), 3000, 'welcome');
    const server = get().getRoomById(room.roomId) as unknown as KartRoom;
    tune(server);
    return { ...client, server };
  }

  async function join(code: string, name: string, extra: Record<string, unknown> = {}): Promise<Client> {
    const room = await get().sdk.joinById(code, { name, ...extra });
    const client = wire(room);
    await room.waitForInitialState();
    await waitFor(() => Boolean(client.me()), 3000, 'welcome');
    return client;
  }

  return { createHost, join };
}

/** Short timers for tests. */
export function tune(server: KartRoom): void {
  (server as any).countdownMs = 250;
  (server as any).resultsDelayMs = 150;
  (server as any).intermissionMs = 400;
}

export const sim = (server: KartRoom) => (server as any).sim as KartSim;
export const racer = (c: Client, id = c.me().playerId) => st(c.room).racers.get(id);

/** Stream inputs like the real client: 2 frames per packet at ~30 packets/s. */
export async function drive(c: Client, input: number, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    c.room.send(KART_MSG.input, { seq: c.seq, inputs: [input, input] });
    c.seq += 2;
    await sleep(33);
  }
}

export async function setSettings(c: Client, settings: Record<string, unknown>): Promise<void> {
  c.room.send('lobby:settings', { settings });
  await waitFor(() => Object.entries(settings).every(([k, v]) => JSON.parse(st(c.room).settingsJson)[k] === v), 3000, 'settings');
}

export async function startRace(host: Client, settings: Record<string, unknown> = {}): Promise<void> {
  if (Object.keys(settings).length) await setSettings(host, settings);
  host.room.send('lobby:start', {});
  await waitFor(() => st(host.room).phase === 'COUNTDOWN' || st(host.room).phase === 'PLAYING', 3000, 'countdown');
}

/**
 * Runs the room's own tick synchronously (the real 60 Hz loop keeps running too), so a whole race
 * of bots can be simulated in a moment. Stops early once the race is decided.
 */
export function fastForward(server: KartRoom, ticks: number, until?: () => boolean): void {
  for (let i = 0; i < ticks; i++) {
    (server as any).tick();
    if (until?.() || sim(server)?.status === 'done') return;
  }
}

/** Autopilot every human kart (test hook) and fast-forward until the race is decided. */
export function simulateRace(server: KartRoom, maxTicks = 60 * 60 * 6): void {
  const s = sim(server);
  for (const [slot] of (server as any).idAt as Map<number, string>) {
    const kart = s.kart(slot);
    if (kart && !kart.bot) (server as any).autopilots.set(slot, new KartBot('hard', slot + 1));
  }
  fastForward(server, maxTicks);
}
