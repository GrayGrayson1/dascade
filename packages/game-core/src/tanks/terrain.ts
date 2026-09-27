/**
 * Destructible terrain as a heightmap: one column per world unit, `h[x]` is the surface
 * height (y-up) of the column spanning [x, x+1). Explosions remove the part of a column
 * inside the blast circle and everything above slides down into the hole ("dirt falls"),
 * which keeps the ground a single surface — tanks always rest on top of it.
 *
 * Every operation uses only + - * / and Math.sqrt/floor/round/min/max, and heights are
 * quantized to 1/heightScale units, so results are bit-identical on every JS engine
 * (see CONTRACT §7) and survive the uint16 wire encoding exactly.
 */
import type { Rng } from '@dascade/shared';
import { TANKS_WORLD, TANK_GEOM, type ConcreteTerrainStyle } from '@dascade/shared/games/tanks';

export interface Terrain {
  width: number;
  height: number;
  h: Float64Array;
}

export interface DirtyRange {
  x0: number;
  /** Exclusive. */
  x1: number;
}

const Q = TANKS_WORLD.heightScale;

export function quantize(v: number): number {
  return Math.round(v * Q) / Q;
}

export function createTerrain(width: number = TANKS_WORLD.width, height: number = TANKS_WORLD.height, fill = 200): Terrain {
  const h = new Float64Array(width);
  h.fill(quantize(fill));
  return { width, height, h };
}

export function cloneTerrain(t: Terrain): Terrain {
  return { width: t.width, height: t.height, h: new Float64Array(t.h) };
}

/** Surface height at a world x (columns outside the world have no ground: -Infinity). */
export function heightAt(t: Terrain, x: number): number {
  const i = Math.floor(x);
  if (i < 0 || i >= t.width) return -Infinity;
  return t.h[i]!;
}

/** Height a tank centred at x rests at: the highest column under its tracks. */
export function restHeight(t: Terrain, x: number): number {
  const span = TANK_GEOM.halfWidth - 6;
  const i0 = Math.max(0, Math.floor(x - span));
  const i1 = Math.min(t.width - 1, Math.floor(x + span));
  let best: number = TANKS_WORLD.bedrock;
  for (let i = i0; i <= i1; i++) if (t.h[i]! > best) best = t.h[i]!;
  return best;
}

function columnRange(t: Terrain, cx: number, r: number): [number, number] {
  return [Math.max(0, Math.floor(cx - r)), Math.min(t.width - 1, Math.floor(cx + r))];
}

/**
 * Blast a circular crater: removes the column interval inside the circle; material above
 * collapses into the gap. Returns the modified column range (empty when nothing changed).
 */
export function carveCircle(t: Terrain, cx: number, cy: number, r: number): DirtyRange {
  const [i0, i1] = columnRange(t, cx, r);
  let lo = t.width;
  let hi = -1;
  for (let i = i0; i <= i1; i++) {
    const dx = i + 0.5 - cx;
    const d2 = r * r - dx * dx;
    if (d2 <= 0) continue;
    const dy = Math.sqrt(d2);
    const top = t.h[i]!;
    const a = Math.max(cy - dy, TANKS_WORLD.bedrock);
    const b = Math.min(cy + dy, top);
    if (b <= a) continue;
    const next = quantize(Math.max(TANKS_WORLD.bedrock, top - (b - a)));
    if (next !== top) {
      t.h[i] = next;
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    }
  }
  return hi < lo ? { x0: 0, x1: 0 } : { x0: lo, x1: hi + 1 };
}

/**
 * Carve a capsule (a segment swept by radius r) — the Driller's bore. Each column loses the
 * single interval where the capsule crosses it (so overlapping samples never double-dig).
 */
export function carveCapsule(t: Terrain, x0: number, y0: number, x1: number, y1: number, r: number): DirtyRange {
  const minX = Math.min(x0, x1) - r;
  const maxX = Math.max(x0, x1) + r;
  const i0 = Math.max(0, Math.floor(minX));
  const i1 = Math.min(t.width - 1, Math.floor(maxX));
  if (i1 < i0) return { x0: 0, x1: 0 };
  const n = i1 - i0 + 1;
  const lo = new Float64Array(n).fill(Infinity);
  const hi = new Float64Array(n).fill(-Infinity);
  const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  const samples = Math.max(1, Math.ceil(len));
  for (let s = 0; s <= samples; s++) {
    const px = x0 + ((x1 - x0) * s) / samples;
    const py = y0 + ((y1 - y0) * s) / samples;
    const c0 = Math.max(i0, Math.floor(px - r));
    const c1 = Math.min(i1, Math.floor(px + r));
    for (let i = c0; i <= c1; i++) {
      const dx = i + 0.5 - px;
      const d2 = r * r - dx * dx;
      if (d2 <= 0) continue;
      const dy = Math.sqrt(d2);
      const k = i - i0;
      if (py - dy < lo[k]!) lo[k] = py - dy;
      if (py + dy > hi[k]!) hi[k] = py + dy;
    }
  }
  let dLo = t.width;
  let dHi = -1;
  for (let k = 0; k < n; k++) {
    if (!(hi[k]! > lo[k]!)) continue;
    const i = i0 + k;
    const top = t.h[i]!;
    const a = Math.max(lo[k]!, TANKS_WORLD.bedrock);
    const b = Math.min(hi[k]!, top);
    if (b <= a) continue;
    const next = quantize(Math.max(TANKS_WORLD.bedrock, top - (b - a)));
    if (next !== top) {
      t.h[i] = next;
      if (i < dLo) dLo = i;
      if (i > dHi) dHi = i;
    }
  }
  return dHi < dLo ? { x0: 0, x1: 0 } : { x0: dLo, x1: dHi + 1 };
}

/**
 * Drop a ball of earth: the part of the circle above the surface falls onto each column
 * (the part already underground adds nothing), capped at the world ceiling.
 */
export function addDirt(t: Terrain, cx: number, cy: number, r: number): DirtyRange {
  const [i0, i1] = columnRange(t, cx, r);
  let lo = t.width;
  let hi = -1;
  for (let i = i0; i <= i1; i++) {
    const dx = i + 0.5 - cx;
    const d2 = r * r - dx * dx;
    if (d2 <= 0) continue;
    const dy = Math.sqrt(d2);
    const top = t.h[i]!;
    const above = cy + dy - Math.max(cy - dy, top);
    if (above <= 0) continue;
    const next = quantize(Math.min(TANKS_WORLD.ceiling, top + above));
    if (next !== top) {
      t.h[i] = next;
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    }
  }
  return hi < lo ? { x0: 0, x1: 0 } : { x0: lo, x1: hi + 1 };
}

/** Level a pad for a tank to sit on (spawn), blending into the neighbouring ground. */
export function flattenPad(t: Terrain, cx: number, half = TANK_GEOM.halfWidth + 4, blend = 14): number {
  const c0 = Math.max(0, Math.floor(cx - half));
  const c1 = Math.min(t.width - 1, Math.floor(cx + half));
  let sum = 0;
  for (let i = c0; i <= c1; i++) sum += t.h[i]!;
  const level = quantize(sum / (c1 - c0 + 1));
  for (let i = Math.max(0, c0 - blend); i <= Math.min(t.width - 1, c1 + blend); i++) {
    let w = 1;
    if (i < c0) w = 1 - (c0 - i) / (blend + 1);
    else if (i > c1) w = 1 - (i - c1) / (blend + 1);
    const s = w * w * (3 - 2 * w);
    t.h[i] = quantize(t.h[i]! + (level - t.h[i]!) * s);
  }
  return level;
}

// ---------------------------------------------------------------------------
// Generation (seeded, server side; clients receive the heightmap)
// ---------------------------------------------------------------------------

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

/** 1D value noise in [-1, 1] with control points every `cell` units. */
function valueNoise(rng: Rng, width: number, cell: number): Float64Array {
  const points = Math.ceil(width / cell) + 2;
  const ctrl = new Float64Array(points);
  for (let i = 0; i < points; i++) ctrl[i] = rng.next() * 2 - 1;
  const out = new Float64Array(width);
  const offset = rng.next() * cell;
  for (let x = 0; x < width; x++) {
    const u = (x + offset) / cell;
    const i = Math.floor(u);
    const f = smoothstep(u - i);
    const a = ctrl[Math.min(points - 1, i)]!;
    const b = ctrl[Math.min(points - 1, i + 1)]!;
    out[x] = a + (b - a) * f;
  }
  return out;
}

function blur(h: Float64Array, radius: number, passes: number): void {
  const n = h.length;
  const tmp = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let k = -radius; k <= radius; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        s += h[j]!;
        c++;
      }
      tmp[i] = s / c;
    }
    h.set(tmp);
  }
}

export const TERRAIN_STYLE_LIST: readonly ConcreteTerrainStyle[] = ['hills', 'mesa', 'valley', 'peaks'];

/** Generate a fresh battlefield. Same rng sequence → same terrain. */
export function generateTerrain(rng: Rng, style: ConcreteTerrainStyle, width: number = TANKS_WORLD.width, height: number = TANKS_WORLD.height): Terrain {
  const t = createTerrain(width, height);
  const h = t.h;
  const n1 = valueNoise(rng, width, 420);
  const n2 = valueNoise(rng, width, 170);
  const n3 = valueNoise(rng, width, 64);
  const n4 = valueNoise(rng, width, 23);
  const detail = (x: number, k: number) => (n2[x]! * 55 + n3[x]! * 18 + n4[x]! * 5) * k;

  for (let x = 0; x < width; x++) {
    const u = x / (width - 1);
    let v: number;
    switch (style) {
      case 'hills':
        v = 260 + n1[x]! * 150 + detail(x, 1);
        break;
      case 'mesa': {
        const base = 330 + n1[x]! * 175 + n2[x]! * 60;
        const step = 72;
        const tt = base / step;
        const f = Math.floor(tt);
        const frac = tt - f;
        const riser = frac < 0.72 ? 0 : smoothstep((frac - 0.72) / 0.28);
        v = (f + riser) * step + n3[x]! * 6 + n4[x]! * 3;
        break;
      }
      case 'valley': {
        const c = u * 2 - 1;
        v = 150 + 360 * c * c + n1[x]! * 50 + detail(x, 0.8);
        break;
      }
      case 'peaks':
      default: {
        const c = (u - 0.5) / 0.19;
        const bump = 1 / (1 + c * c);
        v = 190 + 330 * bump + n1[x]! * 60 + detail(x, 0.9);
        break;
      }
    }
    h[x] = v;
  }
  blur(h, 2, 2);
  const lo = TANKS_WORLD.bedrock + 46;
  const hi = 640;
  for (let x = 0; x < width; x++) h[x] = quantize(Math.min(hi, Math.max(lo, h[x]!)));
  return t;
}

// ---------------------------------------------------------------------------
// Wire encoding: uint16 LE per column (height × heightScale) in base64.
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

function base64ToBytes(s: string): Uint8Array | null {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c]! : -1;
    if (v < 0) return null;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

export function encodeTerrain(t: Terrain): string {
  const bytes = new Uint8Array(t.width * 2);
  for (let i = 0; i < t.width; i++) {
    const v = Math.max(0, Math.min(65535, Math.round(t.h[i]! * Q)));
    bytes[i * 2] = v & 255;
    bytes[i * 2 + 1] = v >> 8;
  }
  return bytesToBase64(bytes);
}

/** Decode a heightmap (null if malformed or the wrong size). */
export function decodeTerrain(s: string, width: number = TANKS_WORLD.width, height: number = TANKS_WORLD.height): Terrain | null {
  const bytes = base64ToBytes(s);
  if (!bytes || bytes.length !== width * 2) return null;
  const t = createTerrain(width, height, 0);
  for (let i = 0; i < width; i++) t.h[i] = (bytes[i * 2]! | (bytes[i * 2 + 1]! << 8)) / Q;
  return t;
}
