/**
 * Coalesces rapid writes (a volume slider emits one change per step) into a single trailing write
 * after `delayMs` of quiet, and never runs two writes at once — so a slow request can't complete
 * after a newer one and leave a stale value stored. `flush()` writes the pending value right away
 * (e.g. on pagehide); `flush(true)` doesn't wait for an in-flight write (the page is going away).
 */
export interface CoalescedWriter<T> {
  schedule(value: T): void;
  flush(force?: boolean): void;
  /** A value is waiting or being written. */
  busy(): boolean;
}

export function createCoalescedWriter<T>(write: (value: T) => Promise<unknown>, delayMs: number): CoalescedWriter<T> {
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const flush = (force = false): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending || (inFlight && !force)) return;
    const { value } = pending;
    pending = null;
    inFlight = true;
    void Promise.resolve()
      .then(() => write(value))
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        // Changes that arrived meanwhile go out next (after their own quiet period if still pending).
        if (pending && !timer) flush();
      });
  };

  return {
    schedule(value) {
      pending = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => flush(), delayMs);
    },
    flush,
    busy: () => pending !== null || inFlight,
  };
}
