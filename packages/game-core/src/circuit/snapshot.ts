/**
 * Compact binary snapshot of every car on track (little-endian).
 *
 * Header (16 bytes)
 *   u8  version            u8  status (0 grid, 1 racing, 2 done)
 *   u16 raceId             u32 tick
 *   i32 raceMs             u8  count      u8[3] reserved
 * Car (40 bytes each)
 *   u8 slot  u8 flags  u8 flags2  u8 reserved
 *   u32 ackSeq (last input applied for this car)
 *   f32 x, y, heading, vx, vy, angVel
 *   u16 boost (×4096)  u16 drift ticks  u16 seg hint  u16 impact (px/s)
 *
 * Car state is quantized by the simulation to exactly these representations, so a
 * client that reconciles from a snapshot replays bit-identically to the server.
 */
import { BOOST_Q, type CarState } from './car.ts';

export const SNAPSHOT_VERSION = 3;
export const SNAPSHOT_HEADER = 16;
export const SNAPSHOT_CAR = 40;
export const MAX_SNAPSHOT_CARS = 32;

export const CarFlag = {
  drifting: 1 << 0,
  boosting: 1 << 1,
  offroad: 1 << 2,
  rumble: 1 << 3,
  sliding: 1 << 4,
  finished: 1 << 5,
  ghost: 1 << 6,
  wrongWay: 1 << 7,
} as const;

export const CarFlag2 = {
  connected: 1 << 0,
  locked: 1 << 1,
  elevated: 1 << 2,
  hit: 1 << 3,
} as const;

export const RaceStatusCode = { grid: 0, racing: 1, done: 2 } as const;
export type RaceStatusCode = (typeof RaceStatusCode)[keyof typeof RaceStatusCode];

export interface SnapshotCar {
  slot: number;
  flags: number;
  flags2: number;
  ack: number;
  state: CarState;
  impact: number;
}

export interface Snapshot {
  status: RaceStatusCode;
  raceId: number;
  tick: number;
  raceMs: number;
  cars: SnapshotCar[];
}

export function encodeSnapshot(snap: Snapshot): Uint8Array {
  const count = Math.min(MAX_SNAPSHOT_CARS, snap.cars.length);
  const buf = new ArrayBuffer(SNAPSHOT_HEADER + count * SNAPSHOT_CAR);
  const v = new DataView(buf);
  v.setUint8(0, SNAPSHOT_VERSION);
  v.setUint8(1, snap.status);
  v.setUint16(2, snap.raceId & 0xffff, true);
  v.setUint32(4, snap.tick >>> 0, true);
  v.setInt32(8, Math.round(snap.raceMs), true);
  v.setUint8(12, count);
  for (let i = 0; i < count; i++) {
    const c = snap.cars[i]!;
    const o = SNAPSHOT_HEADER + i * SNAPSHOT_CAR;
    const st = c.state;
    v.setUint8(o, c.slot);
    v.setUint8(o + 1, c.flags & 0xff);
    v.setUint8(o + 2, (c.flags2 & 0x7f) | (st.boostOn ? 0x80 : 0));
    v.setUint32(o + 4, c.ack >>> 0, true);
    v.setFloat32(o + 8, st.x, true);
    v.setFloat32(o + 12, st.y, true);
    v.setFloat32(o + 16, st.heading, true);
    v.setFloat32(o + 20, st.vx, true);
    v.setFloat32(o + 24, st.vy, true);
    v.setFloat32(o + 28, st.angVel, true);
    v.setUint16(o + 32, Math.round(st.boost * BOOST_Q), true);
    v.setUint16(o + 34, Math.min(0xffff, st.drift), true);
    v.setUint16(o + 36, Math.min(0xffff, st.seg), true);
    v.setUint16(o + 38, Math.min(0xffff, Math.round(c.impact)), true);
  }
  return new Uint8Array(buf);
}

/** Decode a snapshot; returns null for anything malformed (short, wrong version, non-finite car state). */
export function decodeSnapshot(bytes: Uint8Array): Snapshot | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < SNAPSHOT_HEADER) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== SNAPSHOT_VERSION) return null;
  const count = v.getUint8(12);
  if (count > MAX_SNAPSHOT_CARS || bytes.byteLength < SNAPSHOT_HEADER + count * SNAPSHOT_CAR) return null;
  const status = v.getUint8(1);
  const cars: SnapshotCar[] = [];
  for (let i = 0; i < count; i++) {
    const o = SNAPSHOT_HEADER + i * SNAPSHOT_CAR;
    // The server only ever encodes finite floats: NaN/Infinity means a corrupt frame, which
    // must not poison prediction or rendering.
    for (let f = o + 8; f < o + 32; f += 4) if (!Number.isFinite(v.getFloat32(f, true))) return null;
    const flags2Raw = v.getUint8(o + 2);
    cars.push({
      slot: v.getUint8(o),
      flags: v.getUint8(o + 1),
      flags2: flags2Raw & 0x7f,
      ack: v.getUint32(o + 4, true),
      impact: v.getUint16(o + 38, true),
      state: {
        x: v.getFloat32(o + 8, true),
        y: v.getFloat32(o + 12, true),
        heading: v.getFloat32(o + 16, true),
        vx: v.getFloat32(o + 20, true),
        vy: v.getFloat32(o + 24, true),
        angVel: v.getFloat32(o + 28, true),
        boost: v.getUint16(o + 32, true) / BOOST_Q,
        boostOn: (flags2Raw & 0x80) !== 0,
        drift: v.getUint16(o + 34, true),
        seg: v.getUint16(o + 36, true),
      },
    });
  }
  return {
    status: (status <= 2 ? status : 0) as RaceStatusCode,
    raceId: v.getUint16(2, true),
    tick: v.getUint32(4, true),
    raceMs: v.getInt32(8, true),
    cars,
  };
}
