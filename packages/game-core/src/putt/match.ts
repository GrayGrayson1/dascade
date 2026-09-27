/**
 * DAS Putt match rules (pure, no timers — the room drives time):
 *  - Stroke play over a route of holes. Everyone tees off from the tee; balls never collide.
 *  - Turn mode: one stroke at a time, rotating through the players still on the hole.
 *    Ghost mode: everyone may putt whenever their own ball is at rest.
 *  - Water / out of bounds: +1 penalty stroke, ball back to where it was struck from.
 *  - Stroke limit per hole = par + maxOverPar; reaching it picks the ball up with that score.
 *  - A shot-clock timeout costs a stroke; two in a row on one hole picks the ball up.
 *  - Honour: the next hole is played in order of the previous hole's score (ties keep order).
 *  - Standings: lowest total wins; equal totals share a place. Tournament matches may add
 *    sudden-death playoff holes between the tied leaders (see startPlayoff()).
 */
import type { PuttMode, PuttShotResult } from '@dascade/shared/games/putt';
import { getHole } from './course.ts';
import { restLie, simulateShot, type ShotSim } from './physics.ts';
import type { HoleDef } from './types.ts';

export interface Golfer {
  id: string;
  /** Play order on the current hole (0 = first). */
  order: number;
  lie: { x: number; y: number };
  strokes: number;
  holed: boolean;
  pickedUp: boolean;
  /** Left the match for good: skipped from now on and ranked last. */
  retired: boolean;
  /** Sitting out (playoff holes they are not part of). */
  sittingOut: boolean;
  /** Scores per route index (0 = not finished). */
  card: number[];
  holesInOne: number;
  /** Consecutive shot-clock timeouts on the current hole. */
  timeouts: number;
}

export interface MatchConfig {
  route: readonly number[];
  mode: PuttMode;
  maxOverPar: number;
}

export type PickupReason = 'limit' | 'conceded' | 'timeouts' | 'away';

export interface StrokeOutcome {
  sim: ShotSim;
  result: PuttShotResult;
  from: { x: number; y: number };
  lie: { x: number; y: number };
  strokes: number;
  penalty: number;
  holed: boolean;
  pickedUp: boolean;
}

export type ShootBlock = 'unknown' | 'retired' | 'done' | 'not_your_turn' | 'match_over';

export interface Standing {
  id: string;
  total: number;
  parPlayed: number;
  thru: number;
  retired: boolean;
}

export class PuttMatch {
  readonly mode: PuttMode;
  readonly maxOverPar: number;
  /** Hole numbers; playoff holes are appended. */
  readonly route: number[];
  /** Regulation length (route entries after this are playoff holes). */
  readonly regulation: number;
  holeIndex = 0;
  turnId: string | null = null;
  finished = false;
  /** Tied leaders in a sudden-death playoff (empty otherwise). */
  playoffIds: string[] = [];
  /** Playoff outcome among the tied leaders (best first), once decided or exhausted. */
  playoffResult: string[][] | null = null;
  readonly golfers = new Map<string, Golfer>();

  constructor(cfg: MatchConfig, playerIds: readonly string[]) {
    if (!cfg.route.length) throw new RangeError('empty route');
    this.mode = cfg.mode;
    this.maxOverPar = cfg.maxOverPar;
    this.route = [...cfg.route];
    this.regulation = this.route.length;
    playerIds.forEach((id, order) => {
      this.golfers.set(id, {
        id,
        order,
        lie: { x: 0, y: 0 },
        strokes: 0,
        holed: false,
        pickedUp: false,
        retired: false,
        sittingOut: false,
        card: new Array(this.route.length).fill(0),
        holesInOne: 0,
        timeouts: 0,
      });
    });
    this.resetHole();
  }

  get hole(): HoleDef {
    return getHole(this.route[this.holeIndex]!);
  }

  get isPlayoff(): boolean {
    return this.holeIndex >= this.regulation;
  }

  /** Stroke limit on the current hole. */
  limit(): number {
    return this.hole.par + this.maxOverPar;
  }

  ordered(): Golfer[] {
    return [...this.golfers.values()].sort((a, b) => a.order - b.order);
  }

  isDone(g: Golfer): boolean {
    return g.holed || g.pickedUp || g.retired || g.sittingOut;
  }

  /** Golfers still to hole out on this hole. */
  playing(): Golfer[] {
    return this.ordered().filter((g) => !this.isDone(g));
  }

  private resetHole(): void {
    const tee = this.hole.tee;
    for (const g of this.golfers.values()) {
      g.lie = { x: tee[0], y: tee[1] };
      g.strokes = 0;
      g.holed = false;
      g.pickedUp = false;
      g.timeouts = 0;
      g.sittingOut = this.isPlayoff && !this.playoffIds.includes(g.id);
      while (g.card.length < this.route.length) g.card.push(0);
    }
    this.turnId = this.mode === 'turns' ? (this.playing()[0]?.id ?? null) : null;
  }

  canShoot(id: string): ShootBlock | null {
    if (this.finished) return 'match_over';
    const g = this.golfers.get(id);
    if (!g) return 'unknown';
    if (g.retired) return 'retired';
    if (this.isDone(g)) return 'done';
    if (this.mode === 'turns' && this.turnId !== id) return 'not_your_turn';
    return null;
  }

  private close(g: Golfer, score: number): void {
    g.strokes = score;
    g.card[this.holeIndex] = score;
  }

  /** Simulate and apply one stroke. Throws if the golfer may not shoot (callers check canShoot first). */
  stroke(id: string, angle: number, power: number, obstacleMs: number): StrokeOutcome {
    const block = this.canShoot(id);
    if (block) throw new Error(`cannot shoot: ${block}`);
    const g = this.golfers.get(id)!;
    const from = { ...g.lie };
    const sim = simulateShot(this.hole, from, angle, power, obstacleMs);
    g.timeouts = 0;
    g.strokes += 1;
    let penalty = 0;
    let lie = from;
    if (sim.result === 'water' || sim.result === 'oob') {
      penalty = 1;
      g.strokes += 1;
    } else if (sim.result === 'cup') {
      lie = { x: this.hole.cup[0], y: this.hole.cup[1] };
    } else {
      lie = restLie(sim);
    }
    g.lie = lie;
    const limit = this.limit();
    if (sim.result === 'cup' && g.strokes <= limit) {
      g.holed = true;
      if (g.strokes === 1) g.holesInOne += 1;
      this.close(g, g.strokes);
    } else if (g.strokes >= limit) {
      g.pickedUp = true;
      this.close(g, limit);
    }
    return { sim, result: sim.result, from, lie, strokes: g.strokes, penalty, holed: g.holed, pickedUp: g.pickedUp };
  }

  /** Shot clock ran out: one penalty stroke; the second consecutive timeout (or the limit) picks the ball up. */
  timeout(id: string): { strokes: number; pickedUp: boolean; reason: PickupReason | null } {
    const g = this.golfers.get(id);
    if (!g || this.isDone(g)) return { strokes: g?.strokes ?? 0, pickedUp: false, reason: null };
    g.strokes += 1;
    g.timeouts += 1;
    const limit = this.limit();
    if (g.strokes >= limit) {
      g.pickedUp = true;
      this.close(g, limit);
      return { strokes: limit, pickedUp: true, reason: 'limit' };
    }
    if (g.timeouts >= 2) {
      g.pickedUp = true;
      this.close(g, limit);
      return { strokes: limit, pickedUp: true, reason: 'timeouts' };
    }
    return { strokes: g.strokes, pickedUp: false, reason: null };
  }

  /** Pick the ball up (conceded / away): the hole scores the stroke limit. */
  pickUp(id: string): boolean {
    const g = this.golfers.get(id);
    if (!g || this.isDone(g)) return false;
    g.pickedUp = true;
    this.close(g, this.limit());
    return true;
  }

  /** Leave the match for good (their unfinished hole scores the limit). */
  retire(id: string): void {
    const g = this.golfers.get(id);
    if (!g || g.retired) return;
    if (!this.isDone(g)) this.close(g, this.limit());
    g.retired = true;
    if (this.turnId === id) this.turnId = null;
  }

  /**
   * Turn mode: the next golfer after `afterId` in play order who is still on the hole
   * (possibly `afterId` again). Sets and returns turnId (null when the hole is complete).
   */
  nextTurn(afterId: string | null = this.turnId): string | null {
    if (this.mode !== 'turns') return (this.turnId = null);
    const order = this.ordered();
    if (!order.length) return (this.turnId = null);
    const start = afterId ? order.findIndex((g) => g.id === afterId) : -1;
    for (let k = 1; k <= order.length; k++) {
      const g = order[(start + k + order.length) % order.length]!;
      if (!this.isDone(g)) return (this.turnId = g.id);
    }
    return (this.turnId = null);
  }

  holeComplete(): boolean {
    return this.playing().length === 0;
  }

  /**
   * Close the current hole and move to the next one. Returns false when the route is over
   * (the match is finished unless startPlayoff() appends another hole).
   */
  advance(): boolean {
    for (const g of this.golfers.values()) {
      if (!this.isDone(g)) this.close(g, this.limit());
    }
    if (this.isPlayoff) this.resolvePlayoffHole();
    // Honour: best score on this hole tees off first; ties keep the previous order; retired last.
    const idx = this.holeIndex;
    const next = [...this.golfers.values()].sort(
      (a, b) => Number(a.retired) - Number(b.retired) || (a.card[idx] || 99) - (b.card[idx] || 99) || a.order - b.order,
    );
    next.forEach((g, i) => (g.order = i));
    if (this.playoffResult && this.isPlayoff) {
      this.finished = true;
      this.turnId = null;
      return false;
    }
    if (this.holeIndex + 1 >= this.route.length) {
      this.finished = true;
      this.turnId = null;
      return false;
    }
    this.holeIndex += 1;
    this.resetHole();
    return true;
  }

  private resolvePlayoffHole(): void {
    const idx = this.holeIndex;
    const ids = this.playoffIds.filter((id) => !this.golfers.get(id)?.retired);
    const scores = ids.map((id) => this.golfers.get(id)!.card[idx]!);
    const best = Math.min(...scores);
    const leaders = ids.filter((_, i) => scores[i] === best);
    if (ids.length <= 1 || leaders.length === 1) {
      const rest = ids.filter((id) => !leaders.includes(id));
      this.playoffResult = rest.length ? [leaders, rest] : [leaders];
      return;
    }
    this.playoffIds = leaders;
  }

  /** Append a sudden-death playoff hole between `ids` (call after advance() returned false). */
  startPlayoff(ids: readonly string[], holeNumber: number): void {
    if (ids.length < 2) return;
    this.playoffIds = [...ids];
    this.playoffResult = null;
    this.route.push(holeNumber);
    this.finished = false;
    this.holeIndex = this.route.length - 1;
    this.resetHole();
  }

  /** Give up on the playoff (limit reached): the tied leaders stay tied. */
  endPlayoffTied(): void {
    this.playoffResult = [this.playoffIds.filter((id) => !this.golfers.get(id)?.retired)];
    this.finished = true;
    this.turnId = null;
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  /** Regulation total / par over finished regulation holes. */
  totals(g: Golfer): Standing {
    let total = 0;
    let parPlayed = 0;
    let thru = 0;
    for (let i = 0; i < this.regulation; i++) {
      const s = g.card[i] ?? 0;
      if (s > 0) {
        total += s;
        parPlayed += getHole(this.route[i]!).par;
        thru += 1;
      }
    }
    return { id: g.id, total, parPlayed, thru, retired: g.retired };
  }

  /** Current standings: active golfers by total (then par played, then order), retired last. */
  standings(): Standing[] {
    return [...this.golfers.values()]
      .map((g) => ({ g, s: this.totals(g) }))
      .sort(
        (a, b) =>
          Number(a.s.retired) - Number(b.s.retired) ||
          (a.s.retired ? b.s.thru - a.s.thru : 0) ||
          a.s.total - a.s.parPlayed - (b.s.total - b.s.parPlayed) ||
          a.s.total - b.s.total ||
          a.g.order - b.g.order,
      )
      .map((x) => x.s);
  }

  /** Tied leaders after regulation (length ≥ 2 means a playoff could be needed). */
  leaders(): string[] {
    const active = this.standings().filter((s) => !s.retired);
    if (!active.length) return [];
    const best = active[0]!.total;
    return active.filter((s) => s.total === best).map((s) => s.id);
  }

  /** Final placements: equal totals share a place (unless a playoff split them); retired players last, one per place. */
  placements(): string[][] {
    const st = this.standings();
    const groups: string[][] = [];
    let last: Standing | null = null;
    for (const s of st) {
      if (s.retired) {
        groups.push([s.id]);
        last = null;
        continue;
      }
      if (last && !last.retired && last.total === s.total && groups.length) groups[groups.length - 1]!.push(s.id);
      else groups.push([s.id]);
      last = s;
    }
    if (this.playoffResult && groups.length) {
      const top = new Set(groups[0]);
      const split = this.playoffResult.map((g) => g.filter((id) => top.has(id))).filter((g) => g.length);
      const missing = groups[0]!.filter((id) => !split.some((g) => g.includes(id)));
      if (missing.length) split.push(missing);
      groups.splice(0, 1, ...split);
    }
    return groups;
  }

  scores(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const g of this.golfers.values()) out[g.id] = this.totals(g).total;
    return out;
  }
}
