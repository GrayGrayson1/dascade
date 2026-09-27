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
import { hazardPose, pointAtS, type HazardPose, type KartTrack } from '@dascade/game-core/kart';
import { MeshBuilder } from '../art/builder.ts';
import { shadeInt } from '../art/palette.ts';
import type { BiomeStyle } from './biomes.ts';

export interface HazardView {
  group: Group;
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
            b.box(0, 0, 0, 2.6, 2.2, 2.2, 0x2563eb);
            for (let k = -2; k <= 2; k++) b.box(k * 0.5, 0, 1.11, 0.1, 2, 0.04, 0x1e40af);
            b.box(0, 1.2, 0, 2.7, 0.2, 2.3, 0xffd23f);
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
        m.scale.setScalar(r / 1.3);
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
          landed: false,
          update(tick) {
            const p = hazardPose(track, h.index, tick);
            m.position.set(p.x, p.z + 1.4, -p.y);
            dir.set(p.x - px, p.z + 2.4 - pz, -p.y + py);
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
