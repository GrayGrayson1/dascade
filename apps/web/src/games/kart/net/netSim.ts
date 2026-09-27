/**
 * Debug network conditioner (same idea as DASh Circuit's): adds artificial one-way latency + jitter to outgoing
 * inputs and incoming snapshots on this client only (order preserved, like TCP).
 * Enable with `?netdebug=1&lag=120&jitter=30`, or from the F3 overlay.
 */
export interface NetSimConfig {
  /** Round-trip latency to add (ms); half is applied each way. */
  lagMs: number;
  /** ± jitter per direction (ms). */
  jitterMs: number;
}

type Timer = ReturnType<typeof setTimeout>;

class DelayLine<T> {
  private lastDelivery = 0;
  private readonly timers = new Set<Timer>();

  constructor(private readonly deliver: (value: T, at: number) => void) {}

  push(value: T, delayMs: number): void {
    if (delayMs <= 0 && this.timers.size === 0) {
      this.deliver(value, performance.now());
      return;
    }
    const due = Math.max(performance.now() + delayMs, this.lastDelivery + 0.1);
    this.lastDelivery = due;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.deliver(value, performance.now());
    }, due - performance.now());
    this.timers.add(timer);
  }

  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

export class NetSim {
  config: NetSimConfig;
  private readonly out: DelayLine<unknown>;
  private readonly inbound: DelayLine<{ kind: 'snap' | 'own'; bytes: Uint8Array }>;

  constructor(
    send: (payload: unknown) => void,
    receive: (kind: 'snap' | 'own', bytes: Uint8Array, arrivalMs: number) => void,
    config: NetSimConfig = { lagMs: 0, jitterMs: 0 },
  ) {
    this.config = config;
    this.out = new DelayLine(send);
    // Both server streams share one delay line so their relative order is preserved.
    this.inbound = new DelayLine((m, at) => receive(m.kind, m.bytes, at));
  }

  get active(): boolean {
    return this.config.lagMs > 0 || this.config.jitterMs > 0;
  }

  private delay(): number {
    const { lagMs, jitterMs } = this.config;
    if (lagMs <= 0 && jitterMs <= 0) return 0;
    return Math.max(0, lagMs / 2 + (Math.random() * 2 - 1) * jitterMs);
  }

  send(payload: unknown): void {
    this.out.push(payload, this.delay());
  }

  receive(bytes: Uint8Array, kind: 'snap' | 'own' = 'snap'): void {
    this.inbound.push({ kind, bytes }, this.delay());
  }

  dispose(): void {
    this.out.clear();
    this.inbound.clear();
  }
}

/** Parse ?netdebug / ?lag / ?jitter from the URL. */
export function netDebugFromUrl(): { show: boolean; config: NetSimConfig } {
  try {
    const q = new URLSearchParams(location.search);
    const lag = Math.max(0, Math.min(1000, Number(q.get('lag') ?? 0) || 0));
    const jitter = Math.max(0, Math.min(300, Number(q.get('jitter') ?? 0) || 0));
    return { show: q.get('netdebug') === '1', config: { lagMs: lag, jitterMs: jitter } };
  } catch {
    return { show: false, config: { lagMs: 0, jitterMs: 0 } };
  }
}
