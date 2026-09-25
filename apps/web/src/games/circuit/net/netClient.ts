/**
 * Client netcode for DASh Circuit (no rendering in here).
 *
 * Local car — client-side prediction + server reconciliation:
 *   - Runs the shared `stepCar` at the server's fixed 60 Hz on sampled, quantized inputs.
 *   - Sends frames in small packets (2 per packet ≈ 30 packets/s), each tagged with a seq.
 *   - Every snapshot carries the server state of our car and the last applied seq (ack).
 *     We rewind to that state, drop acknowledged frames and replay the rest. Small
 *     disagreements are hidden by a decaying visual offset; big ones snap.
 *
 * Remote cars — snapshot interpolation:
 *   - Snapshots are timestamped with the server tick. A windowed-minimum clock filter
 *     maps ticks onto local time; cars are drawn `interpDelay` ms in the past (adaptive to
 *     jitter, ~100 ms) with Hermite interpolation using the snapshot velocities.
 *   - If packets are late, cars extrapolate for at most 130 ms, then hold.
 */
import { CIRCUIT_SIM, NEUTRAL_INPUT, packInput, quantizeInput, unpackInput, type CarInput, type CircuitInputPacket } from '@dascade/shared/games/circuit';
import {
  CarFlag,
  RaceStatusCode,
  decodeSnapshot,
  lerpAngle,
  stepCar,
  wrapAngle,
  type CarSpec,
  type CarState,
  type Snapshot,
  type StepInfo,
  type Track,
} from '@dascade/game-core/circuit';

export interface NetCar {
  slot: number;
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  speed: number;
  angVel: number;
  flags: number;
  flags2: number;
  boost: number;
  local: boolean;
}

export interface NetImpact {
  slot: number;
  impact: number;
}

export interface NetStats {
  rttMs: number;
  jitterMs: number;
  interpDelayMs: number;
  buffered: number;
  corrections: number;
  lastCorrectionPx: number;
  pendingInputs: number;
  snapsPerSec: number;
  kbps: number;
  extrapolating: number;
  serverTick: number;
  packetsSent: number;
  packetsHeld: number;
}

interface Frame {
  seq: number;
  packed: number;
  locked: boolean;
  sentAt: number;
}

interface Sample {
  tick: number;
  state: CarState;
  flags: number;
  flags2: number;
}

const SNAP_DISTANCE = 160;
const MAX_CATCHUP_STEPS = 8;
const MAX_EXTRAPOLATE_TICKS = 8;
const CLOCK_WINDOW = 90;
/** Unacknowledged frames beyond which we stop replaying and re-sync (server rejects jumps > 600). */
const RESYNC_GAP = 360;
/** No snapshot for this long → treat the connection as stalled. */
const STALL_MS = 500;

export class CircuitNet {
  readonly tickMs = 1000 / CIRCUIT_SIM.tickRate;
  readonly dt = 1 / CIRCUIT_SIM.tickRate;

  track: Track;
  boostEnabled = true;
  raceId = -1;
  status: RaceStatusCode = RaceStatusCode.grid;
  serverTick = 0;
  raceMs = 0;
  hasSnapshot = false;

  // Local prediction.
  private localSlot: number | null = null;
  private spec: CarSpec | null = null;
  private pred: CarState | null = null;
  private prevPred: CarState | null = null;
  predInfo: StepInfo | null = null;
  lastInput: CarInput = { ...NEUTRAL_INPUT };
  private frames: Frame[] = [];
  private outbox: number[] = [];
  private outboxSeq = 0;
  private seq = 0;
  private acc = 0;
  private lastUpdateAt = -1;
  private errX = 0;
  private errY = 0;
  private errH = 0;

  // Remote interpolation.
  private readonly buffers = new Map<number, Sample[]>();
  private readonly clockSamples: number[] = [];
  private offset = 0;
  private jitter = 0;
  private interpDelay = 100;
  private lastSnapArrival = 0;
  private snapInterval = 33;

  /** One-shot impacts reported by the server since the last drain. */
  private impacts: NetImpact[] = [];

  // Stats.
  private rtt = 0;
  private corrections = 0;
  private lastCorrection = 0;
  private extrapolating = 0;
  private packetsSent = 0;
  private packetsHeld = 0;
  private windowStart = 0;
  private windowSnaps = 0;
  private windowBytes = 0;
  private snapsPerSec = 0;
  private kbps = 0;

  constructor(
    track: Track,
    private readonly sendPacket: (packet: CircuitInputPacket) => void,
  ) {
    this.track = track;
  }

  setTrack(track: Track): void {
    if (this.track === track) return;
    this.track = track;
    this.resetRace(this.raceId);
  }

  /** Which car we drive (null = spectating). */
  setLocal(slot: number | null, spec: CarSpec | null): void {
    if (slot === this.localSlot && spec === this.spec) return;
    this.localSlot = slot;
    this.spec = spec;
    this.pred = null;
    this.prevPred = null;
    this.frames = [];
    this.outbox = [];
  }

  get local(): number | null {
    return this.localSlot;
  }

  get predicting(): boolean {
    return this.pred !== null && this.localSlot !== null;
  }

  resetRace(raceId: number): void {
    this.raceId = raceId;
    this.buffers.clear();
    this.clockSamples.length = 0;
    this.pred = null;
    this.prevPred = null;
    this.predInfo = null;
    this.frames = [];
    this.outbox = [];
    this.errX = this.errY = this.errH = 0;
    this.hasSnapshot = false;
    this.serverTick = 0;
    this.status = RaceStatusCode.grid;
    this.impacts = [];
  }

  // -------------------------------------------------------------------------
  // Incoming snapshots
  // -------------------------------------------------------------------------

  ingest(bytes: Uint8Array, arrivalMs: number): Snapshot | null {
    const snap = decodeSnapshot(bytes);
    if (!snap) return null;
    if (snap.raceId !== this.raceId) this.resetRace(snap.raceId);
    if (this.hasSnapshot && snap.tick <= this.serverTick) return null;
    this.hasSnapshot = true;
    this.serverTick = snap.tick;
    this.status = snap.status;
    this.raceMs = snap.raceMs;

    // Bandwidth / rate stats (1 s windows).
    if (!this.windowStart) this.windowStart = arrivalMs;
    this.windowSnaps++;
    this.windowBytes += bytes.byteLength;
    if (arrivalMs - this.windowStart >= 1000) {
      const secs = (arrivalMs - this.windowStart) / 1000;
      this.snapsPerSec = this.windowSnaps / secs;
      this.kbps = (this.windowBytes * 8) / 1000 / secs;
      this.windowStart = arrivalMs;
      this.windowSnaps = 0;
      this.windowBytes = 0;
    }

    // Clock: windowed minimum of (arrival − tick·dt) tracks the fastest path; the spread is jitter.
    const sample = arrivalMs - snap.tick * this.tickMs;
    this.clockSamples.push(sample);
    if (this.clockSamples.length > CLOCK_WINDOW) this.clockSamples.shift();
    let min = Infinity;
    for (const s of this.clockSamples) if (s < min) min = s;
    this.offset = min;
    const excess = sample - min;
    this.jitter = Math.max(this.jitter * 0.97, excess);
    if (this.lastSnapArrival) this.snapInterval += (Math.min(200, arrivalMs - this.lastSnapArrival) - this.snapInterval) * 0.1;
    this.lastSnapArrival = arrivalMs;
    const target = Math.max(60, Math.min(300, this.snapInterval * 1.4 + this.jitter + 12));
    this.interpDelay += (target - this.interpDelay) * 0.08;

    const seen = new Set<number>();
    for (const car of snap.cars) {
      seen.add(car.slot);
      let buf = this.buffers.get(car.slot);
      if (!buf) this.buffers.set(car.slot, (buf = []));
      buf.push({ tick: snap.tick, state: car.state, flags: car.flags, flags2: car.flags2 });
      if (buf.length > 48) buf.splice(0, buf.length - 48);
      if (car.impact > 60) this.impacts.push({ slot: car.slot, impact: car.impact });
      if (car.slot === this.localSlot) this.reconcile(car.state, car.ack, arrivalMs);
    }
    for (const slot of [...this.buffers.keys()]) if (!seen.has(slot)) this.buffers.delete(slot);
    return snap;
  }

  private reconcile(server: CarState, ack: number, now: number): void {
    const spec = this.spec;
    if (!spec) return;
    const acked = this.frames.find((f) => f.seq === ack);
    if (acked) this.rtt = this.rtt ? this.rtt + (now - acked.sentAt - this.rtt) * 0.15 : now - acked.sentAt;
    this.frames = this.frames.filter((f) => f.seq > ack);

    if (!this.pred || this.seq - ack > RESYNC_GAP) {
      // First snapshot of this race (or we ran far ahead during a long outage):
      // adopt the server state and continue the sequence just after the ack.
      if (this.pred) this.corrections++;
      this.pred = server;
      this.prevPred = server;
      this.seq = Math.max(this.seq, ack + 20);
      this.frames = [];
      return;
    }
    const racing = this.status === RaceStatusCode.racing;
    let s = server;
    let prev = server;
    let info: StepInfo | null = null;
    for (const f of this.frames) {
      prev = s;
      const r = stepCar(s, unpackInput(f.packed), spec, this.track, { dt: this.dt, locked: racing ? false : f.locked, boostEnabled: this.boostEnabled });
      s = r.state;
      info = r.info;
    }
    const dx = this.pred.x - s.x;
    const dy = this.pred.y - s.y;
    const dh = wrapAngle(this.pred.heading - s.heading);
    const dist = Math.hypot(dx, dy);
    if (dist > 0.05 || Math.abs(dh) > 0.002) {
      this.corrections++;
      this.lastCorrection = dist;
    }
    if (dist > SNAP_DISTANCE || Math.abs(dh) > 1.4) {
      this.errX = this.errY = this.errH = 0;
    } else {
      this.errX += dx;
      this.errY += dy;
      this.errH = wrapAngle(this.errH + dh);
    }
    this.pred = s;
    this.prevPred = prev;
    if (info) this.predInfo = info;
  }

  /** Drain server-reported impacts (sparks/sound). */
  takeImpacts(): NetImpact[] {
    const out = this.impacts;
    this.impacts = [];
    return out;
  }

  // -------------------------------------------------------------------------
  // Local fixed-step prediction
  // -------------------------------------------------------------------------

  /**
   * Advance local prediction to `now`, sampling one input per fixed step.
   * `locked` mirrors the grid lock; `frozen` stops simulating (results).
   */
  update(now: number, sample: () => CarInput, locked: boolean, frozen = false): void {
    const frameDt = this.lastUpdateAt >= 0 ? Math.max(0, now - this.lastUpdateAt) : 0;
    this.lastUpdateAt = now;
    const decay = Math.exp(-(frameDt / 1000) * 11);
    this.errX *= decay;
    this.errY *= decay;
    this.errH *= decay;
    if (!this.pred || !this.spec || frozen) {
      this.acc = 0;
      return;
    }
    this.acc += Math.min(frameDt, 250);
    let steps = 0;
    while (this.acc >= this.tickMs && steps < MAX_CATCHUP_STEPS) {
      this.acc -= this.tickMs;
      steps++;
      const input = quantizeInput(sample());
      const packed = packInput(input);
      const seq = ++this.seq;
      this.prevPred = this.pred;
      const r = stepCar(this.pred, input, this.spec, this.track, { dt: this.dt, locked, boostEnabled: this.boostEnabled });
      this.pred = r.state;
      this.predInfo = r.info;
      this.lastInput = input;
      this.frames.push({ seq, packed, locked, sentAt: now });
      if (this.outbox.length === 0) this.outboxSeq = seq;
      this.outbox.push(packed);
      if (this.outbox.length >= CIRCUIT_SIM.inputEvery) this.flush(now);
      if (this.frames.length > 240) this.frames.splice(0, this.frames.length - 240);
    }
    if (this.acc > this.tickMs * MAX_CATCHUP_STEPS) this.acc = 0;
  }

  /**
   * True while snapshots have stopped arriving (a stalled connection). We then hold
   * input packets back instead of letting a backlog pile up in the socket (a burst
   * would trip the server's per-second message cap); reconciliation fixes the gap.
   */
  stalled(now: number): boolean {
    return this.hasSnapshot && this.lastSnapArrival > 0 && now - this.lastSnapArrival > STALL_MS;
  }

  private flush(now: number): void {
    if (!this.outbox.length) return;
    if (this.stalled(now)) {
      this.outbox = [];
      this.packetsHeld++;
      return;
    }
    this.sendPacket({ seq: this.outboxSeq, inputs: this.outbox });
    this.packetsSent++;
    this.outbox = [];
  }

  /** Smoothed render state of our own car. */
  localRender(): NetCar | null {
    if (!this.pred || this.localSlot === null) return null;
    const alpha = Math.max(0, Math.min(1, this.acc / this.tickMs));
    const a = this.prevPred ?? this.pred;
    const b = this.pred;
    const info = this.predInfo;
    let flags = 0;
    if (info?.drifting) flags |= CarFlag.drifting;
    if (b.boostOn) flags |= CarFlag.boosting;
    if (info?.surface === 2) flags |= CarFlag.offroad;
    if (info?.surface === 1) flags |= CarFlag.rumble;
    if (info?.sliding) flags |= CarFlag.sliding;
    const latest = this.buffers.get(this.localSlot)?.at(-1);
    if (latest) flags |= latest.flags & (CarFlag.finished | CarFlag.ghost | CarFlag.wrongWay);
    const vx = a.vx + (b.vx - a.vx) * alpha;
    const vy = a.vy + (b.vy - a.vy) * alpha;
    return {
      slot: this.localSlot,
      x: a.x + (b.x - a.x) * alpha + this.errX,
      y: a.y + (b.y - a.y) * alpha + this.errY,
      heading: wrapAngle(lerpAngle(a.heading, b.heading, alpha) + this.errH),
      vx,
      vy,
      speed: Math.hypot(vx, vy),
      angVel: b.angVel,
      flags,
      flags2: latest?.flags2 ?? 0,
      boost: b.boost,
      local: true,
    };
  }

  /** Authoritative-derived state of our car (for HUD numbers). */
  get predicted(): CarState | null {
    return this.pred;
  }

  // -------------------------------------------------------------------------
  // Remote interpolation
  // -------------------------------------------------------------------------

  /** Render tick for remote cars at local time `now`. */
  renderTick(now: number): number {
    return (now - this.offset - this.interpDelay) / this.tickMs;
  }

  remoteRender(slot: number, now: number): NetCar | null {
    const buf = this.buffers.get(slot);
    if (!buf || !buf.length) return null;
    const rt = this.renderTick(now);
    const last = buf[buf.length - 1]!;
    if (rt >= last.tick) {
      const ahead = Math.min(rt - last.tick, MAX_EXTRAPOLATE_TICKS) * this.dt;
      if (rt - last.tick > 0.5) this.extrapolating++;
      const s = last.state;
      return this.carFrom(slot, s.x + s.vx * ahead, s.y + s.vy * ahead, wrapAngle(s.heading + s.angVel * ahead), s, last);
    }
    let i = buf.length - 2;
    while (i > 0 && buf[i]!.tick > rt) i--;
    const a = buf[i]!;
    const b = buf[i + 1] ?? a;
    if (rt <= a.tick || b === a) return this.carFrom(slot, a.state.x, a.state.y, a.state.heading, a.state, a);
    const span = b.tick - a.tick;
    const t = (rt - a.tick) / span;
    const dtSec = span * this.dt;
    // Cubic Hermite with velocity tangents: smooth through curves without overshoot on straights.
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const sa = a.state;
    const sb = b.state;
    const x = h00 * sa.x + h10 * sa.vx * dtSec + h01 * sb.x + h11 * sb.vx * dtSec;
    const y = h00 * sa.y + h10 * sa.vy * dtSec + h01 * sb.y + h11 * sb.vy * dtSec;
    const vx = sa.vx + (sb.vx - sa.vx) * t;
    const vy = sa.vy + (sb.vy - sa.vy) * t;
    const heading = lerpAngle(sa.heading, sb.heading, t);
    return {
      slot,
      x,
      y,
      heading,
      vx,
      vy,
      speed: Math.hypot(vx, vy),
      angVel: sb.angVel,
      flags: t < 0.5 ? a.flags : b.flags,
      flags2: t < 0.5 ? a.flags2 : b.flags2,
      boost: sb.boost,
      local: false,
    };
  }

  private carFrom(slot: number, x: number, y: number, heading: number, s: CarState, sample: Sample): NetCar {
    return { slot, x, y, heading, vx: s.vx, vy: s.vy, speed: Math.hypot(s.vx, s.vy), angVel: s.angVel, flags: sample.flags, flags2: sample.flags2, boost: s.boost, local: false };
  }

  /** Slots with data. */
  slots(): number[] {
    return [...this.buffers.keys()];
  }

  /** Latest authoritative state of a slot (no interpolation). */
  latest(slot: number): CarState | null {
    return this.buffers.get(slot)?.at(-1)?.state ?? null;
  }

  stats(): NetStats {
    let buffered = 0;
    for (const b of this.buffers.values()) buffered = Math.max(buffered, b.length);
    const s: NetStats = {
      rttMs: Math.round(this.rtt),
      jitterMs: Math.round(this.jitter),
      interpDelayMs: Math.round(this.interpDelay),
      buffered,
      corrections: this.corrections,
      lastCorrectionPx: Math.round(this.lastCorrection * 10) / 10,
      pendingInputs: this.frames.length,
      snapsPerSec: Math.round(this.snapsPerSec * 10) / 10,
      kbps: Math.round(this.kbps * 10) / 10,
      extrapolating: this.extrapolating,
      serverTick: this.serverTick,
      packetsSent: this.packetsSent,
      packetsHeld: this.packetsHeld,
    };
    return s;
  }
}
