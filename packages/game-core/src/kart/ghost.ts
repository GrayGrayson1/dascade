/**
 * Time-trial ghosts: a quantized position trace at 10 Hz (x, y at 1/16 u as deltas, z at 1/16 u,
 * heading in 1/256 turns), base64 in a small JSON document. Bounded in size and strictly validated
 * on decode (the document comes from local storage, which the user controls).
 */
import {
  KART_BODY_IDS,
  KART_GHOST_MAX_BYTES,
  KART_RACER_IDS,
  KART_TRACK_IDS,
  type KartBodyId,
  type KartRacerId,
  type KartTrackId,
} from '@dascade/shared/games/kart';
import { TAU } from './math.ts';

export const GHOST_VERSION = 1;
export const GHOST_HZ = 10;
/** Ticks between samples at 60 Hz. */
export const GHOST_EVERY = 6;
/** Max samples: 10 minutes at 10 Hz. */
export const GHOST_MAX_SAMPLES = 6000;
const BYTES_PER_SAMPLE = 7;

export interface GhostSample {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface KartGhost {
  v: typeof GHOST_VERSION;
  track: KartTrackId;
  racer: KartRacerId;
  body: KartBodyId;
  paint: string;
  timeMs: number;
  samples: GhostSample[];
}

export class GhostRecorder {
  private samples: GhostSample[] = [];
  private startTick = -1;

  /** Record the kart's pose; call every tick from the green light (samples every 6th tick). */
  push(st: { x: number; y: number; z: number; heading: number }, tick: number): void {
    if (this.startTick < 0) this.startTick = tick;
    if ((tick - this.startTick) % GHOST_EVERY !== 0 || this.samples.length >= GHOST_MAX_SAMPLES) return;
    this.samples.push({ x: st.x, y: st.y, z: st.z, heading: st.heading });
  }

  get length(): number {
    return this.samples.length;
  }

  finish(meta: { track: KartTrackId; racer: KartRacerId; body: KartBodyId; paint: string; timeMs: number }): KartGhost {
    return { v: GHOST_VERSION, ...meta, samples: quantizeSamples(this.samples) };
  }
}

const QXY = 16;
const QZ = 16;

function quantizeSamples(samples: readonly GhostSample[]): GhostSample[] {
  return samples.map((s) => ({
    x: Math.round(s.x * QXY) / QXY,
    y: Math.round(s.y * QXY) / QXY,
    z: Math.round(s.z * QZ) / QZ,
    heading: (Math.round((s.heading / TAU) * 256) & 255) * (TAU / 256),
  }));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}

function fromBase64(str: string): Uint8Array | null {
  if (str.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return null;
  const pad = str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((str.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < str.length; i += 4) {
    const n =
      (B64.indexOf(str[i]!) << 18) |
      (B64.indexOf(str[i + 1]!) << 12) |
      ((str[i + 2] === '=' ? 0 : B64.indexOf(str[i + 2]!)) << 6) |
      (str[i + 3] === '=' ? 0 : B64.indexOf(str[i + 3]!));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/**
 * Sample layout: first sample absolute (i32 x, i32 y at 1/16 u, i16 z, u8 heading = 11 B);
 * then per sample i16 dx, i16 dy, i16 z, u8 heading (7 B). A delta beyond i16 ends the trace.
 */
function packSamples(samples: readonly GhostSample[]): Uint8Array {
  const n = samples.length;
  const buf = new ArrayBuffer(n === 0 ? 0 : 11 + (n - 1) * BYTES_PER_SAMPLE);
  const v = new DataView(buf);
  let px = 0;
  let py = 0;
  let o = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    const qx = Math.round(s.x * QXY);
    const qy = Math.round(s.y * QXY);
    if (i === 0) {
      v.setInt32(0, qx, true);
      v.setInt32(4, qy, true);
      o = 8;
    } else {
      v.setInt16(o, Math.max(-32768, Math.min(32767, qx - px)), true);
      v.setInt16(o + 2, Math.max(-32768, Math.min(32767, qy - py)), true);
      o += 4;
    }
    v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(s.z * QZ))), true);
    v.setUint8(o + 2, Math.round((s.heading / TAU) * 256) & 255);
    o += 3;
    px = qx;
    py = qy;
  }
  return new Uint8Array(buf);
}

function unpackSamples(bytes: Uint8Array): GhostSample[] | null {
  if (bytes.length === 0) return [];
  if (bytes.length < 11 || (bytes.length - 11) % BYTES_PER_SAMPLE !== 0) return null;
  const n = 1 + (bytes.length - 11) / BYTES_PER_SAMPLE;
  if (n > GHOST_MAX_SAMPLES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: GhostSample[] = [];
  let qx = 0;
  let qy = 0;
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      qx = v.getInt32(0, true);
      qy = v.getInt32(4, true);
      o = 8;
    } else {
      qx += v.getInt16(o, true);
      qy += v.getInt16(o + 2, true);
      o += 4;
    }
    const z = v.getInt16(o, true) / QZ;
    const h = v.getUint8(o + 2);
    o += 3;
    if (Math.abs(qx) > 1e6 * QXY || Math.abs(qy) > 1e6 * QXY) return null;
    out.push({ x: qx / QXY, y: qy / QXY, z, heading: (h >= 128 ? h - 256 : h) * (TAU / 256) });
  }
  return out;
}

/** Serialize a ghost to its storage JSON (throws if it exceeds KART_GHOST_MAX_BYTES). */
export function encodeGhost(g: KartGhost): string {
  const json = JSON.stringify({
    v: GHOST_VERSION,
    track: g.track,
    racer: g.racer,
    body: g.body,
    paint: g.paint,
    timeMs: Math.round(g.timeMs),
    hz: GHOST_HZ,
    data: toBase64(packSamples(g.samples.slice(0, GHOST_MAX_SAMPLES))),
  });
  if (json.length > KART_GHOST_MAX_BYTES) throw new RangeError('ghost too large');
  return json;
}

/** Parse + validate a stored ghost (the JSON string or the parsed object). Null when invalid. */
export function decodeGhost(input: unknown): KartGhost | null {
  let doc: unknown = input;
  if (typeof input === 'string') {
    if (input.length > KART_GHOST_MAX_BYTES) return null;
    try {
      doc = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (d.v !== GHOST_VERSION || d.hz !== GHOST_HZ) return null;
  if (typeof d.track !== 'string' || !(KART_TRACK_IDS as readonly string[]).includes(d.track)) return null;
  if (typeof d.racer !== 'string' || !(KART_RACER_IDS as readonly string[]).includes(d.racer)) return null;
  if (typeof d.body !== 'string' || !(KART_BODY_IDS as readonly string[]).includes(d.body)) return null;
  if (typeof d.paint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(d.paint)) return null;
  if (typeof d.timeMs !== 'number' || !Number.isInteger(d.timeMs) || d.timeMs <= 0 || d.timeMs > 60 * 60 * 1000) return null;
  if (typeof d.data !== 'string' || d.data.length > KART_GHOST_MAX_BYTES) return null;
  const bytes = fromBase64(d.data);
  if (!bytes) return null;
  const samples = unpackSamples(bytes);
  if (!samples || samples.length < 2) return null;
  return {
    v: GHOST_VERSION,
    track: d.track as KartTrackId,
    racer: d.racer as KartRacerId,
    body: d.body as KartBodyId,
    paint: d.paint,
    timeMs: d.timeMs,
    samples,
  };
}

/** Interpolated pose `ms` after the green light (null past the end). */
export function ghostPoseAt(g: KartGhost, ms: number): GhostSample | null {
  const f = (Math.max(0, ms) / 1000) * GHOST_HZ;
  const i = Math.floor(f);
  if (i >= g.samples.length - 1) return null;
  const a = g.samples[i]!;
  const b = g.samples[i + 1]!;
  const t = f - i;
  let dh = b.heading - a.heading;
  if (dh > Math.PI) dh -= TAU;
  else if (dh < -Math.PI) dh += TAU;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, heading: a.heading + dh * t };
}
