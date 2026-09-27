/**
 * The static + ambient world of one track: road, shoulders, kerbs, walls, skirts, decals, terrain,
 * water / cloud sea, sky, horizon, props, landmarks, hazards, item cubes, start gantry and the
 * finish arch. Built once per track; `update()` animates the living parts; `applyPalette()`
 * recolours in place on theme change (never rebuilds).
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import type { KartTrack } from '@dascade/game-core/kart';
import { MeshBuilder } from '../art/builder.ts';
import { itemModel } from '../art/items.ts';
import { makeVoxelMaterial } from '../art/materials.ts';
import { shadeInt } from '../art/palette.ts';
import { BIOMES, OFFROAD, type BiomeStyle, type WorldPalette } from './biomes.ts';
import { linRGB } from './geo.ts';
import { buildHazards, type HazardSet } from './hazards.ts';
import { ARCH_KINDS, LANDMARK_FOOTPRINT, buildLandmark, isLandmarkKind, type LandmarkInstance } from './landmarks.ts';
import { buildProps, type PropSet } from './props.ts';
import { addSparkle } from './shaderPatches.ts';
import { RoadIndex, roadPaths, type RoadPath } from './roads.ts';
import { DistanceField, buildHorizon, buildTerrain, groundDetailTextures, hillsFor, makeSkyDome, setSkyColors, terrainHeightFn, type Horizon } from './terrain.ts';
import {
  checkerTexture,
  chevronTexture,
  conveyorTexture,
  dotTexture,
  facadeTextures,
  iceTexture,
  makeRoadTextures,
  mudTexture,
  rampTexture,
  signTexture,
  topperTexture,
  wallTextures,
  type RoadTextures,
} from './textures.ts';
import type { KartBoxState, KartQuality } from './types.ts';
import {
  buildBoostPads,
  buildCurbs,
  buildDropLips,
  buildGridMarks,
  buildRamps,
  buildRoad,
  buildShoulders,
  buildSkirts,
  buildStartLine,
  buildZones,
  pathOfMain,
  pointOn,
  setWorldAo,
  buildWallTopper,
  wallMasks,
  wallThickness,
  buildWalls,
} from './worldGeom.ts';

export interface WorldOptions {
  quality: KartQuality;
  aniso: number;
}

const LIGHT_OFF = 0x2a0a10;
const LIGHT_RED = 0xff2a3a;
const LIGHT_GREEN = 0x2dff7a;

export class KartWorld {
  readonly root = new Group();
  readonly biome: BiomeStyle;
  readonly fog: Fog;
  readonly paths: RoadPath[];
  readonly index: RoadIndex;
  readonly field: DistanceField;
  readonly groundY: number;
  readonly sky: Mesh;
  readonly voxel: MeshLambertMaterial;
  readonly dot: Texture;
  /** Three-space ground height at a track (x, y) — terrain, not road. */
  readonly heightAt: (x: number, y: number) => number;
  private roadTex: RoadTextures;
  private disposables: { dispose(): void }[] = [];
  private horizon: Horizon | null = null;
  private landmarks: LandmarkInstance[] = [];
  private hazards: HazardSet;
  private padTex: Texture;
  private conveyorTex: Texture | null = null;
  private boxShell: InstancedMesh | null = null;
  private boxGlyph: InstancedMesh | null = null;
  private boxScale: Float32Array;
  private boxVisible: Uint8Array;
  private lightsGeo: BufferGeometry | null = null;
  private lightRanges: [number, number][] = [];
  private lastLights = -2;
  private water: Mesh | null = null;
  private tmpM = new Matrix4();
  private tmpQ = new Quaternion();
  private tmpV = new Vector3();
  private tmpS = new Vector3();
  private upV = new Vector3(0, 1, 0);
  private stompLanded: { x: number; y: number; z: number }[] = [];
  props: PropSet;

  constructor(
    readonly track: KartTrack,
    palette: WorldPalette,
    o: WorldOptions,
  ) {
    const biome = BIOMES[track.def.biome] ?? BIOMES.city;
    this.biome = biome;
    this.paths = roadPaths(track);
    this.index = new RoadIndex(this.paths);
    this.groundY = track.bounds.minZ - 0.35;
    this.field = new DistanceField(this.paths, track.bounds, o.quality === 'low' ? 8 : 6, 460, 320);
    this.voxel = makeVoxelMaterial();
    this.dot = dotTexture();
    this.disposables.push(this.voxel, this.dot);
    this.fog = new Fog(palette.fog, biome.fogNear, biome.fogFar);

    const add = (geo: BufferGeometry | null, mat: Material, name: string, order = 0): Mesh | null => {
      if (!geo) return null;
      const m = new Mesh(geo, mat);
      m.name = name;
      m.renderOrder = order;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      this.root.add(m);
      this.disposables.push(geo);
      return m;
    };
    const mat = <T extends Material>(m: T): T => {
      this.disposables.push(m);
      return m;
    };

    setWorldAo(linRGB(biome.aoTint));
    // --- road surfaces --------------------------------------------------------------------------
    this.roadTex = makeRoadTextures(palette, track.def.offroad, o.aniso, biome.id);
    this.disposables.push(this.roadTex);
    const lambertMap = (map: Texture, extra: Partial<ConstructorParameters<typeof MeshLambertMaterial>[0]> = {}) =>
      mat(new MeshLambertMaterial({ map, vertexColors: true, ...extra }));
    add(
      buildRoad(this.paths, 'road'),
      lambertMap(this.roadTex.asphalt, { emissiveMap: this.roadTex.asphaltGlow, emissive: new Color(0xffffff), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      'road',
      1,
    );
    add(buildRoad(this.paths, 'dirt'), lambertMap(this.roadTex.dirt), 'dirt');
    const shoulderMat = lambertMap(this.roadTex.offroad);
    if (track.def.offroad === 'snow') addSparkle(shoulderMat, 0.9, 6);
    add(buildShoulders(this.paths), shoulderMat, 'shoulders');
    add(buildCurbs(this.paths), lambertMap(this.roadTex.curb, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'curbs', 2);

    // --- walls, lips, skirts --------------------------------------------------------------------
    const masks = wallMasks(this.paths, this.index, biome.wall);
    const wt = wallTextures(biome.wall, biome.wallA, biome.wallB);
    this.disposables.push(wt.map, wt.glow);
    const glass = biome.wall === 'glass';
    const wallMat = mat(
      new MeshLambertMaterial({
        map: wt.map,
        emissiveMap: wt.glow,
        emissive: new Color(0xffffff),
        vertexColors: true,
        side: DoubleSide,
        transparent: glass,
        opacity: glass ? 0.55 : 1,
        depthWrite: !glass,
      }),
    );
    const snowy = biome.id === 'snow';
    if (snowy) addSparkle(wallMat, 0.9, 6);
    add(buildWalls(this.paths, masks, biome.wall), wallMat, 'walls');
    const topper = buildWallTopper(this.paths, masks, biome.wall);
    if (topper && (biome.wall === 'snowbank' || biome.wall === 'bumper')) {
      const tt = topperTexture(biome.wall);
      this.disposables.push(tt);
      add(topper, mat(new MeshLambertMaterial({ map: tt, alphaTest: 0.5, side: DoubleSide, vertexColors: true })), 'wallTopper');
    }
    add(buildDropLips(this.paths), mat(new MeshBasicMaterial({ color: biome.glow, vertexColors: true, side: DoubleSide })), 'lips');
    const floating = biome.id === 'sky';
    const embank = biome.slopedSkirts ? shadeInt(OFFROAD[track.def.offroad].base, biome.id === 'snow' ? -0.06 : -0.18) : shadeInt(biome.wallA, -0.25);
    add(
      buildSkirts(this.paths, masks, {
        groundY: this.groundY,
        dropDepth: 30,
        floating,
        sloped: biome.slopedSkirts,
        wall: biome.wall,
        color: linRGB(embank),
        cliff: linRGB(floating ? 0x6f7f9e : shadeInt(biome.ground, -0.4)),
      }),
      mat(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })),
      'skirts',
    );

    // --- decals ---------------------------------------------------------------------------------
    const checker = checkerTexture();
    this.disposables.push(checker);
    add(buildStartLine(track), mat(new MeshLambertMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })), 'startLine', 3);
    add(buildGridMarks(track), mat(new MeshBasicMaterial({ color: 0xf1f5f9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, transparent: true, opacity: 0.8 })), 'gridMarks', 3);
    this.padTex = chevronTexture(0x35e0ff, 0xffffff);
    this.disposables.push(this.padTex);
    add(buildBoostPads(track), mat(new MeshBasicMaterial({ map: this.padTex, transparent: true, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })), 'pads', 3);
    const rampTex = rampTexture();
    this.disposables.push(rampTex);
    add(buildRamps(track), mat(new MeshLambertMaterial({ map: rampTex, vertexColors: true, side: DoubleSide, emissive: 0x332200 })), 'ramps');
    const ice = buildZones(track, 'ice');
    if (ice) {
      const t = iceTexture();
      this.disposables.push(t);
      add(ice, mat(new MeshLambertMaterial({ map: t, transparent: true, opacity: 0.62, emissive: 0x1a3b52, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false })), 'ice', 2);
    }
    const mud = buildZones(track, 'mud');
    if (mud) {
      const t = mudTexture();
      this.disposables.push(t);
      add(mud, mat(new MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), 'mud', 2);
    }
    const conv = buildZones(track, 'conveyor');
    if (conv) {
      this.conveyorTex = conveyorTexture();
      this.disposables.push(this.conveyorTex);
      add(conv, mat(new MeshLambertMaterial({ map: this.conveyorTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), 'conveyor', 2);
    }

    // --- terrain / water / cloud sea ------------------------------------------------------------
    const res = o.quality === 'high' ? 120 : o.quality === 'medium' ? 90 : 60;
    const quay = biome.water ? 70 : undefined;
    const pads = track.landmarks
      .filter((lm) => !(ARCH_KINDS.has(lm.kind) && Math.abs(lm.d) < 1))
      .map((lm) => ({ x: lm.x, y: lm.y, z: lm.z, r: (isLandmarkKind(lm.kind) ? LANDMARK_FOOTPRINT[lm.kind] : 11) * lm.scale }))
      .filter((p) => p.r > 0);
    const terrainOpts = { groundY: this.groundY, dropDepth: 30, hills: hillsFor(biome), extent: 560, res, quay, pads };
    if (!biome.cloudSea) {
      const terrain = buildTerrain(track, this.field, biome, terrainOpts);
      const det = groundDetailTextures(biome);
      this.disposables.push(det.map);
      if (det.glow) this.disposables.push(det.glow);
      const tm = new MeshLambertMaterial({ vertexColors: true, map: det.map });
      // steep faces get rock strata (world-space bands) so hillsides and cliffs read as rock
      tm.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vUp;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vUp;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
{
  float steep = 1.0 - smoothstep(0.55, 0.9, vUp);
  float band = fract(vWPos.y * 0.42 + sin(vWPos.x * 0.07) * 0.35 + sin(vWPos.z * 0.05) * 0.35);
  float strata = mix(0.78, 1.08, smoothstep(0.35, 0.5, band)) * mix(0.92, 1.0, step(0.8, band));
  diffuseColor.rgb *= mix(1.0, strata, steep);
}`,
          );
      };
      tm.customProgramCacheKey = () => 'dasphalt-terrain';
      if (biome.id === 'snow') addSparkle(tm, 1, 4);
      if (det.glow) {
        tm.emissiveMap = det.glow;
        tm.emissive = new Color(0xffffff);
      }
      add(terrain, mat(tm), 'terrain', -1);
    }
    const cx = (track.bounds.minX + track.bounds.maxX) / 2;
    const cy = (track.bounds.minY + track.bounds.maxY) / 2;
    const half = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxY - track.bounds.minY) / 2;
    if (biome.water) {
      const g = new PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      const w = new Mesh(g, mat(new MeshPhongMaterial({ color: biome.water.color, shininess: 90, specular: 0x9fd8ff, transparent: true, opacity: 0.94 })));
      w.scale.set((half + 900) * 2, 1, (half + 900) * 2);
      w.position.set(cx, this.groundY - biome.water.below, -cy);
      this.root.add(w);
      this.disposables.push(g);
      this.water = w;
    }
    if (biome.cloudSea) {
      const g = new PlaneGeometry(1, 1, 1, 1);
      g.rotateX(-Math.PI / 2);
      const sea = new Mesh(g, mat(new MeshLambertMaterial({ color: biome.cloudSea.color, emissive: 0x8aa8c8 })));
      sea.scale.set((half + 1000) * 2, 1, (half + 1000) * 2);
      sea.position.set(cx, this.groundY - biome.cloudSea.below, -cy);
      this.root.add(sea);
      this.disposables.push(g);
    }
    const th = terrainHeightFn(this.field, terrainOpts, track.def.decorSeed);
    const seaY = this.groundY - (biome.cloudSea?.below ?? 0);
    this.heightAt = biome.cloudSea ? () => seaY : th;

    // --- sky + horizon -------------------------------------------------------------------------
    this.sky = makeSkyDome(biome);
    setSkyColors(this.sky, palette.skyTop, palette.skyHorizon, palette.skyBottom);
    this.root.add(this.sky);
    this.disposables.push(this.sky.geometry, this.sky.material as Material);
    const horizonR = half + 620;
    this.horizon = buildHorizon(biome, [cx, cy], horizonR, this.groundY, track.def.decorSeed);
    for (const m of this.horizon.meshes) {
      this.root.add(m);
      this.disposables.push(m.geometry, m.material as Material);
    }
    this.disposables.push(...this.horizon.textures);
    this.horizon.recolor(palette.fog, biome.night);

    // --- props, landmarks, hazards -------------------------------------------------------------
    const ft = facadeTextures(biome.id === 'cyber' ? 'server' : 'windows', biome.night, track.def.decorSeed);
    this.disposables.push(ft.map, ft.glow);
    const facadeMat = mat(makeVoxelMaterial());
    facadeMat.map = ft.map;
    facadeMat.emissiveMap = ft.glow;
    facadeMat.emissive = new Color(0xffffff);
    this.props = buildProps(
      {
        track,
        paths: this.paths,
        field: this.field,
        biome,
        heightAt: this.heightAt,
        clearance: wallThickness(biome.wall) + 0.5,
        clearings: pads.map((p) => ({ x: p.x, y: p.y, r: p.r * 1.25 })),
        density: o.quality === 'high' ? 1 : o.quality === 'medium' ? 0.7 : 0.45,
      },
      this.voxel,
      facadeMat,
    );
    for (const m of this.props.meshes) this.root.add(m);
    this.disposables.push(...this.props.geometries);

    const shadowGeo = new PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    this.disposables.push(shadowGeo);
    const shadowMat = mat(new MeshBasicMaterial({ map: this.dot, color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    for (const lm of track.landmarks) {
      const spanning = ARCH_KINDS.has(lm.kind) && Math.abs(lm.d) < 1;
      let span: number | undefined;
      if (spanning) {
        const i = Math.min(track.n - 1, Math.max(0, Math.floor(lm.s / track.spacing)));
        const half = Math.max(track.hwL[i]!, track.hwR[i]!) + track.shoulder + wallThickness(biome.wall) + 2.4;
        span = half / Math.max(0.1, lm.scale);
      }
      const inst = buildLandmark(lm.kind, biome, this.voxel, span);
      inst.group.position.set(lm.x, lm.z - 0.05, -lm.y);
      // models face +Z toward the road; arches are built across Z: straddle the road, or stand parallel beside it
      inst.group.rotation.y = ARCH_KINDS.has(lm.kind) ? lm.yaw + (spanning ? 0 : Math.PI / 2) : lm.yaw + (lm.d < 0 ? Math.PI : 0);
      inst.group.scale.setScalar(lm.scale);
      if (!spanning && !['blimp', 'hot-air-balloon', 'cloud-island'].includes(lm.kind)) {
        const sh = new Mesh(shadowGeo, shadowMat);
        sh.scale.set(40, 1, 40);
        sh.position.y = 0.08;
        inst.group.add(sh);
      }
      this.root.add(inst.group);
      this.landmarks.push(inst);
      this.disposables.push(...inst.materials);
    }

    this.hazards = buildHazards(track, biome, this.voxel, this.dot);
    for (const h of this.hazards.views) this.root.add(h.group);

    // --- item cubes ----------------------------------------------------------------------------
    const nBox = track.itemBoxes.length;
    this.boxScale = new Float32Array(nBox).fill(1);
    this.boxVisible = new Uint8Array(nBox).fill(1);
    if (nBox > 0) {
      const shellMat = mat(makeVoxelMaterial({ transparent: true, opacity: 0.78, rim: true }));
      const glyphMat = mat(makeVoxelMaterial({ rim: false }));
      this.boxShell = new InstancedMesh(itemModel('prismShell'), shellMat, nBox);
      this.boxGlyph = new InstancedMesh(itemModel('prismGlyph'), glyphMat, nBox);
      this.boxShell.instanceMatrix.setUsage(DynamicDrawUsage);
      this.boxGlyph.instanceMatrix.setUsage(DynamicDrawUsage);
      this.boxShell.frustumCulled = false;
      this.boxGlyph.frustumCulled = false;
      this.boxShell.renderOrder = 5;
      this.root.add(this.boxGlyph, this.boxShell);
      // soft glow pools under each cube
      const pool = new InstancedMesh(shadowGeo, mat(new MeshBasicMaterial({ map: this.dot, color: 0xff7ae0, transparent: true, opacity: 0.45, depthWrite: false, blending: AdditiveBlending })), nBox);
      track.itemBoxes.forEach((b, i) => {
        this.tmpV.set(b.x, b.z + 0.05, -b.y);
        this.tmpS.set(2.6, 1, 2.6);
        pool.setMatrixAt(i, this.tmpM.compose(this.tmpV, this.tmpQ.identity(), this.tmpS));
      });
      pool.computeBoundingSphere();
      this.root.add(pool);
    }

    this.buildGantry();
    this.buildFinishArch();
  }

  /** Start gantry over the line with the five start lamps and the DASphalt GP sign. */
  private buildGantry(): void {
    const t = this.track;
    const main = pathOfMain(t);
    const p = pointOn(main, 0);
    const wall = wallThickness(this.biome.wall);
    const L = t.hwL[0]! + t.shoulder + wall + 1;
    const R = t.hwR[0]! + t.shoulder + wall + 1;
    const g = new Group();
    g.position.set(p.x, p.z, -p.y);
    g.rotation.y = Math.atan2(p.ty, p.tx);
    const b = new MeshBuilder();
    const H = 8;
    for (const z of [-L, R]) {
      b.box(0, H / 2, z, 1.2, H, 1.2, 0x2a2d3a);
      b.box(0, H / 2, z, 1.26, H - 1, 0.2, this.biome.glow, 0.9);
      b.box(0, 0.3, z, 2, 0.6, 2, 0x1c1f2b);
    }
    b.box(0, H + 0.8, (R - L) / 2, 1.6, 2.2, L + R + 1.2, 0x1c1f2b);
    b.box(-0.82, H + 1.9, (R - L) / 2, 0.1, 0.2, L + R + 1.2, this.biome.glowB, 1);
    // lamp housings (facing the grid, −X)
    const n = 5;
    for (let k = 0; k < n; k++) {
      const z = (R - L) / 2 + (k - (n - 1) / 2) * 1.6;
      b.box(-0.9, H - 0.6, z, 0.4, 1.4, 1.2, 0x10121a);
    }
    const geo = b.build();
    const m = new Mesh(geo, this.voxel);
    g.add(m);
    this.disposables.push(geo);
    // lenses: one geometry, colour ranges rewritten when the lights change
    const lb = new MeshBuilder();
    this.lightRanges = [];
    for (let k = 0; k < n; k++) {
      const z = (R - L) / 2 + (k - (n - 1) / 2) * 1.6;
      const start = lb.vertexCount;
      lb.cyl(-1.12, H - 0.25, z, 0.42, 0.1, LIGHT_OFF, 12, 'x', 1);
      lb.cyl(-1.12, H - 1.0, z, 0.42, 0.1, LIGHT_OFF, 12, 'x', 1);
      this.lightRanges.push([start, lb.vertexCount]);
    }
    this.lightsGeo = lb.build();
    this.disposables.push(this.lightsGeo);
    g.add(new Mesh(this.lightsGeo, this.voxel));
    // sign
    const sign = signTexture(['DASPHALT GP'], 0x1c1f2b, 0xffffff, 1024, 128, this.biome.glowB);
    this.disposables.push(sign);
    const sg = new PlaneGeometry(Math.min(L + R, 22), 1.8);
    this.disposables.push(sg);
    const sm = new MeshBasicMaterial({ map: sign, side: DoubleSide });
    this.disposables.push(sm);
    const front = new Mesh(sg, sm);
    front.position.set(-0.83, H + 0.85, (R - L) / 2);
    front.rotation.y = -Math.PI / 2;
    const back = new Mesh(sg, sm);
    back.position.set(0.83, H + 0.85, (R - L) / 2);
    back.rotation.y = Math.PI / 2;
    g.add(front, back);
    this.root.add(g);
    this.setLights(-1);
  }

  /** A chequered arch just before the line: the finish you drive toward every lap. */
  private buildFinishArch(): void {
    const t = this.track;
    const main = pathOfMain(t);
    const sPos = t.length - 16;
    const p = pointOn(main, sPos);
    const i = Math.min(t.n - 1, Math.floor(sPos / t.spacing));
    const wall = wallThickness(this.biome.wall);
    const L = t.hwL[i]! + t.shoulder + wall + 1.4;
    const R = t.hwR[i]! + t.shoulder + wall + 1.4;
    const b = new MeshBuilder();
    const H = 9.5;
    for (const z of [-L, R]) {
      b.cyl(0, H / 2, z, 0.8, H, 0xf1f5f9, 8);
      for (let k = 0; k < 6; k++) b.cyl(0, 0.8 + k * 1.5, z, 0.82, 0.7, k % 2 ? 0x111118 : 0xf8fafc, 8);
      b.ball(0, H + 0.4, z, 1, this.biome.glow, 1, 1);
    }
    const W = L + R;
    const cells = Math.round(W / 1.2);
    for (let k = 0; k < cells; k++)
      for (let r = 0; r < 2; r++) b.box(0, H - 0.3 - r * 0.9, -L + (k + 0.5) * (W / cells), 0.4, 0.9, W / cells, (k + r) % 2 ? 0x111118 : 0xf8fafc);
    b.box(0, H + 0.55, (R - L) / 2, 0.6, 0.3, W, this.biome.glowB, 1);
    const geo = b.build();
    this.disposables.push(geo);
    const m = new Mesh(geo, this.voxel);
    m.position.set(p.x, p.z, -p.y);
    m.rotation.y = Math.atan2(p.ty, p.tx);
    this.root.add(m);
  }

  /** Start lights: -1 hidden/off, 0..3 reds lit, 4 = all green. */
  setLights(n: number): void {
    if (n === this.lastLights || !this.lightsGeo) return;
    this.lastLights = n;
    const col = this.lightsGeo.getAttribute('color');
    const glow = this.lightsGeo.getAttribute('glow');
    const off = new Color(LIGHT_OFF);
    const red = new Color(LIGHT_RED);
    const green = new Color(LIGHT_GREEN);
    this.lightRanges.forEach(([a, b], k) => {
      const c = n >= 4 ? green : n > 0 && k < Math.min(5, Math.round((n / 3) * 5)) ? red : off;
      for (let v = a; v < b; v++) {
        col.setXYZ(v, c.r, c.g, c.b);
        glow.setX(v, c === off ? 0.2 : 1.4);
      }
    });
    col.needsUpdate = true;
    glow.needsUpdate = true;
  }

  /** Per-frame: animated textures, landmarks, hazards, cubes, sky follow. */
  update(t: number, dt: number, tick: number, reducedMotion: boolean, boxes: readonly KartBoxState[] | undefined, camPos: Vector3, far: number): void {
    this.sky.position.copy(camPos);
    this.sky.scale.setScalar(far * 0.92);
    if (!reducedMotion) {
      this.padTex.offset.y = -((t * 2.2) % 1);
      if (this.conveyorTex) this.conveyorTex.offset.x = -((t * 0.8) % 1);
    }
    (this.sky.material as ShaderMaterial).uniforms.time!.value = t;
    const lt = reducedMotion ? 0 : t;
    for (const l of this.landmarks) l.update(lt);
    this.stompLanded.length = 0;
    for (const h of this.hazards.views) {
      const p = h.update(tick, t, reducedMotion);
      if (h.landed) this.stompLanded.push(p);
    }
    if (this.water && !reducedMotion) this.water.position.y = this.groundY - (this.biome.water?.below ?? 1.6) + Math.sin(t * 0.8) * 0.08;
    this.updateBoxes(t, dt, boxes, reducedMotion);
  }

  /** Stompers that slammed down this frame (for dust fx). */
  get landedStompers(): readonly { x: number; y: number; z: number }[] {
    return this.stompLanded;
  }

  private updateBoxes(t: number, dt: number, boxes: readonly KartBoxState[] | undefined, rm: boolean): void {
    if (!this.boxShell || !this.boxGlyph) return;
    const list = this.track.itemBoxes;
    if (boxes) {
      this.boxVisible.fill(1);
      for (const b of boxes) if (b.index >= 0 && b.index < list.length) this.boxVisible[b.index] = b.visible ? 1 : 0;
    }
    for (let i = 0; i < list.length; i++) {
      const b = list[i]!;
      const target = this.boxVisible[i] ? 1 : 0;
      let s = this.boxScale[i]!;
      s = target ? Math.min(1, s + dt * 3.2) : 0;
      this.boxScale[i] = s;
      const pop = s < 1 ? 1 + Math.sin(s * Math.PI) * 0.35 : 1;
      const sc = s * pop * 1.35;
      const spin = rm ? 0.6 : t * 1.4 + i * 0.7;
      const bob = rm ? 0 : Math.sin(t * 2.6 + i) * 0.14;
      this.tmpV.set(b.x, b.z + 1.25 + bob, -b.y);
      this.tmpQ.setFromAxisAngle(this.upV, spin);
      this.tmpQ.multiply(TILT);
      this.tmpS.set(sc, sc, sc);
      this.boxShell.setMatrixAt(i, this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS));
      this.tmpQ.setFromAxisAngle(this.upV, -spin * 1.7);
      this.boxGlyph.setMatrixAt(i, this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS));
    }
    this.boxShell.instanceMatrix.needsUpdate = true;
    this.boxGlyph.instanceMatrix.needsUpdate = true;
  }

  /** Recolour in place for a theme change. */
  applyPalette(p: WorldPalette): void {
    this.roadTex.repaint(p, this.track.def.offroad);
    setSkyColors(this.sky, p.skyTop, p.skyHorizon, p.skyBottom);
    this.fog.color.set(p.fog);
    this.horizon?.recolor(p.fog, this.biome.night);
  }

  /** Walk the world and hide/show instanced props (quality changes don't rebuild). */
  setPropVisibility(on: boolean): void {
    for (const m of this.props.meshes) m.visible = on;
  }

  dispose(): void {
    this.hazards.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.traverse((o: Object3D) => {
      if (o instanceof InstancedMesh) o.dispose();
    });
    this.root.clear();
  }
}

const TILT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 1).normalize(), 0.45);
