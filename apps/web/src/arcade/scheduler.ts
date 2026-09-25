/**
 * One shared animation clock for the arcade floor.
 *
 * A single requestAnimationFrame loop ticks every registered job at its own
 * frame rate (the floor runs at ~20–30fps), and only while:
 *   - the page is visible (the loop stops on `visibilitychange`), and
 *   - the job's element is on screen (one shared IntersectionObserver).
 * When nothing is visible the loop parks itself, so an idle tab costs nothing.
 */

type TickFn = (timeSec: number) => void;

interface Job {
  tick: TickFn;
  interval: number;
  last: number;
  visible: boolean;
  el: Element | null;
}

const jobs = new Set<Job>();
const jobByEl = new Map<Element, Job>();
let rafId = 0;
let observer: IntersectionObserver | null = null;
let listening = false;

function hasVisibleJob(): boolean {
  for (const job of jobs) if (job.visible) return true;
  return false;
}

function loop(now: number): void {
  rafId = 0;
  if (document.hidden) return;
  let any = false;
  for (const job of jobs) {
    if (!job.visible) continue;
    any = true;
    if (now - job.last >= job.interval - 3) {
      job.last = now;
      try {
        job.tick(now / 1000);
      } catch {
        /* a broken frame must never kill the loop */
      }
    }
  }
  if (any) rafId = requestAnimationFrame(loop);
}

function wake(): void {
  if (rafId || document.hidden || !hasVisibleJob()) return;
  rafId = requestAnimationFrame(loop);
}

function ensureListeners(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    } else wake();
  });
}

function getObserver(): IntersectionObserver | null {
  if (observer || typeof IntersectionObserver !== 'function') return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const job = jobByEl.get(entry.target);
        if (job) job.visible = entry.isIntersecting;
      }
      wake();
    },
    { rootMargin: '48px' },
  );
  return observer;
}

/**
 * Registers a frame callback. With `el`, the job only ticks while that element
 * intersects the viewport. Returns a disposer.
 */
export function addFrameJob(tick: TickFn, opts: { fps?: number; el?: Element | null } = {}): () => void {
  ensureListeners();
  const el = opts.el ?? null;
  const io = el ? getObserver() : null;
  const job: Job = { tick, interval: 1000 / Math.max(1, opts.fps ?? 30), last: 0, visible: !io, el };
  jobs.add(job);
  if (el && io) {
    jobByEl.set(el, job);
    io.observe(el);
  }
  wake();
  return () => {
    jobs.delete(job);
    if (el) {
      jobByEl.delete(el);
      observer?.unobserve(el);
    }
  };
}

/** Seconds on the shared clock (same timebase the jobs receive). */
export function clockNow(): number {
  return performance.now() / 1000;
}
