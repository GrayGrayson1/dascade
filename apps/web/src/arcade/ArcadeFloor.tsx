/**
 * The DASCADE arcade floor — the landing experience.
 *
 * A pixel-art room with a horizontal lineup of the eleven cabinets: the centred
 * machine is the focal point (full size, lit, attract running, marquee aglow)
 * and its neighbours recede to either side with depth, so it's obvious there's
 * more to browse.
 *
 *  - Mouse / trackpad: wheel or swipe (one cabinet per gesture), drag with
 *    snapping, prev/next buttons, click a neighbour to bring it to centre,
 *    click the centred cabinet (or Play/Open) to walk in.
 *  - Keyboard: ←/→, Home/End, PageUp/PageDown, Enter/Space opens.
 *  - Touch: swipe with snapping; tap a neighbour to centre it, tap again to open.
 *  - Reduced motion: no 3D sweep — moves are instant.
 * Motion is driven by a spring written straight to the DOM (no React renders
 * per frame). No game module or engine is imported here.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router';
import { CABINET_IDS, CABINET_LIST, cabinetPath, isMultiGameCabinet } from '@dascade/shared';
import { Button, IconButton, cx } from '@dascade/ui';
import { useApp } from '../app/store.ts';
import { music, sfx } from '../audio/audio.ts';
import { ArcadeFooter, ArcadeHeader, useServerStatus } from './ArcadeHud.tsx';
import { ArcadeRoom, type RoomSize } from './ArcadeRoom.tsx';
import { Cabinet } from './Cabinet.tsx';
import { CAB_H, CAB_W, FACE_W } from './cabinetArt.tsx';
import {
  WheelStepper,
  clampIndex,
  coverflowSlot,
  initialIndex,
  keyAction,
  lineupFit,
  releaseTarget,
  slotScale,
  slotX,
  springSettled,
  springStep,
  type SpringState,
} from './carousel.ts';
import { Plaque, plaqueAnnouncement } from './Plaque.tsx';
import { TournamentKiosk } from './TournamentKiosk.tsx';
import { lastCabinet, rememberCabinet, runViewTransition } from './transition.ts';
import './arcade.css';

const COUNT = CABINET_LIST.length;

interface Metrics {
  W: number;
  H: number;
  faceW: number;
  cabW: number;
  cabH: number;
  plateH: number;
  cx: number;
  baseY: number;
  spread: number;
  maxVisible: number;
  stepPx: number;
}

function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof matchMedia !== 'function') return () => undefined;
      const mq = matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
    () => false,
  );
}

function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

/** Warms the (small, engine-free) title-screen and picker chunks on first intent so the zoom never waits on the network. */
let entryPrefetch: Promise<unknown> | null = null;
let pickerPrefetch: Promise<unknown> | null = null;
function prefetchScreens(multi: boolean): void {
  if (multi)
    pickerPrefetch ??= import('../shell/CabinetPicker.tsx').catch(() => {
      pickerPrefetch = null;
    });
  else
    entryPrefetch ??= import('../shell/CabinetEntry.tsx').catch(() => {
      entryPrefetch = null;
    });
}

export function ArcadeFloor() {
  const navigate = useNavigate();
  const reduced = useApp((s) => s.settings.reducedMotion);
  const touch = useMedia('(hover: none)');
  const wide = useMedia('(min-width: 1280px) and (min-height: 640px)');
  const status = useServerStatus();
  const remembered = useMemo(() => lastCabinet(), []);
  const [index, setIndex] = useState(() => initialIndex(CABINET_IDS, remembered));
  const [launching, setLaunching] = useState(false);
  const [roomSize, setRoomSize] = useState<RoomSize | null>(null);
  const [announce, setAnnounce] = useState('');
  const cabinet = CABINET_LIST[index]!;
  const headerKiosk = useMemo(() => (wide ? <TournamentKiosk variant="board" /> : null), [wide]);

  const mainRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  const slots = useRef<Array<HTMLLIElement | null>>([]);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const screens = useRef<Array<HTMLElement | null>>([]);
  const metrics = useRef<Metrics | null>(null);
  const spring = useRef<SpringState>({ pos: index, vel: 0 });
  const target = useRef(index);
  const raf = useRef(0);
  const lastFrame = useRef(0);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const launchingRef = useRef(false);
  const suppressClick = useRef(false);
  const wheel = useRef(new WheelStepper());

  useEffect(() => {
    music.setMood('arcade');
    music.start('arcade');
  }, []);

  // ---------------------------------------------------------------------------
  // Layout: write every slot's transform for a (fractional) lineup position.
  /**
   * Per-slot element handles + the last values written, so a frame only touches what changed.
   * Everything is written straight onto the element it affects (no inherited custom properties:
   * those would restyle every SVG node inside the cabinet on every frame).
   */
  const handles = useRef<
    Array<{
      li: HTMLLIElement;
      sideL: SVGGElement | null;
      sideR: SVGGElement | null;
      plate: HTMLElement | null;
      last: { t: string; z: number; o: string; pe: string; f: string; l: string; r: string; p: string };
    } | null>
  >([]);

  const apply = useCallback((pos: number) => {
    const m = metrics.current;
    if (!m) return;
    const opts = { reduced: reducedRef.current, spread: m.spread, maxVisible: m.maxVisible };
    for (let i = 0; i < COUNT; i++) {
      const el = slots.current[i];
      if (!el) continue;
      let h = handles.current[i];
      if (!h || h.li !== el) {
        h = {
          li: el,
          sideL: el.querySelector<SVGGElement>('.af-cab__side--l'),
          sideR: el.querySelector<SVGGElement>('.af-cab__side--r'),
          plate: el.querySelector<HTMLElement>('.af-cab__plate'),
          last: { t: '', z: -1, o: '-', pe: '-', f: '-', l: '-', r: '-', p: '-' },
        };
        handles.current[i] = h;
      }
      const s = coverflowSlot(i - pos, opts);
      const x = m.cx + s.x * m.faceW - m.cabW / 2;
      const y = m.baseY - m.cabH + s.y * m.faceW;
      const t = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.scale.toFixed(4)})${s.tilt ? ` rotateY(${s.tilt.toFixed(2)}deg)` : ''}`;
      const last = h.last;
      if (t !== last.t) el.style.transform = last.t = t;
      if (s.z !== last.z) el.style.zIndex = String((last.z = s.z));
      const o = s.opacity >= 0.999 ? '' : s.opacity.toFixed(2);
      if (o !== last.o) el.style.opacity = last.o = o;
      const pe = s.opacity < 0.2 ? 'none' : '';
      if (pe !== last.pe) el.style.pointerEvents = last.pe = pe;
      // Dimming on the (composited) slot itself: the compositor applies it without re-rasterising the art.
      const f = s.shade < 0.005 ? '' : `brightness(${(1 - s.shade).toFixed(2)})`;
      if (f !== last.f) el.style.filter = last.f = f;
      const l = `scaleX(${Math.max(0, s.side).toFixed(3)})`;
      if (h.sideL && l !== last.l) h.sideL.style.transform = last.l = l;
      const r = `scaleX(${Math.max(0, -s.side).toFixed(3)})`;
      if (h.sideR && r !== last.r) h.sideR.style.transform = last.r = r;
      const p = Math.max(0, 1 - Math.abs(i - pos)).toFixed(2);
      if (h.plate && p !== last.p) h.plate.style.opacity = last.p = p;
    }
  }, []);

  const tick = useCallback(
    (now: number) => {
      raf.current = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - (lastFrame.current || now - 16)) / 1000));
      lastFrame.current = now;
      spring.current = springStep(spring.current, target.current, dt);
      if (springSettled(spring.current, target.current)) spring.current = { pos: target.current, vel: 0 };
      apply(spring.current.pos);
      if (spring.current.pos !== target.current || spring.current.vel !== 0) raf.current = requestAnimationFrame(tick);
      else lastFrame.current = 0;
    },
    [apply],
  );

  const kick = useCallback(() => {
    if (reducedRef.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      spring.current = { pos: target.current, vel: 0 };
      apply(target.current);
      return;
    }
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  }, [apply, tick]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // ---------------------------------------------------------------------------
  // Navigation
  const goTo = useCallback(
    (i: number, opts: { focus?: boolean; sound?: boolean } = {}) => {
      const next = clampIndex(i, COUNT);
      const changed = next !== target.current;
      target.current = next;
      setIndex(next);
      if (changed) {
        if (opts.sound !== false) sfx('hover', 60);
        const c = CABINET_LIST[next]!;
        setAnnounce(plaqueAnnouncement(c, next, COUNT));
        prefetchScreens(isMultiGameCabinet(c));
      }
      kick();
      if (opts.focus) buttons.current[next]?.focus({ preventScroll: true });
    },
    [kick],
  );

  const open = useCallback(
    (i: number) => {
      if (launchingRef.current) return;
      if (i !== target.current) {
        goTo(i);
        return;
      }
      const c = CABINET_LIST[i]!;
      const multi = isMultiGameCabinet(c);
      launchingRef.current = true;
      setLaunching(true);
      prefetchScreens(multi);
      sfx('coin');
      rememberCabinet(c.id);
      const path = cabinetPath(c);
      const screen = screens.current[i];
      if (reducedRef.current || !screen) {
        navigate(path);
        return;
      }
      const r = screen.getBoundingClientRect();
      const root = document.documentElement;
      root.style.setProperty('--vt-x', `${Math.round(r.left + r.width / 2)}px`);
      root.style.setProperty('--vt-y', `${Math.round(r.top + r.height / 2)}px`);
      screen.style.viewTransitionName = 'af-screen';
      const started = runViewTransition('enter', () => navigate(path), multi ? '[data-cabinet-picker]' : '[data-cabinet-entry]');
      if (!started) {
        screen.style.viewTransitionName = '';
        const main = mainRef.current;
        if (main) {
          const mr = main.getBoundingClientRect();
          main.style.setProperty('--zoom-x', `${r.left + r.width / 2 - mr.left}px`);
          main.style.setProperty('--zoom-y', `${r.top + r.height / 2 - mr.top}px`);
          main.classList.add('af-floor--launching');
        }
        window.setTimeout(() => navigate(path), 440);
      }
    },
    [goTo, navigate],
  );

  const onPress = useCallback(
    (i: number) => {
      if (suppressClick.current) return;
      open(i);
    },
    [open],
  );
  const onKeyboardFocus = useCallback(
    (i: number) => {
      if (i !== target.current) goTo(i);
    },
    [goTo],
  );
  const onHover = useCallback((i: number) => {
    if (i === target.current) prefetchScreens(isMultiGameCabinet(CABINET_LIST[i]!));
    sfx('hover', 90);
  }, []);
  const setSlot = useCallback((i: number, el: HTMLLIElement | null) => {
    slots.current[i] = el;
  }, []);
  const setButton = useCallback((i: number, el: HTMLButtonElement | null) => {
    buttons.current[i] = el;
  }, []);
  const setScreen = useCallback((i: number, el: HTMLElement | null) => {
    screens.current[i] = el;
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard: on the lineup (roving focus) and anywhere on the floor when nothing is focused.
  const onTrackKeyDown = (e: ReactKeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const action = keyAction(e.key, target.current, COUNT);
    if (!action || action.kind === 'open') return; // Enter/Space reach the focused <button> natively
    e.preventDefault();
    goTo(action.to, { focus: true });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (useApp.getState().modal) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && !t.classList.contains('af-floor')) return;
      const action = keyAction(e.key, target.current, COUNT);
      if (!action) return;
      e.preventDefault();
      if (action.kind === 'open') open(target.current);
      else goTo(action.to, { focus: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, open]);

  // ---------------------------------------------------------------------------
  // Wheel / trackpad: one cabinet per gesture (vertical too, unless the page scrolls).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      const scroller = document.scrollingElement ?? document.documentElement;
      const main = mainRef.current;
      const pageScrolls = scroller.scrollHeight > window.innerHeight + 2 || (!!main && main.scrollHeight > main.clientHeight + 2);
      const allowVertical = !pageScrolls;
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontal && !allowVertical) return;
      e.preventDefault();
      const step = wheel.current.push({ t: e.timeStamp, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode, allowVertical });
      if (step) goTo(target.current + step);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [goTo]);

  // ---------------------------------------------------------------------------
  // Drag / swipe with snapping (pointer events; vertical page scroll stays native via touch-action).
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    type Drag = {
      id: number;
      x0: number;
      y0: number;
      pos0: number;
      start: number;
      lastX: number;
      lastT: number;
      v: number;
      active: boolean;
      type: string;
    };
    let drag: Drag | null = null;
    const finish = (cancelled: boolean) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.active) return;
      track.classList.remove('is-dragging');
      try {
        track.releasePointerCapture(d.id);
      } catch {
        /* already released */
      }
      const m = metrics.current;
      const velSlots = m ? -d.v / m.stepPx : 0; // px/ms → slots/ms (dragging left moves forward)
      const next = cancelled ? d.start : releaseTarget(spring.current.pos, velSlots, d.start, COUNT);
      spring.current = { pos: spring.current.pos, vel: reducedRef.current ? 0 : velSlots * 1000 * 0.6 };
      goTo(next);
      // the click that ends a drag must not open a cabinet
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 60);
    };
    const onDown = (e: PointerEvent) => {
      if (launchingRef.current || drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        pos0: spring.current.pos,
        start: target.current,
        lastX: e.clientX,
        lastT: performance.now(),
        v: 0,
        active: false,
        type: e.pointerType,
      };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const m = metrics.current;
      if (!m) return;
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      if (!drag.active) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.1) {
          if (Math.abs(dy) > 12) drag = null; // a vertical gesture: leave it to the page
          return;
        }
        drag.active = true;
        track.classList.add('is-dragging');
        try {
          track.setPointerCapture(drag.id);
        } catch {
          /* synthetic pointers can't be captured */
        }
        cancelAnimationFrame(raf.current);
        raf.current = 0;
        lastFrame.current = 0;
      }
      e.preventDefault();
      let pos = drag.pos0 - dx / m.stepPx;
      if (pos < 0) pos *= 0.35;
      if (pos > COUNT - 1) pos = COUNT - 1 + (pos - (COUNT - 1)) * 0.35;
      // Velocity from the wall clock (event timestamps can be coarse or synthetic).
      const now = performance.now();
      const dt = Math.max(8, now - drag.lastT);
      const inst = (e.clientX - drag.lastX) / dt;
      drag.v = drag.v * 0.6 + inst * 0.4;
      drag.lastX = e.clientX;
      drag.lastT = now;
      spring.current = { pos, vel: 0 };
      apply(pos);
      const near = clampIndex(pos, COUNT);
      if (near !== target.current) {
        target.current = near;
        setIndex(near);
        sfx('hover', 60);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) finish(false);
    };
    const onCancel = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) finish(!drag.active);
    };
    track.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      track.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [apply, goTo]);

  // ---------------------------------------------------------------------------
  // Measure the stage: cabinet size, spacing, and the room hints (sign above the centred cabinet).
  useLayoutEffect(() => {
    const main = mainRef.current;
    const stage = stageRef.current;
    const track = trackRef.current;
    if (!main || !stage || !track) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const W = stage.clientWidth;
      const H = stage.clientHeight;
      if (W < 40 || H < 80) return;
      const phone = W < 700;
      const plateH = H < 360 ? 0 : touch && !phone ? 64 : H < 560 ? 40 : 46;
      // Desktop keeps room above the centred cabinet for the room's neon DASCADE sign.
      const reserveTop = phone ? Math.max(18, H * 0.05) : Math.max(H >= 440 ? 100 : 30, Math.min(190, H * 0.165));
      const bottomPad = H < 360 ? 4 : 14; // room for the pager
      const byHeight = ((H - reserveTop - plateH - bottomPad) * FACE_W) / CAB_H;
      const faceW = Math.max(56, Math.min(byHeight, W * (phone ? 0.46 : 0.27), 340));
      const cabW = (faceW * CAB_W) / FACE_W;
      const cabH = (cabW * CAB_H) / CAB_W;
      // Wide stages keep a margin at each end for the room's claw machine and change machine (and the arrows).
      const margin = W >= 1600 ? Math.min(200, W * 0.1) : 0;
      const fit = lineupFit((W / 2 - margin) / faceW, COUNT);
      const m: Metrics = {
        W,
        H,
        faceW,
        cabW,
        cabH,
        plateH,
        cx: W / 2,
        baseY: H - plateH - bottomPad,
        spread: fit.spread,
        maxVisible: fit.maxVisible,
        stepPx: slotX(1, fit.spread) * faceW,
      };
      metrics.current = m;
      // Custom properties on the track restyle every cabinet node: only write them when they change.
      setVar(track, '--cab-w', `${cabW.toFixed(1)}px`);
      setVar(track, '--cab-h', `${cabH.toFixed(1)}px`);
      setVar(track, '--plate-h', `${plateH}px`);
      setVar(track, '--face-w', `${faceW.toFixed(1)}px`);
      apply(spring.current.pos);
      // Room hints (relative to the floor): the sign fits between the HUD and the centred cabinet.
      const mr = main.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const header = main.querySelector<HTMLElement>('.af-hud');
      const far = Math.max(1, Math.floor(m.maxVisible));
      const reach = Math.min(W / 2, (slotX(far, m.spread) + slotScale(far) * 0.75) * faceW);
      // Arrows sit just outside the lineup on wide stages (the room's props stay clear), at the edges otherwise.
      setVar(stage, '--arrow-inset', `${Math.round(margin ? Math.max(10, W / 2 - reach - 58) : 10)}px`);
      // With the room's floor props showing, the arrows float higher (level with the marquees) to stay clear of them.
      setVar(stage, '--arrow-top', margin ? `${Math.round(m.baseY - cabH * 0.86)}px` : '46%');
      const hints = {
        headerBottom: header ? header.getBoundingClientRect().bottom - mr.top : 64,
        rowTop: sr.top - mr.top + m.baseY - cabH,
        rowBottom: sr.top - mr.top + m.baseY,
        rowLeft: Math.max(0, sr.left - mr.left + m.cx - reach),
        rowRight: Math.min(mr.width, sr.left - mr.left + m.cx + reach),
      };
      const next: RoomSize = { w: Math.round(mr.width), h: Math.round(Math.max(main.scrollHeight, mr.height)), hints };
      setRoomSize((prev) => {
        if (
          prev &&
          prev.w === next.w &&
          prev.h === next.h &&
          Math.abs(prev.hints.rowTop - next.hints.rowTop) < 2 &&
          Math.abs(prev.hints.rowBottom - next.hints.rowBottom) < 2 &&
          Math.abs(prev.hints.rowLeft - next.hints.rowLeft) < 2 &&
          Math.abs(prev.hints.headerBottom - next.hints.headerBottom) < 2
        )
          return prev;
        return next;
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    ro?.observe(main);
    ro?.observe(stage);
    window.addEventListener('resize', schedule);
    void document.fonts?.ready.then(schedule);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [apply, touch]);

  // Re-apply when motion preference flips (tilt on/off).
  useEffect(() => {
    apply(spring.current.pos);
  }, [reduced, apply]);

  return (
    <main
      id="main"
      ref={mainRef}
      className={cx('af-floor', launching && 'af-floor--busy')}
      data-arcade-floor
      tabIndex={-1}
      style={{ '--sel': cabinet.accent.primary, '--sel-2': cabinet.accent.secondary } as CSSProperties}
    >
      <ArcadeRoom size={roomSize} />
      <ArcadeHeader status={status} kiosk={headerKiosk} />

      <section
        ref={stageRef}
        className="af-lineup"
        aria-roledescription="carousel"
        aria-label="Arcade cabinets"
        data-active-cabinet={cabinet.id}
      >
        <p className="visually-hidden" id="lineup-help">
          Use the left and right arrow keys, Home and End to browse the cabinets. Press Enter to open the centred cabinet.
        </p>
        <ul className="af-lineup__track" ref={trackRef} aria-describedby="lineup-help" onKeyDown={onTrackKeyDown}>
          {CABINET_LIST.map((c, i) => (
            <Cabinet
              key={c.id}
              cabinet={c}
              index={i}
              count={COUNT}
              active={i === index}
              running={Math.abs(i - index) <= 1 && !launching}
              tabbable={i === index}
              isLast={remembered === c.id}
              touch={touch}
              onPress={onPress}
              onKeyboardFocus={onKeyboardFocus}
              onHover={onHover}
              setSlot={setSlot}
              setButton={setButton}
              setScreen={setScreen}
            />
          ))}
        </ul>
        <IconButton
          icon="arrow-left"
          label="Previous cabinet"
          variant="secondary"
          className="af-lineup__arrow af-lineup__arrow--prev"
          disabled={index <= 0}
          onClick={() => goTo(target.current - 1)}
        />
        <IconButton
          icon="arrow-right"
          label="Next cabinet"
          variant="secondary"
          className="af-lineup__arrow af-lineup__arrow--next"
          disabled={index >= COUNT - 1}
          onClick={() => goTo(target.current + 1)}
        />
        <div className="af-lineup__pager" aria-hidden>
          {CABINET_LIST.map((c, i) => (
            <i key={c.id} data-on={i === index ? 'true' : undefined} style={{ '--dot': c.accent.primary } as CSSProperties} />
          ))}
        </div>
      </section>

      <div className="af-floor__plaque-wrap">
        <Plaque cabinet={cabinet} onOpen={() => open(target.current)} busy={launching} />
        <div className="af-floor__extras">
          {wide ? null : <TournamentKiosk variant="strip" />}
          <Button
            variant="ghost"
            icon="users"
            className="af-floor__join-mobile"
            onClick={() => {
              sfx('click');
              useApp.getState().openModal('join');
            }}
          >
            Join with code
          </Button>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">
          {announce}
        </p>
      </div>

      <ArcadeFooter status={status} />
    </main>
  );
}
