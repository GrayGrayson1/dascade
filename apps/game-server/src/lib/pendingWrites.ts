/**
 * Fire-and-forget database writes in flight (tournament snapshots, high scores, match summaries).
 * Gameplay never waits on them, but a clean shutdown (deploy, instance sleep) waits briefly so the
 * last results aren't lost — see index.ts.
 */
const inflight = new Set<Promise<unknown>>();

/** Track a background write until it settles. Returns the same promise. */
export function trackWrite<T>(write: Promise<T>): Promise<T> {
  inflight.add(write);
  const done = () => void inflight.delete(write);
  write.then(done, done);
  return write;
}

/** Writes currently in flight (tests). */
export function pendingWriteCount(): number {
  return inflight.size;
}

/**
 * Wait for every tracked write plus the ones `start` kicks off (e.g. flushing queued rows), for at
 * most `timeoutMs`. Resolves true when everything settled in time; never rejects.
 */
export async function drainWrites(timeoutMs: number, start: Array<() => Promise<unknown>> = []): Promise<boolean> {
  const started = start.map((fn) => {
    try {
      return fn();
    } catch (err) {
      return Promise.reject(err);
    }
  });
  const all = Promise.allSettled([...inflight, ...started]).then(() => true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
  try {
    return await Promise.race([all, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
