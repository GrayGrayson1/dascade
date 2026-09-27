/**
 * Race progress + anti-cheat (same rules as DASh Circuit's race.ts, on the kart track):
 *  - Progress s is the main-line arc length (branch positions map linearly onto their span).
 *  - Gates must be crossed in order; skipping one (teleport, wall clip) never counts. No gate
 *    lies inside a branch or gap span, so real shortcuts work but can't skip checkpoints.
 *  - Driving back over the last gate un-passes it (and un-completes the lap for the line).
 *  - A step whose progress jumps more than MAX_STEP_DISTANCE is a discontinuity: nothing counts.
 *  - Ranking is capped at the next unpassed gate.
 */
import { loopDelta, mod } from './math.ts';
import type { KartTrack } from './track.ts';

export interface KartProgress {
  /** 0 = on the grid, 1..laps = current lap, laps+1 = finished. */
  lap: number;
  nextGate: number;
  s: number;
  lapStarts: number[];
  lapTimes: number[];
  bestLapMs: number;
  wrongWayMs: number;
  wrongWay: boolean;
  finished: boolean;
  finishMs: number;
}

export type ProgressEvent =
  | { type: 'lap-start'; lap: number; atMs: number }
  | { type: 'gate'; gate: number; lap: number }
  | { type: 'gate-undo'; gate: number }
  | { type: 'lap'; lap: number; lapMs: number; best: boolean }
  | { type: 'lap-undo'; lap: number }
  | { type: 'finish'; timeMs: number }
  | { type: 'wrong-way'; on: boolean };

export const WRONG_WAY_ON_MS = 1000;
/** Largest plausible progress change in one step (u). Branch shortcuts map ≤ ~3× driven distance. */
export const MAX_STEP_DISTANCE = 6;

export function createProgress(s: number): KartProgress {
  return {
    lap: 0,
    nextGate: 0,
    s,
    lapStarts: [],
    lapTimes: [],
    bestLapMs: 0,
    wrongWayMs: 0,
    wrongWay: false,
    finished: false,
    finishMs: 0,
  };
}

export interface ProgressSample {
  s: number;
  headingDot: number;
  velDot: number;
  speed: number;
  /** Race time at the start/end of the step (ms). */
  t0: number;
  t1: number;
}

export function advanceProgress(p: KartProgress, sample: ProgressSample, track: KartTrack, totalLaps: number): ProgressEvent[] {
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
    // Discontinuity (respawn, teleport): gates in between were not driven through.
  } else if (ds > 0) {
    let crossed = true;
    // Crossings in travel order (at most a couple per step).
    while (crossed && !p.finished) {
      crossed = false;
      const g = p.nextGate;
      const rel = mod(gates[g]! - prevS, L);
      if (rel > 0 && rel <= ds) {
        crossForward(p, g, sample.t0 + dtMs * (rel / ds), count, totalLaps, events);
        crossed = p.nextGate !== g;
      }
    }
  } else if (ds < 0 && p.lap > 0) {
    const last = (p.nextGate - 1 + count) % count;
    const rel = mod(prevS - gates[last]!, L);
    if (rel >= 0 && rel < -ds) crossBackward(p, last, count, events);
  }
  p.s = sample.s;
  const against = (sample.headingDot < -0.3 && sample.speed > 3) || sample.velDot < -4;
  if (against) p.wrongWayMs = Math.min(5000, p.wrongWayMs + dtMs);
  else p.wrongWayMs = Math.max(0, p.wrongWayMs - dtMs * 3);
  if (!p.wrongWay && p.wrongWayMs >= WRONG_WAY_ON_MS) {
    p.wrongWay = true;
    events.push({ type: 'wrong-way', on: true });
  } else if (p.wrongWay && p.wrongWayMs === 0) {
    p.wrongWay = false;
    events.push({ type: 'wrong-way', on: false });
  }
  return events;
}

function crossForward(p: KartProgress, gate: number, at: number, count: number, totalLaps: number, events: ProgressEvent[]): void {
  if (gate !== p.nextGate) return;
  if (gate === 0) {
    if (p.lap === 0) {
      p.lap = 1;
      p.lapStarts = [0];
      p.nextGate = 1 % count;
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
    p.nextGate = 1 % count;
    events.push({ type: 'lap-start', lap: p.lap, atMs: at });
    return;
  }
  p.nextGate = (gate + 1) % count;
  events.push({ type: 'gate', gate, lap: p.lap });
}

function crossBackward(p: KartProgress, gate: number, count: number, events: ProgressEvent[]): void {
  if (gate === 0) {
    if (p.lap === 1 && p.lapTimes.length === 0) {
      p.lap = 0;
      p.lapStarts = [];
    } else {
      p.lapTimes.pop();
      p.lapStarts.pop();
      p.lap -= 1;
      p.bestLapMs = p.lapTimes.length ? Math.min(...p.lapTimes) : 0;
      events.push({ type: 'lap-undo', lap: p.lap });
    }
    p.nextGate = 0;
    return;
  }
  p.nextGate = gate;
  events.push({ type: 'gate-undo', gate });
  void count;
}

/** Validated race distance: laps × length + distance into the lap, capped at the next gate. */
export function rankDistance(p: KartProgress, track: KartTrack): number {
  const L = track.length;
  if (p.lap === 0) return Math.min(0, p.s - L);
  if (p.finished) return (p.lap - 1) * L;
  const cap = p.nextGate === 0 ? L : track.gates[p.nextGate]!;
  return (p.lap - 1) * L + Math.min(p.s, cap);
}

/** Standings comparator (negative = a ahead). */
export function compareStanding(
  a: { finishOrder: number; dnf: boolean; distance: number },
  b: { finishOrder: number; dnf: boolean; distance: number },
): number {
  if (a.finishOrder && b.finishOrder) return a.finishOrder - b.finishOrder;
  if (a.finishOrder) return -1;
  if (b.finishOrder) return 1;
  if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
  return b.distance - a.distance;
}
