/**
 * Neon Snake client netcode: keeps the latest grid snapshots and sends turn intents.
 *
 * Turns are sent the moment a key/swipe happens (the server buffers up to three per snake and
 * ignores reversals). The view extrapolates each head by the fraction of the current step
 * that has elapsed (in its next direction), so movement is continuous while the server stays
 * the only authority on position, food and crashes.
 */
import { SNAKE_MSG } from '@dascade/shared/games/snake';
import { DX, DY, decodeSnakeSnapshot, type Dir, type SnakeSnapshot } from '@dascade/game-core/snake';
import { session } from '../../net/session.ts';
import { subscribeBytes } from '../_classics/index.ts';

export const opposite = (d: number) => (d + 2) & 3;

export class SnakeNet {
  latest: SnakeSnapshot | null = null;
  prev: SnakeSnapshot | null = null;
  latestAt = 0;
  private unsub: (() => void) | null = null;
  /** Turns we sent that the server hasn't applied yet (for the heading chevron). */
  private pending: Array<{ dir: Dir; at: number }> = [];
  mySlot = -1;
  onSnapshot: ((s: SnakeSnapshot, prev: SnakeSnapshot | null) => void) | null = null;

  attach(): void {
    this.unsub = subscribeBytes(SNAKE_MSG.snap, (bytes) => {
      const s = decodeSnakeSnapshot(bytes);
      if (!s) return;
      const prev = this.latest && this.latest.matchId === s.matchId ? this.latest : null;
      if (prev && s.tick < prev.tick) return;
      this.prev = prev;
      this.latest = s;
      this.latestAt = performance.now();
      // Drop pending turns the server has consumed.
      const mine = s.snakes.find((x) => x.slot === this.mySlot);
      if (mine) {
        const now = performance.now();
        // Applied (the server heading matches) or stale (the server must have refused it).
        while (this.pending.length && (this.pending[0]!.dir === mine.dir || now - this.pending[0]!.at > s.stepMs * 3 + 150)) this.pending.shift();
        if (!mine.body.length) this.pending = [];
      }
      this.onSnapshot?.(s, prev);
    });
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  reset(): void {
    this.latest = null;
    this.prev = null;
    this.pending = [];
  }

  /** Send a turn if it isn't a repeat or reversal of our last heading (mirrors the server rule). */
  turn(dir: Dir): boolean {
    const mine = this.latest?.snakes.find((x) => x.slot === this.mySlot);
    if (!mine || !mine.body.length) return false;
    const last = this.pending.length ? this.pending[this.pending.length - 1]!.dir : mine.next >= 0 ? (mine.next as Dir) : mine.dir;
    if (dir === last || dir === opposite(last)) return false;
    if (this.pending.length >= 3) return false;
    this.pending.push({ dir, at: performance.now() });
    session.send(SNAKE_MSG.turn, { dir });
    return true;
  }

  /** The direction our head is about to take (pending local turn, else the server's next/current). */
  myNextDir(): number {
    const mine = this.latest?.snakes.find((x) => x.slot === this.mySlot);
    if (!mine) return -1;
    if (this.pending.length) return this.pending[0]!.dir;
    return mine.next >= 0 ? mine.next : mine.dir;
  }

  /** Fraction [0, 1] of the current step elapsed since the latest snapshot. */
  progress(now = performance.now()): number {
    const s = this.latest;
    if (!s || s.over || s.stepMs <= 0) return 0;
    return Math.max(0, Math.min(1, (now - this.latestAt) / s.stepMs));
  }
}

/** Head position extrapolated `t` of a step in direction `dir` (grid units, may leave the grid in wrap mode). */
export function extrapolate(x: number, y: number, dir: number, t: number): [number, number] {
  return [x + (DX[dir] ?? 0) * t, y + (DY[dir] ?? 0) * t];
}
