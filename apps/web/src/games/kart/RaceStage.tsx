/**
 * Hosts the 3D race view + HUD. The controller lives for the lifetime of this component; the
 * renderer (three.js) is loaded on demand with a polished loading card, then fed every animation
 * frame. Theme / fx / reduced-motion changes are pushed into the live renderer — never a rebuild.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { KART_CUPS, KART_TRACKS, type KartPublicState } from '@dascade/shared/games/kart';
import { PixelIcon, ProgressBar, watchThemeTokens } from '@dascade/ui';
import { useApp } from '../../app/store.ts';
import { useRoomSelector } from '../../net/hooks.ts';
import { KartController } from './race/controller.ts';
import { createFlatView } from './race/flatView.ts';
import { Hud } from './hud/Hud.tsx';
import { TouchControls } from './hud/TouchControls.tsx';
import { NetDebug } from './hud/NetDebug.tsx';
import { TrackThumb } from './lobby/TrackThumb.tsx';
import { BIOME_LABEL, trackBiome } from './trackInfo.ts';
import { Results } from './results/Results.tsx';
import { GpIntermission } from './results/GpIntermission.tsx';
import type { KartQuality } from './render/types.ts';
import type { KartRenderer } from './render/renderer.ts';
import type { FlatView } from './race/flatView.ts';

type Renderer = KartRenderer | FlatView;
/** Lazy chunk: three.js + the renderer load only when a race is shown. */
const loadRenderer = () => import('./render/renderer.ts');

declare global {
  interface Window {
    __KART__?: { controller: KartController; renderer: Renderer | null; test: KartController['test'] };
  }
}

const STEPS = ['Loading the garage', 'Building the track', 'Painting the world', 'Warming up engines'] as const;

function defaultQuality(): KartQuality {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 560;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  if (coarse && (small || mem <= 4)) return 'low';
  if (coarse || mem <= 4) return 'medium';
  return 'high';
}

export function RaceStage() {
  const phase = useRoomSelector((s: KartPublicState) => s.phase);
  const dimmed = phase === 'RESULTS' || phase === 'INTERMISSION';
  const hostRef = useRef<HTMLDivElement>(null);
  const [ctrl] = useState(() => new KartController());
  const fx = useApp((s) => s.settings.fx);
  const reducedMotion = useApp((s) => s.settings.reducedMotion);
  const quality = useRef({ fx, reducedMotion });
  const rendererRef = useRef<Renderer | null>(null);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [flat, setFlat] = useState(false);
  const ui = useSyncExternalStore(ctrl.subscribeUi, ctrl.getUi, ctrl.getUi);
  const trackId = ui.trackId;
  const race = useRoomSelector((s: KartPublicState) =>
    s.race ? { laps: s.race.laps, mode: s.race.mode, round: s.race.round, rounds: s.race.rounds, cup: s.race.cup } : null,
  );

  useEffect(() => {
    ctrl.start();
    window.__KART__ = { controller: ctrl, renderer: null, test: (a) => ctrl.test(a) };
    return () => {
      ctrl.destroy();
      if (window.__KART__?.controller === ctrl) delete window.__KART__;
    };
  }, [ctrl]);

  // Renderer lifecycle: (re)created per track; everything else is pushed in place.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    let raf = 0;
    let stopTheme: (() => void) | null = null;
    let ro: ResizeObserver | null = null;
    let renderer: Renderer | null = null;
    setReady(false);
    setStep(0);
    const makeCanvas = () => {
      const c = document.createElement('canvas');
      c.className = 'kr-canvas';
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', 'Race view');
      return c;
    };
    let canvas = makeCanvas();
    void (async () => {
      const track = ctrl.track;
      try {
        performance.mark('kart:load-start');
        const mod = await loadRenderer();
        performance.mark('kart:renderer-chunk');
        if (!alive) return;
        setStep(1);
        await new Promise((r) => requestAnimationFrame(r));
        setStep(2);
        await new Promise((r) => requestAnimationFrame(r));
        if (!alive) return;
        const q = quality.current;
        renderer = mod.createKartRenderer(canvas, {
          track,
          quality: defaultQuality(),
          reducedMotion: q.reducedMotion,
          fx: q.fx,
          autoQuality: true,
        });
        performance.mark('kart:renderer-created');
      } catch (err) {
        // No WebGL (or the renderer chunk failed): race on in the top-down view.
        console.warn('[kart] 3D renderer unavailable, using the top-down view', err);
        if (!alive) return;
        canvas = makeCanvas();
        renderer = createFlatView(canvas, track);
        setFlat(true);
      }
      rendererRef.current = renderer;
      if (window.__KART__) window.__KART__.renderer = renderer;
      host.appendChild(canvas);
      const resize = () => renderer?.resize(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(host);
      stopTheme = watchThemeTokens(host, (t) => renderer?.setThemeTokens(t));
      renderer.setRoster(ctrl.roster());
      setStep(3);
      let first = true;
      const loop = (t: number) => {
        raf = requestAnimationFrame(loop);
        if (!renderer) return;
        const view = ctrl.frame(t);
        for (const f of ctrl.takeFx()) renderer.triggerFx(f.kind, f.at);
        renderer.frame(view);
        if (first) {
          first = false;
          performance.mark('kart:first-frame');
          setReady(true);
        }
      };
      raf = requestAnimationFrame(loop);
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stopTheme?.();
      ro?.disconnect();
      renderer?.dispose();
      rendererRef.current = null;
      if (window.__KART__) window.__KART__.renderer = null;
      canvas.remove();
    };
  }, [ctrl, trackId]);

  // Roster changes (joins, racer swaps between GP races): rebuild models in place.
  useEffect(() => {
    rendererRef.current?.setRoster(ctrl.roster());
  }, [ctrl, ui.rosterKey, ready]);

  // Time-trial ghost look (the pose comes with every frame).
  useEffect(() => {
    const r = rendererRef.current;
    if (r && 'setGhostLook' in r) r.setGhostLook(ctrl.ghostLook());
  }, [ctrl, ui.ghostKey, ready]);

  // FX level / reduced motion: re-present the running race in place.
  useEffect(() => {
    quality.current = { fx, reducedMotion };
    rendererRef.current?.setOptions({ fx, reducedMotion });
  }, [fx, reducedMotion]);

  // A touch on the stage brings the touch controls back after a keyboard took over.
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && !ctrl.getUi().touch) ctrl.setTouch(true);
    };
    window.addEventListener('pointerdown', onPointer, { passive: true });
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [ctrl]);

  const t = KART_TRACKS[trackId];
  return (
    <div className="kr" data-part="race" data-dimmed={dimmed ? 'true' : undefined} data-ready={ready ? 'true' : undefined}>
      <div className="kr-host" data-part="track" ref={hostRef} />
      <Hud ctrl={ctrl} hidden={dimmed} />
      {ui.touch && !ui.spectating && !ui.finished && !dimmed ? (
        <TouchControls sampler={ctrl.sampler} bridge={ctrl.hud} itemsOn={ui.items} locked={ui.locked} />
      ) : null}
      {phase === 'RESULTS' ? <Results ctrl={ctrl} /> : null}
      {phase === 'INTERMISSION' ? <GpIntermission /> : null}
      {ui.netDebug ? <NetDebug ctrl={ctrl} renderer={rendererRef.current} /> : null}
      {!ready ? (
        <div className="kr-loading" role="status" aria-live="polite" data-biome={trackBiome(trackId)}>
          <div className="kr-loading__card">
            <span className="kr-loading__kicker">
              {race?.mode === 'gp'
                ? `${KART_CUPS[race.cup].name} · Race ${race.round}/${race.rounds}`
                : race?.mode === 'timetrial'
                  ? 'Time Trial'
                  : KART_CUPS[t.cup].name}
            </span>
            <TrackThumb trackId={trackId} />
            <h2 className="kr-loading__name">{t.name}</h2>
            <p className="kr-loading__tag">{t.tagline}</p>
            <span className="kr-loading__meta">
              {BIOME_LABEL[trackBiome(trackId)]}
              {race ? (
                <>
                  {' · '}
                  <span className="kh-num">{race.laps}</span> {race.laps === 1 ? 'lap' : 'laps'}
                </>
              ) : null}
            </span>
            <ProgressBar value={(step + 1) / (STEPS.length + 1)} label="Loading race" />
            <span className="kr-loading__step">{STEPS[step]}…</span>
          </div>
        </div>
      ) : null}
      {flat ? (
        <p className="kr-flat-note" role="note">
          <PixelIcon name="warning" /> 3D graphics aren’t available here — racing in the top-down view.
        </p>
      ) : null}
      <div className="dc-rotate-hint kr-rotate" role="note">
        <PixelIcon name="refresh" /> Rotate for the widest view — or race on in portrait.
      </div>
    </div>
  );
}
