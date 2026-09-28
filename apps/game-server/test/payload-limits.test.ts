/**
 * Oversized-payload guard (BaseGameRoom.handle → `maxNodes`): Zod parses every array element before
 * it checks `.max()`, so every handler is refused anything bigger than its limit before Zod runs.
 *
 * 1. Every handler of every room: the largest payload its schema (or byte budget) accepts stays
 *    below its node limit, so no legitimate message is ever refused by the guard.
 * 2. Kart and DASh Circuit inputs: a full-size hostile frame is dropped without running Zod, while
 *    max-size legitimate packets still drive.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import type { ColyseusTestServer } from '@colyseus/testing';
import { GAME_IDS, LOBBY, type GameId } from '@dascade/shared';
import { KART_MSG, KART_SIM, KartInputSchema } from '@dascade/shared/games/kart';
import { CIRCUIT_MSG, CIRCUIT_SIM, CircuitInputSchema } from '@dascade/shared/games/circuit';
import { TRIVIA_MSG, TriviaPackSchema } from '@dascade/shared/games/trivia';
import { DASKETCH_MSG, SKETCH_LIMITS } from '@dascade/shared/games/dasketch';
import { BaseGameRoom, type MessageOptions } from '../src/rooms/BaseGameRoom.ts';
import { DEFAULT_MAX_NODES } from '../src/lib/payloadNodes.ts';
import { bootTestServer, collect, quiet, sleep, waitFor } from './helpers.ts';
import { schemaBound } from './schemaBounds.ts';

interface Registration {
  game: GameId;
  type: string;
  schema: z.ZodType;
  opts: MessageOptions;
  room: BaseGameRoom;
}

const registrations: Registration[] = [];
const proto = BaseGameRoom.prototype as any;
const originalHandle = proto.handle as (...args: unknown[]) => void;
proto.handle = function (this: BaseGameRoom, type: string, schema: z.ZodType, handler: unknown, opts: MessageOptions = {}) {
  registrations.push({ game: (this as any).gameId, type, schema, opts, room: this });
  return originalHandle.call(this, type, schema, handler, opts);
};

let colyseus: ColyseusTestServer;
beforeAll(async () => {
  ({ colyseus } = await bootTestServer([...GAME_IDS]));
});
afterEach(async () => {
  await colyseus.cleanup();
});
afterAll(async () => {
  proto.handle = originalHandle;
  await colyseus.shutdown();
});

/** The most values a legitimate payload of this handler can hold. */
function legitMaxNodes(r: Registration): number {
  const room = r.room as any;
  if (r.type === LOBBY.settings) {
    // Refused outright where settings never change from the lobby (the tournament kiosk).
    if ((room.settingsEditablePhases as readonly string[]).length === 0) return 0;
    return 2 + schemaBound(room.settingsSchema).nodes; // { settings: {...} }
  }
  // The envelope is `unknown` (validated per question in the handler); the client sends a validated pack.
  if (r.type === TRIVIA_MSG.pack) return 2 + schemaBound(TriviaPackSchema).nodes;
  // The draw schema's own budget: ≤ eventsPerMessage events, ≤ pointsPerMessage points in the message.
  if (r.type === DASKETCH_MSG.draw) return 3 + SKETCH_LIMITS.eventsPerMessage * 6 + SKETCH_LIMITS.pointsPerMessage * 2;
  const bound = schemaBound(r.schema).nodes;
  // A JSON text of L characters holds at most (L + 1) / 2 values ("[0,0,…]").
  if (!Number.isFinite(bound) && r.opts.maxBytes !== undefined) return Math.floor((r.opts.maxBytes + 1) / 2);
  return bound;
}

async function openEveryRoom(): Promise<void> {
  for (const id of GAME_IDS) {
    const client = await colyseus.sdk.create(id, { name: 'Probe' });
    quiet(client);
    await client.waitForInitialState();
  }
}

describe('payload node limits', () => {
  it('every handler of every game accepts its largest legitimate payload', async () => {
    registrations.length = 0;
    await openEveryRoom();
    const games = new Set(registrations.map((r) => r.game));
    expect([...games].sort()).toEqual([...GAME_IDS].sort());

    let largest = { nodes: 0, where: '' };
    for (const r of registrations) {
      const limit = r.opts.maxNodes ?? DEFAULT_MAX_NODES;
      const legit = legitMaxNodes(r);
      const where = `${r.game} ${r.type}`;
      expect(Number.isFinite(legit), `${where}: unbounded payload`).toBe(true);
      expect(legit, `${where}: legitimate maximum ${legit} vs limit ${limit}`).toBeLessThan(limit);
      if (r.opts.maxNodes === undefined && legit > largest.nodes) largest = { nodes: legit, where };
    }
    // The default leaves real headroom over the largest payload that relies on it
    // (today: tournament:admin, bounded by its 8 KB byte cap, then a 200-question trivia pack).
    expect(largest.nodes * 2, largest.where).toBeLessThan(DEFAULT_MAX_NODES);

    // Every high-rate stream sets its own tight limit (schema maximum + a small margin).
    const streams = registrations.filter((r) => r.opts.silent && r.opts.rate && r.opts.rate.perSecond >= 10);
    expect(streams.length).toBeGreaterThanOrEqual(12);
    for (const r of streams) {
      expect(r.opts.maxNodes, `${r.game} ${r.type} sets maxNodes`).toBeDefined();
      expect(r.opts.maxNodes!, `${r.game} ${r.type} limit stays tight`).toBeLessThanOrEqual(legitMaxNodes(r) + 64);
    }
  });

  it('kart inputs: a full-size hostile frame never reaches Zod; max-size packets still drive', async () => {
    const host = quiet(await colyseus.sdk.create('kart', { name: 'Host' }));
    await host.waitForInitialState();
    const server = colyseus.getRoomById(host.roomId) as any;
    server.countdownMs = 250;
    host.send('lobby:settings', { settings: { bots: 0, laps: 1 } });
    await sleep(100);
    host.send('lobby:start', {});
    await waitFor(() => (host.state as any).phase === 'PLAYING', 5000, 'playing');
    const parse = vi.spyOn(KartInputSchema, 'safeParse');
    try {
      const before = server.stats.inputPackets;
      host.send(KART_MSG.input, { seq: 1, inputs: new Array<number>(240_000).fill(1) });
      await sleep(200);
      expect(parse).not.toHaveBeenCalled(); // refused by the node guard, before any parse
      expect(server.stats.inputPackets).toBe(before);

      const frames = new Array<number>(KART_SIM.maxInputsPerPacket).fill(15);
      host.send(KART_MSG.input, { seq: 1, inputs: frames });
      host.send(KART_MSG.input, { seq: 1 + frames.length, inputs: frames });
      await waitFor(() => server.stats.inputPackets === before + 2, 3000, 'legit packets accepted');
      expect(parse).toHaveBeenCalledTimes(2);
      expect(server.stats.inputFrames).toBeGreaterThanOrEqual(frames.length);
    } finally {
      parse.mockRestore();
    }
  });

  it('DASh Circuit inputs: a full-size hostile frame never reaches Zod; max-size packets still drive', async () => {
    const solo = quiet(await colyseus.sdk.create('circuit', { name: 'Solo', solo: true }));
    await solo.waitForInitialState();
    const server = colyseus.getRoomById(solo.roomId) as any;
    await waitFor(() => ['COUNTDOWN', 'PLAYING'].includes((solo.state as any).phase), 5000, 'race');
    const parse = vi.spyOn(CircuitInputSchema, 'safeParse');
    try {
      const before = server.stats.inputPackets;
      solo.send(CIRCUIT_MSG.input, { seq: 1, inputs: new Array<number>(240_000).fill(1) });
      await sleep(200);
      expect(parse).not.toHaveBeenCalled();
      expect(server.stats.inputPackets).toBe(before);

      solo.send(CIRCUIT_MSG.input, { seq: 1, inputs: new Array<number>(CIRCUIT_SIM.maxInputsPerPacket).fill(1) });
      await waitFor(() => server.stats.inputPackets === before + 1, 3000, 'legit packet accepted');
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });

  it('handlers without their own limit get the platform default (reply: too large)', async () => {
    const host = quiet(await colyseus.sdk.create('kart', { name: 'Host' }));
    const errors = collect<{ type?: string; code: string; message: string }>(host, 'sys:error');
    await host.waitForInitialState();
    host.send('lobby:settings', { settings: { laps: 2, junk: new Array<number>(DEFAULT_MAX_NODES).fill(0) } });
    await waitFor(() => errors.length > 0, 3000, 'rejection');
    expect(errors[0]).toMatchObject({ type: 'lobby:settings', code: 'invalid_payload', message: 'That action is too large.' });
    expect(JSON.parse((host.state as any).settingsJson).laps).toBe(3);
    host.send('lobby:settings', { settings: { laps: 2 } });
    await waitFor(() => JSON.parse((host.state as any).settingsJson).laps === 2, 3000, 'normal settings still apply');
  });
});
