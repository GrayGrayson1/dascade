/**
 * Race progress: checkpoints, laps, wrong-way detection and ranking.
 *
 * - Progress is measured by projecting the car onto the centerline (arc length s).
 * - Gates sit at ordered arc lengths; gate 0 is the start/finish line. A gate only
 *   counts when it is the *next* gate, so skipping one (a shortcut, a teleport) never
 *   counts: the car must go back through it.
 * - Driving back over the most recent gate un-passes it (and un-completes the lap for
 *   the finish line), so rocking over the line can't farm laps.
 * - The ranking value is capped at the next unpassed gate, so it is robust to shortcuts.
 */
import { loopDelta, mod } from './math.ts';
import type { Track } from './track.ts';

export interface RaceProgress {
  /** 0 = on the grid (line not crossed yet), 1..laps = current lap, laps+1 = finished. */
  lap: number;
  /** Index of the next gate to cross. */
  nextGate: number;
  /** Last projected arc length. */
  s: number;
  /** Race-time (ms) at which each lap started; lapStarts[k] = start of lap k+1. */
  lapStarts: number[];
  lapTimes: number[];
  bestLapMs: number;
  /** Split time (ms since lap start) at each gate passed in the current lap. */
  splits: number[];
  wrongWayMs: number;
  wrongWay: boolean;
  finished: boolean;
  finishMs: number;
}

export type ProgressEvent =
  | { type: 'lap-start'; lap: number; atMs: number }
  | { type: 'gate'; gate: number; lap: number; splitMs: number }
  | { type: 'gate-undo'; gate: number }
  | { type: 'lap'; lap: number; lapMs: number; best: boolean }
  | { type: 'lap-undo'; lap: number }
  | { type: 'finish'; timeMs: number }
  | { type: 'wrong-way'; on: boolean };

export const WRONG_WAY_ON_MS = 1000;
/** Largest plausible arc-length change in one step; anything bigger is a discontinuity. */
export const MAX_STEP_DISTANCE = 160;

export function createProgress(s: number): RaceProgress {
  return {
    lap: 0,
    nextGate: 0,
    s,
    lapStarts: [],
    lapTimes: [],
    bestLapMs: 0,
    splits: [],
    wrongWayMs: 0,
    wrongWay: false,
    finished: false,
    finishMs: 0,
  };
}

export interface ProgressSample {
  /** New projected arc length. */
  s: number;
  /** cos(heading vs track direction). */
  headingDot: number;
  /** Velocity along the track direction (px/s). */
  velDot: number;
  speed: number;
  /** Race time at the start and end of the step (ms). */
  t0: number;
  t1: number;
}

/**
 * Advance progress by one simulation step. Mutates `p` and returns the events.
 * `totalLaps` is the race length; crossing the line after the final lap finishes.
 */
export function advanceProgress(p: RaceProgress, sample: ProgressSample, track: Track, totalLaps: number): ProgressEvent[] {
  const events: ProgressEvent[] = [];
  if (p.finished) {
    p.s = sample.s;
    return events;
  }
  const L = track.length;
  const gates = track.gates;
  const count = gates.length;
  const prevS = p.s;
  const ds = loopDelta(prevS, sample.s, L);
  const dtMs = sample.t1 - sample.t0;

  if (Math.abs(ds) > MAX_STEP_DISTANCE) {
    // Discontinuity (teleport, lost projection, shortcut through a wall): gates in
    // between were not driven through, so none of them count.
  } else if (ds > 0) {
    // Forward: gates in (prevS, prevS + ds], in travel order.
    const hits: Array<{ gate: number; rel: number }> = [];
    for (let g = 0; g < count; g++) {
      const rel = mod(gates[g]! - prevS, L);
      if (rel > 0 && rel <= ds) hits.push({ gate: g, rel });
    }
    hits.sort((a, b) => a.rel - b.rel);
    for (const hit of hits) {
      const at = sample.t0 + dtMs * (hit.rel / ds);
      crossForward(p, hit.gate, at, count, totalLaps, events);
      if (p.finished) break;
    }
  } else if (ds < 0) {
    // Backward: gates in [prevS + ds, prevS), most recent first.
    const hits: Array<{ gate: number; rel: number }> = [];
    for (let g = 0; g < count; g++) {
      const rel = mod(prevS - gates[g]!, L);
      if (rel >= 0 && rel < -ds) hits.push({ gate: g, rel });
    }
    hits.sort((a, b) => a.rel - b.rel);
    for (const hit of hits) crossBackward(p, hit.gate, count, events);
  }
  p.s = sample.s;

  // Wrong way: facing or moving against the track direction for over a second.
  const against = (sample.headingDot < -0.3 && sample.speed > 30) || sample.velDot < -60;
  if (!p.finished) {
    if (against) p.wrongWayMs = Math.min(5000, p.wrongWayMs + dtMs);
    else p.wrongWayMs = Math.max(0, p.wrongWayMs - dtMs * 3);
    if (!p.wrongWay && p.wrongWayMs >= WRONG_WAY_ON_MS) {
      p.wrongWay = true;
      events.push({ type: 'wrong-way', on: true });
    } else if (p.wrongWay && p.wrongWayMs === 0) {
      p.wrongWay = false;
      events.push({ type: 'wrong-way', on: false });
    }
  }
  return events;
}

function crossForward(p: RaceProgress, gate: number, at: number, count: number, totalLaps: number, events: ProgressEvent[]): void {
  if (gate !== p.nextGate) return;
  const after = count > 1 ? 1 : 0;
  if (gate === 0) {
    if (p.lap === 0) {
      // First crossing after the standing start: lap 1 is timed from the green light.
      p.lap = 1;
      p.lapStarts = [0];
      p.splits = [];
      p.nextGate = after;
      events.push({ type: 'lap-start', lap: 1, atMs: 0 });
      return;
    }
    const lapMs = Math.max(0, Math.round(at - (p.lapStarts[p.lap - 1] ?? 0)));
    p.lapTimes.push(lapMs);
    const best = p.bestLapMs === 0 || lapMs < p.bestLapMs;
    if (best) p.bestLapMs = lapMs;
    events.push({ type: 'lap', lap: p.lap, lapMs, best });
    if (p.lap >= totalLaps) {
      p.lap = totalLaps + 1;
      p.finished = true;
      p.finishMs = Math.round(at);
      p.nextGate = 0;
      p.wrongWay = false;
      p.wrongWayMs = 0;
      events.push({ type: 'finish', timeMs: p.finishMs });
      return;
    }
    p.lap += 1;
    p.lapStarts.push(at);
    p.splits = [];
    p.nextGate = after;
    events.push({ type: 'lap-start', lap: p.lap, atMs: at });
    return;
  }
  const splitMs = Math.max(0, Math.round(at - (p.lapStarts[p.lap - 1] ?? 0)));
  p.splits[gate] = splitMs;
  p.nextGate = (gate + 1) % count;
  events.push({ type: 'gate', gate, lap: p.lap, splitMs });
}

function crossBackward(p: RaceProgress, gate: number, count: number, events: ProgressEvent[]): void {
  const lastPassed = (p.nextGate - 1 + count) % count;
  if (p.lap === 0 || gate !== lastPassed) return;
  if (gate === 0) {
    // Reversed back over the line: undo the lap change.
    if (p.lap === 1 && p.lapTimes.length === 0) {
      p.lap = 0;
      p.lapStarts = [];
    } else {
      const undone = p.lapTimes.pop();
      p.lapStarts.pop();
      p.lap -= 1;
      p.bestLapMs = p.lapTimes.length ? Math.min(...p.lapTimes) : 0;
      if (undone !== undefined) events.push({ type: 'lap-undo', lap: p.lap });
    }
    p.nextGate = 0;
    p.splits = [];
    return;
  }
  p.nextGate = gate;
  p.splits.length = Math.min(p.splits.length, gate);
  events.push({ type: 'gate-undo', gate });
}

/**
 * Validated race distance used for positions: completed laps × length plus the
 * distance into the current lap, capped at the next unpassed gate.
 */
export function rankDistance(p: RaceProgress, track: Track): number {
  const L = track.length;
  if (p.lap === 0) return Math.min(0, p.s - L);
  if (p.finished) return (p.lap - 1) * L;
  const cap = p.nextGate === 0 ? L : track.gates[p.nextGate]!;
  return (p.lap - 1) * L + Math.min(p.s, cap);
}

/** Compare two racers for standings (negative = a ahead). */
export function compareStanding(
  a: { progress: RaceProgress; finishOrder: number; dnf: boolean; distance: number },
  b: { progress: RaceProgress; finishOrder: number; dnf: boolean; distance: number },
): number {
  if (a.finishOrder && b.finishOrder) return a.finishOrder - b.finishOrder;
  if (a.finishOrder) return -1;
  if (b.finishOrder) return 1;
  if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
  return b.distance - a.distance;
}
