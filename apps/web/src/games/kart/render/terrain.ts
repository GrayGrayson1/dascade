/**
 * Terrain, sky and horizon.
 *  - DistanceField: coarse grid of "distance to the nearest road edge" (+ drop/gap flag), stamped
 *    from every road sample; drives terrain height and prop scatter.
 *  - Terrain: vertex-coloured grid, flat near the track, hills/dunes/mountains rising toward the
 *    horizon, cliffs under drop edges and gaps, a quay edge into the water for harbors.
 *  - Sky dome: gradient + sun glow + (night) stars, one shader, no textures.
 *  - Horizon silhouettes: two rings of biome skyline (city towers, mesas, peaks…) fading into fog.
 */
import {
  BackSide,
  ClampToEdgeWrapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type CanvasTexture,
} from 'three';
import type { KartTrack } from '@dascade/game-core/kart';
import type { BiomeStyle } from './biomes.ts';
import { linRGB } from './geo.ts';
import { hash2, mulberry32 } from './rng.ts';
import type { RoadPath } from './roads.ts';
import { canvasTexture, makeCanvas } from './textures.ts';
import { intToHex, mixInt, shadeInt } from '../art/palette.ts';

const EDGE_DROP = 1;

export class DistanceField {
  readonly x0: number;
  readonly y0: number;
  readonly nx: number;
  readonly ny: number;
  readonly dist: Float32Array;
  readonly drop: Uint8Array;
  readonly z: Float32Array;
  /** Lowest road height among roads within 14 u (so terrain never rises over a lower road). */
  readonly zLow: Float32Array;
  /** 1 within (half-width + shoulder + gapPad) of a gap sample: the terrain becomes a chasm there. */
  readonly gap: Uint8Array;

  constructor(
    paths: readonly RoadPath[],
    bounds: KartTrack['bounds'],
    readonly cell: number,
    readonly margin: number,
    readonly radius: number,
  ) {
    this.x0 = bounds.minX - margin;
    this.y0 = bounds.minY - margin;
    this.nx = Math.ceil((bounds.maxX - bounds.minX + 2 * margin) / cell) + 1;
    this.ny = Math.ceil((bounds.maxY - bounds.minY + 2 * margin) / cell) + 1;
    const N = this.nx * this.ny;
    this.dist = new Float32Array(N).fill(radius);
    this.drop = new Uint8Array(N);
    this.z = new Float32Array(N).fill(bounds.minZ);
    this.zLow = new Float32Array(N).fill(Infinity);
    this.gap = new Uint8Array(N);
    const r = Math.ceil(radius / cell);
    // chasms: stamp generously around gap samples (the terrain grid is coarser than a gap is long)
    const gapPad = 18;
    for (const p of paths) {
      for (let i = 0; i < p.n; i++) {
        if (!p.noGround[i]) continue;
        const reach = Math.max(p.hwL[i]!, p.hwR[i]!) + p.shoulder + gapPad;
        const rr = Math.ceil(reach / cell);
        const ci = Math.round((p.xs[i]! - this.x0) / cell);
        const cj = Math.round((p.ys[i]! - this.y0) / cell);
        for (let gj = Math.max(0, cj - rr); gj <= Math.min(this.ny - 1, cj + rr); gj++)
          for (let gi = Math.max(0, ci - rr); gi <= Math.min(this.nx - 1, ci + rr); gi++) {
            const dx = this.x0 + gi * cell - p.xs[i]!;
            const dy = this.y0 + gj * cell - p.ys[i]!;
            if (dx * dx + dy * dy <= reach * reach) this.gap[gj * this.nx + gi] = 1;
          }
      }
    }
    for (const p of paths) {
      for (let i = 0; i < p.n; i++) {
        const sx = p.xs[i]!;
        const sy = p.ys[i]!;
        const ci = Math.round((sx - this.x0) / cell);
        const cj = Math.round((sy - this.y0) / cell);
        for (let gj = Math.max(0, cj - r); gj <= Math.min(this.ny - 1, cj + r); gj++)
          for (let gi = Math.max(0, ci - r); gi <= Math.min(this.nx - 1, ci + r); gi++) {
            const px = this.x0 + gi * cell;
            const py = this.y0 + gj * cell;
            const dx = px - sx;
            const dy = py - sy;
            const side = -p.ty[i]! * dx + p.tx[i]! * dy;
            const hw = (side >= 0 ? p.hwL[i]! : p.hwR[i]!) + p.shoulder;
            const d = Math.sqrt(dx * dx + dy * dy) - hw;
            const k = gj * this.nx + gi;
            if (d < 14 && p.zs[i]! < this.zLow[k]!) this.zLow[k] = p.zs[i]!;
            if (d < this.dist[k]!) {
              this.dist[k] = d;
              this.z[k] = p.zs[i]!;
              const edge = side >= 0 ? p.edgeL[i] : p.edgeR[i];
              this.drop[k] = p.noGround[i] ? 1 : edge === EDGE_DROP && d > -0.5 ? 1 : 0;
            }
          }
      }
    }
  }

  private idx(x: number, y: number): number {
    const gi = Math.max(0, Math.min(this.nx - 1, Math.round((x - this.x0) / this.cell)));
    const gj = Math.max(0, Math.min(this.ny - 1, Math.round((y - this.y0) / this.cell)));
    return gj * this.nx + gi;
  }

  /** Distance to the nearest road edge (incl. shoulder), capped at `radius`; outside the grid = radius. */
  at(x: number, y: number): number {
    if (x < this.x0 || y < this.y0 || x > this.x0 + (this.nx - 1) * this.cell || y > this.y0 + (this.ny - 1) * this.cell) return this.radius;
    return this.dist[this.idx(x, y)]!;
  }
  gapAt(x: number, y: number): boolean {
    if (x < this.x0 || y < this.y0 || x > this.x0 + (this.nx - 1) * this.cell || y > this.y0 + (this.ny - 1) * this.cell) return false;
    return this.gap[this.idx(x, y)] === 1;
  }
  dropAt(x: number, y: number): boolean {
    return this.drop[this.idx(x, y)] === 1 && this.at(x, y) < this.radius;
  }
  roadZ(x: number, y: number): number {
    return this.z[this.idx(x, y)]!;
  }
  /** Road height the terrain should meet near (x, y): the lowest nearby road. */
  roadLowZ(x: number, y: number): number {
    const k = this.idx(x, y);
    const v = this.zLow[k]!;
    return Number.isFinite(v) ? v : this.z[k]!;
  }
}

export interface TerrainOptions {
  groundY: number;
  dropDepth: number;
  /** Hill amplitude toward the horizon. */
  hills: number;
  /** Half extent of the terrain square beyond the bounds. */
  extent: number;
  res: number;
  /** Harbor: land only within this distance of a road, water beyond. */
  quay?: number;
  /** Flat pads (landmark footprints) the terrain levels out to. */
  pads?: readonly { x: number; y: number; z: number; r: number }[];
}

export function hillsFor(b: BiomeStyle): number {
  switch (b.id) {
    case 'snow':
      return 70;
    case 'desert':
      return 16;
    case 'carnival':
      return 12;
    case 'factory':
      return 4;
    case 'city':
    case 'cyber':
      return 2;
    default:
      return 0;
  }
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Terrain height at a track (x, y): meets the road (just below it) near the track, rolls into
 * biome hills toward the horizon, drops into cliffs under drop edges and gaps, and (harbor) falls
 * away into the water beyond the quay.
 */
export function terrainHeightFn(field: DistanceField, o: TerrainOptions, seed: number): (x: number, y: number) => number {
  return (x, y) => {
    const dist = field.at(x, y);
    const n = vnoise(x / 90, y / 90, seed) * 0.7 + vnoise(x / 25, y / 25, seed + 1) * 0.3;
    let h = o.groundY + o.hills * smooth(35, 260, dist) * (0.35 + 0.65 * n) + (dist > 30 ? (n - 0.5) * Math.min(3, o.hills * 0.2) : 0);
    const rz = field.roadLowZ(x, y) - 0.6;
    const follow = 1 - smooth(4, 80, dist);
    h = h * (1 - follow) + Math.max(h, rz) * follow;
    if (field.gapAt(x, y)) h = Math.min(h, rz - o.dropDepth);
    else if (field.dropAt(x, y)) h = Math.min(h, rz - o.dropDepth * smooth(-4, 6, dist));
    if (o.quay !== undefined && dist > o.quay) h = Math.min(h, o.groundY - 6 * smooth(o.quay, o.quay + 12, dist));
    if (o.pads)
      for (const p of o.pads) {
        const dd = Math.sqrt((x - p.x) * (x - p.x) + (y - p.y) * (y - p.y));
        if (dd < p.r * 1.6) h = h + (p.z - 0.3 - h) * (1 - smooth(p.r, p.r * 1.6, dd));
      }
    return h;
  };
}

/** Terrain grid (three space) with vertex colours and world-scale UVs (detail texture every 12 u). */
export function buildTerrain(track: KartTrack, field: DistanceField, biome: BiomeStyle, o: TerrainOptions): BufferGeometry {
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const half = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2 + o.extent;
  const N = o.res;
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  const col = new Float32Array((N + 1) * (N + 1) * 3);
  const uv = new Float32Array((N + 1) * (N + 1) * 2);
  const base = linRGB(biome.ground);
  const alt = linRGB(biome.groundAlt);
  const deep = linRGB(shadeInt(biome.ground, -0.45));
  const seed = track.def.decorSeed;
  const height = terrainHeightFn(field, o, seed);
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const x = cx - half + (2 * half * i) / N;
      const y = cy - half + (2 * half * j) / N;
      const dist = field.at(x, y);
      const h = height(x, y);
      const n = vnoise(x / 90, y / 90, seed) * 0.7 + vnoise(x / 25, y / 25, seed + 1) * 0.3;
      const k = (j * (N + 1) + i) * 3;
      pos[k] = x;
      pos[k + 1] = h;
      pos[k + 2] = -y;
      uv[(j * (N + 1) + i) * 2] = x / 12;
      uv[(j * (N + 1) + i) * 2 + 1] = y / 12;
      const t = hash2(i, j, seed) * 0.4 + n * 0.6;
      const lowT = smooth(field.roadLowZ(x, y) - 3, field.roadLowZ(x, y) - o.dropDepth, h);
      const edgeAO = 1 - 0.22 * (1 - smooth(0, 12, dist));
      for (let c = 0; c < 3; c++) col[k + c] = (base[c]! + (alt[c]! - base[c]!) * t) * (1 - lowT) * edgeAO + deep[c]! * lowT;
    }
  const idx: number[] = [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b2 = a + 1;
      const c = a + N + 1;
      const d = c + 1;
      idx.push(a, c, b2, b2, c, d);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // steep faces become rock (cliffs and hillsides read as terrain, not grey slabs)
  const rock = linRGB(ROCK[biome.id] ?? shadeInt(biome.ground, -0.3));
  const nrm = g.getAttribute('normal');
  for (let v = 0; v < nrm.count; v++) {
    const ny = nrm.getY(v);
    // patchy: noise keeps some snow/grass on the steep faces
    const patch = vnoise(pos[v * 3]! / 14, pos[v * 3 + 2]! / 14, seed + 5);
    const t = smooth(0.92, 0.6, ny) * (0.45 + 0.55 * smooth(0.3, 0.7, patch));
    if (t <= 0) continue;
    for (let c = 0; c < 3; c++) col[v * 3 + c] = col[v * 3 + c]! * (1 - t) + rock[c]! * t;
  }
  g.computeBoundingSphere();
  return g;
}

const ROCK: Partial<Record<BiomeStyle['id'], number>> = {
  snow: 0x8a96aa,
  desert: 0xa65a34,
  carnival: 0x5b7a44,
  harbor: 0x6b6f78,
  factory: 0x4a403a,
  city: 0x2a2d40,
  cyber: 0x0e1426,
};

/** Ground detail texture (white-based so vertex colours dominate) + optional glow (cyber grid). */
export function groundDetailTextures(biome: BiomeStyle): { map: CanvasTexture; glow: CanvasTexture | null } {
  const S = 256;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d')!;
  const r = mulberry32(77);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  let glow: CanvasTexture | null = null;
  const speck = (n: number, a: number, dark = '#000000', size = 2) => {
    g.fillStyle = dark;
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + r() * 0.6);
      g.fillRect(Math.floor(r() * S), Math.floor(r() * S), size, size);
    }
    g.globalAlpha = 1;
  };
  switch (biome.id) {
    case 'city':
    case 'harbor':
    case 'factory': {
      speck(1400, 0.12);
      g.strokeStyle = 'rgba(0,0,0,0.28)';
      g.lineWidth = 3;
      const step = biome.id === 'city' ? 64 : 128;
      for (let x = 0; x <= S; x += step) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, S);
        g.stroke();
        g.beginPath();
        g.moveTo(0, x);
        g.lineTo(S, x);
        g.stroke();
      }
      break;
    }
    case 'cyber': {
      speck(800, 0.15);
      const gc = makeCanvas(S, S);
      const gg = gc.getContext('2d')!;
      gg.fillStyle = '#000';
      gg.fillRect(0, 0, S, S);
      gg.fillStyle = '#1aa6c4';
      for (let x = 0; x < S; x += 64) {
        gg.fillRect(x, 0, 2, S);
        gg.fillRect(0, x, S, 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 0; x < S; x += 64) {
        g.fillRect(x, 0, 2, S);
        g.fillRect(0, x, S, 2);
      }
      glow = canvasTexture(gc, true, 8);
      break;
    }
    case 'desert': {
      g.strokeStyle = 'rgba(120,60,20,0.18)';
      g.lineWidth = 3;
      for (let y = 6; y < S; y += 22) {
        g.beginPath();
        for (let x = 0; x <= S; x += 8) g.lineTo(x, y + 5 * Math.sin((x / S) * Math.PI * 4 + y * 0.3));
        g.stroke();
      }
      speck(900, 0.15);
      break;
    }
    case 'snow':
      speck(700, 0.08, '#5a7090');
      g.fillStyle = '#ffffff';
      break;
    case 'carnival':
    default:
      speck(2200, 0.18, '#0a3a14', 2);
      for (let i = 0; i < 500; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,40,10,0.2)';
        g.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1, 4);
      }
      break;
  }
  return { map: canvasTexture(c, true, 8), glow };
}

// ---------------------------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------------------------

export function makeSkyMaterial(biome: BiomeStyle, clouds = true): ShaderMaterial {
  const k = biome.skyLook;
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color(biome.skyTop) },
      horizon: { value: new Color(biome.skyHorizon) },
      bottom: { value: new Color(biome.skyBottom) },
      sunDir: { value: new Vector3(...biome.sunDir).normalize() },
      sunColor: { value: new Color(biome.sun) },
      sunSize: { value: k.sunSize },
      stars: { value: biome.stars ? 1 : 0 },
      moon: { value: k.moon ? 1 : 0 },
      time: { value: 0 },
      haze: { value: new Color(k.haze) },
      hazeAmt: { value: k.hazeAmt },
      cloudCover: { value: clouds ? k.cover : 2 },
      cloudLit: { value: new Color(k.cloud) },
      cloudShade: { value: new Color(k.shade) },
      cirrus: { value: clouds ? k.cirrus : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor;
      uniform float sunSize; uniform float stars; uniform float moon; uniform float time;
      uniform vec3 haze; uniform float hazeAmt;
      uniform float cloudCover; uniform vec3 cloudLit; uniform vec3 cloudShade; uniform float cirrus;
      varying vec3 vDir;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float a = 0.5; float s = 0.0;
        for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 3.7); a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(clamp(y, 0.0, 1.0), 0.5)) : mix(horizon, bottom, clamp(-y * 3.0, 0.0, 1.0));
        vec3 s = normalize(sunDir);
        float sd = max(dot(d, s), 0.0);
        // horizon haze band, warmer toward the sun
        float band = exp(-abs(y) * 7.0);
        c = mix(c, haze + sunColor * pow(sd, 6.0) * 0.25, band * hazeAmt);
        // sun: crisp disc + corona + wide glow
        if (sunSize > 0.0) {
          float disc = smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.7, sd);
          c += sunColor * (disc * 1.6 + pow(sd, 90.0) * 0.55 + pow(sd, 10.0) * 0.18);
        }
        if (moon > 0.5) {
          vec3 m = normalize(vec3(-s.x, max(0.35, s.y), -s.z));
          float md = dot(d, m);
          float mdisc = smoothstep(0.99955, 0.99975, md);
          float crater = vn(d.xz * 260.0) * 0.25;
          c = mix(c, vec3(0.93, 0.9, 1.0) * (0.85 - crater), mdisc);
          c += vec3(0.5, 0.45, 0.8) * pow(max(md, 0.0), 400.0) * 0.35;
        }
        if (stars > 0.5 && y > 0.05) {
          vec2 uv = vec2(atan(d.z, d.x) * 120.0, y * 160.0);
          vec2 cell = floor(uv);
          float r = h21(cell);
          float tw = 0.6 + 0.4 * sin(time * 2.0 + r * 40.0);
          float star = step(0.985, r) * smoothstep(0.5, 0.0, length(fract(uv) - 0.5)) * tw;
          c += vec3(star) * smoothstep(0.05, 0.4, y);
        }
        // clouds: a cumulus deck + high cirrus streaks, projected on a plane, fading into the haze
        if (y > 0.0 && cloudCover < 1.5) {
          vec2 p = d.xz / (y + 0.12);
          float fade = smoothstep(0.015, 0.22, y);
          float n = fbm(p * 1.1 + vec2(time * 0.006, time * 0.002));
          float cov = smoothstep(cloudCover, cloudCover + 0.22, n) * fade;
          float lit = clamp(0.35 + (n - cloudCover) * 2.0 + pow(sd, 3.0) * 0.6, 0.0, 1.0);
          vec3 cc = mix(cloudShade, cloudLit, lit) + sunColor * pow(sd, 12.0) * 0.4;
          c = mix(c, cc, cov * 0.92);
          if (cirrus > 0.0) {
            float ci = fbm(vec2(p.x * 0.35, p.y * 2.4) + vec2(time * 0.01, 0.0));
            float cs = smoothstep(0.55, 0.8, ci) * fade * cirrus * (1.0 - cov);
            c = mix(c, cloudLit, cs * 0.55);
          }
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function makeSkyDome(biome: BiomeStyle, clouds = true): Mesh {
  const m = new Mesh(new SphereGeometry(1, 48, 24), makeSkyMaterial(biome, clouds));
  m.frustumCulled = false;
  m.renderOrder = -1000;
  return m;
}

export function setSkyColors(m: Mesh, top: number, horizon: number, bottom: number): void {
  const u = (m.material as ShaderMaterial).uniforms;
  (u.top!.value as Color).set(top);
  (u.horizon!.value as Color).set(horizon);
  (u.bottom!.value as Color).set(bottom);
}

// ---------------------------------------------------------------------------------------------
// Horizon silhouettes
// ---------------------------------------------------------------------------------------------

type SilhouetteKind = 'city' | 'mesa' | 'hills' | 'peaks' | 'rides' | 'stacks' | 'clouds' | 'data';

const SILHOUETTE: Record<BiomeStyle['id'], [SilhouetteKind, SilhouetteKind]> = {
  city: ['city', 'city'],
  desert: ['mesa', 'hills'],
  harbor: ['hills', 'city'],
  snow: ['peaks', 'peaks'],
  carnival: ['hills', 'rides'],
  factory: ['stacks', 'hills'],
  sky: ['clouds', 'clouds'],
  cyber: ['data', 'data'],
};

function drawSilhouette(kind: SilhouetteKind, w: number, h: number, seed: number, night: boolean): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d')!;
  const r = mulberry32(seed);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(0, h);
  const lights: [number, number][] = [];
  if (kind === 'city' || kind === 'data' || kind === 'stacks') {
    let x = 0;
    while (x < w) {
      const bw = kind === 'stacks' ? 14 + r() * 40 : 10 + r() * 34;
      const bh = kind === 'data' ? h * (0.25 + r() * 0.7) : h * (0.2 + r() * 0.6);
      g.lineTo(x, h - bh);
      if (kind === 'stacks' && r() < 0.4) {
        g.lineTo(x + bw * 0.3, h - bh);
        g.lineTo(x + bw * 0.3, h - bh - h * 0.25);
        g.lineTo(x + bw * 0.45, h - bh - h * 0.25);
        g.lineTo(x + bw * 0.45, h - bh);
      }
      if (kind === 'data' && r() < 0.5) {
        g.lineTo(x + bw / 2, h - bh - h * 0.12);
      }
      g.lineTo(x + bw, h - bh);
      if (night) for (let k = 0; k < 6; k++) lights.push([x + r() * bw, h - r() * bh * 0.9]);
      x += bw + (r() < 0.3 ? r() * 8 : 0);
    }
  } else {
    const n = kind === 'peaks' ? 14 : kind === 'mesa' ? 9 : kind === 'clouds' ? 22 : 12;
    let x = 0;
    for (let i = 0; i <= n; i++) {
      const nx = (i / n) * w;
      const top = kind === 'peaks' ? h * (0.35 + r() * 0.6) : kind === 'mesa' ? h * (0.25 + r() * 0.45) : h * (0.15 + r() * 0.35);
      if (kind === 'mesa') {
        g.lineTo(x + (nx - x) * 0.2, h - top);
        g.lineTo(x + (nx - x) * 0.7, h - top);
        g.lineTo(nx, h - top * 0.25);
      } else if (kind === 'peaks') {
        g.lineTo((x + nx) / 2, h - top);
        g.lineTo(nx, h - top * 0.35);
      } else if (kind === 'clouds') {
        g.quadraticCurveTo((x + nx) / 2, h - top * 1.8, nx, h - top * 0.6);
      } else if (kind === 'rides') {
        g.lineTo(nx, h - top);
        if (r() < 0.35) {
          g.lineTo(nx, h - top - h * 0.3);
          g.lineTo(nx + 6, h - top - h * 0.3);
          g.lineTo(nx + 6, h - top);
        }
      } else {
        g.quadraticCurveTo((x + nx) / 2, h - top * 1.4, nx, h - top);
      }
      x = nx;
    }
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  g.clearRect(0, 0, w, 3);
  if (kind === 'peaks') {
    // snow caps: lighter band handled by colour; keep alpha only
  }
  if (lights.length) {
    // windows are cut out (alpha) so the lit layer behind the fog shows through; drawn as holes
    g.globalCompositeOperation = 'destination-out';
    for (const [lx, ly] of lights) g.fillRect(Math.round(lx), Math.round(ly), 2, 2);
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}

export interface Horizon {
  meshes: Mesh[];
  textures: CanvasTexture[];
  recolor(fog: number, night: boolean): void;
}

/**
 * Layered horizon: three cylinder bands of biome skyline at increasing distance (each mixed further
 * toward the fog colour), plus a haze band in front of them so the ground dissolves into distance
 * instead of ending at the last prop row. No fog on these (colours are pre-mixed).
 */
export function buildHorizon(biome: BiomeStyle, centre: [number, number], radius: number, groundY: number, seed: number): Horizon {
  const kinds = SILHOUETTE[biome.id];
  const meshes: Mesh[] = [];
  const textures: CanvasTexture[] = [];
  const layers = [
    { r: radius, h: radius * 0.2, k: kinds[1], t: 0.82, rep: 3 },
    { r: radius * 0.86, h: radius * 0.14, k: kinds[0], t: 0.62, rep: 2 },
    { r: radius * 0.74, h: radius * 0.09, k: kinds[1], t: 0.42, rep: 2 },
  ];
  layers.forEach((L, i) => {
    const tex = canvasTexture(drawSilhouette(L.k, 2048, 256, seed + i * 17, biome.night), true, 1);
    // repeat around the ring only: a vertical repeat bleeds the opaque bottom row into the band's top edge
    // (that was the thin "power line" across the sky)
    tex.wrapT = ClampToEdgeWrapping;
    tex.repeat.set(L.rep, 1);
    textures.push(tex);
    const geo = new CylinderGeometry(L.r, L.r, L.h, 64, 1, true);
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, fog: false, side: DoubleSide, depthWrite: false, alphaTest: 0.02 });
    const m = new Mesh(geo, mat);
    m.position.set(centre[0], groundY + L.h / 2 - (biome.id === 'sky' ? radius * 0.07 : 2), -centre[1]);
    m.rotation.y = i * 1.3;
    m.renderOrder = -900 + i;
    m.frustumCulled = false;
    m.userData.mixT = L.t;
    meshes.push(m);
  });
  // haze band: fog-coloured, opaque at the ground, fading out upward
  const hc = makeCanvas(4, 128);
  const hg = hc.getContext('2d')!;
  const grd = hg.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0.95)');
  hg.fillStyle = grd;
  hg.fillRect(0, 0, 4, 128);
  const htex = canvasTexture(hc, false, 1);
  textures.push(htex);
  const hh = radius * 0.08;
  const haze = new Mesh(new CylinderGeometry(radius * 0.7, radius * 0.7, hh, 48, 1, true), new MeshBasicMaterial({ map: htex, transparent: true, fog: false, side: DoubleSide, depthWrite: false }));
  haze.position.set(centre[0], groundY + hh / 2 - 4, -centre[1]);
  haze.renderOrder = -880;
  haze.frustumCulled = false;
  haze.userData.haze = true;
  meshes.push(haze);
  const recolor = (fog: number, night: boolean) => {
    for (const m of meshes) {
      const mat = m.material as MeshBasicMaterial;
      if (m.userData.haze) {
        mat.color.set(intToHex(fog));
        continue;
      }
      const t = m.userData.mixT as number;
      const dark = biome.id === 'sky' ? 0xffffff : biome.id === 'snow' ? 0xe8f0fa : night ? 0x05040f : shadeInt(biome.ground, -0.45);
      mat.color.set(intToHex(mixInt(dark, fog, t)));
    }
  };
  recolor(biome.fog, biome.night);
  return { meshes, textures, recolor };
}

/**
 * Shore foam: a thin strip along the iso-line `dist = iso` of the distance field (where the quay
 * terrain meets the water), traced with marching squares. Three space, at height `y`. u runs along
 * the strip (world units / 4), v across (0 inner → 1 outer).
 */
export function buildShoreFoam(field: DistanceField, iso: number, y: number, width: number): BufferGeometry | null {
  const { nx, ny, cell, x0, y0, dist } = field;
  const pos: number[] = [];
  const uv: number[] = [];
  const at = (i: number, j: number) => dist[j * nx + i]! - iso;
  const lerp = (a: number, b: number) => a / (a - b);
  const edgePoint = (i: number, j: number, e: number): [number, number] => {
    // edges: 0 bottom (i,j)-(i+1,j), 1 right (i+1,j)-(i+1,j+1), 2 top (i,j+1)-(i+1,j+1), 3 left (i,j)-(i,j+1)
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i + 1, j + 1);
    const d = at(i, j + 1);
    const fx = e === 0 ? lerp(a, b) : e === 1 ? 1 : e === 2 ? lerp(d, c) : 0;
    const fy = e === 0 ? 0 : e === 1 ? lerp(b, c) : e === 2 ? 1 : lerp(a, d);
    return [x0 + (i + fx) * cell, y0 + (j + fy) * cell];
  };
  const seg = (p: [number, number], q: [number, number], outward: [number, number]) => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    // normal toward larger distance (the water)
    const flip = -dy * outward[0] + dx * outward[1] < 0 ? -1 : 1;
    const nxv = (-dy / l) * flip;
    const nyv = (dx / l) * flip;
    const w = width / 2;
    const P = (x: number, yy: number) => pos.push(x, y, -yy);
    const u0 = (p[0] + p[1]) / 4;
    const u1 = u0 + l / 4;
    P(p[0] - nxv * w, p[1] - nyv * w);
    P(q[0] - nxv * w, q[1] - nyv * w);
    P(q[0] + nxv * w, q[1] + nyv * w);
    P(p[0] - nxv * w, p[1] - nyv * w);
    P(q[0] + nxv * w, q[1] + nyv * w);
    P(p[0] + nxv * w, p[1] + nyv * w);
    uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
  };
  const TABLE: Record<number, number[][]> = {
    1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]],
    8: [[2, 3]], 9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]],
  };
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const code = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      const edges = TABLE[code];
      if (!edges) continue;
      // outward = gradient of dist (toward water)
      const gx = b + c - a - d;
      const gy = c + d - a - b;
      for (const [e0, e1] of edges) seg(edgePoint(i, j, e0!), edgePoint(i, j, e1!), [gx, gy]);
    }
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
