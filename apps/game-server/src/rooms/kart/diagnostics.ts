/**
 * DASphalt GP server diagnostics: per-room tick timing (ring buffer for percentiles) and a
 * process-wide event-loop delay monitor. Only exposed to clients (`kart:diag`) on servers started
 * with relaxed limits (tests, load simulation); the counters themselves are always cheap.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

const RING = 4096;

export class TickStats {
  snapshots = 0;
  snapshotBytes = 0;
  snapshotMaxBytes = 0;
  /** Per-racer exact-state messages (`kart:own`). */
  owns = 0;
  ownBytes = 0;
  inputPackets = 0;
  inputFrames = 0;
  /** Frames that arrived but were not queued (duplicates, stale, or for a kart that is no longer racing). */
  inputFramesDropped = 0;
  /** Packets from players without a kart in this race (spectator-ish / late). */
  inputPacketsIgnored = 0;
  /** Packets that re-anchored a kart's sequence after the client restarted its numbering. */
  seqRestarts = 0;
  ticks = 0;
  stepMsTotal = 0;
  stepMsMax = 0;
  private readonly ring = new Float64Array(RING);
  private ringLen = 0;
  private ringPos = 0;

  recordStep(ms: number): void {
    this.ticks++;
    this.stepMsTotal += ms;
    if (ms > this.stepMsMax) this.stepMsMax = ms;
    this.ring[this.ringPos] = ms;
    this.ringPos = (this.ringPos + 1) % RING;
    if (this.ringLen < RING) this.ringLen++;
  }

  recordSnapshot(bytes: number): void {
    this.snapshots++;
    this.snapshotBytes += bytes;
    if (bytes > this.snapshotMaxBytes) this.snapshotMaxBytes = bytes;
  }

  /** Percentile of the recent step times (ms). */
  stepPercentile(p: number): number {
    if (this.ringLen === 0) return 0;
    const xs = Array.from(this.ring.subarray(0, this.ringLen)).sort((a, b) => a - b);
    return xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
  }

  reset(): void {
    this.snapshots = this.snapshotBytes = this.snapshotMaxBytes = this.owns = this.ownBytes = 0;
    this.inputPackets = this.inputFrames = this.inputFramesDropped = this.inputPacketsIgnored = this.seqRestarts = 0;
    this.ticks = this.stepMsTotal = this.stepMsMax = 0;
    this.ringLen = this.ringPos = 0;
  }

  view(): Record<string, number> {
    return {
      ticks: this.ticks,
      stepMsAvg: this.ticks ? this.stepMsTotal / this.ticks : 0,
      stepMsP50: this.stepPercentile(0.5),
      stepMsP99: this.stepPercentile(0.99),
      stepMsMax: this.stepMsMax,
      snapshots: this.snapshots,
      snapshotBytesAvg: this.snapshots ? this.snapshotBytes / this.snapshots : 0,
      snapshotBytesMax: this.snapshotMaxBytes,
      owns: this.owns,
      ownBytesAvg: this.owns ? this.ownBytes / this.owns : 0,
      inputPackets: this.inputPackets,
      inputFrames: this.inputFrames,
      inputFramesDropped: this.inputFramesDropped,
      inputPacketsIgnored: this.inputPacketsIgnored,
      seqRestarts: this.seqRestarts,
    };
  }
}

let loopDelay: ReturnType<typeof monitorEventLoopDelay> | null = null;
/** Sampling resolution (ms); the histogram's values include it, so it is subtracted below. */
const RESOLUTION_MS = 5;

/** Starts the (process-wide) event-loop delay monitor once. */
export function ensureLoopMonitor(): void {
  if (loopDelay) return;
  loopDelay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
  loopDelay.enable();
}

/** Event-loop delay beyond the sampling interval (ms) and memory, since the last reset. */
export function processDiagnostics(reset = false): Record<string, number> {
  const mem = process.memoryUsage();
  const h = loopDelay;
  const out = {
    loopDelayMeanMs: h ? Math.max(0, h.mean / 1e6 - RESOLUTION_MS) : 0,
    loopDelayP99Ms: h ? Math.max(0, h.percentile(99) / 1e6 - RESOLUTION_MS) : 0,
    loopDelayMaxMs: h ? Math.max(0, h.max / 1e6 - RESOLUTION_MS) : 0,
    rssMb: mem.rss / 1048576,
    heapUsedMb: mem.heapUsed / 1048576,
  };
  if (reset) h?.reset();
  return out;
}
