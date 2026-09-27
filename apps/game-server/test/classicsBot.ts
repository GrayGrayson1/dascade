/**
 * Test helpers for DAScade Classics rooms: a verified-run "bot" that plays the real engine,
 * records its inputs with the kit's InputRecorder and streams them exactly like the web client.
 */
import type { Room as SdkRoom } from '@colyseus/sdk';
import { CLASSICS_MSG, type RunAck, type RunInputBatch, type RunTicket, type RunVerdict } from '@dascade/shared/games/classics';
import { InputRecorder, type ClassicsSim } from '@dascade/game-core/classics/shared';
import { collect, quiet, waitFor } from './helpers.ts';

export interface ClassicsClient {
  room: SdkRoom;
  tickets: RunTicket[];
  verdicts: RunVerdict[];
  acks: RunAck[];
  errors: Array<{ code: string; type?: string }>;
  events: unknown[];
  me: () => { playerId: string; seatToken: string };
}

export function wireClassics(room: SdkRoom): ClassicsClient {
  const welcomes = collect<{ playerId: string; seatToken: string }>(room, 'sys:welcome');
  const tickets = collect<RunTicket>(room, CLASSICS_MSG.run);
  const verdicts = collect<RunVerdict>(room, CLASSICS_MSG.verdict);
  const acks = collect<RunAck>(room, CLASSICS_MSG.ack);
  const errors = collect<{ code: string; type?: string }>(room, 'sys:error');
  const events = collect<unknown>(room, CLASSICS_MSG.event);
  quiet(room);
  return { room, tickets, verdicts, acks, errors, events, me: () => welcomes[welcomes.length - 1]! };
}

export interface BotOptions<S extends ClassicsSim> {
  /** Codes to apply at the current tick. */
  policy: (sim: S) => number[];
  maxTicks?: number;
  /** Stop (without game over) after this many ticks — e.g. to test reconnects mid-run. */
  stopAt?: number;
  batchEvery?: number;
  /** Real-time pacing: ms to wait after each batch (0 = as fast as the server allows). */
  pauseMs?: number;
}

/** Plays a run to game over (or stopAt), streaming batches. Returns the local sim for comparisons. */
export async function playRun<S extends ClassicsSim>(
  client: ClassicsClient,
  ticket: RunTicket,
  factory: (seed: string, options: Record<string, number | string | boolean>) => S,
  opts: BotOptions<S>,
): Promise<{ sim: S; recorder: InputRecorder }> {
  const sim = factory(ticket.seed, ticket.options);
  const recorder = new InputRecorder();
  const every = opts.batchEvery ?? 60;
  // Stay inside the server's per-player input rate (CLASSICS_INPUT_RATE) like a real client would.
  let tokens = 30;
  let last = Date.now();
  const pace = async () => {
    for (;;) {
      const now = Date.now();
      tokens = Math.min(30, tokens + ((now - last) / 1000) * 12);
      last = now;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const max = opts.maxTicks ?? 200_000;
  const limit = ticket.limitTicks > 0 ? ticket.limitTicks : Infinity;
  const send = async (final: boolean) => {
    for (;;) {
      const b = recorder.take(sim.tick);
      if (!b) break;
      await pace();
      const payload: RunInputBatch = { runId: ticket.runId, seq: b.seq, upTo: b.upTo, events: b.events };
      if (final && b.upTo >= sim.tick) {
        payload.final = true;
        payload.clientScore = sim.summary().score;
      }
      client.room.send(CLASSICS_MSG.input, payload);
    }
  };
  while (!sim.over && sim.tick < max && sim.tick < limit) {
    if (opts.stopAt !== undefined && sim.tick >= opts.stopAt) {
      await send(false);
      return { sim, recorder };
    }
    for (const code of opts.policy(sim)) if (sim.input(code)) recorder.record(sim.tick, code);
    sim.step();
    if (sim.tick % every === 0) {
      await send(false);
      if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
      else if (sim.tick % (every * 20) === 0) await new Promise((r) => setImmediate(r));
    }
  }
  await send(true);
  return { sim, recorder };
}

export async function waitVerdict(client: ClassicsClient, runId: string, timeoutMs = 6000): Promise<RunVerdict> {
  await waitFor(() => client.verdicts.some((v) => v.runId === runId), timeoutMs, 'verdict');
  return client.verdicts.find((v) => v.runId === runId)!;
}

export async function nextTicket(client: ClassicsClient, after = 0, timeoutMs = 4000): Promise<RunTicket> {
  await waitFor(() => client.tickets.length > after, timeoutMs, 'ticket');
  return client.tickets[client.tickets.length - 1]!;
}
