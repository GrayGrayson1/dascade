/**
 * Fixed-step helpers. Every Classics simulation advances in whole ticks (CLASSICS.tickHz);
 * rendering interpolates between ticks. The accumulator never spirals: after a long stall
 * (background tab, debugger) it drops the backlog beyond `maxSteps`.
 */

export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

export function ticksToMs(ticks: number, hz = TICK_HZ): number {
  return (ticks * 1000) / hz;
}

export function msToTicks(ms: number, hz = TICK_HZ): number {
  return Math.floor((ms * hz) / 1000);
}

export class FixedStepper {
  readonly stepMs: number;
  private acc = 0;
  /** Steps dropped because the backlog exceeded maxSteps (diagnostics). */
  dropped = 0;

  constructor(
    hz = TICK_HZ,
    private readonly maxSteps = 6,
  ) {
    this.stepMs = 1000 / hz;
  }

  /** Feed elapsed wall time; returns how many fixed steps to run now. */
  advance(elapsedMs: number): number {
    if (!(elapsedMs > 0)) return 0;
    this.acc += Math.min(elapsedMs, 1000);
    let steps = Math.floor(this.acc / this.stepMs);
    this.acc -= steps * this.stepMs;
    if (steps > this.maxSteps) {
      this.dropped += steps - this.maxSteps;
      steps = this.maxSteps;
      this.acc = 0;
    }
    return steps;
  }

  /** Fraction [0, 1) of the next step already elapsed (render interpolation). */
  get alpha(): number {
    return this.acc / this.stepMs;
  }

  reset(): void {
    this.acc = 0;
  }
}
