/**
 * requestAnimationFrame-driven fixed-step loop for the Classics.
 *
 *   const loop = new FixedLoop({ hz: 60, step: () => {...}, render: (alpha) => {...} });
 *   loop.start(); … loop.stop();   // or useFixedLoop(...) which disposes on unmount
 *
 * `step` runs at exactly `hz` per second of wall time (bounded catch-up after hitches);
 * `render` runs once per animation frame with the interpolation alpha. Nothing here touches
 * React state — keep per-frame data in refs / the canvas.
 */
import { useEffect, useRef } from 'react';
import { FixedStepper } from '@dascade/game-core/classics/shared';

export interface FixedLoopOptions {
  hz?: number;
  /** Max fixed steps per animation frame (the rest of a long stall is dropped). */
  maxSteps?: number;
  step: () => void;
  render: (alpha: number, frameMs: number) => void;
}

export class FixedLoop {
  private raf = 0;
  private last = 0;
  private running = false;
  private readonly stepper: FixedStepper;

  constructor(private readonly opts: FixedLoopOptions) {
    this.stepper = new FixedStepper(opts.hz ?? 60, opts.maxSteps ?? 5);
  }

  private readonly frame = (now: number) => {
    if (!this.running) return;
    const elapsed = this.last ? now - this.last : 0;
    this.last = now;
    const steps = this.stepper.advance(elapsed);
    for (let i = 0; i < steps; i++) this.opts.step();
    this.opts.render(this.stepper.alpha, elapsed);
    this.raf = requestAnimationFrame(this.frame);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.stepper.reset();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }
}

/** Runs a FixedLoop for the component's lifetime. Callbacks are read through refs (no restarts). */
export function useFixedLoop(step: () => void, render: (alpha: number, frameMs: number) => void, hz = 60): void {
  const stepRef = useRef(step);
  const renderRef = useRef(render);
  stepRef.current = step;
  renderRef.current = render;
  useEffect(() => {
    const loop = new FixedLoop({ hz, step: () => stepRef.current(), render: (a, f) => renderRef.current(a, f) });
    loop.start();
    return () => loop.stop();
  }, [hz]);
}
