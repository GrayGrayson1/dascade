/**
 * Racer portraits for menus, rendered from the actual 3D kart model with one shared offscreen
 * renderer (so menus match the race). Results are cached PNG data URLs.
 *
 *   const url = await renderRacerPortrait('mochi', 'tub', '#ff4fd8', 256);
 *
 * `view`: 'kart' = the whole kart at a 3/4 angle (default), 'face' = head-and-shoulders close-up.
 * The WebGL context is created on demand and released automatically ~2.5 s after the last portrait
 * (cached data URLs stay); `disposePortraitRenderer()` frees it immediately and clears the cache.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import type { KartBodyId, KartRacerId } from '@dascade/shared/games/kart';
import { WHEEL_WIDTH_SCALE, buildKartArt, buildWheelGeometry } from './karts.ts';
import { sharedMaterials } from './materials.ts';
import { RACER_ART } from './palette.ts';

export type PortraitView = 'kart' | 'face' | 'rear';

let renderer: WebGLRenderer | null = null;
let scene: Scene | null = null;
let camera: PerspectiveCamera | null = null;
const results = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** The offscreen WebGL context is released this long after the last portrait (results stay cached). */
const IDLE_RELEASE_MS = 2500;

/** Release the offscreen context (keeps the cached data URLs); it is recreated on the next request. */
function releaseContext(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!renderer) return;
  renderer.dispose();
  renderer.forceContextLoss();
  renderer = null;
  scene = null;
  camera = null;
}

function scheduleRelease(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(releaseContext, IDLE_RELEASE_MS);
}

function setup(): { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera } | null {
  if (renderer && scene && camera) return { renderer, scene, camera };
  try {
    const canvas = document.createElement('canvas');
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  scene = new Scene();
  scene.add(new HemisphereLight(0xdfe8ff, 0x3a3050, 1.5));
  scene.add(new AmbientLight(0xffffff, 0.35));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const rim = new DirectionalLight(0x9be7ff, 1.2);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  camera = new PerspectiveCamera(30, 1, 0.1, 50);
  return { renderer, scene, camera };
}

function render(racer: KartRacerId, body: KartBodyId, paint: string, size: number, view: PortraitView): string {
  const ctx = setup();
  if (!ctx) return '';
  const { renderer: r, scene: s, camera: cam } = ctx;
  const art = buildKartArt(racer, body, paint);
  const mats = sharedMaterials();
  const g = new Group();
  g.add(new Mesh(art.body, mats.kart));
  const head = new Mesh(art.head, mats.kart);
  head.position.set(art.spec.head[0], art.spec.head[1], art.spec.head[2]);
  head.rotation.y = 0.25;
  g.add(head);
  const wheel = buildWheelGeometry();
  const hubMat = sharedMaterials().voxel.clone();
  hubMat.color = new Color(RACER_ART[racer].trim);
  for (const w of art.spec.wheels) {
    const m = new Mesh(wheel, hubMat);
    m.position.set(w.x, w.y, w.z);
    m.scale.set(w.r, w.r, WHEEL_WIDTH_SCALE);
    if (w.front) m.rotation.y = 0.3;
    g.add(m);
  }
  // 3/4 front view, facing the viewer's right
  g.rotation.y = -0.15;
  s.add(g);
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  cam.aspect = 1;
  if (view === 'rear') {
    // the chase-cam angle (for reviewing the most-watched view in the game)
    g.rotation.y = 0;
    cam.fov = 40;
    cam.position.set(-4.4, 1.8, 0.15);
    cam.lookAt(1.2, 0.95, 0);
  } else if (view === 'face') {
    cam.fov = 24;
    cam.position.set(1.9, 1.5, 1.6);
    cam.lookAt(art.spec.head[0] * 0.5, art.spec.head[1] + 0.2, 0);
  } else {
    cam.fov = 30;
    cam.position.set(3.9, 2.4, 3.9);
    cam.lookAt(0, 0.78, 0);
  }
  cam.updateProjectionMatrix();
  r.render(s, cam);
  const url = r.domElement.toDataURL('image/png');
  s.remove(g);
  hubMat.dispose();
  return url;
}

/** Render (or fetch from cache) a racer portrait as a PNG data URL. Resolves '' if WebGL is unavailable. */
export function renderRacerPortrait(racer: KartRacerId, body: KartBodyId, paint: string, size = 256, view: PortraitView = 'kart'): Promise<string> {
  const key = `${racer}|${body}|${paint.toLowerCase()}|${size}|${view}`;
  let p = results.get(key);
  if (!p) {
    p = queue.then(
      () =>
        new Promise<string>((resolve) => {
          // yield a frame between portraits so a picker full of them never blocks input
          const run = () => {
            try {
              resolve(render(racer, body, paint, Math.max(32, Math.min(1024, Math.round(size))), view));
            } catch {
              resolve('');
            }
            scheduleRelease();
          };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
          else run();
        }),
    );
    queue = p;
    results.set(key, p);
  }
  return p;
}

/**
 * Free the offscreen WebGL context now and forget cached portraits. Optional: the context is also
 * released automatically ~2.5 s after the last portrait, so the lobby never holds a live context.
 */
export function disposePortraitRenderer(): void {
  releaseContext();
  results.clear();
}
