/**
 * The contract between a Classics engine and the verified-run plumbing.
 *
 * A verified engine is a deterministic state machine advanced one tick at a time. Inputs are
 * small integer codes applied at a tick BEFORE that tick is stepped:
 *
 *   for each tick t:  apply every event whose tick === t (in log order), then step() → t + 1
 *
 * The client and the server run exactly this loop over the same seed and the same log, so
 * they reach the same state. The server's result always wins.
 */
import type { RunSummary } from '@dascade/shared/games/classics';

export interface ClassicsSim {
  /** Ticks stepped so far. */
  readonly tick: number;
  /**
   * Game over: further steps are no-ops. IMPORTANT: `over` may only become true inside step().
   * If an input ends the game (e.g. a hard drop that tops out), keep `over` false until the
   * following step() has advanced `tick` once more — otherwise the ending input's tick would
   * equal the final tick and could never be carried by a batch (events must be < upTo).
   */
  readonly over: boolean;
  /** Apply one input code at the current tick. Returns false (state untouched) when the code is not valid. */
  input(code: number): boolean;
  /** Advance exactly one fixed tick. */
  step(): void;
  /** Current verified summary. */
  summary(): RunSummary;
}

export type SimFactory<S extends ClassicsSim = ClassicsSim> = (seed: string, options: Record<string, number | string | boolean>) => S;

export interface InputEvent {
  tick: number;
  code: number;
}

export type AdvanceResult =
  | { ok: true; ticks: number; over: boolean }
  | { ok: false; reason: 'bad-code' | 'bad-tick' | 'too-long'; ticks: number };

/**
 * Apply `events` (absolute ticks, non-decreasing, each ≥ sim.tick) and step the sim until it
 * reaches `upTo`, it ends, or `limitTicks` is hit. Events at or after `upTo` are refused.
 */
export function advanceSim(sim: ClassicsSim, events: readonly InputEvent[], upTo: number, limitTicks = Infinity): AdvanceResult {
  let i = 0;
  const target = Math.min(upTo, limitTicks);
  for (const ev of events) {
    if (ev.tick < sim.tick || ev.tick >= upTo) return { ok: false, reason: 'bad-tick', ticks: sim.tick };
  }
  while (sim.tick < target && !sim.over) {
    while (i < events.length && events[i]!.tick === sim.tick) {
      if (!sim.input(events[i]!.code)) return { ok: false, reason: 'bad-code', ticks: sim.tick };
      i++;
    }
    sim.step();
  }
  return { ok: true, ticks: sim.tick, over: sim.over };
}

/** Replay a whole run from scratch (resume after reconnect, tests, audits). */
export function replayRun<S extends ClassicsSim>(factory: SimFactory<S>, seed: string, options: Record<string, number | string | boolean>, events: readonly InputEvent[], upTo: number): S {
  const sim = factory(seed, options);
  advanceSim(sim, events, upTo);
  return sim;
}
