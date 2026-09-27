/**
 * Server-side round-trip measurement for Pixel Paddle's hit forgiveness (lag compensation).
 *
 * The room sends WebSocket ping frames carrying a token and times the matching pong. Browsers
 * answer ping frames themselves (page scripts never see them), so a modified client can't report a
 * made-up latency to earn a longer paddle history. The median of the last few samples resists
 * one-off spikes. Transports without ping frames simply never produce a measurement.
 */
import type { Client } from '@colyseus/core';

interface PingSocket {
  ping(data?: Buffer): void;
  on(event: 'pong', listener: (data: Buffer) => void): unknown;
  off(event: 'pong', listener: (data: Buffer) => void): unknown;
}

/** Samples kept per player (median of these). */
const SAMPLES = 7;
/** An unanswered ping this old is forgotten. */
const STALE_MS = 5_000;
const PREFIX = 'dp:';

function pingSocket(client: Client | null | undefined): PingSocket | null {
  const ref = client?.ref as Partial<PingSocket> | undefined;
  return ref && typeof ref.ping === 'function' && typeof ref.on === 'function' && typeof ref.off === 'function' ? (ref as PingSocket) : null;
}

export class RttProbe {
  private readonly samples = new Map<string, number[]>();
  private readonly pending = new Map<string, Map<string, number>>();
  private readonly sockets = new Map<string, { ref: PingSocket; onPong: (data: Buffer) => void }>();
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Ping the player's socket once (no-op when the transport can't ping). */
  probe(playerId: string, client: Client | null | undefined): void {
    const ref = pingSocket(client);
    if (!ref) return;
    this.watch(playerId, ref);
    const now = this.now();
    let pending = this.pending.get(playerId);
    if (!pending) this.pending.set(playerId, (pending = new Map()));
    for (const [token, at] of pending) if (now - at > STALE_MS) pending.delete(token);
    const token = String((this.seq = (this.seq + 1) % 1_000_000_000));
    pending.set(token, now);
    try {
      ref.ping(Buffer.from(PREFIX + token));
    } catch {
      pending.delete(token);
    }
  }

  /** Median of the recent samples (ms), or null before the first answer. */
  rtt(playerId: string): number | null {
    const list = this.samples.get(playerId);
    if (!list?.length) return null;
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  /** Drop a player's samples and listener (left, or a new connection that should be measured afresh). */
  forget(playerId: string): void {
    const socket = this.sockets.get(playerId);
    if (socket) socket.ref.off('pong', socket.onPong);
    this.sockets.delete(playerId);
    this.samples.delete(playerId);
    this.pending.delete(playerId);
  }

  clear(): void {
    for (const id of [...this.sockets.keys()]) this.forget(id);
    this.samples.clear();
    this.pending.clear();
  }

  private watch(playerId: string, ref: PingSocket): void {
    const current = this.sockets.get(playerId);
    if (current?.ref === ref) return;
    if (current) current.ref.off('pong', current.onPong);
    const onPong = (data: Buffer) => this.onPong(playerId, data);
    ref.on('pong', onPong);
    this.sockets.set(playerId, { ref, onPong });
  }

  private onPong(playerId: string, data: Buffer): void {
    const text = Buffer.isBuffer(data) ? data.toString('latin1') : '';
    if (!text.startsWith(PREFIX)) return;
    const pending = this.pending.get(playerId);
    const at = pending?.get(text.slice(PREFIX.length));
    if (at === undefined) return;
    pending!.delete(text.slice(PREFIX.length));
    let list = this.samples.get(playerId);
    if (!list) this.samples.set(playerId, (list = []));
    list.push(Math.max(0, this.now() - at));
    if (list.length > SAMPLES) list.shift();
  }
}
