/**
 * Lobby showroom: the chosen racer in their kart on a slowly turning pedestal, rendered live with
 * the same voxel art the race uses (render lane's `art/`). Picking a racer drops the new kart onto
 * the pedestal with a bounce and a little rev. Drag to spin it yourself.
 *
 * Reduced motion: a still 3/4 view (drag still works). Effects off: no pedestal glow ring.
 * If WebGL is unavailable, the static portrait is shown instead. Renders only while visible.
 */
import { useEffect, useRef, useState } from 'react';
import type { KartBodyId, KartRacerId } from '@dascade/shared/games/kart';
import { useApp } from '../../../app/store.ts';
import { Portrait } from './Portrait.tsx';

interface ShowroomProps {
  racer: KartRacerId;
  body: KartBodyId;
  paint: string;
  label: string;
}

type Three = typeof import('three');
type Art = typeof import('../art/karts.ts');
type Mats = typeof import('../art/materials.ts');
type Pal = typeof import('../art/palette.ts');

interface Live {
  setKart: (racer: KartRacerId, body: KartBodyId, paint: string) => void;
  setMotion: (reduced: boolean, fx: string) => void;
  dispose: () => void;
}

async function createShowroom(canvas: HTMLCanvasElement, reduced: boolean, fx: string): Promise<Live | null> {
  const [T, art, mats, pal]: [Three, Art, Mats, Pal] = await Promise.all([
    import('three'),
    import('../art/karts.ts'),
    import('../art/materials.ts'),
    import('../art/palette.ts'),
  ]);
  let renderer: import('three').WebGLRenderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xdfe8ff, 0x3a3050, 1.4));
  scene.add(new T.AmbientLight(0xffffff, 0.3));
  const sun = new T.DirectionalLight(0xffffff, 2.3);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const rim = new T.DirectionalLight(0x9be7ff, 1.3);
  rim.position.set(-4, 2.5, -3);
  scene.add(rim);
  const camera = new T.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(4.1, 2.35, 4.1);
  camera.lookAt(0, 0.55, 0);

  // Pedestal: a chunky turntable with a glowing rim in the racer's colour.
  const pedestalGeo = new T.CylinderGeometry(1.75, 1.9, 0.32, 40);
  const pedestalMat = new T.MeshLambertMaterial({ color: 0x2a2540 });
  const pedestal = new T.Mesh(pedestalGeo, pedestalMat);
  pedestal.position.y = -0.16;
  scene.add(pedestal);
  const ringGeo = new T.TorusGeometry(1.8, 0.05, 8, 64);
  const ringMat = new T.MeshBasicMaterial({ color: 0xffffff });
  const ring = new T.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);
  const shadowGeo = new T.CircleGeometry(1.2, 32);
  const shadowMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
  const shadow = new T.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  scene.add(shadow);

  const turn = new T.Group();
  scene.add(turn);
  let kart: import('three').Group | null = null;
  let head: import('three').Mesh | null = null;
  const wheels: import('three').Mesh[] = [];
  let hubMat: import('three').MeshLambertMaterial | null = null;

  let motionReduced = reduced;
  let fxLevel = fx;
  let yaw = -0.6;
  let spin = 0.35;
  let dropT = 1;
  let dragging = false;
  let lastX = 0;
  let raf = 0;
  let visible = true;
  let last = performance.now();

  const setKart = (racer: KartRacerId, body: KartBodyId, paint: string) => {
    if (kart) {
      turn.remove(kart);
      kart = null;
    }
    wheels.length = 0;
    hubMat?.dispose();
    const a = art.buildKartArt(racer, body, paint);
    const shared = mats.sharedMaterials();
    const g = new T.Group();
    g.add(new T.Mesh(a.body, shared.voxel));
    head = new T.Mesh(a.head, shared.voxel);
    head.position.set(a.spec.head[0], a.spec.head[1], a.spec.head[2]);
    g.add(head);
    hubMat = shared.voxel.clone();
    hubMat.color = new T.Color(pal.RACER_ART[racer].trim);
    const wheelGeo = art.buildWheelGeometry();
    for (const w of a.spec.wheels) {
      const m = new T.Mesh(wheelGeo, hubMat);
      m.position.set(w.x, w.y, w.z);
      m.scale.set(w.r, w.r, art.WHEEL_WIDTH_SCALE);
      if (w.front) m.rotation.y = 0.3;
      wheels.push(m);
      g.add(m);
    }
    kart = g;
    turn.add(g);
    ringMat.color = new T.Color(pal.hexToInt(paint, 0xffffff));
    dropT = motionReduced ? 1 : 0;
  };

  const resize = () => {
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 260;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
  });
  io.observe(canvas);

  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
    spin = 0;
  };
  const onUp = () => {
    dragging = false;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!visible || document.hidden) return;
    if (!motionReduced && !dragging) {
      spin += (0.35 - spin) * dt * 0.8;
      yaw += spin * dt;
    }
    turn.rotation.y = yaw;
    if (kart) {
      // Drop in with a bounce, then idle with a tiny engine shimmy and head bob.
      if (dropT < 1) dropT = Math.min(1, dropT + dt * 1.8);
      const k = dropT;
      const bounce = k < 1 ? Math.abs(Math.cos(k * Math.PI * 2.5)) * (1 - k) * (1 - k) * 1.6 : 0;
      kart.position.y = bounce;
      kart.scale.setScalar(k < 0.15 ? 0.6 + k * 2.6 : 1);
      if (!motionReduced) {
        kart.position.y += Math.sin(t / 55) * 0.006;
        if (head) head.rotation.y = 0.25 + Math.sin(t / 900) * 0.25;
        for (const w of wheels) w.rotation.z -= dt * 1.2;
      }
    }
    ring.visible = fxLevel !== 'off';
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  return {
    setKart,
    setMotion: (r, f) => {
      motionReduced = r;
      fxLevel = f;
      if (r) dropT = 1;
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      pedestalGeo.dispose();
      pedestalMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      hubMat?.dispose();
      // Kart geometry is cached by the art module (shared with the race): never disposed here.
      renderer.dispose();
      // Release the GPU context now (browsers cap live contexts; GC may take a long time).
      renderer.forceContextLoss();
    },
  };
}

export function Showroom({ racer, body, paint, label }: ShowroomProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef<Live | null>(null);
  const [failed, setFailed] = useState(false);
  // A WebGL context can fail to start while the GPU process is busy (another tab, a context being
  // released): retry once on a fresh canvas before falling back to the static portrait.
  const [attempt, setAttempt] = useState(0);
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  const init = useRef({ racer, body, paint, reduced, fx });
  init.current = { racer, body, paint, reduced, fx };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let alive = true;
    void createShowroom(canvas, init.current.reduced, init.current.fx)
      .then((l) => {
        if (!alive) {
          l?.dispose();
          return;
        }
        if (!l) {
          if (attempt === 0) setTimeout(() => alive && setAttempt(1), 500);
          else setFailed(true);
          return;
        }
        live.current = l;
        const c = init.current;
        l.setKart(c.racer, c.body, c.paint);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      live.current?.dispose();
      live.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    live.current?.setKart(racer, body, paint);
  }, [racer, body, paint]);

  useEffect(() => {
    live.current?.setMotion(reduced, fx);
  }, [reduced, fx]);

  return (
    <div className="kp-setup__stage" role="img" aria-label={label}>
      {failed ? <Portrait racer={racer} body={body} paint={paint} size={220} /> : <canvas key={attempt} ref={ref} aria-hidden />}
    </div>
  );
}
