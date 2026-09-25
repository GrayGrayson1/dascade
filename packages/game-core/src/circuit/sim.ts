/**
 * RaceSim — the authoritative race simulation (used by the server room, tests and bots).
 *
 * Input model ("client-driven steps with a credit bank")
 *  - Each car owns a queue of sequenced input frames received from its client.
 *  - Every server tick adds one step of credit (capped). A car simulates one queued
 *    frame per credit, at most 1 per tick (2 when the queue is backing up), so a
 *    client can never run its car faster than real time, no matter how fast it sends.
 *  - After STARVE_TICKS without input (or while disconnected) the car coasts with a
 *    neutral input so it never freezes mid-track.
 *  - `ackSeq` (last applied frame) travels in snapshots; clients rewind to the
 *    snapshot state and replay frames after the ack.
 */
import { NEUTRAL_INPUT, unpackInput, type CarInput, type ChassisId } from '@dascade/shared/games/circuit';
import { CHASSIS, createCar, stepCar, Surface, type CarSpec, type CarState, type StepInfo } from './car.ts';
import { collideCars } from './collide.ts';
import { loopDelta } from './math.ts';
import { advanceProgress, compareStanding, createProgress, rankDistance, type ProgressEvent, type RaceProgress } from './race.ts';
import { CarFlag, CarFlag2, RaceStatusCode, encodeSnapshot, type Snapshot } from './snapshot.ts';
import { GRID_SLOTS, levelAt, type Track } from './track.ts';

export const SIM_LIMITS = {
  /** Max banked steps (ticks of credit). */
  maxCredit: 10,
  /** Max queued frames before the oldest are discarded. */
  maxQueue: 12,
  /** Frames kept after a discard. */
  trimTo: 4,
  /** Ticks without input before the car coasts on its own. */
  starveTicks: 12,
  /** Ticks after a disconnect before the car turns into a non-colliding ghost. */
  ghostAfterTicks: 120,
  /** Ticks a disconnected racer may be gone before the race stops waiting for them. */
  absentAfterTicks: 300,
  /** Reject a packet whose seq is further than this ahead of the last seen. */
  maxSeqJump: 600,
  /** Only cars this close along the track (and on the same level) can collide. */
  collisionWindow: 160,
} as const;

export interface SimOptions {
  laps: number;
  collisions: boolean;
  boost: boolean;
  tickRate: number;
  /** Time the field gets after the winner finishes (ms). */
  finishWindowMs: number;
  /** Hard cap on race duration (ms) so a race can never stall. */
  maxRaceMs: number;
}

export type DnfReason = 'timeout' | 'left' | 'disconnected';

export interface SimCar {
  slot: number;
  id: string;
  chassis: ChassisId;
  spec: CarSpec;
  state: CarState;
  info: StepInfo;
  progress: RaceProgress;
  queue: Array<{ seq: number; packed: number }>;
  lastSeq: number;
  ackSeq: number;
  credit: number;
  starved: number;
  connected: boolean;
  disconnectedTicks: number;
  retired: boolean;
  dnf: boolean;
  dnfReason: DnfReason | null;
  finishOrder: number;
  /** Largest impact since the last snapshot (px/s). */
  impact: number;
  /** Cached validated race distance. */
  distance: number;
  /** Total frames applied (for tests / diagnostics). */
  applied: number;
}

export type SimEvent =
  | { type: 'progress'; slot: number; event: ProgressEvent }
  | { type: 'finish'; slot: number; place: number; timeMs: number }
  | { type: 'dnf'; slot: number; reason: DnfReason }
  | { type: 'collision'; a: number; b: number; impact: number; x: number; y: number }
  | { type: 'done' };

export class RaceSim {
  readonly track: Track;
  readonly opts: SimOptions;
  readonly dt: number;
  readonly dtMs: number;
  readonly raceId: number;
  tick = 0;
  goTick = -1;
  status: 'grid' | 'racing' | 'done' = 'grid';
  firstFinishTick = -1;
  /** Tick at which the race was decided (-1 while running). */
  doneTick = -1;
  finishCount = 0;
  private readonly bySlot = new Map<number, SimCar>();
  private ordered: SimCar[] = [];

  constructor(track: Track, opts: SimOptions, raceId = 1) {
    this.track = track;
    this.opts = opts;
    this.dt = 1 / opts.tickRate;
    this.dtMs = 1000 / opts.tickRate;
    this.raceId = raceId & 0xffff;
  }

  get cars(): readonly SimCar[] {
    return this.ordered;
  }

  car(slot: number): SimCar | undefined {
    return this.bySlot.get(slot);
  }

  /** Place a car on its grid slot. */
  addCar(slot: number, id: string, chassis: ChassisId): SimCar {
    if (slot < 0 || slot >= GRID_SLOTS) throw new RangeError(`slot ${slot}`);
    if (this.bySlot.has(slot)) throw new Error(`slot ${slot} taken`);
    const g = this.track.grid[slot]!;
    const spec = CHASSIS[chassis] ?? CHASSIS.volt;
    const state = createCar(g.x, g.y, g.heading, this.track, this.opts.boost ? undefined : 0);
    const car: SimCar = {
      slot,
      id,
      chassis,
      spec,
      state,
      info: {
        s: g.s,
        d: 0,
        surface: Surface.Road,
        speed: 0,
        forwardSpeed: 0,
        slip: 0,
        drifting: false,
        sliding: false,
        boosting: false,
        wallImpact: 0,
        headingDot: 1,
        velDot: 0,
      },
      progress: createProgress(g.s),
      queue: [],
      lastSeq: 0,
      ackSeq: 0,
      credit: 0,
      starved: 0,
      connected: true,
      disconnectedTicks: 0,
      retired: false,
      dnf: false,
      dnfReason: null,
      finishOrder: 0,
      impact: 0,
      distance: 0,
      applied: 0,
    };
    car.distance = rankDistance(car.progress, this.track);
    this.bySlot.set(slot, car);
    this.ordered = [...this.bySlot.values()].sort((a, b) => a.slot - b.slot);
    return car;
  }

  /**
   * Queue input frames for a car. `seq` numbers frame 0; the rest follow consecutively.
   * Old/duplicate frames are ignored; absurd sequence jumps reject the packet.
   * Returns how many frames were accepted.
   */
  pushInputs(slot: number, seq: number, packed: readonly number[]): number {
    const car = this.bySlot.get(slot);
    if (!car || car.retired) return 0;
    if (car.lastSeq === 0) car.lastSeq = seq - 1;
    if (seq > car.lastSeq + SIM_LIMITS.maxSeqJump) return 0;
    let accepted = 0;
    for (let k = 0; k < packed.length; k++) {
      const s = seq + k;
      if (s <= car.lastSeq) continue;
      car.queue.push({ seq: s, packed: packed[k]! });
      car.lastSeq = s;
      accepted++;
    }
    if (car.queue.length > SIM_LIMITS.maxQueue) {
      const dropped = car.queue.splice(0, car.queue.length - SIM_LIMITS.trimTo);
      // Discarded frames will never be simulated; ack them so the client stops replaying them.
      car.ackSeq = dropped[dropped.length - 1]!.seq;
    }
    return accepted;
  }

  setConnected(slot: number, connected: boolean): void {
    const car = this.bySlot.get(slot);
    if (!car) return;
    car.connected = connected;
    if (connected) car.disconnectedTicks = 0;
    else car.queue.length = 0;
  }

  /** Take a car off the track for good (left the room / away). */
  retire(slot: number, reason: DnfReason): SimEvent[] {
    const car = this.bySlot.get(slot);
    if (!car || car.retired) return [];
    car.retired = true;
    car.queue.length = 0;
    const events: SimEvent[] = [];
    if (!car.progress.finished && !car.dnf) {
      car.dnf = true;
      car.dnfReason = reason;
      events.push({ type: 'dnf', slot, reason });
    }
    events.push(...this.checkDone());
    return events;
  }

  /** Lights out. */
  go(): void {
    if (this.status !== 'grid') return;
    this.status = 'racing';
    this.goTick = this.tick;
  }

  /** Race clock in ms at (fractional) tick t. */
  raceMsAt(t: number): number {
    return this.goTick < 0 ? 0 : Math.max(0, (t - this.goTick) * this.dtMs);
  }

  get raceMs(): number {
    return this.raceMsAt(this.doneTick >= 0 ? this.doneTick : this.tick);
  }

  /**
   * Advance the whole race by one fixed tick. After the race is decided (`done`) the
   * cars keep driving (a cool-down lap for the celebration) but nothing is scored.
   */
  step(): SimEvent[] {
    this.tick++;
    const events: SimEvent[] = [];
    for (const car of this.ordered) {
      if (car.retired) continue;
      if (!car.connected) car.disconnectedTicks++;
      car.credit = Math.min(SIM_LIMITS.maxCredit, car.credit + 1);
      const q = car.queue.length;
      const cap = q > 6 ? 3 : q >= 3 ? 2 : 1;
      const steps = Math.min(q, Math.floor(car.credit), cap);
      if (steps === 0) {
        car.starved++;
        if (car.starved > SIM_LIMITS.starveTicks || !car.connected) {
          this.simulate(car, NEUTRAL_INPUT, 0, 1, events);
          car.credit -= 1;
        }
        continue;
      }
      car.starved = 0;
      for (let j = 0; j < steps; j++) {
        const frame = car.queue.shift()!;
        this.simulate(car, unpackInput(frame.packed), j, steps, events);
        car.ackSeq = frame.seq;
        car.credit -= 1;
        car.applied++;
      }
    }
    if (this.opts.collisions) this.resolveCollisions(events);
    for (const car of this.ordered) car.distance = rankDistance(car.progress, this.track);
    if (this.status === 'racing') events.push(...this.checkDone());
    return events;
  }

  private simulate(car: SimCar, input: CarInput, j: number, n: number, events: SimEvent[]): void {
    const racing = this.status === 'racing';
    const res = stepCar(car.state, input, car.spec, this.track, { dt: this.dt, locked: this.status === 'grid', boostEnabled: this.opts.boost });
    car.state = res.state;
    car.info = res.info;
    if (res.info.wallImpact > car.impact) car.impact = res.info.wallImpact;
    if (!racing) {
      car.progress.s = res.info.s;
      return;
    }
    if (car.progress.finished || car.dnf) {
      car.progress.s = res.info.s;
      return;
    }
    const t0 = this.raceMsAt(this.tick - 1 + j / n);
    const t1 = this.raceMsAt(this.tick - 1 + (j + 1) / n);
    const evs = advanceProgress(
      car.progress,
      { s: res.info.s, headingDot: res.info.headingDot, velDot: res.info.velDot, speed: res.info.speed, t0, t1 },
      this.track,
      this.opts.laps,
    );
    for (const ev of evs) {
      events.push({ type: 'progress', slot: car.slot, event: ev });
      if (ev.type === 'finish') {
        car.finishOrder = ++this.finishCount;
        if (this.firstFinishTick < 0) this.firstFinishTick = this.tick;
        events.push({ type: 'finish', slot: car.slot, place: car.finishOrder, timeMs: ev.timeMs });
      }
    }
  }

  /** Cars that can't be hit: finished, retired, or disconnected for a while. */
  isGhost(car: SimCar): boolean {
    return car.retired || car.progress.finished || car.dnf || (!car.connected && car.disconnectedTicks > SIM_LIMITS.ghostAfterTicks);
  }

  private resolveCollisions(events: SimEvent[]): void {
    const list = this.ordered;
    const L = this.track.length;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (this.isGhost(a)) continue;
      for (let k = i + 1; k < list.length; k++) {
        const b = list[k]!;
        if (this.isGhost(b)) continue;
        if (Math.abs(loopDelta(a.info.s, b.info.s, L)) > SIM_LIMITS.collisionWindow) continue;
        if (levelAt(this.track, a.info.s) !== levelAt(this.track, b.info.s)) continue;
        const hit = collideCars(a.state, a.spec, b.state, b.spec);
        if (!hit) continue;
        a.state = hit.a;
        b.state = hit.b;
        if (hit.impact > 40) {
          a.impact = Math.max(a.impact, hit.impact);
          b.impact = Math.max(b.impact, hit.impact);
          events.push({ type: 'collision', a: a.slot, b: b.slot, impact: hit.impact, x: hit.x, y: hit.y });
        }
      }
    }
  }

  private checkDone(): SimEvent[] {
    if (this.status !== 'racing') return [];
    const events: SimEvent[] = [];
    const racing = this.ordered.filter((c) => !c.retired && !c.progress.finished && !c.dnf);
    const windowOver = this.firstFinishTick >= 0 && (this.tick - this.firstFinishTick) * this.dtMs >= this.opts.finishWindowMs;
    const timeUp = this.raceMs >= this.opts.maxRaceMs;
    const onlyAbsentLeft = racing.every((c) => !c.connected && c.disconnectedTicks > SIM_LIMITS.absentAfterTicks);
    if (racing.length === 0 || windowOver || timeUp || (onlyAbsentLeft && this.ordered.some((c) => c.connected && !c.retired))) {
      for (const car of racing) {
        car.dnf = true;
        car.dnfReason = car.connected ? 'timeout' : 'disconnected';
        events.push({ type: 'dnf', slot: car.slot, reason: car.dnfReason });
      }
      this.status = 'done';
      this.doneTick = this.tick;
      events.push({ type: 'done' });
    }
    return events;
  }

  /** Current standings (best first). */
  standings(): SimCar[] {
    return [...this.ordered].sort((a, b) => compareStanding(a, b) || a.slot - b.slot);
  }

  snapshot(): Snapshot {
    const cars = [];
    for (const car of this.ordered) {
      if (car.retired) continue;
      const i = car.info;
      let flags = 0;
      if (i.drifting) flags |= CarFlag.drifting;
      if (car.state.boostOn) flags |= CarFlag.boosting;
      if (i.surface === Surface.Offroad) flags |= CarFlag.offroad;
      if (i.surface === Surface.Rumble) flags |= CarFlag.rumble;
      if (i.sliding) flags |= CarFlag.sliding;
      if (car.progress.finished) flags |= CarFlag.finished;
      if (this.isGhost(car)) flags |= CarFlag.ghost;
      if (car.progress.wrongWay) flags |= CarFlag.wrongWay;
      let flags2 = 0;
      if (car.connected) flags2 |= CarFlag2.connected;
      if (this.status === 'grid') flags2 |= CarFlag2.locked;
      if (levelAt(this.track, i.s)) flags2 |= CarFlag2.elevated;
      if (car.impact > 0) flags2 |= CarFlag2.hit;
      cars.push({ slot: car.slot, flags, flags2, ack: car.ackSeq, state: car.state, impact: car.impact });
    }
    return {
      status: this.status === 'grid' ? RaceStatusCode.grid : this.status === 'racing' ? RaceStatusCode.racing : RaceStatusCode.done,
      raceId: this.raceId,
      tick: this.tick,
      raceMs: this.raceMs,
      cars,
    };
  }

  /** Encode the current snapshot and reset per-snapshot impact accumulators. */
  encodeSnapshot(): Uint8Array {
    const bytes = encodeSnapshot(this.snapshot());
    for (const car of this.ordered) car.impact = 0;
    return bytes;
  }
}
