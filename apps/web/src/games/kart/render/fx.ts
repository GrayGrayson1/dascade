/**
 * Pooled effects. Everything is preallocated; spawning writes into typed arrays, the update
 * compacts live particles, and each system is ONE draw call:
 *  - Particles (additive + alpha): sparks, flames, glows, smoke, dust, snow, sand, splash,
 *    confetti (square "pixels"), fireworks, shards, stars.
 *  - Streaks: additive line segments (heat shimmer behind exhausts, warp trails, wall sparks).
 *  - SpeedLines: camera-space lines rushing past at high speed / boost.
 *  - Skids: a ring buffer of tyre-mark quads on the road that fade out.
 *  - Rings: expanding pulse / landing shock rings.
 * Colours passed in are 0xRRGGBB (sRGB) and converted to linear once per spawn.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  ShaderMaterial,
  TorusGeometry,
  type Camera,
  type Object3D,
} from 'three';

const tmpC = new Color();

const PARTICLE_ATTRS = ['position', 'color', 'size', 'alpha', 'shape'] as const;

export const SHAPE_SOFT = 0;
export const SHAPE_SQUARE = 1;
export const SHAPE_STAR = 2;

export class Particles {
  readonly points: Points;
  private n = 0;
  private readonly cap: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private shape: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private spin: Float32Array;
  private geo: BufferGeometry;
  readonly material: ShaderMaterial;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    const g = new BufferGeometry();
    const attr = (a: Float32Array, n: number) => {
      const b = new BufferAttribute(a, n);
      b.setUsage(DynamicDrawUsage);
      return b;
    };
    g.setAttribute('position', attr(this.pos, 3));
    g.setAttribute('color', attr(this.col, 3));
    g.setAttribute('size', attr(this.size, 1));
    g.setAttribute('alpha', attr(this.alpha, 1));
    g.setAttribute('shape', attr(this.shape, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.material = new ShaderMaterial({
      uniforms: { scale: { value: 600 }, maxPx: { value: 64 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute float shape; attribute vec3 color;
        uniform float scale; uniform float maxPx;
        varying vec3 vCol; varying float vA; varying float vShape;
        void main() {
          vCol = color; vA = alpha; vShape = shape;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // capped on-screen size + fade inside ~3 u of the eye: nothing can blanket the view
          gl_PointSize = clamp(size * scale / max(0.1, -mv.z), 0.0, maxPx);
          vA *= smoothstep(1.0, 2.8, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vCol; varying float vA; varying float vShape;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a;
          if (vShape < 0.5) a = smoothstep(0.5, 0.05, length(c));
          else if (vShape < 1.5) a = step(max(abs(c.x), abs(c.y)), 0.42);
          else a = max(smoothstep(0.12, 0.0, abs(c.x)) * smoothstep(0.5, 0.1, abs(c.y)), smoothstep(0.12, 0.0, abs(c.y)) * smoothstep(0.5, 0.1, abs(c.x))) + smoothstep(0.2, 0.0, length(c));
          if (a * vA < 0.01) discard;
          gl_FragColor = vec4(vCol, a * vA);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 15;
  }

  get count(): number {
    return this.n;
  }

  /** Spawn one particle (three-space position/velocity). Silently drops when full. */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number, color: number, alpha = 1, gravity = 0, drag = 0, shape = SHAPE_SOFT): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    tmpC.setHex(color);
    this.col[k] = tmpC.r;
    this.col[k + 1] = tmpC.g;
    this.col[k + 2] = tmpC.b;
    this.life[i] = life;
    this.max[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.a0[i] = alpha;
    this.grav[i] = gravity;
    this.drag[i] = drag;
    this.shape[i] = shape;
    this.spin[i] = 0;
    this.size[i] = size0;
    this.alpha[i] = alpha;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      const l = this.life[i]! - dt;
      if (l <= 0) {
        this.kill(i);
        continue;
      }
      this.life[i] = l;
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[k] = this.vel[k]! * d;
      this.vel[k + 1] = this.vel[k + 1]! * d - this.grav[i]! * dt;
      this.vel[k + 2] = this.vel[k + 2]! * d;
      this.pos[k] = this.pos[k]! + this.vel[k]! * dt;
      this.pos[k + 1] = this.pos[k + 1]! + this.vel[k + 1]! * dt;
      this.pos[k + 2] = this.pos[k + 2]! + this.vel[k + 2]! * dt;
      const t = 1 - l / this.max[i]!;
      this.size[i] = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * t;
      this.alpha[i] = this.a0[i]! * (t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9);
      i++;
    }
    const g = this.geo;
    g.setDrawRange(0, this.n);
    for (let k = 0; k < PARTICLE_ATTRS.length; k++) {
      const a = g.getAttribute(PARTICLE_ATTRS[k]!) as BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * a.itemSize);
      a.needsUpdate = true;
    }
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    const ki = i * 3;
    const kj = j * 3;
    for (let c = 0; c < 3; c++) {
      this.pos[ki + c] = this.pos[kj + c]!;
      this.vel[ki + c] = this.vel[kj + c]!;
      this.col[ki + c] = this.col[kj + c]!;
    }
    this.size[i] = this.size[j]!;
    this.alpha[i] = this.alpha[j]!;
    this.shape[i] = this.shape[j]!;
    this.life[i] = this.life[j]!;
    this.max[i] = this.max[j]!;
    this.s0[i] = this.s0[j]!;
    this.s1[i] = this.s1[j]!;
    this.a0[i] = this.a0[j]!;
    this.grav[i] = this.grav[j]!;
    this.drag[i] = this.drag[j]!;
    this.spin[i] = this.spin[j]!;
  }

  clear(): void {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }

  setScale(viewportHeightPx: number, fovDeg: number): void {
    this.material.uniforms.scale!.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    // no single particle bigger than ~7% of the view height
    this.material.uniforms.maxPx!.value = Math.max(12, viewportHeightPx * 0.07);
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

/** Additive line streaks (world space). Colour fades to black = transparent with additive blending. */
export class Streaks {
  readonly lines: LineSegments;
  private n = 0;
  private readonly cap: number;
  private pos: Float32Array;
  private col: Float32Array;
  private hx: Float32Array;
  private vel: Float32Array;
  private len: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private rgb: Float32Array;
  private geo: BufferGeometry;
  private mat: LineBasicMaterial;

  constructor(capacity: number) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 6);
    this.col = new Float32Array(capacity * 6);
    this.hx = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.len = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.max = new Float32Array(capacity);
    this.rgb = new Float32Array(capacity * 3);
    const g = new BufferGeometry();
    const p = new BufferAttribute(this.pos, 3);
    p.setUsage(DynamicDrawUsage);
    const c = new BufferAttribute(this.col, 3);
    c.setUsage(DynamicDrawUsage);
    g.setAttribute('position', p);
    g.setAttribute('color', c);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new LineBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false });
    this.lines = new LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 21;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, length: number, life: number, color: number, intensity = 1): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.hx[i * 3] = x;
    this.hx[i * 3 + 1] = y;
    this.hx[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.len[i] = length;
    this.life[i] = life;
    this.max[i] = life;
    tmpC.setHex(color);
    this.rgb[i * 3] = tmpC.r * intensity;
    this.rgb[i * 3 + 1] = tmpC.g * intensity;
    this.rgb[i * 3 + 2] = tmpC.b * intensity;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      const l = this.life[i]! - dt;
      if (l <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let c = 0; c < 3; c++) {
            this.hx[i * 3 + c] = this.hx[j * 3 + c]!;
            this.vel[i * 3 + c] = this.vel[j * 3 + c]!;
            this.rgb[i * 3 + c] = this.rgb[j * 3 + c]!;
          }
          this.len[i] = this.len[j]!;
          this.life[i] = this.life[j]!;
          this.max[i] = this.max[j]!;
        }
        continue;
      }
      this.life[i] = l;
      const k = i * 3;
      const vx = this.vel[k]!;
      const vy = this.vel[k + 1]!;
      const vz = this.vel[k + 2]!;
      this.hx[k] = this.hx[k]! + vx * dt;
      this.hx[k + 1] = this.hx[k + 1]! + vy * dt;
      this.hx[k + 2] = this.hx[k + 2]! + vz * dt;
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      const L = this.len[i]! / sp;
      const o = i * 6;
      this.pos[o] = this.hx[k]!;
      this.pos[o + 1] = this.hx[k + 1]!;
      this.pos[o + 2] = this.hx[k + 2]!;
      this.pos[o + 3] = this.hx[k]! - vx * L;
      this.pos[o + 4] = this.hx[k + 1]! - vy * L;
      this.pos[o + 5] = this.hx[k + 2]! - vz * L;
      const f = l / this.max[i]!;
      for (let c = 0; c < 3; c++) {
        this.col[o + c] = this.rgb[k + c]! * f;
        this.col[o + 3 + c] = 0;
      }
      i++;
    }
    this.geo.setDrawRange(0, this.n * 2);
    const p = this.geo.getAttribute('position') as BufferAttribute;
    const c = this.geo.getAttribute('color') as BufferAttribute;
    p.clearUpdateRanges();
    p.addUpdateRange(0, this.n * 6);
    p.needsUpdate = true;
    c.clearUpdateRanges();
    c.addUpdateRange(0, this.n * 6);
    c.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Camera-attached speed lines. `intensity` 0..1 per frame. */
export class SpeedLines {
  readonly lines: LineSegments;
  private z: Float32Array;
  private ang: Float32Array;
  private rad: Float32Array;
  private pos: Float32Array;
  private col: Float32Array;
  private geo: BufferGeometry;
  private mat: LineBasicMaterial;
  private seed = 1;

  constructor(
    private readonly count = 48,
    parent: Camera,
  ) {
    this.z = new Float32Array(count);
    this.ang = new Float32Array(count);
    this.rad = new Float32Array(count);
    this.pos = new Float32Array(count * 6);
    this.col = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) this.reset(i, true);
    const g = new BufferGeometry();
    const p = new BufferAttribute(this.pos, 3);
    p.setUsage(DynamicDrawUsage);
    const c = new BufferAttribute(this.col, 3);
    c.setUsage(DynamicDrawUsage);
    g.setAttribute('position', p);
    g.setAttribute('color', c);
    this.geo = g;
    this.mat = new LineBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false });
    this.lines = new LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 50;
    this.lines.visible = false;
    parent.add(this.lines);
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private reset(i: number, anywhere: boolean): void {
    this.z[i] = anywhere ? -2 - this.rnd() * 14 : -16;
    this.ang[i] = this.rnd() * Math.PI * 2;
    this.rad[i] = 1.4 + this.rnd() * 2.6;
  }

  update(dt: number, intensity: number, speed: number, tint: number, fovDeg = 64, aspect = 16 / 9): void {
    const on = intensity > 0.02;
    this.lines.visible = on;
    if (!on) return;
    tmpC.setHex(tint);
    const tanH = Math.tan((fovDeg * Math.PI) / 360);
    for (let i = 0; i < this.count; i++) {
      this.z[i] = this.z[i]! + dt * (18 + speed * 1.2);
      if (this.z[i]! > -1.2) this.reset(i, false);
      const a = this.ang[i]!;
      // keep lines in the outer ring of the screen (radius 0.62..1.05 of the half-extent)
      const rn = 0.62 + (this.rad[i]! - 1.4) / 2.6 * 0.43;
      const z = this.z[i]!;
      const x = Math.cos(a) * rn * -z * tanH * aspect;
      const y = Math.sin(a) * rn * -z * tanH;
      const o = i * 6;
      const L = 1 + intensity * 1.6;
      const k = (z + L) / z;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
      this.pos[o + 3] = x * k;
      this.pos[o + 4] = y * k;
      this.pos[o + 5] = z + L;
      const f = intensity * 0.45 * Math.min(1, (-z - 1.2) / 3);
      this.col[o] = tmpC.r * f;
      this.col[o + 1] = tmpC.g * f;
      this.col[o + 2] = tmpC.b * f;
      this.col[o + 3] = 0;
      this.col[o + 4] = 0;
      this.col[o + 5] = 0;
    }
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.lines.parent?.remove(this.lines);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Tyre marks: ring buffer of quads. Fade handled by a per-vertex birth time in the shader. */
export class Skids {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private birth: Float32Array;
  private head = 0;
  private readonly cap: number;
  private geo: BufferGeometry;
  private mat: ShaderMaterial;
  /** last point per (slot*2 + wheel): x, y, z, valid */
  private last = new Float32Array(64 * 4);

  constructor(capacity: number) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 6 * 3);
    this.birth = new Float32Array(capacity * 6).fill(-1000);
    const g = new BufferGeometry();
    const p = new BufferAttribute(this.pos, 3);
    p.setUsage(DynamicDrawUsage);
    const b = new BufferAttribute(this.birth, 1);
    b.setUsage(DynamicDrawUsage);
    g.setAttribute('position', p);
    g.setAttribute('birth', b);
    this.geo = g;
    this.mat = new ShaderMaterial({
      uniforms: { time: { value: 0 }, life: { value: 7 }, color: { value: new Color(0x0c0c10) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      vertexShader: /* glsl */ `
        attribute float birth; uniform float time; uniform float life; varying float vA;
        void main() { vA = clamp(1.0 - (time - birth) / life, 0.0, 1.0) * 0.32; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; varying float vA;
        void main() {
          if (vA < 0.01) discard;
          gl_FragColor = vec4(color, vA);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Break the mark for a wheel (lifted / not skidding). */
  lift(key: number): void {
    this.last[key * 4 + 3] = 0;
  }

  /** Add a mark segment for wheel `key` to (x, y, z) three-space, facing `hx, hz` (unit forward). */
  mark(key: number, x: number, y: number, z: number, hx: number, hz: number, time: number, width = 0.13): void {
    const o = key * 4;
    if (this.last[o + 3] === 1) {
      const lx = this.last[o]!;
      const ly = this.last[o + 1]!;
      const lz = this.last[o + 2]!;
      const dx = x - lx;
      const dz = z - lz;
      if (dx * dx + dz * dz < 0.09) return;
      if (dx * dx + dz * dz < 16) {
        // side vector
        const sx = -hz * width;
        const sz = hx * width;
        const q = this.head;
        this.head = (this.head + 1) % this.cap;
        const v = q * 18;
        const P = this.pos;
        const yy = y + 0.02;
        const ly2 = ly + 0.02;
        // tri 1
        P[v] = lx - sx;
        P[v + 1] = ly2;
        P[v + 2] = lz - sz;
        P[v + 3] = lx + sx;
        P[v + 4] = ly2;
        P[v + 5] = lz + sz;
        P[v + 6] = x + sx;
        P[v + 7] = yy;
        P[v + 8] = z + sz;
        // tri 2
        P[v + 9] = lx - sx;
        P[v + 10] = ly2;
        P[v + 11] = lz - sz;
        P[v + 12] = x + sx;
        P[v + 13] = yy;
        P[v + 14] = z + sz;
        P[v + 15] = x - sx;
        P[v + 16] = yy;
        P[v + 17] = z - sz;
        for (let k = 0; k < 6; k++) this.birth[q * 6 + k] = time;
        const pa = this.geo.getAttribute('position') as BufferAttribute;
        const ba = this.geo.getAttribute('birth') as BufferAttribute;
        pa.addUpdateRange(v, 18);
        pa.needsUpdate = true;
        ba.addUpdateRange(q * 6, 6);
        ba.needsUpdate = true;
      }
    }
    this.last[o] = x;
    this.last[o + 1] = y;
    this.last[o + 2] = z;
    this.last[o + 3] = 1;
  }

  update(time: number): void {
    this.mat.uniforms.time!.value = time;
  }

  beginFrame(): void {
    (this.geo.getAttribute('position') as BufferAttribute).clearUpdateRanges();
    (this.geo.getAttribute('birth') as BufferAttribute).clearUpdateRanges();
  }

  clear(): void {
    this.birth.fill(-1000);
    this.last.fill(0);
    (this.geo.getAttribute('birth') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Expanding rings (pulse wave, landing shock, boost burst). */
export class Rings {
  private meshes: Mesh[] = [];
  private t: Float32Array;
  private dur: Float32Array;
  private r1: Float32Array;
  private geo: TorusGeometry;

  constructor(parent: Object3D, count = 8) {
    this.geo = new TorusGeometry(1, 0.06, 4, 48);
    this.geo.rotateX(Math.PI / 2);
    this.t = new Float32Array(count).fill(-1);
    this.dur = new Float32Array(count).fill(1);
    this.r1 = new Float32Array(count).fill(1);
    for (let i = 0; i < count; i++) {
      const m = new Mesh(this.geo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 22;
      m.frustumCulled = false;
      parent.add(m);
      this.meshes.push(m);
    }
  }

  spawn(x: number, y: number, z: number, radius: number, duration: number, color: number, thickness = 1): void {
    let best = 0;
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.t[i]! < 0) {
        best = i;
        break;
      }
      if (this.t[i]! > this.t[best]!) best = i;
    }
    const m = this.meshes[best]!;
    m.position.set(x, y, z);
    (m.material as MeshBasicMaterial).color.setHex(color);
    m.userData.th = thickness;
    this.t[best] = 0;
    this.dur[best] = duration;
    this.r1[best] = radius;
    m.visible = true;
  }

  update(dt: number, cam?: { x: number; y: number; z: number }): void {
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.t[i]! < 0) continue;
      const t = (this.t[i] = this.t[i]! + dt);
      const m = this.meshes[i]!;
      const f = t / this.dur[i]!;
      if (f >= 1) {
        this.t[i] = -1;
        m.visible = false;
        continue;
      }
      const e = 1 - (1 - f) * (1 - f);
      const r = 0.5 + e * this.r1[i]!;
      const th = (m.userData.th as number) ?? 1;
      m.scale.set(r, th * (1 + e * 6), r);
      let near = 1;
      if (cam) {
        // fade rings whose edge passes close to the camera
        const dx = m.position.x - cam.x;
        const dy = m.position.y - cam.y;
        const dz = m.position.z - cam.z;
        const edge = Math.abs(Math.sqrt(dx * dx + dz * dz) - r);
        const d = Math.sqrt(edge * edge + dy * dy);
        near = Math.max(0, Math.min(1, (d - 1.5) / 3));
      }
      (m.material as MeshBasicMaterial).opacity = (1 - f) * near;
    }
  }

  clear(): void {
    for (let i = 0; i < this.meshes.length; i++) {
      this.t[i] = -1;
      this.meshes[i]!.visible = false;
    }
  }

  dispose(): void {
    for (const m of this.meshes) {
      (m.material as MeshBasicMaterial).dispose();
      m.parent?.remove(m);
    }
    this.geo.dispose();
  }
}
