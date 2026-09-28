/**
 * Hazard visuals driven by core's `hazardPose(track, index, tick)` — the same pure function the
 * simulation uses, so what you see is exactly what hits you. Danger telegraphs: stomper shadows grow
 * before the slam, lasers blink before switching on, rollers glow when they respawn.
 */
import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
  Vector3,
} from 'three';
import { hazardPose, pointAtS, type HazardKind, type HazardPose, type KartTrack } from '@dascade/game-core/kart';
import { MeshBuilder } from '../art/builder.ts';
import { shadeInt } from '../art/palette.ts';
import type { BiomeStyle } from './biomes.ts';

export interface HazardView {
  group: Group;
  kind: HazardKind;
  radius: number;
  update(tick: number, t: number, reducedMotion: boolean): HazardPose;
  /** True on the frame a stomper lands (for dust fx). */
  landed: boolean;
}

export interface HazardSet {
  views: HazardView[];
  dispose(): void;
}

const geoCache = new Map<string, BufferGeometry>();
function geo(key: string, build: (b: MeshBuilder) => void): BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    const b = new MeshBuilder();
    build(b);
    g = b.build();
    geoCache.set(key, g);
  }
  return g;
}

export function buildHazards(track: KartTrack, biome: BiomeStyle, voxel: Material, dot: Texture): HazardSet {
  const views: HazardView[] = [];
  const mats: Material[] = [];
  const shadowMat = new MeshBasicMaterial({ map: dot, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  mats.push(shadowMat);
  const plane = new PlaneGeometry(1, 1);
  plane.rotateX(-Math.PI / 2);

  for (const h of track.hazards) {
    const group = new Group();
    const r = h.radius;
    const base = hazardPose(track, h.index, 0);
    const toThree = (p: HazardPose, m: { position: { set(x: number, y: number, z: number): void } }, dy = 0) => m.position.set(p.x, p.z + dy, -p.y);
    let view: HazardView;
    switch (h.kind) {
      case 'bumper': {
        const g = geo(`bumper:${biome.id}`, (b) => {
          b.cyl(0, 0.5, 0, 1, 1, 0x1f2937, 16);
          b.cyl(0, 1.05, 0, 0.92, 0.2, 0xff4fd8, 16, 'y', 0.9);
          b.cyl(0, 1.2, 0, 0.7, 0.2, 0xfff6e0, 16);
          b.cyl(0, 1.35, 0, 0.35, 0.2, 0xffd23f, 12, 'y', 1);
          b.torus(0, 0.35, 0, 1.02, 0.12, 0x22d3ee, 4, 24, 1, 'y');
        });
        const m = new Mesh(g, voxel);
        m.scale.set(r, 1, r);
        group.add(m);
        toThree(base, group);
        view = {
          group,
          kind: h.kind,
          radius: r,
          landed: false,
          update(tick, t, rm) {
            const p = hazardPose(track, h.index, tick);
            if (!rm) m.scale.y = 1 + 0.06 * Math.sin(t * 6 + h.index);
            return p;
          },
        };
        break;
      }
      case 'stomper': {
        const block = geo(`stomper:${biome.id}`, (b) => {
          b.box(0, 0.9, 0, 2, 1.8, 2, 0x8b93a3);
          b.box(0, 0.05, 0, 2.1, 0.2, 2.1, 0x3b4252);
          // hazard chevrons on all four faces
          for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const)
            for (let k = 0; k < 4; k++) {
              const u = -0.75 + k * 0.5;
              b.boxR(nx * 1.01 + nz * u, 0.75, nz * 1.01 + nx * u, nx ? 0.02 : 0.22, 0.9, nz ? 0.02 : 0.22, nx ? 'x' : 'z', 0.6, 0xffd23f);
            }
          b.box(0, 1.55, 0, 2.04, 0.18, 2.04, 0xffd23f);
          b.box(0, 1.9, 0, 1.6, 0.2, 1.6, 0xff8a1f, 0.8);
          b.box(0, 5, 0, 0.5, 6.4, 0.5, 0xc0c7d2);
        });
        const posts = geo(`stomperFrame:${biome.id}`, (b) => {
          for (const s of [-1, 1]) {
            for (let k = 0; k < 10; k++) b.box(0, 0.5 + k, s * 1.3, 0.42, 1, 0.42, k % 2 ? 0x1f2028 : 0xffd23f);
            b.box(0, 0.2, s * 1.3, 1, 0.4, 1, 0x2a2d3a);
            b.ball(0, 10.4, s * 1.3, 0.25, 0xff3048, 0, 1);
          }
          b.box(0, 10.2, 0, 0.8, 0.6, 3.2, 0x3b4252);
        });
        const m = new Mesh(block, voxel);
        m.scale.set(r, 1, r);
        const frame = new Mesh(posts, voxel);
        frame.scale.set(r, 1, r);
        const sh = new Mesh(plane, shadowMat);
        group.add(m, frame, sh);
        const groundZ = pointAtS(track, h.s).z;
        group.position.set(base.x, groundZ, -base.y);
        group.rotation.y = h.heading;
        let wasActive = false;
        view = {
          group,
          kind: h.kind,
          radius: r,
          landed: false,
          update(tick) {
            const p = hazardPose(track, h.index, tick);
            m.position.y = p.z - groundZ;
            frame.position.y = 0;
            const lift = Math.min(1, m.position.y / 4.5);
            const s = r * 2.4 * (1.25 - lift * 0.5);
            sh.scale.set(s, 1, s);
            sh.position.y = 0.05;
            (sh.material as MeshBasicMaterial).opacity = 0.35 + (1 - lift) * 0.4;
            this.landed = p.active && !wasActive;
            wasActive = p.active;
            return p;
          },
        };
        break;
      }
      case 'sweeper': {
        const harbor = biome.id === 'harbor';
        const obj = geo(`sweeper:${biome.id}`, (b) => {
          if (harbor) {
            // a shipping container slung under a crane spreader: ribs, doors, corner castings, a hazard
            // band, four chains to a hook block and a flashing beacon (long axis along the road)
            const C = 0x2563eb;
            const CD = 0x1d4ed8;
            const RIB = 0x1e3a8a;
            b.box(0, 0, 0, 2.6, 2.0, 2.0, C);
            for (let k = -5; k <= 5; k++) {
              const x = k * 0.23;
              b.box(x, 0.05, 1.01, 0.09, 1.7, 0.04, RIB).box(x, 0.05, -1.01, 0.09, 1.7, 0.04, RIB);
            }
            for (let k = -4; k <= 4; k++) b.box(k * 0.28, 1.01, 0, 0.1, 0.04, 1.9, CD);
            // door end (+X) with leaves, locking bars and handles; plain ribbed end (−X)
            b.box(1.31, 0, 0, 0.03, 1.9, 1.9, CD);
            b.box(1.325, 0, 0, 0.02, 1.9, 0.04, 0x0f1f4a);
            for (const z of [-0.7, -0.25, 0.25, 0.7]) {
              b.box(1.34, 0, z, 0.03, 1.85, 0.05, 0xc0c7d2);
              b.box(1.36, -0.2, z, 0.04, 0.05, 0.14, 0xc0c7d2);
            }
            for (let k = -3; k <= 3; k++) b.box(-1.31, 0, k * 0.26, 0.03, 1.7, 0.08, RIB);
            // corner castings
            for (const x of [-1.27, 1.27]) for (const y of [-0.96, 0.96]) for (const z of [-0.97, 0.97]) b.box(x, y, z, 0.14, 0.14, 0.14, 0x1c1f2b);
            // hazard band around the base (black / yellow blocks)
            for (let k = 0; k < 10; k++) {
              const x = -1.17 + k * 0.26;
              const col = k % 2 ? 0x1b1b22 : 0xffd23f;
              b.box(x, -0.78, 1.04, 0.26, 0.26, 0.03, col).box(x, -0.78, -1.04, 0.26, 0.26, 0.03, col);
            }
            // …and on both ends (the view you approach it from)
            for (let k = 0; k < 7; k++) {
              const z = -0.78 + k * 0.26;
              const col = k % 2 ? 0x1b1b22 : 0xffd23f;
              b.box(1.38, -0.78, z, 0.03, 0.26, 0.26, col).box(-1.34, -0.78, z, 0.03, 0.26, 0.26, col);
            }
            // spreader frame, chains, hook block, beacon
            b.box(0, 1.28, 0, 2.7, 0.16, 0.34, 0xffd23f);
            b.box(-1.2, 1.28, 0, 0.3, 0.16, 2.0, 0xffd23f).box(1.2, 1.28, 0, 0.3, 0.16, 2.0, 0xffd23f);
            for (const x of [-1.2, 1.2]) for (const z of [-0.9, 0.9]) b.strut(x, 1.36, z, x * 0.06, 2.0, z * 0.06, 0.04, 0x2a2d3a);
            b.box(0, 2.18, 0, 0.36, 0.4, 0.3, 0xffd23f);
            b.box(0, 2.18, 0.16, 0.37, 0.2, 0.02, 0x1b1b22);
            b.torus(0, 1.94, 0, 0.14, 0.035, 0xc0c7d2, 4, 12, 0, 'z');
            b.ball(0.15, 2.44, 0, 0.08, 0xff8a1f, 1, 1);
          } else {
            b.ball(0, 0, 0, 1.1, 0x2a2d3a, 2);
            b.torus(0, 0, 0, 1.12, 0.1, 0xffd23f, 3, 20, 0.6, 'y');
            b.cyl(0, 1.2, 0, 0.25, 0.4, 0x9aa4b8, 6);
          }
        });
        const beam = geo(`sweeperBeam:${biome.id}`, (b) => {
          b.box(0, 0, 0, 1.2, 1.2, 1, 0x3b4252);
          b.box(0, 0.7, 0, 1.4, 0.3, 1.2, 0xffd23f);
        });
        const cable = geo('cable', (b) => b.box(0, -0.5, 0, 0.08, 1, 0.08, 0x1c1f2b));
        const m = new Mesh(obj, voxel);
        const loadScale = r / 1.3;
        m.scale.setScalar(loadScale);
        // hook top (model 2.4 above the load centre for the container; the ball's cap at 1.4)
        const hookTop = (harbor ? 2.4 : 1.4) * loadScale;
        const top = new Mesh(beam, voxel);
        const c = new Mesh(cable, voxel);
        const sh = new Mesh(plane, shadowMat);
        group.add(m, top, c, sh);
        const pivotH = 12;
        const c0 = pointAtS(track, h.s);
        const px = c0.x - c0.ty * h.d;
        const py = c0.y + c0.tx * h.d;
        const pz = c0.z + pivotH;
        top.position.set(px, pz, -py);
        top.rotation.y = Math.atan2(c0.ty, c0.tx);
        m.rotation.order = 'YXZ';
        m.rotation.y = Math.atan2(c0.ty, c0.tx);
        c.position.set(px, pz, -py);
        // a proper gantry: legs outside the road edges, a girder across at pivot height
        const reach = Math.max(c0.hwL, c0.hwR) + track.shoulder + 3.2;
        const gantry = geo(`gantry:${biome.id}:${Math.round(reach * 2)}:${pivotH}`, (b) => {
          const col = biome.id === 'harbor' ? 0xf2a900 : 0x6b7280;
          for (const z of [-reach, reach]) {
            b.box(0, pivotH / 2, z, 0.9, pivotH + 1.2, 0.9, col);
            b.box(0, 0.25, z, 1.8, 0.5, 1.8, 0x2a2d3a);
            for (let y = 2; y < pivotH; y += 2.4) b.boxR(0, y, z, 0.12, 2.6, 0.12, 'x', 0.7, shadeInt(col, -0.25));
          }
          b.box(0, pivotH + 0.9, 0, 1.2, 1.1, reach * 2 + 1, col);
          b.box(0, pivotH + 0.9, 0, 1.24, 0.25, reach * 2 + 1.1, 0x1c1f2b);
          b.box(0, pivotH + 1.6, reach - 1.5, 2.2, 1.6, 2.2, 0xe8364f);
        });
        const g = new Mesh(gantry, voxel);
        const cx0 = c0.x;
        const cy0 = c0.y;
        g.position.set(cx0, c0.z, -cy0);
        g.rotation.y = Math.atan2(c0.ty, c0.tx);
        group.add(g);
        const dir = new Vector3();
        const down = new Vector3(0, -1, 0);
        view = {
          group,
          kind: h.kind,
          radius: r,
          landed: false,
          update(tick) {
            const p = hazardPose(track, h.index, tick);
            // hang the load so its bottom clears the road by ~0.3 u (it hits karts' bodies, not the ground)
            const cy = p.z + 1.0 * loadScale + 0.3;
            m.position.set(p.x, cy, -p.y);
            // swing tilt: lean the load a little with the swing's lateral speed
            m.rotation.x = Math.sin(p.phase * Math.PI * 2 + Math.PI / 2) * 0.12;
            dir.set(p.x - px, cy + hookTop - pz, -p.y + py);
            const len = dir.length();
            c.quaternion.setFromUnitVectors(down, dir.multiplyScalar(1 / Math.max(1e-4, len)));
            c.scale.set(1, len, 1);
            sh.position.set(p.x, c0.z + 0.06, -p.y);
            sh.scale.set(r * 2.6, 1, r * 2.6);
            return p;
          },
        };
        break;
      }
      case 'roller': {
        const snow = biome.id === 'snow';
        const g = geo(`roller:${biome.id}`, (b) => {
          if (snow) {
            b.ball(0, 0, 0, 1, 0xf5f9ff, 2);
            b.ball(0.3, 0.4, 0.5, 0.4, 0xdfe9f5, 1);
            b.ball(-0.5, -0.2, 0.4, 0.35, 0xe6effa, 1);
          } else {
            b.cyl(0, 0, 0, 1, 1.6, 0xb45309, 12, 'z');
            b.cyl(0, 0, 0, 1.03, 0.14, 0x3b4252, 12, 'z');
            b.box(0, 0, 0.81, 0.8, 0.8, 0.02, 0xffd23f, 0.3);
          }
        });
        const m = new Mesh(g, voxel);
        m.scale.setScalar(r);
        const sh = new Mesh(plane, shadowMat);
        group.add(m, sh);
        let lastS = base.s;
        let roll = 0;
        view = {
          group,
          kind: h.kind,
          radius: r,
          landed: false,
          update(tick, _t, _rm) {
            const p = hazardPose(track, h.index, tick);
            let ds = lastS - p.s;
            if (Math.abs(ds) > 50) ds = 0;
            lastS = p.s;
            roll += ds / r;
            m.position.set(p.x, p.z, -p.y);
            m.rotation.set(0, p.heading, 0);
            m.rotateZ(roll);
            m.visible = p.active || Math.floor(tick / 4) % 2 === 0;
            sh.position.set(p.x, p.z - r + 0.06, -p.y);
            sh.scale.set(r * 2.4, 1, r * 2.4);
            return p;
          },
        };
        break;
      }
      case 'laser': {
        const post = geo(`laserPost:${biome.id}`, (b) => {
          b.box(0, 1.4, 0, 0.7, 2.8, 0.7, 0x10172e);
          b.box(0, 1.4, 0, 0.74, 2.2, 0.2, 0xff2e5b, 0.7);
          b.box(0, 2.95, 0, 0.9, 0.3, 0.9, 0x22d3ee, 0.8);
          b.box(0, 0.1, 0, 1.2, 0.2, 1.2, 0x2a2d3a);
        });
        const hw = Math.max(1, r);
        const beamMat = new MeshBasicMaterial({ color: 0xff2e5b, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
        mats.push(beamMat);
        const beamGeo = geo('laserBeam', (b) => {
          for (let k = 0; k < 3; k++) b.box(0, 0.45 + k * 0.7, 0, 0.12, 0.12, 1, 0xffffff);
        });
        const beam = new Mesh(beamGeo, beamMat);
        const a = new Mesh(post, voxel);
        const b2 = new Mesh(post, voxel);
        group.add(a, b2, beam);
        toThree(base, group);
        group.rotation.y = base.heading;
        a.position.set(0, 0, -(hw + 0.4));
        b2.position.set(0, 0, hw + 0.4);
        beam.scale.set(1, 1, hw * 2 + 0.8);
        view = {
          group,
          kind: h.kind,
          radius: r,
          landed: false,
          update(tick, _t, rm) {
            const p = hazardPose(track, h.index, tick);
            if (p.active) {
              beamMat.opacity = rm ? 0.9 : 0.75 + 0.25 * Math.sin(tick * 1.3);
              beam.scale.x = 1.6;
            } else {
              const warn = p.phase > 0.85;
              beamMat.opacity = warn ? (Math.floor(tick / 5) % 2 ? 0.45 : 0.08) : 0.06;
              beam.scale.x = 0.5;
            }
            return p;
          },
        };
        break;
      }
    }
    view.kind = h.kind;
    view.radius = r;
    views.push(view);
  }
  return {
    views,
    dispose() {
      for (const m of mats) m.dispose();
      plane.dispose();
    },
  };
}

export function clearHazardCache(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}
