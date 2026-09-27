/**
 * GeoBuf — a tiny growable triangle soup (position, normal, uv, colour) for procedural world
 * geometry, plus the track→three coordinate helpers.
 *
 * three(x, y, z) = (trackX, trackZ, -trackY). Lateral offset d (+ = left) at sample i of a path
 * maps to track (x - ty·d, y + tx·d).
 */
import { BufferAttribute, BufferGeometry } from 'three';

export class GeoBuf {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  /** Colour that occlusion darkens toward (linear rgb). Default black = plain darkening. */
  ao: RGB = [0, 0, 0];

  get triangles(): number {
    return this.pos.length / 9;
  }

  /** One triangle with a flat face normal. Colours are linear rgb triples (0..1). */
  tri(a: V3, b: V3, c: V3, ua: V2, ub: V2, uc: V2, ca: number, cb: number, cc: number, tint?: RGB): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    const r = tint ? tint[0] : 1;
    const g = tint ? tint[1] : 1;
    const bl = tint ? tint[2] : 1;
    // shade 1 = unoccluded; toward 0 the colour sinks into the AO tint (tinted shadows)
    const [ar, ag, ab] = this.ao;
    const m = (t: number, s: number, a: number) => t * (a + (1 - a) * s);
    this.col.push(m(r, ca, ar), m(g, ca, ag), m(bl, ca, ab), m(r, cb, ar), m(g, cb, ag), m(bl, cb, ab), m(r, cc, ar), m(g, cc, ag), m(bl, cc, ab));
  }

  /**
   * Quad a-b-c-d (a,b on one edge, d,c on the next: a→b across, a→d along), with per-corner shade.
   * Winding is chosen so the normal faces `up` hint when given (+1 = keep, -1 = flip).
   */
  quad(a: V3, b: V3, c: V3, d: V3, ua: V2, ub: V2, uc: V2, ud: V2, sa = 1, sb = 1, sc = 1, sd = 1, flip = false, tint?: RGB): void {
    if (!flip) {
      this.tri(a, b, c, ua, ub, uc, sa, sb, sc, tint);
      this.tri(a, c, d, ua, uc, ud, sa, sc, sd, tint);
    } else {
      this.tri(a, c, b, ua, uc, ub, sa, sc, sb, tint);
      this.tri(a, d, c, ua, ud, uc, sa, sd, sc, tint);
    }
  }

  build(): BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export type V3 = [number, number, number];
export type V2 = [number, number];
export type RGB = [number, number, number];

/** sRGB 0xRRGGBB → linear rgb (matches three's vertex colour space). */
export function linRGB(hex: number): RGB {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

/** Track point + lateral offset + height → three position. */
export function at(x: number, y: number, z: number, tx: number, ty: number, d: number, h: number): V3 {
  return [x - ty * d, z + h, -(y + tx * d)];
}
