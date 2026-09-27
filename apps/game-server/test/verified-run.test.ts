/**
 * VerifiedRun (Classics kit, authority model 2) — pure unit tests with a tiny fake engine: the
 * 60-minute length cap ends a run with a real verdict, and the behind-real-time measure that backs
 * the solo pause budget.
 */
import { describe, expect, it } from 'vitest';
import { CLASSICS, RunInputBatchSchema } from '@dascade/shared/games/classics';
import type { ClassicsSim } from '@dascade/game-core/classics/shared';
import { VerifiedRun } from '../src/rooms/classics/VerifiedRun.ts';

/** Counts ticks; codes 1–3 are valid. Never ends by itself. */
class CounterSim implements ClassicsSim {
  tick = 0;
  over = false;
  readonly inputs: Array<[number, number]> = [];
  input(code: number): boolean {
    if (code < 1 || code > 3) return false;
    this.inputs.push([this.tick, code]);
    return true;
  }
  step(): void {
    this.tick++;
  }
  summary() {
    return { score: this.tick, level: 1, lives: 0, stat: this.inputs.length };
  }
}

const TICK_MS = 1000 / CLASSICS.tickHz;

function newRun(startAt = 0, limitTicks = 0) {
  const sim = new CounterSim();
  const run = new VerifiedRun({ runId: 'r1', matchNo: 1, playerId: 'p1', seed: 's', startAt, limitTicks, options: {}, board: 'arcade', sim, maxCode: 3 });
  return { run, sim };
}

describe('VerifiedRun — length cap', () => {
  it('a batch crossing the 60-minute cap ends the run there with a real (recordable) verdict', () => {
    const { run, sim } = newRun();
    const cap = CLASSICS.maxRunTicks;
    const now = (cap + 600) * TICK_MS; // plenty of wall clock
    expect(run.ingest({ runId: 'r1', seq: 1, upTo: cap - 12, events: [] }, now)).toEqual({ status: 'ok', ended: false });
    // One input before the cap, one after it (an older client that kept playing).
    const crossing = { runId: 'r1', seq: 2, upTo: cap + 12, events: [7, 1, 8, 2] };
    expect(RunInputBatchSchema.safeParse(crossing).success).toBe(true);
    expect(run.ingest(crossing, now)).toEqual({ status: 'ok', ended: true, reason: 'time' });
    expect(sim.tick).toBe(cap);
    expect(sim.inputs).toEqual([[cap - 5, 1]]);
    expect(run.log).toEqual([{ tick: cap - 5, code: 1 }]);
    expect(run.upTo).toBe(cap);
  });

  it('timed races still end at their own (shorter) limit', () => {
    const { run, sim } = newRun(0, 120);
    expect(run.ingest({ runId: 'r1', seq: 1, upTo: 130, events: [] }, 10_000)).toEqual({ status: 'ok', ended: true, reason: 'time' });
    expect(sim.tick).toBe(120);
  });
});

describe('VerifiedRun — behind real time (solo pause budget)', () => {
  it('counts pauses / slow motion since the best position, not network latency', () => {
    const { run } = newRun(0);
    const at = (ticks: number) => ticks * TICK_MS + 1; // wall clock after `ticks` of real time
    expect(run.behindTicks(at(300))).toBe(0); // nothing verified yet
    // 60 ticks in: the client verified 54 (6 ticks of latency — the baseline).
    run.ingest({ runId: 'r1', seq: 1, upTo: 54, events: [] }, at(60));
    expect(run.behindTicks(at(60))).toBe(0);
    // Two seconds without batches (paused): 120 ticks behind.
    expect(run.behindTicks(at(180))).toBe(120);
    // Resumed at normal speed: the gap stays (it can't catch up past real time).
    run.ingest({ runId: 'r1', seq: 2, upTo: 114, events: [] }, at(240));
    expect(run.behindTicks(at(240))).toBe(120);
  });

  it('a client that was allowed far ahead (clock moved) has no backlog', () => {
    const { run } = newRun(-30 * 60_000);
    run.ingest({ runId: 'r1', seq: 1, upTo: 600, events: [] }, 0);
    run.ingest({ runId: 'r1', seq: 2, upTo: 6_000, events: [] }, 500);
    expect(run.behindTicks(500)).toBe(0);
  });

  it('an unranked run re-sends its ticket without a board', () => {
    const { run } = newRun();
    expect(run.ticket().board).toBe('arcade');
    run.unranked = true;
    expect(run.ticket().board).toBe('');
  });
});
