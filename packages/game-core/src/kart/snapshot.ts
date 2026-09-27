/**
 * Binary wire formats (little-endian).
 *
 * `kart:snap` — broadcast to everyone, ~20 B per kart (display only, quantized):
 *   Header (20 B): u8 version · u8 status (0 grid, 1 racing, 2 done) · u16 raceId · u32 tick ·
 *                  i32 goTick (-1 = not scheduled) · u32 raceMs · u8 karts · u8 entities · u8 boxes · u8 0
 *   Boxes: ceil(boxes / 8) bytes, bit i = item cube i present.
 *   Kart (20 B): u8 slot · u16 flags · i24 x, i24 y (1/128 u) · i16 z (1/64 u) · u16 heading (TAU/65536) ·
 *                i16 vx, vy (1/256 u/s) · i8 yaw rate (1/8 rad/s) · u8 drift (dir 2b | stage 2b << 2) ·
 *                u8 item (code 4b | uses 2b << 4 | trailing << 6 | roulette << 7)
 *   Entity (15 B): u16 id · u8 kind · u8 owner · i24 x, i24 y (1/128 u) · i16 z (1/64 u) · u8 heading (TAU/256) ·
 *                  u8 extra · u8 age (ticks, saturating)
 *
 * `kart:own` — sent only to the racer who drives the kart, the EXACT predictor state (60 B):
 *   u8 version · u16 raceId · u32 tick · u8 slot · u32 ackSeq · state (48 B, see writeState).
 */
import type { KartItemId } from '@dascade/shared/games/kart';
import { itemFromCode } from './itemcodes.ts';
import { ENTITY_KINDS, type EntityKind } from './items.ts';
import { driftStage, type KartState } from './kart.ts';
import { HEADING_Q, Q_ANG, Q_VEL, Q_Z, TAU, headingIndex } from './math.ts';
import type { KartSim, SimKart } from './sim.ts';
import { SURF_DIRT, SURF_MUD, SURF_OFFROAD } from './track.ts';

export const KART_SNAPSHOT_VERSION = 1;
export const KART_OWN_VERSION = 1;
export const SNAP_HEADER = 20;
export const SNAP_KART = 20;
export const SNAP_ENTITY = 15;
export const OWN_BYTES = 60;
export const STATE_BYTES = 48;
export const MAX_SNAP_KARTS = 32;
export const MAX_SNAP_ENTITIES = 64;
export const MAX_SNAP_BOXES = 64;

export type KartStatusCode = 0 | 1 | 2;
const STATUS_NAMES = ['grid', 'racing', 'done'] as const;

export const KartFlag = {
  drifting: 1 << 0,
  boosting: 1 << 1,
  offroad: 1 << 2,
  air: 1 << 3,
  ghost: 1 << 4,
  finished: 1 << 5,
  wrongWay: 1 << 6,
  connected: 1 << 7,
  shielded: 1 << 8,
  spinning: 1 << 9,
  warping: 1 << 10,
  falling: 1 << 11,
  immune: 1 << 12,
  /** Hit (or blocked a hit) since the last snapshot. */
  hit: 1 << 13,
  slick: 1 << 14,
  magnet: 1 << 15,
} as const;

export interface SnapKart {
  slot: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vy: number;
  /** Yaw rate (rad/s, 1/8 precision). */
  yawRate: number;
  /** -1 right, 0 none, 1 left. */
  driftDir: number;
  driftStage: number;
  item: KartItemId | null;
  itemUses: number;
  trailing: boolean;
  roulette: boolean;
}

export interface SnapEntity {
  id: number;
  kind: EntityKind;
  owner: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** puck: wall bounces · seeker: target slot (255 = none) · mine/puddle: 1 = still in the air (lobbed). */
  extra: number;
  age: number;
}

export interface KartSnapshot {
  status: 'grid' | 'racing' | 'done';
  raceId: number;
  tick: number;
  goTick: number;
  raceMs: number;
  karts: SnapKart[];
  entities: SnapEntity[];
  /** Present flag per track.itemBoxes index. */
  boxes: boolean[];
}

export interface KartOwn {
  raceId: number;
  tick: number;
  slot: number;
  ack: number;
  state: KartState;
}

function setI24(v: DataView, o: number, val: number): void {
  const q = Math.max(-0x800000, Math.min(0x7fffff, Math.round(val)));
  const u = q < 0 ? q + 0x1000000 : q;
  v.setUint8(o, u & 0xff);
  v.setUint8(o + 1, (u >>> 8) & 0xff);
  v.setUint8(o + 2, (u >>> 16) & 0xff);
}

function getI24(v: DataView, o: number): number {
  const u = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16);
  return u >= 0x800000 ? u - 0x1000000 : u;
}

const clampI16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x)));
const clampI8 = (x: number) => Math.max(-128, Math.min(127, Math.round(x)));

export function kartFlags(sim: KartSim, k: SimKart): number {
  const st = k.state;
  const i = k.info;
  let f = 0;
  if (st.driftDir !== 0) f |= KartFlag.drifting;
  if (st.boostTicks > 0) f |= KartFlag.boosting;
  if (i.surface === SURF_OFFROAD || i.surface === SURF_DIRT || i.surface === SURF_MUD) f |= KartFlag.offroad;
  if (!st.grounded) f |= KartFlag.air;
  if (sim.isGhost(k)) f |= KartFlag.ghost;
  if (k.progress.finished) f |= KartFlag.finished;
  if (k.progress.wrongWay) f |= KartFlag.wrongWay;
  if (k.connected || k.brain) f |= KartFlag.connected;
  if (st.shieldTicks > 0) f |= KartFlag.shielded;
  if (st.spinTicks > 0) f |= KartFlag.spinning;
  if (st.warpTicks > 0) f |= KartFlag.warping;
  if (st.fallTicks > 0) f |= KartFlag.falling;
  if (st.immuneTicks > 0) f |= KartFlag.immune;
  if (k.hitFlag) f |= KartFlag.hit;
  if (st.slickTicks > 0) f |= KartFlag.slick;
  if (st.magnetTicks > 0) f |= KartFlag.magnet;
  return f;
}

export function encodeSnapshot(sim: KartSim): Uint8Array {
  const karts = sim.karts.filter((k) => !k.retired).slice(0, MAX_SNAP_KARTS);
  const ents = sim.entities.slice(-MAX_SNAP_ENTITIES);
  const boxes = sim.boxes.slice(0, MAX_SNAP_BOXES);
  const boxBytes = Math.ceil(boxes.length / 8);
  const size = SNAP_HEADER + boxBytes + karts.length * SNAP_KART + ents.length * SNAP_ENTITY;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint8(0, KART_SNAPSHOT_VERSION);
  v.setUint8(1, sim.statusCode());
  v.setUint16(2, sim.raceId & 0xffff, true);
  v.setUint32(4, sim.tick >>> 0, true);
  v.setInt32(8, sim.goTick, true);
  v.setUint32(12, Math.max(0, Math.round(sim.raceMs)) >>> 0, true);
  v.setUint8(16, karts.length);
  v.setUint8(17, ents.length);
  v.setUint8(18, boxes.length);
  let o = SNAP_HEADER;
  for (let i = 0; i < boxes.length; i++) if (boxes[i]!.present) v.setUint8(o + (i >> 3), v.getUint8(o + (i >> 3)) | (1 << (i & 7)));
  o += boxBytes;
  for (const k of karts) {
    const st = k.state;
    v.setUint8(o, k.slot);
    v.setUint16(o + 1, kartFlags(sim, k), true);
    setI24(v, o + 3, st.x * 128);
    setI24(v, o + 6, st.y * 128);
    v.setInt16(o + 9, clampI16(st.z * 64), true);
    v.setUint16(o + 11, headingIndex(st.heading) & 0xffff, true);
    v.setInt16(o + 13, clampI16(st.vx * 256), true);
    v.setInt16(o + 15, clampI16(st.vy * 256), true);
    v.setInt8(o + 17, clampI8(st.angVel * 8));
    const dir = st.driftDir > 0 ? 1 : st.driftDir < 0 ? 2 : 0;
    v.setUint8(o + 18, dir | (driftStage(st) << 2));
    v.setUint8(o + 19, (st.item & 15) | (Math.min(3, st.itemUses) << 4) | (st.trailing ? 64 : 0) | (st.rouletteTicks > 0 ? 128 : 0));
    o += SNAP_KART;
  }
  for (const e of ents) {
    v.setUint16(o, e.id & 0xffff, true);
    v.setUint8(o + 2, ENTITY_KINDS.indexOf(e.kind));
    v.setUint8(o + 3, e.owner & 0xff);
    setI24(v, o + 4, e.x * 128);
    setI24(v, o + 7, e.y * 128);
    v.setInt16(o + 10, clampI16(e.z * 64), true);
    v.setUint8(o + 12, ((Math.round((e.heading / TAU) * 256) % 256) + 256) % 256);
    const extra = e.kind === 'puck' ? e.bounces : e.kind === 'seeker' ? (e.target < 0 ? 255 : e.target) : e.flying ? 1 : 0;
    v.setUint8(o + 13, extra & 0xff);
    v.setUint8(o + 14, Math.min(255, e.age));
    o += SNAP_ENTITY;
  }
  return new Uint8Array(buf);
}

/** Decode a broadcast snapshot; null for anything malformed. */
export function decodeKartSnapshot(bytes: Uint8Array): KartSnapshot | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < SNAP_HEADER) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== KART_SNAPSHOT_VERSION) return null;
  const status = v.getUint8(1);
  if (status > 2) return null;
  const nk = v.getUint8(16);
  const ne = v.getUint8(17);
  const nb = v.getUint8(18);
  if (nk > MAX_SNAP_KARTS || ne > MAX_SNAP_ENTITIES || nb > MAX_SNAP_BOXES) return null;
  const boxBytes = Math.ceil(nb / 8);
  if (bytes.byteLength !== SNAP_HEADER + boxBytes + nk * SNAP_KART + ne * SNAP_ENTITY) return null;
  let o = SNAP_HEADER;
  const boxes: boolean[] = [];
  for (let i = 0; i < nb; i++) boxes.push((v.getUint8(o + (i >> 3)) & (1 << (i & 7))) !== 0);
  o += boxBytes;
  const karts: SnapKart[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < nk; i++) {
    const slot = v.getUint8(o);
    if (slot >= MAX_SNAP_KARTS || seen.has(slot)) return null;
    seen.add(slot);
    const drift = v.getUint8(o + 18);
    const item = v.getUint8(o + 19);
    const dirBits = drift & 3;
    if (dirBits === 3) return null;
    karts.push({
      slot,
      flags: v.getUint16(o + 1, true),
      x: getI24(v, o + 3) / 128,
      y: getI24(v, o + 6) / 128,
      z: v.getInt16(o + 9, true) / 64,
      heading: headingFromIndex(v.getUint16(o + 11, true)),
      vx: v.getInt16(o + 13, true) / 256,
      vy: v.getInt16(o + 15, true) / 256,
      yawRate: v.getInt8(o + 17) / 8,
      driftDir: dirBits === 1 ? 1 : dirBits === 2 ? -1 : 0,
      driftStage: (drift >> 2) & 3,
      item: itemFromCode(item & 15),
      itemUses: (item >> 4) & 3,
      trailing: (item & 64) !== 0,
      roulette: (item & 128) !== 0,
    });
    o += SNAP_KART;
  }
  const entities: SnapEntity[] = [];
  for (let i = 0; i < ne; i++) {
    const kind = ENTITY_KINDS[v.getUint8(o + 2)];
    if (!kind) return null;
    const h = v.getUint8(o + 12);
    entities.push({
      id: v.getUint16(o, true),
      kind,
      owner: v.getUint8(o + 3),
      x: getI24(v, o + 4) / 128,
      y: getI24(v, o + 7) / 128,
      z: v.getInt16(o + 10, true) / 64,
      heading: (h >= 128 ? h - 256 : h) * (TAU / 256),
      extra: v.getUint8(o + 13),
      age: v.getUint8(o + 14),
    });
    o += SNAP_ENTITY;
  }
  return {
    status: STATUS_NAMES[status]!,
    raceId: v.getUint16(2, true),
    tick: v.getUint32(4, true),
    goTick: v.getInt32(8, true),
    raceMs: v.getUint32(12, true),
    karts,
    entities,
    boxes,
  };
}

function headingFromIndex(u: number): number {
  return (u >= 32768 ? u - 65536 : u) * HEADING_Q;
}

// ---------------------------------------------------------------------------
// Own (exact) state
// ---------------------------------------------------------------------------

/** Write the exact KartState (48 B) at offset o. */
export function writeState(v: DataView, o: number, st: KartState): void {
  v.setFloat32(o, st.x, true);
  v.setFloat32(o + 4, st.y, true);
  v.setInt16(o + 8, clampI16(st.z * Q_Z), true);
  v.setInt16(o + 10, headingIndex(st.heading), true);
  v.setInt16(o + 12, clampI16(st.vx * Q_VEL), true);
  v.setInt16(o + 14, clampI16(st.vy * Q_VEL), true);
  v.setInt16(o + 16, clampI16(st.vz * Q_VEL), true);
  v.setInt16(o + 18, clampI16(st.angVel * Q_ANG), true);
  v.setUint16(o + 20, st.seg & 0xffff, true);
  v.setInt8(o + 22, st.branch);
  v.setUint16(o + 23, st.safeSeg & 0xffff, true);
  v.setInt8(o + 25, st.safeBranch);
  v.setUint8(
    o + 26,
    (st.grounded ? 1 : 0) |
      (st.driftArmed ? 2 : 0) |
      (st.rampAir ? 4 : 0) |
      (st.trick ? 8 : 0) |
      (st.trailing ? 16 : 0) |
      ((st.buttons & 3) << 5),
  );
  v.setInt8(o + 27, st.driftDir);
  v.setUint16(o + 28, st.driftCharge, true);
  const u8 = [st.boostTicks, st.boostPower, st.stallTicks, st.rev, st.spinTicks, st.immuneTicks, st.slickTicks];
  for (let i = 0; i < u8.length; i++) v.setUint8(o + 30 + i, Math.max(0, Math.min(255, u8[i]!)));
  v.setUint16(o + 37, st.shieldTicks, true);
  const u8b = [st.magnetTicks, st.magnetPower, st.warpTicks, st.fallTicks, st.airTicks, st.item, st.itemUses, st.rouletteTicks];
  for (let i = 0; i < u8b.length; i++) v.setUint8(o + 39 + i, Math.max(0, Math.min(255, u8b[i]!)));
  v.setInt8(o + 47, Math.max(-127, Math.min(127, st.wallTicks)));
}

export function readState(v: DataView, o: number): KartState | null {
  const x = v.getFloat32(o, true);
  const y = v.getFloat32(o + 4, true);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
  const bits = v.getUint8(o + 26);
  const driftDir = v.getInt8(o + 27);
  if (driftDir < -1 || driftDir > 1) return null;
  const item = v.getUint8(o + 44);
  if (item > 15) return null;
  return {
    x,
    y,
    z: v.getInt16(o + 8, true) / Q_Z,
    heading: v.getInt16(o + 10, true) * HEADING_Q,
    vx: v.getInt16(o + 12, true) / Q_VEL,
    vy: v.getInt16(o + 14, true) / Q_VEL,
    vz: v.getInt16(o + 16, true) / Q_VEL,
    angVel: v.getInt16(o + 18, true) / Q_ANG,
    seg: v.getUint16(o + 20, true),
    branch: v.getInt8(o + 22),
    safeSeg: v.getUint16(o + 23, true),
    safeBranch: v.getInt8(o + 25),
    grounded: (bits & 1) !== 0,
    driftArmed: (bits & 2) !== 0,
    rampAir: (bits & 4) !== 0,
    trick: (bits & 8) !== 0,
    trailing: (bits & 16) !== 0,
    buttons: (bits >> 5) & 3,
    driftDir,
    driftCharge: v.getUint16(o + 28, true),
    boostTicks: v.getUint8(o + 30),
    boostPower: v.getUint8(o + 31),
    stallTicks: v.getUint8(o + 32),
    rev: v.getUint8(o + 33),
    spinTicks: v.getUint8(o + 34),
    immuneTicks: v.getUint8(o + 35),
    slickTicks: v.getUint8(o + 36),
    shieldTicks: v.getUint16(o + 37, true),
    magnetTicks: v.getUint8(o + 39),
    magnetPower: v.getUint8(o + 40),
    warpTicks: v.getUint8(o + 41),
    fallTicks: v.getUint8(o + 42),
    airTicks: v.getUint8(o + 43),
    item,
    itemUses: v.getUint8(o + 45),
    rouletteTicks: v.getUint8(o + 46),
    wallTicks: v.getInt8(o + 47),
  };
}

export function encodeOwn(raceId: number, tick: number, slot: number, ack: number, st: KartState): Uint8Array {
  const buf = new ArrayBuffer(OWN_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, KART_OWN_VERSION);
  v.setUint16(1, raceId & 0xffff, true);
  v.setUint32(3, tick >>> 0, true);
  v.setUint8(7, slot & 0xff);
  v.setUint32(8, ack >>> 0, true);
  writeState(v, 12, st);
  return new Uint8Array(buf);
}

/** Decode a `kart:own` record; null for anything malformed. */
export function decodeKartOwn(bytes: Uint8Array): KartOwn | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== OWN_BYTES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== KART_OWN_VERSION) return null;
  const slot = v.getUint8(7);
  if (slot >= MAX_SNAP_KARTS) return null;
  const state = readState(v, 12);
  if (!state) return null;
  return { raceId: v.getUint16(1, true), tick: v.getUint32(3, true), slot, ack: v.getUint32(8, true), state };
}
