/**
 * Kart visuals: one merged body (chassis + driver torso) and a head per kart, a merged LOD for far
 * karts, and shared InstancedMeshes for every kart's wheels, blob shadows, exhaust flames, shield
 * bubbles and dizzy stars. Character animation: lean into turns, head turns with the steering and
 * looks back when aiming back, hop, drift angle, landing squash, idle engine shake, dizzy spin with
 * orbiting stars when hit, and a celebration bounce after finishing.
 *
 * Per-frame work is allocation-free (temps are reused).
 */
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Material,
  type MeshLambertMaterial,
  type Texture,
} from 'three';
import { MeshBuilder } from '../art/builder.ts';
import { itemModel, modelForItem, type ItemModelId } from '../art/items.ts';
import { WHEEL_WIDTH_SCALE, buildKartArt, buildWheelGeometry, type KartArt } from '../art/karts.ts';
import { DRIFT_STAGE_COLORS, ITEM_COLORS, RACER_ART, hexToInt } from '../art/palette.ts';
import { nameTagTexture } from './textures.ts';
import { KF, type KartEntityPose, type KartPose, type KartRosterEntry } from './types.ts';

export const MAX_KARTS = 31; // 30 grid slots + a ghost

interface KartVis {
  entry: KartRosterEntry;
  art: KartArt;
  root: Group;
  body: Group;
  bodyMesh: Mesh;
  headMesh: Mesh;
  lodMesh: Mesh;
  tag: Sprite;
  tagTex: Texture;
  hub: Color;
  wheelSpin: number;
  pitch: number;
  roll: number;
  headYaw: number;
  px: number;
  py: number;
  pz: number;
  prevValid: boolean;
  hopT: number;
  spinA: number;
  spinning: boolean;
  squash: number;
  groundZ: number;
  prevFlags: number;
  prevStage: number;
  celebrateT: number;
  dizzyT: number;
  /** Flame tint (stage colour after a mini-turbo, fades back to orange). */
  flame: Color;
  flameT: number;
  tagA: number;
  lod: boolean;
  visible: boolean;
  dist: number;
  ghost: boolean;
}

/** Events the kart layer detects from pose changes (fed to fx by the renderer). */
export interface KartVisEvents {
  stageUp(slot: number, stage: number, x: number, y: number, z: number): void;
  miniTurbo(slot: number, stage: number, x: number, y: number, z: number): void;
  landed(slot: number, x: number, y: number, z: number, hard: boolean): void;
  hop(slot: number): void;
}

const tmpM = new Matrix4();
const tmpM2 = new Matrix4();
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpS = new Vector3();
const tmpE = new Vector3();
const tmpC = new Color();
const Y = new Vector3(0, 1, 0);
const UP = Y;

const ITEM_MODELS: ItemModelId[] = ['turbo', 'puck', 'seeker', 'mine', 'fizz', 'magnet', 'warp', 'pulse'];

export class KartLayer {
  readonly group = new Group();
  private karts = new Map<number, KartVis>();
  private ghostVis: KartVis | null = null;
  private wheels: InstancedMesh;
  private shadows: InstancedMesh;
  private flames: InstancedMesh;
  private bubbles: InstancedMesh;
  private stars: InstancedMesh;
  private exhaustGlow: InstancedMesh;
  private tether: InstancedMesh;
  private tetherMat: ShaderMaterial;
  private contact: InstancedMesh;
  private items = new Map<ItemModelId, InstancedMesh>();
  private itemCounts = new Map<ItemModelId, number>();
  private bubbleMat: ShaderMaterial;
  private geos: BufferGeometry[] = [];
  private mats: Material[] = [];
  private order: KartVis[] = [];
  private tagRects: number[] = [];
  lodDistance = 60;
  cullDistance = 320;
  maxTags = 6;
  /** Karts closer to the camera than this fade out so they never block the view of your kart. */
  nearFade = 3.4;
  reducedMotion = false;

  constructor(
    private readonly kartMat: MeshLambertMaterial,
    private readonly ghostMat: MeshLambertMaterial,
    dot: Texture,
    contactTex: Texture,
  ) {
    const wheel = buildWheelGeometry();
    this.wheels = new InstancedMesh(wheel, kartMat, MAX_KARTS * 4);
    this.wheels.instanceMatrix.setUsage(DynamicDrawUsage);
    this.wheels.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_KARTS * 4 * 3).fill(1), 3);
    this.wheels.frustumCulled = false;
    this.wheels.count = 0;

    const sg = new PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.geos.push(sg);
    const sm = new MeshBasicMaterial({ map: dot, color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.mats.push(sm);
    this.shadows = new InstancedMesh(sg, sm, MAX_KARTS + 64);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 6;

    const fb = new MeshBuilder();
    // outer flame (tinted per instance) + hot white core, pointing backwards (−X)
    fb.cone(0, 0, 0, 0.42, 1, 0xffffff, 10, 'x', 1, true);
    fb.cone(0.12, 0, 0, 0.2, 0.62, 0xffffff, 8, 'x', 1, true);
    const fg = fb.build();
    fg.translate(-0.5, 0, 0);
    this.geos.push(fg);
    const fm = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.75 });
    this.mats.push(fm);
    this.flames = new InstancedMesh(fg, fm, MAX_KARTS * 2);
    this.flames.instanceMatrix.setUsage(DynamicDrawUsage);
    this.flames.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_KARTS * 2 * 3), 3);
    this.flames.frustumCulled = false;
    this.flames.count = 0;
    this.flames.renderOrder = 19;

    const bg = new SphereGeometry(1, 20, 14);
    this.geos.push(bg);
    this.bubbleMat = new ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: new Color(0x7cd8ff) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vV = normalize(-mv.xyz); vP = position;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time; uniform vec3 color; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
          float hex = 0.5 + 0.5 * sin(vP.y * 18.0 + time * 3.0) * sin(vP.x * 14.0 - time * 2.0);
          float a = f * 0.9 + 0.08 + hex * 0.06;
          gl_FragColor = vec4(color * (0.6 + f), a);
          #include <colorspace_fragment>
        }`,
    });
    this.mats.push(this.bubbleMat);
    this.bubbles = new InstancedMesh(bg, this.bubbleMat, MAX_KARTS);
    this.bubbles.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bubbles.frustumCulled = false;
    this.bubbles.count = 0;
    this.bubbles.renderOrder = 18;

    const stb = new MeshBuilder();
    stb.octa(0, 0, 0, 0.09, 0xffe14a, 1, 1);
    stb.push().rotate('z', Math.PI / 4);
    stb.octa(0, 0, 0, 0.065, 0xffffff, 1, 1);
    stb.pop();
    const stg = stb.build();
    this.geos.push(stg);
    this.stars = new InstancedMesh(stg, kartMat, MAX_KARTS * 4);
    this.stars.instanceMatrix.setUsage(DynamicDrawUsage);
    this.stars.frustumCulled = false;
    this.stars.count = 0;

    // exhaust tips: unlit discs whose colour tracks idle / drift stage / boost
    const eg = new MeshBuilder();
    eg.cyl(0, 0, 0, 1, 0.2, 0xffffff, 12, 'x');
    const egg = eg.build();
    this.geos.push(egg);
    const egm = new MeshBasicMaterial({ color: 0xffffff });
    this.mats.push(egm);
    this.exhaustGlow = new InstancedMesh(egg, egm, MAX_KARTS * 2);
    this.exhaustGlow.instanceMatrix.setUsage(DynamicDrawUsage);
    this.exhaustGlow.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_KARTS * 2 * 3), 3);
    this.exhaustGlow.frustumCulled = false;
    this.exhaustGlow.count = 0;
    // magnet tether: a pulsing energy beam (unit cylinder along +Y, stretched between karts)
    const tg = new CylinderGeometry(1, 1, 1, 10, 1, true);
    tg.translate(0, 0.5, 0);
    this.geos.push(tg);
    this.tetherMat = new ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: new Color(ITEM_COLORS.magnet.glow) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time; uniform vec3 color; varying vec2 vUv;
        void main() {
          float flow = 0.5 + 0.5 * sin((vUv.y * 18.0 - time * 14.0));
          float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float fadeEnds = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
          gl_FragColor = vec4(color * (0.5 + flow * 0.9), (0.25 + 0.45 * flow) * fadeEnds);
          #include <colorspace_fragment>
        }`,
    });
    this.mats.push(this.tetherMat);
    this.tether = new InstancedMesh(tg, this.tetherMat, MAX_KARTS);
    this.tether.instanceMatrix.setUsage(DynamicDrawUsage);
    this.tether.frustumCulled = false;
    this.tether.count = 0;
    this.tether.renderOrder = 23;

    // crisp contact shadow (rounded rectangle under the chassis)
    const cm = new MeshBasicMaterial({ map: contactTex, color: 0x000000, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
    this.mats.push(cm);
    this.contact = new InstancedMesh(sg, cm, MAX_KARTS);
    this.contact.instanceMatrix.setUsage(DynamicDrawUsage);
    this.contact.frustumCulled = false;
    this.contact.count = 0;
    this.contact.renderOrder = 7;

    for (const id of ITEM_MODELS) {
      const im = new InstancedMesh(itemModel(id), kartMat, 64);
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      this.items.set(id, im);
      this.group.add(im);
    }
    this.group.add(this.wheels, this.shadows, this.contact, this.flames, this.bubbles, this.stars, this.exhaustGlow, this.tether);
  }

  private makeVis(e: KartRosterEntry): KartVis {
    const art = buildKartArt(e.racer, e.body, e.paint);
    const root = new Group();
    const body = new Group();
    root.add(body);
    const bodyMesh = new Mesh(art.body, this.kartMat);
    const headMesh = new Mesh(art.head, this.kartMat);
    headMesh.position.set(art.spec.head[0], art.spec.head[1], art.spec.head[2]);
    const lodMesh = new Mesh(art.lod, this.kartMat);
    lodMesh.visible = false;
    body.add(bodyMesh, headMesh, lodMesh);
    const { tex } = nameTagTexture(e.name, hexToInt(e.paint));
    const sm = new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false });
    const tag = new Sprite(sm);
    tag.scale.set(0.15, 0.0375, 1);
    tag.center.set(0.5, 0);
    tag.position.set(0, art.spec.top + 0.35, 0);
    tag.renderOrder = 30;
    tag.visible = false;
    root.add(tag);
    root.visible = false;
    this.group.add(root);
    return {
      entry: e,
      art,
      root,
      body,
      bodyMesh,
      headMesh,
      lodMesh,
      tag,
      tagTex: tex,
      hub: new Color(RACER_ART[e.racer].trim),
      wheelSpin: 0,
      pitch: 0,
      roll: 0,
      headYaw: 0,
      px: 0,
      py: 0,
      pz: 0,
      prevValid: false,
      hopT: 1,
      spinA: 0,
      spinning: false,
      squash: 0,
      groundZ: 0,
      prevFlags: 0,
      prevStage: 0,
      celebrateT: -1,
      dizzyT: 0,
      flame: new Color(0xffa040),
      flameT: 0,
      tagA: 0,
      lod: false,
      visible: false,
      dist: 0,
      ghost: false,
    };
  }

  private dropVis(v: KartVis): void {
    this.group.remove(v.root);
    (v.tag.material as SpriteMaterial).dispose();
    v.tagTex.dispose();
  }

  setRoster(entries: readonly KartRosterEntry[]): void {
    const keep = new Set<number>();
    for (const e of entries) {
      keep.add(e.slot);
      const cur = this.karts.get(e.slot);
      if (cur && cur.entry.racer === e.racer && cur.entry.body === e.body && cur.entry.paint.toLowerCase() === e.paint.toLowerCase() && cur.entry.name === e.name) {
        cur.entry = e;
        continue;
      }
      if (cur) this.dropVis(cur);
      this.karts.set(e.slot, this.makeVis(e));
    }
    for (const [slot, v] of this.karts) {
      if (!keep.has(slot)) {
        this.dropVis(v);
        this.karts.delete(slot);
      }
    }
    this.order = [...this.karts.values()];
  }

  /** Ghost (time trial) look: set once; pose passed per frame. */
  setGhost(look: { racer: KartRosterEntry['racer']; body: KartRosterEntry['body']; paint: string } | null): void {
    if (this.ghostVis) {
      this.dropVis(this.ghostVis);
      this.ghostVis = null;
    }
    if (!look) return;
    const v = this.makeVis({ slot: -1, racer: look.racer, body: look.body, paint: look.paint, name: 'Ghost', local: false });
    v.ghost = true;
    v.bodyMesh.material = this.ghostMat;
    v.headMesh.material = this.ghostMat;
    v.lodMesh.material = this.ghostMat;
    this.ghostVis = v;
  }

  getVis(slot: number): { root: Object3D; spec: KartArt['spec'] } | null {
    const v = this.karts.get(slot);
    return v ? { root: v.root, spec: v.art.spec } : null;
  }

  /**
   * Update every kart from its pose. Returns nothing; emits pose-derived events.
   * `groundAt(x, y)` is only called for airborne karts' shadows (cheap path otherwise).
   */
  update(poses: readonly KartPose[], ghost: KartPose | null | undefined, dt: number, t: number, camera: Camera, targetSlot: number, ev: KartVisEvents): void {
    let wi = 0;
    let si = 0;
    let fi = 0;
    let bi = 0;
    let st = 0;
    let gi = 0;
    let ci = 0;
    const camPos = camera.position;
    for (const v of this.order) v.visible = false;
    for (let k = 0; k < poses.length; k++) {
      const p = poses[k]!;
      const v = this.karts.get(p.slot);
      if (!v) continue;
      if (!p.active) continue;
      const r = this.poseKart(v, p, dt, t, camPos, p.slot === targetSlot, ev);
      if (!r) continue;
      wi = this.writeWheels(v, p, wi);
      si = this.writeShadow(v, p, si);
      fi = this.writeFlames(v, p, fi, t);
      gi = this.writeExhaustGlow(v, p, gi, t);
      if (!v.lod && v.body.visible) ci = this.writeContact(v, p, ci);
      const nearCam = v.dist < this.nearFade && p.slot !== targetSlot;
      if (p.flags & KF.shield && !nearCam) bi = this.writeBubble(v, p, bi, t);
      if ((v.dizzyT > 0 || p.flags & KF.spinning) && !nearCam && !v.lod) st = this.writeStars(v, st, t);
      this.writeHeld(v, p, t);
    }
    if (ghost && this.ghostVis) {
      const v = this.ghostVis;
      if (this.poseKart(v, ghost, dt, t, camPos, false, NOOP_EVENTS)) {
        wi = this.writeWheels(v, ghost, wi);
      }
    } else if (this.ghostVis) this.ghostVis.root.visible = false;
    for (const v of this.order) if (!v.visible) v.root.visible = false;
    let ti = 0;
    for (let k = 0; k < poses.length; k++) {
      const p = poses[k]!;
      if (!p.active || !(p.flags & KF.magnet)) continue;
      const v = this.karts.get(p.slot);
      if (!v || !v.visible) continue;
      // a tether from a kart right behind the camera would sweep across the lens
      if (p.slot !== targetSlot && v.dist < 9) continue;
      const tgt = this.tetherTarget(p, poses);
      if (!tgt) continue;
      ti = this.writeTether(p, tgt, ti);
    }
    this.tether.count = ti;
    this.tether.instanceMatrix.needsUpdate = true;
    this.tetherMat.uniforms.time!.value = t;
    this.wheels.count = wi;
    this.wheels.instanceMatrix.needsUpdate = true;
    if (this.wheels.instanceColor) this.wheels.instanceColor.needsUpdate = true;
    this.shadows.count = si;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.flames.count = fi;
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
    this.exhaustGlow.count = gi;
    this.exhaustGlow.instanceMatrix.needsUpdate = true;
    if (this.exhaustGlow.instanceColor) this.exhaustGlow.instanceColor.needsUpdate = true;
    this.contact.count = ci;
    this.contact.instanceMatrix.needsUpdate = true;
    this.bubbles.count = bi;
    this.bubbles.instanceMatrix.needsUpdate = true;
    this.bubbleMat.uniforms.time!.value = t;
    this.stars.count = st;
    this.stars.instanceMatrix.needsUpdate = true;
    this.updateTags(targetSlot, camera, dt);
  }

  /** Entities (projectiles/traps) + held items are drawn through the item instancers. */
  beginItems(): void {
    for (const id of ITEM_MODELS) this.itemCounts.set(id, 0);
  }

  pushItem(id: ItemModelId, x: number, y: number, z: number, yaw: number, scale: number): void {
    const im = this.items.get(id);
    if (!im) return;
    const n = this.itemCounts.get(id) ?? 0;
    if (n >= im.instanceMatrix.count) return;
    tmpV.set(x, y, z);
    tmpQ.setFromAxisAngle(Y, yaw);
    tmpS.set(scale, scale, scale);
    im.setMatrixAt(n, tmpM.compose(tmpV, tmpQ, tmpS));
    this.itemCounts.set(id, n + 1);
  }

  endItems(): void {
    for (const id of ITEM_MODELS) {
      const im = this.items.get(id)!;
      im.count = this.itemCounts.get(id) ?? 0;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  drawEntities(ents: readonly KartEntityPose[], t: number): void {
    for (const e of ents) {
      const x = e.x;
      const y = e.z;
      const z = -e.y;
      const pop = Math.min(1, e.age * 6);
      switch (e.kind) {
        case 'puck':
          this.pushItem('puck', x, y + 0.35, z, t * 9, 1.1 * pop);
          this.pushShadowAt(x, e.z, -e.y, 1.1);
          break;
        case 'seeker':
          this.pushItem('seeker', x, y + 1.3 + Math.sin(t * 8) * 0.1, z, e.heading, 1.6 * pop);
          this.pushShadowAt(x, e.z, -e.y, 1.4);
          break;
        case 'mine':
          this.pushItem('mine', x, y + 0.45 + Math.sin(t * 5 + e.id) * 0.05, z, t * 1.5, 1.3 * pop);
          this.pushShadowAt(x, e.z, -e.y, 1.0);
          break;
        case 'fizz':
          this.pushItem('fizz', x, y + 0.02, z, e.id * 1.7, 2.6 * pop);
          break;
        case 'turbo':
          this.pushItem('turbo', x, y + 0.6, z, e.heading, 1.2);
          break;
        default:
          break;
      }
    }
  }

  private pushShadowAt(x: number, y: number, z: number, s: number): void {
    const n = this.shadows.count;
    if (n >= MAX_KARTS + 64) return;
    tmpV.set(x, y + 0.03, z);
    tmpS.set(s, 1, s);
    this.shadows.setMatrixAt(n, tmpM.compose(tmpV, tmpQ.identity(), tmpS));
    this.shadows.count = n + 1;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  private poseKart(v: KartVis, p: KartPose, dt: number, t: number, cam: Vector3, isTarget: boolean, ev: KartVisEvents): boolean {
    const x3 = p.x;
    const y3 = p.z;
    const z3 = -p.y;
    const dx = x3 - cam.x;
    const dy = y3 - cam.y;
    const dz = z3 - cam.z;
    v.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (v.dist > this.cullDistance && !isTarget) {
      v.root.visible = false;
      v.prevValid = false;
      return false;
    }
    v.visible = true;
    v.root.visible = true;
    const f = p.flags;
    const air = (f & KF.airborne) !== 0;
    const rm = this.reducedMotion;
    // --- derived motion -------------------------------------------------------------------------
    let pitchTarget = 0;
    if (v.prevValid && dt > 0) {
      const mx = p.x - v.px;
      const my = p.y - v.py;
      const horiz = Math.sqrt(mx * mx + my * my);
      const vz = (p.z - v.pz) / dt;
      if (air) pitchTarget = Math.max(-0.45, Math.min(0.35, vz * 0.03));
      else if (horiz > 0.02) pitchTarget = Math.max(-0.4, Math.min(0.4, (p.z - v.pz) / horiz));
    }
    const wasAir = (v.prevFlags & KF.airborne) !== 0;
    if (wasAir && !air && v.prevValid) {
      v.squash = 1;
      ev.landed(p.slot, p.x, p.y, p.z, true);
    }
    if (!air) v.groundZ = p.z;
    v.px = p.x;
    v.py = p.y;
    v.pz = p.z;
    v.prevValid = true;
    const k = 1 - Math.exp(-dt * 10);
    v.pitch += (pitchTarget - v.pitch) * k;
    const spd = Math.abs(p.speed);
    const sf = Math.min(1, spd / 22);
    const drifting = (f & KF.drifting) !== 0;
    const dDir = f & KF.driftLeft ? 1 : -1;
    const rollTarget = p.steer * sf * 0.07 + (drifting ? dDir * 0.09 : 0);
    v.roll += (rollTarget - v.roll) * k;
    // hop
    if (f & KF.hop && !(v.prevFlags & KF.hop)) {
      v.hopT = 0;
      ev.hop(p.slot);
    }
    v.hopT = Math.min(1, v.hopT + dt / 0.28);
    // stage up / mini-turbo
    if (drifting && p.driftStage > v.prevStage && p.driftStage > 0) ev.stageUp(p.slot, p.driftStage, p.x, p.y, p.z);
    if (!drifting && v.prevFlags & KF.drifting && v.prevStage > 0 && f & KF.boosting) {
      ev.miniTurbo(p.slot, v.prevStage, p.x, p.y, p.z);
      v.flame.setHex(DRIFT_STAGE_COLORS[v.prevStage] ?? 0xffa040);
      v.flameT = 1.2;
    }
    if (v.flameT > 0) {
      v.flameT -= dt;
      if (v.flameT <= 0) v.flame.setHex(0xffa040);
    }
    v.prevStage = drifting ? p.driftStage : 0;
    // spin-out
    if (f & KF.spinning) {
      v.spinning = true;
      v.spinA += dt * (rm ? 6 : 14);
      v.dizzyT = 1.2;
    } else if (v.spinning) {
      // unwind to the nearest full turn
      const tgt = Math.round(v.spinA / (Math.PI * 2)) * Math.PI * 2;
      v.spinA += (tgt - v.spinA) * Math.min(1, dt * 10);
      if (Math.abs(tgt - v.spinA) < 0.01) {
        v.spinA = 0;
        v.spinning = false;
      }
    }
    v.dizzyT = Math.max(0, v.dizzyT - dt);
    // celebrate
    if (f & KF.finished && !(v.prevFlags & KF.finished)) v.celebrateT = 0;
    if (v.celebrateT >= 0) v.celebrateT += dt;
    v.squash = Math.max(0, v.squash - dt * 5);
    v.prevFlags = f;

    // --- transforms -------------------------------------------------------------------------------
    v.root.position.set(x3, y3, z3);
    v.root.rotation.set(0, p.heading, 0);
    const hopY = v.hopT < 1 ? Math.sin(v.hopT * Math.PI) * 0.4 : 0;
    const idle = !rm && spd < 0.5 && !(f & KF.finished) ? Math.sin(t * 42 + p.slot) * 0.012 : 0;
    const cel = v.celebrateT >= 0 && v.celebrateT < 6 && !rm ? Math.abs(Math.sin(v.celebrateT * 5)) * 0.35 * Math.max(0, 1 - v.celebrateT / 6) : 0;
    // suspension: road buzz at speed + a softer heave; rolls a touch on the steering
    const bob = rm ? 0 : Math.sin(t * 23 + p.slot * 1.7) * 0.012 * sf + Math.sin(t * 7.1 + p.slot) * 0.018 * sf;
    v.body.position.set(0, hopY + idle + cel + bob, 0);
    v.body.rotation.set(v.roll, (drifting ? dDir * 0.16 : 0) + v.spinA, v.pitch, 'YXZ');
    const sq = v.squash;
    v.body.scale.set(1 + sq * 0.08, 1 - sq * 0.14, 1 + sq * 0.08);
    // head: turn with steering, look back when aiming back, lean into the turn, dizzy wobble, celebrate spin
    let hy = p.steer * 0.35;
    if (f & KF.aimBack) hy = 2.5 * (p.steer >= 0 ? 1 : -1);
    if (v.celebrateT >= 0 && v.celebrateT < 1.2 && !rm) hy = v.celebrateT * Math.PI * 2 * 1.2;
    v.headYaw += (hy - v.headYaw) * Math.min(1, dt * 9);
    const wob = v.dizzyT > 0 && !rm ? Math.sin(t * 16) * 0.25 * v.dizzyT : 0;
    const headBob = !rm ? Math.sin(t * 3 + p.slot) * 0.015 : 0;
    v.headMesh.rotation.set(-p.steer * 0.18 + wob, v.headYaw, wob * 0.5 - v.pitch * 0.3);
    v.headMesh.position.y = v.art.spec.head[1] + headBob;
    // LOD / ghost / blink
    const lod = v.dist > this.lodDistance && !isTarget && !(p.flags & KF.finished && v.dist < 30);
    v.lod = lod;
    v.bodyMesh.visible = !lod;
    v.headMesh.visible = !lod;
    v.lodMesh.visible = lod;
    const ghosty = v.ghost || (f & (KF.ghost | KF.warp)) !== 0 || (!isTarget && v.dist < this.nearFade);
    const m = ghosty ? this.ghostMat : this.kartMat;
    if (v.bodyMesh.material !== m) {
      v.bodyMesh.material = m;
      v.headMesh.material = m;
      v.lodMesh.material = m;
    }
    if ((f & (KF.immune | KF.respawning)) !== 0 && !rm && !ghosty) v.body.visible = Math.floor(t * 14) % 2 === 0;
    else v.body.visible = true;
    // wheel spin
    v.wheelSpin += (p.speed * dt) / 0.28 + (f & KF.drifting ? dt * 4 : 0);
    v.root.updateMatrixWorld(true);
    return true;
  }

  private writeWheels(v: KartVis, p: KartPose, wi: number): number {
    if (v.lod || !v.body.visible) return wi;
    for (const w of v.art.spec.wheels) {
      if (wi >= MAX_KARTS * 4) break;
      tmpV.set(w.x, w.y, w.z);
      tmpQ.setFromAxisAngle(Y, w.front ? p.steer * 0.42 : 0);
      tmpS.set(w.r, w.r, WHEEL_WIDTH_SCALE * (w.front ? 0.9 : 1.1));
      tmpM.compose(tmpV, tmpQ, tmpS);
      tmpM2.makeRotationZ(-v.wheelSpin);
      tmpM.multiply(tmpM2);
      tmpM2.multiplyMatrices(v.body.matrixWorld, tmpM);
      this.wheels.setMatrixAt(wi, tmpM2);
      this.wheels.setColorAt(wi, v.hub);
      wi++;
    }
    return wi;
  }

  private writeShadow(v: KartVis, p: KartPose, si: number): number {
    if (si >= MAX_KARTS + 64) return si;
    const h = Math.max(0, p.z - v.groundZ);
    const s = 2.9 / (1 + h * 0.12);
    tmpV.set(p.x, v.groundZ + 0.04, -p.y);
    tmpQ.setFromAxisAngle(Y, p.heading);
    tmpS.set(s * 1.2, 1, s * 0.9);
    this.shadows.setMatrixAt(si, tmpM.compose(tmpV, tmpQ, tmpS));
    return si + 1;
  }

  private writeFlames(v: KartVis, p: KartPose, fi: number, t: number): number {
    const f = p.flags;
    const boosting = (f & KF.boosting) !== 0;
    if (!boosting || v.lod) return fi;
    const flick = this.reducedMotion ? 1 : 0.8 + 0.35 * Math.sin(t * 60 + p.slot * 3) * Math.sin(t * 37);
    for (const e of v.art.spec.exhausts) {
      if (fi >= MAX_KARTS * 2) break;
      tmpV.set(e[0], e[1], e[2]);
      tmpS.set(1.25 * flick, 0.5, 0.5);
      tmpM.compose(tmpV, tmpQ.identity(), tmpS);
      tmpM2.multiplyMatrices(v.body.matrixWorld, tmpM);
      this.flames.setMatrixAt(fi, tmpM2);
      this.flames.setColorAt(fi, v.flame);
      fi++;
    }
    return fi;
  }

  /** Explicit target, or the nearest kart ahead within 160 u and ±40° of the nose. */
  private tetherTarget(p: KartPose, poses: readonly KartPose[]): KartPose | null {
    if (p.magnetTarget !== undefined && p.magnetTarget >= 0) {
      for (const q of poses) if (q.slot === p.magnetTarget && q.active) return q;
      return null;
    }
    const fx = Math.cos(p.heading);
    const fy = Math.sin(p.heading);
    let best: KartPose | null = null;
    let bestD = 160;
    for (const q of poses) {
      if (!q.active || q.slot === p.slot) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1 || d > bestD) continue;
      if ((dx * fx + dy * fy) / d < 0.766) continue;
      best = q;
      bestD = d;
    }
    return best;
  }

  private writeTether(p: KartPose, q: KartPose, ti: number): number {
    if (ti >= MAX_KARTS) return ti;
    // from the magnet above the tugging kart to the target's roll bar
    tmpV.set(p.x, p.z + 1.75, -p.y);
    tmpE.set(q.x, q.z + 0.9, -q.y);
    const len = tmpV.distanceTo(tmpE);
    tmpE.sub(tmpV).normalize();
    tmpQ.setFromUnitVectors(UP, tmpE);
    const w = this.reducedMotion ? 0.08 : 0.07 + 0.02 * Math.sin(len + p.slot);
    tmpS.set(w, len, w);
    this.tether.setMatrixAt(ti, tmpM.compose(tmpV, tmpQ, tmpS));
    return ti + 1;
  }

  private writeExhaustGlow(v: KartVis, p: KartPose, gi: number, t: number): number {
    if (v.lod || !v.body.visible) return gi;
    const f = p.flags;
    const boosting = (f & KF.boosting) !== 0;
    const drifting = (f & KF.drifting) !== 0 && p.driftStage > 0;
    const rm = this.reducedMotion;
    let size = 1;
    if (boosting) {
      tmpC.copy(v.flame).multiplyScalar(1.6);
      size = 1.25 + (rm ? 0 : 0.15 * Math.sin(t * 50 + p.slot));
    } else if (drifting) {
      const pulse = rm ? 1 : 0.55 + 0.45 * Math.sin(t * (8 + p.driftStage * 4));
      tmpC.setHex(DRIFT_STAGE_COLORS[p.driftStage] ?? 0xffffff).multiplyScalar(0.5 + pulse * 0.9);
      size = 1 + pulse * 0.12 * p.driftStage;
    } else {
      // idle / cruising: a warm ember that brightens with speed
      const k = Math.min(1, Math.abs(p.speed) / 25);
      tmpC.setRGB(0.35 + k * 0.4, 0.09 + k * 0.12, 0.02);
    }
    for (const e of v.art.spec.exhausts) {
      if (gi >= MAX_KARTS * 2) break;
      tmpV.set(e[0] - 0.005, e[1], e[2]);
      const r = v.entry.body === 'rocket' ? 0.17 : 0.05;
      tmpS.set(1, r * size, r * size);
      tmpM.compose(tmpV, tmpQ.identity(), tmpS);
      tmpM2.multiplyMatrices(v.body.matrixWorld, tmpM);
      this.exhaustGlow.setMatrixAt(gi, tmpM2);
      this.exhaustGlow.setColorAt(gi, tmpC);
      gi++;
    }
    return gi;
  }

  private writeContact(v: KartVis, p: KartPose, ci: number): number {
    if (ci >= MAX_KARTS) return ci;
    const h = Math.max(0, p.z - v.groundZ);
    if (h > 1.2) return ci;
    const s = 1 - h * 0.5;
    tmpV.set(p.x, v.groundZ + 0.045, -p.y);
    tmpQ.setFromAxisAngle(Y, p.heading + v.spinA);
    tmpS.set(2.25 * s, 1, 1.55 * s);
    this.contact.setMatrixAt(ci, tmpM.compose(tmpV, tmpQ, tmpS));
    return ci + 1;
  }

  private writeBubble(v: KartVis, p: KartPose, bi: number, t: number): number {
    if (bi >= MAX_KARTS) return bi;
    const pul = this.reducedMotion ? 1 : 1 + Math.sin(t * 6) * 0.03;
    tmpV.set(p.x, p.z + 0.8, -p.y);
    tmpS.set(1.7 * pul, 1.35 * pul, 1.7 * pul);
    tmpQ.setFromAxisAngle(Y, p.heading);
    this.bubbles.setMatrixAt(bi, tmpM.compose(tmpV, tmpQ, tmpS));
    void v;
    return bi + 1;
  }

  private writeStars(v: KartVis, st: number, t: number): number {
    const hp = v.headMesh.getWorldPosition(tmpE);
    for (let i = 0; i < 4 && st < MAX_KARTS * 4; i++) {
      const a = t * 5 + (i * Math.PI) / 2;
      tmpV.set(hp.x + Math.cos(a) * 0.55, hp.y + 0.72 + Math.sin(a * 2) * 0.05, hp.z + Math.sin(a) * 0.55);
      tmpQ.setFromAxisAngle(Y, t * 8 + i);
      tmpS.set(1, 1, 1);
      this.stars.setMatrixAt(st++, tmpM.compose(tmpV, tmpQ, tmpS));
    }
    return st;
  }

  private writeHeld(v: KartVis, p: KartPose, t: number): void {
    if (v.lod) return;
    if (p.item && p.flags & KF.trailing) {
      const id = modelForItem(p.item);
      const n = Math.max(1, Math.min(3, p.itemCount));
      for (let i = 0; i < n; i++) {
        tmpV.set(v.art.spec.trail[0] - i * 0.9, v.art.spec.trail[1] + (id === 'fizz' ? 0.05 : 0.15), v.art.spec.trail[2]);
        tmpV.applyMatrix4(v.root.matrixWorld);
        this.pushItem(id, tmpV.x, tmpV.y, tmpV.z, p.heading + (id === 'puck' || id === 'mine' ? t * 3 : 0), id === 'fizz' ? 0.9 : 0.62);
      }
    }
    if (p.flags & KF.magnet) {
      tmpV.set(0.1, v.art.spec.top + 0.15, 0).applyMatrix4(v.root.matrixWorld);
      this.pushItem('magnet', tmpV.x, tmpV.y, tmpV.z, p.heading + Math.PI, 0.55);
    }
  }

  /**
   * Name tags: nearest first, at most `maxTags`, only within 60 u. A tag whose screen rectangle
   * overlaps a nearer one fades out; tags fade in/out smoothly instead of popping.
   */
  private updateTags(targetSlot: number, camera: Camera, dt: number): void {
    this.order.sort(byDist);
    let shown = 0;
    this.tagRects.length = 0;
    const k = Math.min(1, dt * 8);
    for (const v of this.order) {
      let want = 0;
      const eligible = v.visible && !v.entry.local && v.entry.slot !== targetSlot && v.dist < 60 && v.dist > 4 && shown < this.maxTags;
      if (eligible) {
        tmpV.set(0, v.art.spec.top + 0.35, 0).applyMatrix4(v.root.matrixWorld).project(camera);
        if (tmpV.z < 1) {
          // sizeAttenuation=false sprites are a fixed screen size: ~0.15 × 0.0375 of the view height
          const hw = 0.075 * 0.65;
          const hh = 0.03;
          const x = tmpV.x;
          const y = tmpV.y;
          let clear = true;
          for (let i = 0; i < this.tagRects.length; i += 2) {
            if (Math.abs(this.tagRects[i]! - x) < hw * 2 && Math.abs(this.tagRects[i + 1]! - y) < hh * 2) {
              clear = false;
              break;
            }
          }
          if (clear) {
            this.tagRects.push(x, y);
            shown++;
            want = Math.max(0, Math.min(1, (60 - v.dist) / 20));
          }
        }
      }
      v.tagA += (want - v.tagA) * k;
      if (v.tagA < 0.02) {
        v.tagA = want === 0 ? 0 : v.tagA;
        v.tag.visible = want > 0;
      } else v.tag.visible = true;
      (v.tag.material as SpriteMaterial).opacity = v.tagA;
    }
  }

  /** World position of a kart's rear (for effects). Writes into `out` (three space). */
  localToWorld(slot: number, lx: number, ly: number, lz: number, out: Vector3): boolean {
    const v = this.karts.get(slot);
    if (!v || !v.visible) return false;
    out.set(lx, ly, lz).applyMatrix4(v.body.matrixWorld);
    return true;
  }

  specOf(slot: number): KartArt['spec'] | null {
    return this.karts.get(slot)?.art.spec ?? null;
  }

  isLod(slot: number): boolean {
    return this.karts.get(slot)?.lod ?? true;
  }

  distOf(slot: number): number {
    return this.karts.get(slot)?.dist ?? Infinity;
  }

  stats(): { karts: number; lod: number } {
    let lod = 0;
    let n = 0;
    for (const v of this.order)
      if (v.visible) {
        n++;
        if (v.lod) lod++;
      }
    return { karts: n, lod };
  }

  dispose(): void {
    for (const v of this.karts.values()) this.dropVis(v);
    this.karts.clear();
    if (this.ghostVis) this.dropVis(this.ghostVis);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.wheels.dispose();
    this.shadows.dispose();
    this.flames.dispose();
    this.bubbles.dispose();
    this.stars.dispose();
    this.exhaustGlow.dispose();
    this.contact.dispose();
    this.tether.dispose();
    for (const im of this.items.values()) im.dispose();
    this.group.clear();
  }
}

const byDist = (a: { dist: number }, b: { dist: number }) => a.dist - b.dist;
const NOOP_EVENTS: KartVisEvents = { stageUp() {}, miniTurbo() {}, landed() {}, hop() {} };
