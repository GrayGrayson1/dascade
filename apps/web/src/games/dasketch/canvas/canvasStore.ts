/**
 * Client-side drawing state, kept outside React.
 *
 * - Mirrors the server's op log with the shared SketchBoard engine.
 * - Applies relayed events in sequence; on a gap or mismatch it asks the server for a
 *   fresh snapshot (dasketch:sync), so late joins and dropped packets self-heal.
 * - For the artist: applies local events immediately (zero-latency drawing) and batches
 *   them onto the network every ~50 ms, merging consecutive point chunks.
 *
 * The store subscribes to the session message bus as soon as the game module loads
 * (in the lobby), so no canvas message is ever missed while React mounts.
 */
import { SketchBoard, type ApplyResult } from '@dascade/game-core/dasketch';
import {
  DASKETCH_MSG,
  SKETCH_LIMITS,
  type SketchCanvasSnapshot,
  type SketchEvent,
  type SketchStrokeRelay,
} from '@dascade/shared/games/dasketch';
import { getLastMessage, session, subscribeMessage, useSessionStore } from '../../../net/session.ts';

export type CanvasChange = { kind: 'reset' } | { kind: 'event'; event: SketchEvent; local: boolean };
type Listener = (change: CanvasChange) => void;

const FLUSH_MS = 50;
const SYNC_THROTTLE_MS = 1200;

export interface RemotePen {
  x: number;
  y: number;
  at: number;
  color: string;
}

class CanvasStore {
  board = new SketchBoard();
  turn = 0;
  seq = 0;
  /** Last point the artist drew (for the viewers' pen indicator). */
  pen: RemotePen | null = null;
  private readonly listeners = new Set<Listener>();
  private queue: SketchEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncAt = 0;

  constructor() {
    subscribeMessage(DASKETCH_MSG.canvas, (p) => this.applySnapshot(p as SketchCanvasSnapshot));
    subscribeMessage(DASKETCH_MSG.stroke, (p) => this.applyRelay(p as SketchStrokeRelay));
    const cached = getLastMessage<SketchCanvasSnapshot>(DASKETCH_MSG.canvas);
    if (cached) this.applySnapshot(cached);
    // A different room (or leaving) starts from a blank board.
    useSessionStore.subscribe((s, prev) => {
      if (s.room !== prev.room) this.reset(0);
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: CanvasChange): void {
    for (const l of [...this.listeners]) l(change);
  }

  reset(turn: number): void {
    this.board = new SketchBoard();
    this.turn = turn;
    this.seq = 0;
    this.pen = null;
    this.queue = [];
    this.emit({ kind: 'reset' });
  }

  /** Snapshots are authoritative (turn start, join, reconnect, sync reply). */
  applySnapshot(s: SketchCanvasSnapshot): void {
    this.board = SketchBoard.fromSnapshot(s);
    this.turn = s.turn;
    this.seq = s.seq;
    this.queue = [];
    this.emit({ kind: 'reset' });
  }

  private applyRelay(m: SketchStrokeRelay): void {
    if (m.turn < this.turn) return;
    if (m.turn > this.turn) this.reset(m.turn);
    if (m.seq <= this.seq) return;
    if (m.seq !== this.seq + 1) {
      this.requestSync();
      return;
    }
    this.seq = m.seq;
    for (const ev of m.events) {
      const r = this.board.apply(ev);
      if (!r.ok) {
        this.requestSync();
        return;
      }
      this.trackPen(ev);
      this.emit({ kind: 'event', event: ev, local: false });
    }
  }

  private trackPen(ev: SketchEvent): void {
    if (ev.k !== 'stroke' && ev.k !== 'pts' && ev.k !== 'shape' && ev.k !== 'fill') return;
    const pts = ev.pts;
    const last = this.board.lastOp();
    this.pen = { x: pts[pts.length - 2]!, y: pts[pts.length - 1]!, at: performance.now(), color: last?.color ?? '#ff4fd8' };
  }

  /** Asks the server for a full snapshot (throttled). */
  requestSync(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastSyncAt < SYNC_THROTTLE_MS) return;
    this.lastSyncAt = now;
    session.send(DASKETCH_MSG.sync, {});
  }

  // -------------------------------------------------------------------------
  // Artist side
  // -------------------------------------------------------------------------

  /** Applies a local event (drawn instantly) and queues it for the network. */
  draw(ev: SketchEvent): ApplyResult {
    if (ev.k === 'pts' && ev.pts.length > SKETCH_LIMITS.pointsPerMessage * 2) {
      // A huge burst of coalesced pointer samples: keep every chunk protocol-sized.
      let r: ApplyResult = { ok: true };
      for (let i = 0; i < ev.pts.length && r.ok; i += SKETCH_LIMITS.pointsPerMessage * 2) {
        r = this.draw({ k: 'pts', pts: ev.pts.slice(i, i + SKETCH_LIMITS.pointsPerMessage * 2) });
      }
      return r;
    }
    const r = this.board.apply(ev);
    if (!r.ok) return r;
    this.emit({ kind: 'event', event: ev, local: true });
    this.enqueue(ev);
    return r;
  }

  private enqueue(ev: SketchEvent): void {
    const last = this.queue[this.queue.length - 1];
    if (ev.k === 'pts' && last && (last.k === 'stroke' || last.k === 'pts') && (last.pts.length + ev.pts.length) / 2 <= SKETCH_LIMITS.pointsPerMessage) {
      last.pts = last.pts.concat(ev.pts);
    } else {
      this.queue.push('pts' in ev ? { ...ev, pts: [...ev.pts] } : { ...ev });
    }
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /**
   * Sends everything queued, batched into protocol-sized messages: at most
   * SKETCH_LIMITS.eventsPerMessage events and pointsPerMessage points each (the server
   * silently drops larger ones, which would leave viewers out of sync with the artist).
   */
  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    let events: SketchEvent[] = [];
    let points = 0;
    for (const ev of this.queue) {
      const n = 'pts' in ev ? ev.pts.length / 2 : 0;
      if (events.length > 0 && (events.length >= SKETCH_LIMITS.eventsPerMessage || points + n > SKETCH_LIMITS.pointsPerMessage)) {
        session.send(DASKETCH_MSG.draw, { turn: this.turn, events });
        events = [];
        points = 0;
      }
      events.push(ev);
      points += n;
    }
    if (events.length > 0) session.send(DASKETCH_MSG.draw, { turn: this.turn, events });
    this.queue = [];
  }
}

export const canvasStore = new CanvasStore();
