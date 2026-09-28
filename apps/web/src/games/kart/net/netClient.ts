/**
 * DASphalt GP client netcode (no rendering, no React).
 *
 * Two server streams:
 *  - `kart:snap` (broadcast, ~20 Hz): compact DISPLAY records for every kart + entities + item
 *    boxes. Other karts are drawn from these through an interpolation buffer (~100 ms behind,
 *    adaptive to jitter); the header's tick drives the snapshot clock.
 *  - `kart:own` (only to a racer): that racer's EXACT kart state + the last applied input seq.
 *
 * Local kart — prediction + reconciliation (core `KartPredictor`):
 *   - One input per fixed 60 Hz step, quantized like the wire, stepped locally and recorded;
 *     frames go out in packets of `KART_SIM.inputEvery` (`InputOutbox`).
 *   - Each `kart:own` is adopted and the unacknowledged frames are replayed. The visual difference
 *     between the old and the corrected prediction is folded into a decaying offset
 *     (`ErrorSmoother`), so corrections glide instead of snapping; big jumps (respawn) snap.
 */
import { KART_SIM, NEUTRAL_KART_INPUT, type KartInput, type KartInputPacket } from '@dascade/shared/games/kart';
import {
  KartPredictor,
  decodeKartOwn,
  decodeKartSnapshot,
  type KartSnapshot,
  type KartSpec,
  type KartState,
  type KartStepInfo,
  type KartTrack,
  type SnapEntity,
  type SnapKart,
} from '@dascade/game-core/kart';
import { ErrorSmoother, InterpBuffer, SnapshotClock, lerpAngle, wrapPi, type Pose } from './interp.ts';
import { InputOutbox, RESYNC_GAP } from './outbox.ts';

export interface NetStats {
  rttMs: number;
  jitterMs: number;
  interpDelayMs: number;
  buffered: number;
  corrections: number;
  lastCorrection: number;
  pendingInputs: number;
  snapsPerSec: number;
  kbps: number;
  extrapolating: number;
  serverTick: number;
  packetsSent: number;
  packetsHeld: number;
}

/** No snapshot for this long → treat the connection as stalled (hold input packets). */
const STALL_MS = 500;
const MAX_CATCHUP_STEPS = 8;
/** A per-tick heading change beyond this (rad) is smoothed visually (wall redirects). */
const HEADING_SNAP = 0.5;
const MAX_COORD = 1e5;
const MAX_SPEED = 1e3;
/** Authoritative trace kept for the time-trial ghost (≈10 min at 20 Hz). */
const MAX_TRACE = 12_000;

function finite(...xs: number[]): boolean {
  for (const x of xs) if (!Number.isFinite(x)) return false;
  return true;
}

/** A decoded kart state we are willing to predict from. */
export function saneKartState(s: KartState): boolean {
  return (
    finite(s.x, s.y, s.z, s.heading, s.vx, s.vy, s.vz) &&
    Math.abs(s.x) < MAX_COORD &&
    Math.abs(s.y) < MAX_COORD &&
    Math.abs(s.z) < MAX_COORD &&
    Math.abs(s.vx) < MAX_SPEED &&
    Math.abs(s.vy) < MAX_SPEED &&
    Math.abs(s.vz) < MAX_SPEED
  );
}

export function saneSnapKart(k: SnapKart): boolean {
  return (
    finite(k.x, k.y, k.z, k.heading, k.vx, k.vy) && Math.abs(k.x) < MAX_COORD && Math.abs(k.y) < MAX_COORD && Math.abs(k.z) < MAX_COORD
  );
}

function snapPose(k: SnapKart): Pose {
  return { x: k.x, y: k.y, z: k.z, yaw: k.heading, vx: k.vx, vy: k.vy, vz: 0 };
}

interface EntitySample {
  tick: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  age: number;
}

interface EntityTrack {
  kind: SnapEntity['kind'];
  owner: number;
  a: EntitySample;
  b: EntitySample | null;
}

export interface RenderEntity {
  id: number;
  kind: SnapEntity['kind'];
  owner: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  ageSec: number;
}

export interface TracePoint {
  tick: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

export class KartNet {
  readonly tickMs = 1000 / KART_SIM.tickRate;
  readonly dt = 1 / KART_SIM.tickRate;
  readonly clock = new SnapshotClock(this.tickMs);

  track: KartTrack;
  raceId = -1;
  status: KartSnapshot['status'] = 'grid';
  serverTick = 0;
  goTick = -1;
  raceMs = 0;
  hasSnapshot = false;
  /** Latest snapshot (boxes, raw display records) — read-only for callers. */
  latest: KartSnapshot | null = null;
  /** While the E2E autopilot drives our kart on the server, we neither predict nor send inputs. */
  autopilot = false;

  // Local prediction.
  private localSlot: number | null = null;
  private spec: KartSpec | null = null;
  private pred: KartPredictor | null = null;
  private synced = false;
  private acc = 0;
  private lastUpdateAt = -1;
  readonly err = new ErrorSmoother(12, 12);
  lastInput: KartInput = { ...NEUTRAL_KART_INPUT };
  private infos: KartStepInfo[] = [];
  private readonly outbox: InputOutbox;
  /** Our kart's display flags from the latest broadcast snapshot (wrong way, finished…). */
  localFlags = 0;
  /** Diagnostics: own-state messages seen, and why the last one was ignored. */
  ownSeen = 0;
  ownRejected = '';
  /** Authoritative trace of our own kart this race (ghost recording). */
  readonly trace: TracePoint[] = [];

  // Remote interpolation.
  private readonly buffers = new Map<number, InterpBuffer<SnapKart>>();
  private readonly entities = new Map<number, EntityTrack>();

  // Stats.
  private rtt = 0;
  private corrections = 0;
  private lastCorrection = 0;
  private windowStart = 0;
  private windowSnaps = 0;
  private windowBytes = 0;
  private snapsPerSec = 0;
  private kbps = 0;

  constructor(track: KartTrack, sendPacket: (packet: KartInputPacket) => void) {
    this.track = track;
    this.outbox = new InputOutbox(sendPacket);
  }

  setTrack(track: KartTrack): void {
    if (this.track === track) return;
    this.track = track;
    this.pred = this.localSlot !== null && this.spec ? new KartPredictor(track, this.spec) : null;
    this.resetRace(this.raceId);
  }

  /** Which kart we drive (null = spectating). */
  setLocal(slot: number | null, spec: KartSpec | null): void {
    if (slot === this.localSlot && spec === this.spec) return;
    this.localSlot = slot;
    this.spec = spec;
    this.pred = slot !== null && spec ? new KartPredictor(this.track, spec) : null;
    this.synced = false;
    this.outbox.reset();
    this.err.reset();
  }

  get local(): number | null {
    return this.localSlot;
  }

  /** True once our kart has an authoritative state to predict from. */
  get predicting(): boolean {
    return this.synced && !this.autopilot && this.pred?.state != null && this.localSlot !== null;
  }

  get predictor(): KartPredictor | null {
    return this.pred;
  }

  resetRace(raceId: number): void {
    this.raceId = raceId;
    this.buffers.clear();
    this.entities.clear();
    this.clock.reset();
    this.pred?.reset();
    this.synced = false;
    this.outbox.reset();
    this.err.reset();
    this.hasSnapshot = false;
    this.serverTick = 0;
    this.goTick = -1;
    this.status = 'grid';
    this.latest = null;
    this.infos = [];
    this.trace.length = 0;
    this.localFlags = 0;
    // The server clears test autopilots every race.
    this.autopilot = false;
  }

  // -------------------------------------------------------------------------
  // Incoming
  // -------------------------------------------------------------------------

  /** Raw race ids are 16-bit on the wire. */
  private sameRace(raceId: number): boolean {
    return (raceId & 0xffff) === (this.raceId & 0xffff);
  }

  ingest(bytes: Uint8Array, arrivalMs: number): KartSnapshot | null {
    const snap = decodeKartSnapshot(bytes);
    if (!snap) return null;
    if (!this.sameRace(snap.raceId)) this.resetRace(snap.raceId);
    if (this.hasSnapshot && snap.tick <= this.serverTick) return null;
    this.hasSnapshot = true;
    this.serverTick = snap.tick;
    this.goTick = snap.goTick;
    this.status = snap.status;
    this.raceMs = snap.raceMs;
    this.latest = snap;

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

    this.clock.observe(snap.tick, arrivalMs);

    const seen = new Set<number>();
    for (const k of snap.karts) {
      if (!saneSnapKart(k)) continue;
      seen.add(k.slot);
      let buf = this.buffers.get(k.slot);
      if (!buf) this.buffers.set(k.slot, (buf = new InterpBuffer<SnapKart>(this.dt)));
      buf.push(snap.tick, snapPose(k), k);
      if (k.slot === this.localSlot) this.localFlags = k.flags;
    }
    for (const slot of [...this.buffers.keys()]) if (!seen.has(slot)) this.buffers.delete(slot);

    const live = new Set<number>();
    for (const e of snap.entities) {
      if (!finite(e.x, e.y, e.z, e.heading)) continue;
      live.add(e.id);
      const sample: EntitySample = { tick: snap.tick, x: e.x, y: e.y, z: e.z, heading: e.heading, age: e.age };
      const t = this.entities.get(e.id);
      if (!t || t.kind !== e.kind) this.entities.set(e.id, { kind: e.kind, owner: e.owner, a: sample, b: null });
      else {
        if (t.b) t.a = t.b;
        t.b = sample;
      }
    }
    for (const id of [...this.entities.keys()]) if (!live.has(id)) this.entities.delete(id);
    return snap;
  }

  /** `kart:own`: our kart's exact state + ack → reconcile the prediction. */
  ingestOwn(bytes: Uint8Array, arrivalMs: number): void {
    this.ownSeen++;
    const own = decodeKartOwn(bytes);
    const pred = this.pred;
    if (!own) {
      this.ownRejected = `decode (${bytes?.byteLength ?? typeof bytes} B)`;
      return;
    }
    if (!pred || own.slot !== this.localSlot) {
      this.ownRejected = `slot ${own.slot} vs ${this.localSlot}`;
      return;
    }
    if (!this.sameRace(own.raceId) || !saneKartState(own.state)) {
      this.ownRejected = `race ${own.raceId} vs ${this.raceId}`;
      return;
    }
    const acked = this.outbox.ack(own.ack);
    if (acked) this.rtt = this.rtt ? this.rtt + (arrivalMs - acked.sentAt - this.rtt) * 0.15 : arrivalMs - acked.sentAt;
    if (this.trace.length < MAX_TRACE) {
      const last = this.trace[this.trace.length - 1];
      if (!last || own.tick > last.tick)
        this.trace.push({ tick: own.tick, x: own.state.x, y: own.state.y, z: own.state.z, heading: own.state.heading });
    }
    if (this.autopilot) {
      pred.reset();
      this.synced = false;
      return;
    }
    const racing = this.status === 'racing';
    const before = pred.state;
    if (!this.synced || !before || pred.seq - own.ack > RESYNC_GAP) {
      // First state of this race, or we ran far ahead during an outage: adopt it outright.
      if (this.synced) this.corrections++;
      pred.reconcile(own.state, own.ack, own.tick, racing, own.goSeq);
      this.synced = true;
      this.err.reset();
      return;
    }
    const bx = before.x;
    const by = before.y;
    const bz = before.z;
    const bh = before.heading;
    const dist = pred.reconcile(own.state, own.ack, own.tick, racing, own.goSeq);
    const after = pred.state;
    if (!after) return;
    const dh = wrapPi(bh - after.heading);
    if (dist > 0.02 || Math.abs(dh) > 0.002) {
      this.corrections++;
      this.lastCorrection = dist;
      this.err.add(bx - after.x, by - after.y, bz - after.z, dh);
    }
  }

  /**
   * A solo pause ended: the server's tick stood still while wall time ran on, so the clock filter's
   * history no longer maps ticks to local time. Start it afresh (and drop any visual correction).
   */
  onResume(): void {
    this.clock.reset();
    this.err.reset();
    this.acc = 0;
    this.lastUpdateAt = -1;
  }

  // -------------------------------------------------------------------------
  // Local fixed-step prediction
  // -------------------------------------------------------------------------

  /**
   * Milliseconds until our first input frame applied after GO (the moment the kart really goes,
   * input delay included) — time the countdown lights by this. Null when unknown.
   */
  startToGoMs(): number | null {
    const pred = this.pred;
    if (!pred || this.goTick < 0 || !this.synced) return null;
    const frames = pred.framesToGo(this.goTick);
    if (!Number.isFinite(frames)) return null;
    return (frames - this.acc / this.tickMs) * this.tickMs;
  }

  /** Server tick the next local input will most likely be applied at. */
  predictedTick(now: number): number {
    return this.clock.liveTick(now) + this.rtt / this.tickMs;
  }

  stalled(now: number): boolean {
    return this.hasSnapshot && this.clock.sinceLast(now) > STALL_MS;
  }

  /**
   * Advance local prediction to `now`, one sampled input per fixed step. `locked` mirrors the
   * grid lock; `frozen` stops simulating and sending (lobby/results).
   */
  update(now: number, sample: () => KartInput, locked: boolean, frozen: boolean): void {
    const frameMs = this.lastUpdateAt >= 0 ? Math.max(0, now - this.lastUpdateAt) : 0;
    this.lastUpdateAt = now;
    this.err.decay(frameMs);
    const pred = this.pred;
    if (!pred || frozen || this.autopilot || !this.hasSnapshot) {
      this.acc = 0;
      return;
    }
    this.acc += Math.min(frameMs, 250);
    let steps = 0;
    const stalled = this.stalled(now);
    let tick = Math.round(this.predictedTick(now));
    while (this.acc >= this.tickMs && steps < MAX_CATCHUP_STEPS) {
      this.acc -= this.tickMs;
      steps++;
      const input = sample();
      // Lock each frame exactly as the server will apply it (by frame, relative to goTick), so the
      // start boost/stall the player sees is the one the server gives, at any latency.
      const frameLocked = this.goTick >= 0 || pred.goSeq > 0 ? pred.nextFrameLocked(this.goTick) : locked;
      const r = pred.step(input, frameLocked, tick++);
      this.lastInput = input;
      if (pred.info && pred.state) {
        this.infos.push(pred.info);
        if (this.infos.length > 32) this.infos.splice(0, this.infos.length - 32);
        // A hard wall hit can turn the nose up to ~90° in one tick: glide the visual heading
        // there (~80 ms) instead of snapping. Spin-outs rotate smoothly on their own.
        const prev = pred.prev;
        if (prev && pred.state.spinTicks === 0) {
          const dh = wrapPi(prev.heading - pred.state.heading);
          if (Math.abs(dh) > HEADING_SNAP) this.err.addYaw(dh);
        }
      }
      this.outbox.push(r.packed, now, stalled, r.seq);
    }
    if (this.acc > this.tickMs * MAX_CATCHUP_STEPS) this.acc = 0;
  }

  /** Step infos from local prediction since the last call (landings, pads, mini-turbos, walls). */
  takeInfos(): KartStepInfo[] {
    const out = this.infos;
    this.infos = [];
    return out;
  }

  /** Smoothed render pose of our own kart (interpolated between fixed steps + error offset). */
  localPose(out: Pose): KartState | null {
    const pred = this.pred;
    if (!pred || !this.predicting || !pred.state) return null;
    const alpha = Math.max(0, Math.min(1, this.acc / this.tickMs));
    const b = pred.state;
    const a = pred.prev ?? b;
    const jump = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) > 100;
    const t = jump ? 1 : alpha;
    out.x = a.x + (b.x - a.x) * t + this.err.x;
    out.y = a.y + (b.y - a.y) * t + this.err.y;
    out.z = a.z + (b.z - a.z) * t + this.err.z;
    // A snapped heading (wall redirect) is already glided by the smoother: don't also lerp it.
    const ht = Math.abs(wrapPi(b.heading - a.heading)) > HEADING_SNAP ? 1 : t;
    out.yaw = wrapPi(lerpAngle(a.heading, b.heading, ht) + this.err.yaw);
    out.vx = a.vx + (b.vx - a.vx) * t;
    out.vy = a.vy + (b.vy - a.vy) * t;
    out.vz = b.vz;
    return b;
  }

  // -------------------------------------------------------------------------
  // Remote interpolation
  // -------------------------------------------------------------------------

  renderTick(now: number): number {
    return this.clock.renderTick(now);
  }

  remotePose(slot: number, now: number, out: Pose): SnapKart | null {
    const buf = this.buffers.get(slot);
    if (!buf) return null;
    return buf.sample(this.clock.renderTick(now), out);
  }

  /** Latest display record of a slot (no interpolation). */
  latestOf(slot: number): SnapKart | null {
    return this.buffers.get(slot)?.latest?.data ?? null;
  }

  /** Entities at render time (interpolated between their last two samples). Reuses `out`. */
  renderEntities(now: number, out: RenderEntity[]): RenderEntity[] {
    const rt = this.clock.renderTick(now);
    let n = 0;
    for (const [id, t] of this.entities) {
      const a = t.a;
      const b = t.b;
      let x = a.x;
      let y = a.y;
      let z = a.z;
      let heading = a.heading;
      let age = a.age;
      if (b && b.tick > a.tick) {
        const u = Math.max(0, Math.min(1.4, (rt - a.tick) / (b.tick - a.tick)));
        x = a.x + (b.x - a.x) * u;
        y = a.y + (b.y - a.y) * u;
        z = a.z + (b.z - a.z) * u;
        heading = lerpAngle(a.heading, b.heading, Math.min(1, u));
        age = a.age + (b.age - a.age) * u;
      }
      let e = out[n];
      if (!e) out[n] = e = { id, kind: t.kind, owner: t.owner, x, y, z, heading, ageSec: 0 };
      e.id = id;
      e.kind = t.kind;
      e.owner = t.owner;
      e.x = x;
      e.y = y;
      e.z = z;
      e.heading = heading;
      e.ageSec = Math.max(0, age) * this.dt;
      n++;
    }
    out.length = n;
    return out;
  }

  stats(): NetStats {
    let buffered = 0;
    let extrapolating = 0;
    for (const b of this.buffers.values()) {
      buffered = Math.max(buffered, b.items.length);
      extrapolating += b.extrapolated;
    }
    return {
      rttMs: Math.round(this.rtt),
      jitterMs: Math.round(this.clock.jitter),
      interpDelayMs: Math.round(this.clock.delay),
      buffered,
      corrections: this.corrections,
      lastCorrection: Math.round(this.lastCorrection * 100) / 100,
      pendingInputs: this.pred?.pending.length ?? 0,
      snapsPerSec: Math.round(this.snapsPerSec * 10) / 10,
      kbps: Math.round(this.kbps * 10) / 10,
      extrapolating,
      serverTick: this.serverTick,
      packetsSent: this.outbox.sent,
      packetsHeld: this.outbox.held,
    };
  }
}

/**
 * Resample the authoritative trace onto the ghost's fixed grid (every `every` ticks from GO) so
 * sample i is exactly i·100 ms after the green light, whatever the snapshot cadence was.
 */
export function resampleTrace(trace: readonly TracePoint[], goTick: number, every: number): TracePoint[] {
  const out: TracePoint[] = [];
  if (trace.length < 2 || goTick < 0) return out;
  let j = 0;
  const last = trace[trace.length - 1]!.tick;
  for (let t = goTick; t <= last; t += every) {
    while (j < trace.length - 2 && trace[j + 1]!.tick < t) j++;
    const a = trace[j]!;
    const b = trace[j + 1]!;
    if (t <= a.tick) {
      out.push({ ...a, tick: t });
      continue;
    }
    const u = b.tick > a.tick ? Math.min(1, (t - a.tick) / (b.tick - a.tick)) : 0;
    out.push({
      tick: t,
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
      heading: lerpAngle(a.heading, b.heading, u),
    });
  }
  return out;
}
