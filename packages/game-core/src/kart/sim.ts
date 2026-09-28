/**
 * KartSim — the authoritative race simulation (server room, tests, load bots).
 *
 * Input model (same as DASh Circuit): each human kart owns a queue of sequenced input frames.
 * Every tick adds one step of credit (capped); a kart simulates one queued frame per credit (up to
 * 2–3 per tick when the queue backs up), so a client can never run faster than real time. With no
 * input for STARVE ticks (or while disconnected) the kart coasts on a neutral input; after a while
 * a disconnected kart turns into a non-colliding ghost. `ackSeq` travels to the owner so it can
 * rewind and replay. Bots produce inputs through the same step path (no special physics).
 */
import {
  KART_INPUT_MAX,
  NEUTRAL_KART_INPUT,
  unpackKartInput,
  type KartBotSkill,
  type KartHitCause,
  type KartInput,
  type KartItemId,
  type KartRacerId,
} from '@dascade/shared/games/kart';
import type { Rng } from '@dascade/shared';
import { KartBot } from './bot.ts';
import { collideKarts } from './collide.ts';
import { itemCode, itemFromCode, itemUses } from './itemcodes.ts';
import { ITEM_TUNING, ItemWorld, giveItem, rollItem, type ItemHit, type ItemKart, type KartEntity } from './items.ts';
import { createKartState, newStepInfo, stepKart, type KartState, type KartStepInfo } from './kart.ts';
import { advanceProgress, compareStanding, createProgress, rankDistance, type KartProgress } from './progress.ts';
import { encodeOwn, encodeSnapshot, type KartStatusCode } from './snapshot.ts';
import { racerSpec, type KartSpec } from './spec.ts';
import { KART_GRID_SLOTS, type KartTrack } from './track.ts';

export const KART_SIM_LIMITS = {
  maxCredit: 10,
  maxQueue: 12,
  trimTo: 4,
  starveTicks: 12,
  ghostAfterTicks: 120,
  absentAfterTicks: 300,
  maxSeqJump: 600,
  /** Progress window (u) in which karts are tested for bumps. */
  bumpWindow: 7,
  maxEntities: ITEM_TUNING.maxEntities,
} as const;

export interface KartSimOptions {
  laps: number;
  items: boolean;
  collisions?: boolean;
  finishWindowMs: number;
  maxRaceMs: number;
  /** Item every racer starts with (time trial: 'turbo3'). */
  startItem?: KartItemId | null;
}

export type KartDnfReason = 'timeout' | 'left' | 'disconnected';

export interface SimKart {
  slot: number;
  id: string;
  racer: KartRacerId;
  spec: KartSpec;
  bot: KartBotSkill | null;
  brain: KartBot | null;
  state: KartState;
  info: KartStepInfo;
  progress: KartProgress;
  /** Last input applied (bots: last produced). */
  input: KartInput;
  queue: Array<{ seq: number; packed: number }>;
  lastSeq: number;
  ackSeq: number;
  /**
   * Seq of this kart's first input frame applied after the green light (0 before GO). Frames below
   * it were applied locked (they count toward the start boost); the owner's predictor replays by it.
   */
  goSeq: number;
  credit: number;
  starved: number;
  connected: boolean;
  disconnectedTicks: number;
  retired: boolean;
  dnf: boolean;
  dnfReason: KartDnfReason | null;
  finishOrder: number;
  /** Validated race distance (standings). */
  distance: number;
  /** 1-based position. */
  position: number;
  /** Hit since the last snapshot (flag). */
  hitFlag: boolean;
  applied: number;
}

export type KartSimEvent =
  | { type: 'lap-start'; slot: number; lap: number; atMs: number }
  | { type: 'lap'; slot: number; lap: number; lapMs: number; best: boolean }
  | { type: 'final-lap'; slot: number }
  | { type: 'finish'; slot: number; place: number; timeMs: number }
  | { type: 'dnf'; slot: number; reason: KartDnfReason }
  | { type: 'wrong-way'; slot: number; on: boolean }
  | { type: 'hit'; victim: number; by: number | null; cause: KartHitCause; blocked: boolean }
  | { type: 'item'; slot: number; item: KartItemId }
  | { type: 'use'; slot: number; item: KartItemId }
  | { type: 'box'; slot: number; box: number }
  | { type: 'bump'; a: number; b: number; impact: number; x: number; y: number; z: number }
  | { type: 'go' }
  | { type: 'done' };

export interface ItemBoxState {
  present: boolean;
  respawnTicks: number;
}

export class KartSim {
  readonly track: KartTrack;
  readonly opts: KartSimOptions;
  readonly rng: Rng;
  readonly raceId: number;
  readonly dtMs = 1000 / 60;
  tick = 0;
  goTick = -1;
  status: 'grid' | 'racing' | 'done' = 'grid';
  firstFinishTick = -1;
  doneTick = -1;
  finishCount = 0;
  readonly items: ItemWorld;
  boxes: ItemBoxState[];
  private readonly bySlot = new Map<number, SimKart>();
  private ordered: SimKart[] = [];
  private bumpOrder: SimKart[] = [];
  private itemKarts: ItemKart[] = [];

  constructor(track: KartTrack, opts: KartSimOptions, rng: Rng, raceId = 1) {
    this.track = track;
    this.opts = opts;
    this.rng = rng;
    this.raceId = raceId & 0xffff;
    this.items = new ItemWorld(track);
    this.boxes = track.itemBoxes.map(() => ({ present: opts.items, respawnTicks: 0 }));
  }

  get karts(): readonly SimKart[] {
    return this.ordered;
  }

  get entities(): readonly KartEntity[] {
    return this.items.entities;
  }

  kart(slot: number): SimKart | undefined {
    return this.bySlot.get(slot);
  }

  addRacer(slot: number, id: string, racer: KartRacerId, bot: KartBotSkill | null = null): SimKart {
    if (!Number.isInteger(slot) || slot < 0 || slot >= KART_GRID_SLOTS) throw new RangeError(`slot ${slot}`);
    if (this.bySlot.has(slot)) throw new Error(`slot ${slot} taken`);
    const spec = racerSpec(racer);
    const state = createKartState(this.track, slot);
    if (this.opts.startItem) {
      state.item = itemCode(this.opts.startItem);
      state.itemUses = itemUses(this.opts.startItem);
    }
    const kart: SimKart = {
      slot,
      id,
      racer,
      spec,
      bot,
      brain: bot ? new KartBot(bot, (this.raceId * 31 + slot * 7919) >>> 0) : null,
      state,
      info: newStepInfo(),
      progress: createProgress(this.track.grid[slot]!.s),
      input: { ...NEUTRAL_KART_INPUT },
      queue: [],
      lastSeq: 0,
      ackSeq: 0,
      goSeq: 0,
      credit: 0,
      starved: 0,
      connected: true,
      disconnectedTicks: 0,
      retired: false,
      dnf: false,
      dnfReason: null,
      finishOrder: 0,
      distance: 0,
      position: 0,
      hitFlag: false,
      applied: 0,
    };
    kart.info.s = this.track.grid[slot]!.s;
    kart.distance = rankDistance(kart.progress, this.track);
    this.bySlot.set(slot, kart);
    this.ordered = [...this.bySlot.values()].sort((a, b) => a.slot - b.slot);
    this.bumpOrder = [...this.ordered];
    this.itemKarts = this.ordered.map((k) => this.itemView(k));
    this.updatePositions();
    return kart;
  }

  private itemView(k: SimKart): ItemKart {
    const ghost = () => this.isGhost(k);
    return {
      slot: k.slot,
      get state() {
        return k.state;
      },
      get ghost() {
        return ghost();
      },
      get distance() {
        return k.distance;
      },
      get position() {
        return k.position;
      },
    };
  }

  /** Queue input frames (seq numbers inputs[0]; the rest follow). Returns frames accepted. */
  pushInputs(slot: number, seq: number, packed: readonly number[]): number {
    const kart = this.bySlot.get(slot);
    if (!kart || kart.retired || kart.brain) return 0;
    if (!Number.isInteger(seq) || seq < 1) return 0;
    if (kart.lastSeq === 0) kart.lastSeq = seq - 1;
    if (seq > kart.lastSeq + KART_SIM_LIMITS.maxSeqJump) {
      kart.queue.length = 0;
      kart.lastSeq = seq - 1;
    }
    let accepted = 0;
    for (let k = 0; k < packed.length; k++) {
      const s = seq + k;
      if (s <= kart.lastSeq) continue;
      const p = packed[k]!;
      if (!Number.isInteger(p) || p < 0 || p > KART_INPUT_MAX) continue;
      kart.queue.push({ seq: s, packed: p });
      kart.lastSeq = s;
      accepted++;
    }
    if (kart.queue.length > KART_SIM_LIMITS.maxQueue) {
      const dropped = kart.queue.splice(0, kart.queue.length - KART_SIM_LIMITS.trimTo);
      kart.ackSeq = dropped[dropped.length - 1]!.seq;
    }
    return accepted;
  }

  setConnected(slot: number, connected: boolean): void {
    const kart = this.bySlot.get(slot);
    if (!kart) return;
    kart.connected = connected;
    if (connected) kart.disconnectedTicks = 0;
    else kart.queue.length = 0;
  }

  retire(slot: number, reason: KartDnfReason): KartSimEvent[] {
    const kart = this.bySlot.get(slot);
    if (!kart || kart.retired) return [];
    kart.retired = true;
    kart.queue.length = 0;
    const events: KartSimEvent[] = [];
    if (!kart.progress.finished && !kart.dnf) {
      kart.dnf = true;
      kart.dnfReason = reason;
      events.push({ type: 'dnf', slot, reason });
    }
    events.push(...this.checkDone());
    return events;
  }

  /** Schedule the green light `ticks` from now (goTick travels in snapshots). */
  startCountdown(ticks: number): void {
    if (this.status !== 'grid') return;
    this.goTick = this.tick + Math.max(0, Math.round(ticks));
  }

  /** Green light now. */
  go(): KartSimEvent[] {
    if (this.status !== 'grid') return [];
    this.status = 'racing';
    this.goTick = this.tick;
    for (const k of this.ordered) k.goSeq = k.ackSeq + 1;
    return [{ type: 'go' }];
  }

  raceMsAt(t: number): number {
    return this.goTick < 0 || this.status === 'grid' ? 0 : Math.max(0, (t - this.goTick) * this.dtMs);
  }

  get raceMs(): number {
    return this.raceMsAt(this.doneTick >= 0 ? this.doneTick : this.tick);
  }

  isGhost(k: SimKart): boolean {
    return k.retired || k.progress.finished || k.dnf || (!k.connected && k.disconnectedTicks > KART_SIM_LIMITS.ghostAfterTicks);
  }

  step(): KartSimEvent[] {
    const events: KartSimEvent[] = [];
    if (this.status === 'grid' && this.goTick >= 0 && this.tick >= this.goTick) events.push(...this.go());
    this.tick++;
    const hits: ItemHit[] = [];
    for (const kart of this.ordered) {
      if (kart.retired) continue;
      if (!kart.connected) kart.disconnectedTicks++;
      if (kart.brain) {
        const input = kart.brain.think(this, kart);
        this.simulate(kart, input, 0, 1, events, hits);
        continue;
      }
      kart.credit = Math.min(KART_SIM_LIMITS.maxCredit, kart.credit + 1);
      const q = kart.queue.length;
      const cap = q > 6 ? 3 : q >= 3 ? 2 : 1;
      const steps = Math.min(q, Math.floor(kart.credit), cap);
      if (steps === 0) {
        kart.starved++;
        if (kart.starved > KART_SIM_LIMITS.starveTicks || !kart.connected) {
          this.simulate(kart, NEUTRAL_KART_INPUT, 0, 1, events, hits);
          kart.credit -= 1;
        }
        continue;
      }
      kart.starved = 0;
      for (let j = 0; j < steps; j++) {
        const frame = kart.queue.shift()!;
        this.simulate(kart, unpackKartInput(frame.packed), j, steps, events, hits);
        kart.ackSeq = frame.seq;
        kart.credit -= 1;
        kart.applied++;
      }
    }
    if (this.opts.collisions !== false) this.resolveBumps(events);
    for (const kart of this.ordered) kart.distance = rankDistance(kart.progress, this.track);
    this.updatePositions();
    if (this.status !== 'grid') {
      for (const k of this.itemKarts) this.items.magnetTug(k, this.itemKarts);
      this.items.step(this.itemKarts, hits);
      this.stepBoxes(events);
    }
    for (const h of hits) {
      events.push({ type: 'hit', ...h });
      const v = this.bySlot.get(h.victim);
      if (v) v.hitFlag = true;
    }
    if (this.status === 'racing') events.push(...this.checkDone());
    return events;
  }

  private simulate(kart: SimKart, input: KartInput, j: number, n: number, events: KartSimEvent[], hits: ItemHit[]): void {
    kart.input = input;
    const locked = this.status === 'grid';
    const prevRoulette = kart.state.rouletteTicks;
    const res = stepKart(kart.state, input, kart.spec, this.track, { locked, tick: this.tick });
    kart.state = res.state;
    kart.info = res.info;
    const st = kart.state;
    if (prevRoulette > 0 && st.rouletteTicks === 0 && st.item === 0) {
      const total = this.ordered.filter((k) => !k.retired).length;
      const frac = total > 1 ? (kart.position - 1) / (total - 1) : 0;
      const leader = this.leaderDistance();
      const id = rollItem(this.rng, frac, Math.max(0, leader - kart.distance), total);
      giveItem(st, id);
      events.push({ type: 'item', slot: kart.slot, item: id });
    }
    if (res.info.used) {
      events.push({ type: 'use', slot: kart.slot, item: res.info.used.item });
      const view = this.itemKarts.find((k) => k.slot === kart.slot)!;
      hits.push(...this.items.use(view, res.info.used, this.itemKarts));
    }
    if (res.info.hazardHit >= 0 && !res.info.bumper) {
      hits.push({ victim: kart.slot, by: null, cause: 'hazard', blocked: res.info.hazardBlocked });
    }
    if (res.info.fell) hits.push({ victim: kart.slot, by: null, cause: 'fall', blocked: false });
    if (this.status !== 'racing' || kart.progress.finished || kart.dnf) {
      kart.progress.s = res.info.s;
      return;
    }
    const t0 = this.raceMsAt(this.tick - 1 + j / n);
    const t1 = this.raceMsAt(this.tick - 1 + (j + 1) / n);
    const evs = advanceProgress(
      kart.progress,
      { s: res.info.s, headingDot: res.info.headingDot, velDot: res.info.velDot, speed: res.info.speed, t0, t1 },
      this.track,
      this.opts.laps,
    );
    for (const ev of evs) {
      if (ev.type === 'lap-start') {
        events.push({ type: 'lap-start', slot: kart.slot, lap: ev.lap, atMs: ev.atMs });
        if (ev.lap === this.opts.laps && ev.lap > 1) events.push({ type: 'final-lap', slot: kart.slot });
      } else if (ev.type === 'lap') events.push({ type: 'lap', slot: kart.slot, lap: ev.lap, lapMs: ev.lapMs, best: ev.best });
      else if (ev.type === 'wrong-way') events.push({ type: 'wrong-way', slot: kart.slot, on: ev.on });
      else if (ev.type === 'finish') {
        kart.finishOrder = ++this.finishCount;
        if (this.firstFinishTick < 0) this.firstFinishTick = this.tick;
        events.push({ type: 'finish', slot: kart.slot, place: kart.finishOrder, timeMs: ev.timeMs });
      }
    }
  }

  private leaderDistance(): number {
    let best = -Infinity;
    for (const k of this.ordered) if (!k.retired && !k.dnf && k.distance > best) best = k.distance;
    return best === -Infinity ? 0 : best;
  }

  private updatePositions(): void {
    const order = this.standings();
    for (let i = 0; i < order.length; i++) order[i]!.position = i + 1;
  }

  private stepBoxes(events: KartSimEvent[]): void {
    if (!this.opts.items) return;
    const boxes = this.track.itemBoxes;
    const r2 = ITEM_TUNING.boxRadius * ITEM_TUNING.boxRadius;
    for (let i = 0; i < boxes.length; i++) {
      const box = this.boxes[i]!;
      if (!box.present) {
        if (--box.respawnTicks <= 0) box.present = true;
        continue;
      }
      const b = boxes[i]!;
      for (const k of this.ordered) {
        if (this.isGhost(k)) continue;
        const st = k.state;
        const dx = st.x - b.x;
        const dy = st.y - b.y;
        if (dx * dx + dy * dy > r2 || Math.abs(st.z - b.z) > 3 || st.fallTicks > 0) continue;
        box.present = false;
        box.respawnTicks = ITEM_TUNING.boxRespawnTicks;
        events.push({ type: 'box', slot: k.slot, box: i });
        if (st.item === 0 && st.rouletteTicks === 0) st.rouletteTicks = ITEM_TUNING.rouletteTicks;
        break;
      }
    }
  }

  private resolveBumps(events: KartSimEvent[]): void {
    const list = this.bumpOrder;
    // Insertion sort by progress (nearly sorted tick to tick).
    for (let i = 1; i < list.length; i++) {
      const k = list[i]!;
      let j = i - 1;
      while (j >= 0 && list[j]!.info.s > k.info.s) {
        list[j + 1] = list[j]!;
        j--;
      }
      list[j + 1] = k;
    }
    const L = this.track.length;
    const W = KART_SIM_LIMITS.bumpWindow;
    const n = list.length;
    const tryPair = (a: SimKart, b: SimKart) => {
      if (!this.canBump(a) || !this.canBump(b)) return;
      const hit = collideKarts(a.state, a.spec, b.state, b.spec);
      if (hit && hit.impact > 2.5) events.push({ type: 'bump', a: a.slot, b: b.slot, impact: hit.impact, x: hit.x, y: hit.y, z: hit.z });
    };
    for (let i = 0; i < n; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < n && list[j]!.info.s - a.info.s <= W; j++) tryPair(a, list[j]!);
    }
    // Across the start line.
    for (let i = n - 1; i >= 0 && L - list[i]!.info.s <= W; i--) {
      for (let j = 0; j < i && list[j]!.info.s + L - list[i]!.info.s <= W; j++) tryPair(list[i]!, list[j]!);
    }
  }

  private canBump(k: SimKart): boolean {
    return !this.isGhost(k) && k.state.warpTicks === 0 && k.state.fallTicks === 0;
  }

  private checkDone(): KartSimEvent[] {
    if (this.status !== 'racing') return [];
    const events: KartSimEvent[] = [];
    const racing = this.ordered.filter((k) => !k.retired && !k.progress.finished && !k.dnf);
    const windowOver = this.firstFinishTick >= 0 && (this.tick - this.firstFinishTick) * this.dtMs >= this.opts.finishWindowMs;
    const timeUp = this.raceMs >= this.opts.maxRaceMs;
    // Only disconnected-and-gone humans still racing (bots are never absent): stop waiting.
    const onlyAbsentLeft = racing.every((k) => !k.brain && !k.connected && k.disconnectedTicks > KART_SIM_LIMITS.absentAfterTicks);
    const someonePresent = this.ordered.some((k) => !k.retired && (k.connected || k.brain !== null));
    if (racing.length === 0 || windowOver || timeUp || (onlyAbsentLeft && someonePresent)) {
      for (const k of racing) {
        k.dnf = true;
        k.dnfReason = k.connected || k.brain ? 'timeout' : 'disconnected';
        events.push({ type: 'dnf', slot: k.slot, reason: k.dnfReason });
      }
      this.status = 'done';
      this.doneTick = this.tick;
      events.push({ type: 'done' });
    }
    return events;
  }

  standings(): SimKart[] {
    return [...this.ordered].sort((a, b) => compareStanding(a, b) || a.slot - b.slot);
  }

  /** Broadcast snapshot (display records for every kart + entities + item boxes). Clears hit flags. */
  encodeSnapshot(): Uint8Array {
    const bytes = encodeSnapshot(this);
    for (const k of this.ordered) k.hitFlag = false;
    return bytes;
  }

  /** The exact predictor state + ack of one racer's kart (sent only to that racer). */
  encodeOwn(slot: number): Uint8Array | null {
    const k = this.bySlot.get(slot);
    if (!k || k.retired) return null;
    return encodeOwn(this.raceId, this.tick, k.slot, k.ackSeq, k.state, k.goSeq);
  }

  statusCode(): KartStatusCode {
    return this.status === 'grid' ? 0 : this.status === 'racing' ? 1 : 2;
  }

  /** Held item id of a kart (null = none). */
  heldItem(slot: number): KartItemId | null {
    const k = this.bySlot.get(slot);
    return k ? itemFromCode(k.state.item) : null;
  }
}
