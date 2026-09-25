/** Token-bucket rate limiter. `burst` tokens max, refilled at `perSecond`. */
export interface RateSpec {
  burst: number;
  perSecond: number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly spec: RateSpec,
    now: number = Date.now(),
  ) {
    this.tokens = spec.burst;
    this.last = now;
  }

  /** Attempts to consume `cost` tokens. Returns false (and consumes nothing) when limited. */
  take(cost = 1, now: number = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.spec.burst, this.tokens + elapsed * this.spec.perSecond);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/**
 * Keyed token buckets (e.g. per IP or per player+bucket), kept in least-recently-used order.
 * When full, idle keys are swept and then the least recently used keys are evicted — never
 * everything at once, so a flood of fresh keys can't reset the buckets of active abusers.
 */
export class KeyedRateLimiter {
  private buckets = new Map<string, { bucket: TokenBucket; seen: number }>();

  constructor(
    private readonly spec: RateSpec,
    private readonly maxKeys = 10_000,
  ) {}

  take(key: string, cost = 1, now: number = Date.now()): boolean {
    let entry = this.buckets.get(key);
    if (entry) {
      this.buckets.delete(key); // re-insert below: Map order = LRU order
    } else {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      entry = { bucket: new TokenBucket(this.spec, now), seen: now };
    }
    entry.seen = now;
    this.buckets.set(key, entry);
    return entry.bucket.take(cost, now);
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    const idleMs = (this.spec.burst / Math.max(this.spec.perSecond, 0.001)) * 1000 + 60_000;
    for (const [key, entry] of this.buckets) {
      if (now - entry.seen <= idleMs) break; // LRU order: everything after this is newer
      this.buckets.delete(key);
    }
    // Still full: drop the least recently used tenth.
    if (this.buckets.size >= this.maxKeys) {
      let drop = Math.max(1, Math.ceil(this.maxKeys / 10));
      for (const key of this.buckets.keys()) {
        if (drop-- <= 0) break;
        this.buckets.delete(key);
      }
    }
  }
}

/** Common presets for game messages. */
export const RATE = {
  /** Default for occasional UI actions (ready, settings, votes). */
  action: { burst: 8, perSecond: 3 },
  /** Chat / guesses. */
  chat: { burst: 6, perSecond: 1.5 },
  /** High-frequency streaming (drawing batches, racing input). */
  stream: { burst: 60, perSecond: 40 },
  /** Expensive actions (spins, deals). */
  heavy: { burst: 3, perSecond: 0.5 },
} as const satisfies Record<string, RateSpec>;
