/**
 * MeshBuilder — accumulates primitive shapes (boxes, prisms, cones, spheres…) with per-vertex
 * colour and a per-vertex "glow" (self-illumination 0..1) into ONE merged BufferGeometry, so a
 * whole kart / character / landmark draws in a single call with the shared voxel material.
 *
 * Build-time only (allocates freely); every result is cached by its caller.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type ColorRepresentation,
} from 'three';

const tmpColor = new Color();
const tmpV = new Vector3();
const tmpN = new Matrix3();

/** Unit templates (never disposed; tiny and shared by every build). */
const TEMPLATES = new Map<string, BufferGeometry>();
function template(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = TEMPLATES.get(key);
  if (!g) {
    const made = make();
    g = made.index ? made.toNonIndexed() : made;
    if (g !== made) made.dispose();
    TEMPLATES.set(key, g);
  }
  return g;
}

export type Axis = 'x' | 'y' | 'z';

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private glw: number[] = [];
  private uvs: number[] = [];
  private stack: Matrix4[] = [];
  private m = new Matrix4();
  /** Optional vertex-colour gradient along Y: bottom darkening (fake AO) 0..1. */
  ao = 0;
  /** UV multiplier applied to added primitives (tiling textures such as window facades). */
  uvScale: [number, number] = [1, 1];

  push(): this {
    this.stack.push(this.m.clone());
    return this;
  }
  pop(): this {
    const m = this.stack.pop();
    if (m) this.m.copy(m);
    return this;
  }
  translate(x: number, y: number, z: number): this {
    this.m.multiply(new Matrix4().makeTranslation(x, y, z));
    return this;
  }
  rotate(axis: Axis, a: number): this {
    const r = new Matrix4();
    if (axis === 'x') r.makeRotationX(a);
    else if (axis === 'y') r.makeRotationY(a);
    else r.makeRotationZ(a);
    this.m.multiply(r);
    return this;
  }
  scale(x: number, y = x, z = x): this {
    this.m.multiply(new Matrix4().makeScale(x, y, z));
    return this;
  }

  /** Append any (non-indexed or indexed) geometry transformed by `local` then the current matrix. */
  add(geom: BufferGeometry, color: ColorRepresentation | ((p: Vector3, n: Vector3) => number), glow = 0, local?: Matrix4): this {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const m = local ? this.m.clone().multiply(local) : this.m;
    tmpN.getNormalMatrix(m);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const fixed = typeof color === 'function' ? null : tmpColor.set(color).clone();
    const nv = new Vector3();
    for (let i = 0; i < p.count; i++) {
      tmpV.set(p.getX(i), p.getY(i), p.getZ(i));
      const ly = tmpV.y;
      tmpV.applyMatrix4(m);
      this.pos.push(tmpV.x, tmpV.y, tmpV.z);
      if (n) nv.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(tmpN).normalize();
      else nv.set(0, 1, 0);
      this.nrm.push(nv.x, nv.y, nv.z);
      let c: Color;
      if (fixed) c = fixed;
      else c = tmpColor.set((color as (p: Vector3, n: Vector3) => number)(tmpV, nv));
      const shade = this.ao > 0 ? 1 - this.ao * (0.5 - Math.max(-0.5, Math.min(0.5, ly))) : 1;
      this.col.push(c.r * shade, c.g * shade, c.b * shade);
      this.glw.push(glow);
      if (uv) this.uvs.push(uv.getX(i) * this.uvScale[0], uv.getY(i) * this.uvScale[1]);
      else this.uvs.push(0, 0);
    }
    if (g !== geom) g.dispose();
    return this;
  }

  /** Axis-aligned box centred at (x, y, z) with size (w, h, d) in the current frame. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: ColorRepresentation, glow = 0): this {
    const t = template('box', () => new BoxGeometry(1, 1, 1));
    return this.add(t, color, glow, new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(w, h, d)));
  }

  /** Box rotated about an axis around its own centre. */
  boxR(x: number, y: number, z: number, w: number, h: number, d: number, axis: Axis, a: number, color: ColorRepresentation, glow = 0): this {
    const t = template('box', () => new BoxGeometry(1, 1, 1));
    const q = new Quaternion().setFromAxisAngle(axis === 'x' ? X : axis === 'y' ? Y : Z, a);
    return this.add(t, color, glow, new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(w, h, d)));
  }

  /** Cylinder (prism with `sides`) centred at (x,y,z), radius r, length h along `axis`. */
  cyl(x: number, y: number, z: number, r: number, h: number, color: ColorRepresentation, sides = 8, axis: Axis = 'y', glow = 0, rTop = r): this {
    const key = `cyl${sides}:${(rTop / r).toFixed(3)}`;
    const t = template(key, () => new CylinderGeometry(rTop / r, 1, 1, sides, 1));
    const q = new Quaternion();
    if (axis === 'x') q.setFromAxisAngle(Z, -Math.PI / 2);
    else if (axis === 'z') q.setFromAxisAngle(X, Math.PI / 2);
    return this.add(t, color, glow, new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(r, h, r)));
  }

  /** Cone pointing +axis. */
  cone(x: number, y: number, z: number, r: number, h: number, color: ColorRepresentation, sides = 6, axis: Axis = 'y', glow = 0, flip = false): this {
    const t = template(`cone${sides}`, () => new ConeGeometry(1, 1, sides, 1));
    const q = new Quaternion();
    if (axis === 'x') q.setFromAxisAngle(Z, flip ? Math.PI / 2 : -Math.PI / 2);
    else if (axis === 'z') q.setFromAxisAngle(X, flip ? -Math.PI / 2 : Math.PI / 2);
    else if (flip) q.setFromAxisAngle(X, Math.PI);
    return this.add(t, color, glow, new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(r, h, r)));
  }

  /** Low-poly sphere / ellipsoid. */
  ball(x: number, y: number, z: number, rx: number, color: ColorRepresentation, detail = 1, glow = 0, ry = rx, rz = rx): this {
    const t = template(`ico${detail}`, () => new IcosahedronGeometry(1, detail));
    return this.add(t, color, glow, new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(rx, ry, rz)));
  }

  /** Smooth-ish UV sphere (for bubbles/balloons). */
  sphere(x: number, y: number, z: number, r: number, color: ColorRepresentation, w = 12, h = 8, glow = 0, sy = 1): this {
    const t = template(`sph${w}x${h}`, () => new SphereGeometry(1, w, h));
    return this.add(t, color, glow, new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(r, r * sy, r)));
  }

  octa(x: number, y: number, z: number, r: number, color: ColorRepresentation, glow = 0, sy = 1): this {
    const t = template('octa', () => new OctahedronGeometry(1, 0));
    return this.add(t, color, glow, new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(r, r * sy, r)));
  }

  /** Torus in the XY plane (ring around Z) unless rotated by the caller. */
  torus(x: number, y: number, z: number, R: number, tube: number, color: ColorRepresentation, radial = 6, tubular = 16, glow = 0, axis: Axis = 'z'): this {
    const ratio = (tube / R).toFixed(3);
    const t = template(`tor${radial}x${tubular}:${ratio}`, () => new TorusGeometry(1, tube / R, radial, tubular));
    const q = new Quaternion();
    if (axis === 'y') q.setFromAxisAngle(X, Math.PI / 2);
    else if (axis === 'x') q.setFromAxisAngle(Y, Math.PI / 2);
    return this.add(t, color, glow, new Matrix4().compose(new Vector3(x, y, z), q, new Vector3(R, R, R)));
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('glow', new BufferAttribute(new Float32Array(this.glw), 1));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
