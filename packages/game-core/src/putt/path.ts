/**
 * Compact wire format for simulated rolls: positions quantized to 0.1 units and delta-encoded
 * (small integers → short JSON), events as tuples. Clients decode and interpolate at 60 Hz.
 */
import { PUTT_PATH_SAMPLE, PUTT_TICK_HZ, type PuttPathEvent } from '@dascade/shared/games/putt';
import { PATH_EVENT_INDEX, type SimEvent } from './physics.ts';

export function encodePath(samples: readonly number[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < samples.length; i += 2) {
    const x = Math.round(samples[i]! * 10);
    const y = Math.round(samples[i + 1]! * 10);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

/** Decode to absolute positions [x0, y0, x1, y1, …] in world units. */
export function decodePath(path: readonly number[]): Float64Array {
  const out = new Float64Array(path.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < path.length; i += 2) {
    x += path[i]!;
    y += path[i + 1]!;
    out[i] = x / 10;
    out[i + 1] = y / 10;
  }
  return out;
}

export function encodeEvents(events: readonly SimEvent[]): PuttPathEvent[] {
  return events.map((e) => [e.tick, PATH_EVENT_INDEX[e.kind], Math.round(e.x * 10), Math.round(e.y * 10), Math.round(e.v)]);
}

/** Tick of sample k for a path of `ticks` simulated ticks. */
export function sampleTick(k: number, ticks: number): number {
  return Math.min(k * PUTT_PATH_SAMPLE, ticks);
}

/** Interpolated position along a decoded path at simulation time `tick` (fractional). */
export function pathPosition(pos: Float64Array, ticks: number, tick: number, out: { x: number; y: number }): { x: number; y: number } {
  const n = pos.length / 2;
  if (n === 0) return out;
  if (tick <= 0) {
    out.x = pos[0]!;
    out.y = pos[1]!;
    return out;
  }
  if (tick >= ticks) {
    out.x = pos[(n - 1) * 2]!;
    out.y = pos[(n - 1) * 2 + 1]!;
    return out;
  }
  const k = Math.min(n - 2, Math.floor(tick / PUTT_PATH_SAMPLE));
  const t0 = sampleTick(k, ticks);
  const t1 = sampleTick(k + 1, ticks);
  const f = t1 > t0 ? (tick - t0) / (t1 - t0) : 1;
  const x0 = pos[k * 2]!;
  const y0 = pos[k * 2 + 1]!;
  const x1 = pos[k * 2 + 2]!;
  const y1 = pos[k * 2 + 3]!;
  // Teleports: never slide across the map between two samples.
  if ((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) > 60 * 60) {
    out.x = f < 0.5 ? x0 : x1;
    out.y = f < 0.5 ? y0 : y1;
    return out;
  }
  out.x = x0 + (x1 - x0) * f;
  out.y = y0 + (y1 - y0) * f;
  return out;
}

export function ticksToMs(ticks: number): number {
  return Math.round((ticks * 1000) / PUTT_TICK_HZ);
}
