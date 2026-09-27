/**
 * The collapsed jukebox ("dock"), in two forms:
 *  - the machine: on the arcade floor the jukebox is a physical machine standing at the left end of
 *    the cabinet row (FloorJukebox.tsx) — walk up to it (click) and the player opens as the machine
 *    up close;
 *  - the compact control, everywhere (the floor's HUD too): a jukebox button with play/pause (and the
 *    track title + next where there's room). It lives in a shell toolbar when the page has one (floor
 *    HUD, room top bar, immersive shell menu) and otherwise floats in a free corner — see placement.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { jukebox, showsPlaying, useJukebox } from '../audio/jukebox/index.ts';
import { FloorJukeboxArt } from './FloorJukebox.tsx';
import { Glyph } from './icons.tsx';
import {
  choosePlacement,
  findMachineHost,
  findSlotHost,
  floatCandidates,
  readSafeArea,
  scanObstacles,
  SLOT_WATCH_SELECTOR,
  type DockSlot,
  type FloatCandidate,
} from './placement.ts';

export type DockKind = 'float' | 'topbar' | 'menu' | 'slot' | 'hidden';

/** Which form of the dock opened the player: the floor machine, or the compact control. */
export type DockOpener = 'machine' | 'control';

export interface DockInfo {
  kind: DockKind;
  /** Float corner (for anchoring the expanded player). */
  corner: FloatCandidate['corner'] | null;
}

function Eq({ active }: { active: boolean }) {
  return (
    <span className="jb-eq" data-active={active ? 'true' : undefined} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

function useWide(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

interface DockProps {
  expanded: boolean;
  /** `opener`: the button pressed (focus returns to it on close — Safari doesn't focus buttons on click). */
  onToggleOpen: (from: DockOpener, opener?: HTMLElement) => void;
  onDock: (info: DockInfo) => void;
}

export function Dock({ expanded, onToggleOpen, onDock }: DockProps) {
  const { pathname } = useLocation();
  const [slot, setSlot] = useState<DockSlot | null>(null);
  const [float, setFloat] = useState<FloatCandidate | null>(null);
  const [machine, setMachine] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const machineRef = useRef<HTMLElement | null>(null);
  /** Which toolbars were present at the last evaluation (cheap change detection). */
  const signature = useRef('');

  const currentId = useJukebox((s) => s.currentId);
  const playing = useJukebox((s) => s.playing);
  const wantPlaying = useJukebox((s) => s.wantPlaying);
  const transportOn = useJukebox(showsPlaying);
  const needsGesture = useJukebox((s) => s.needsGesture);
  const source = useJukebox((s) => s.source);
  useJukebox((s) => s.room?.djId ?? null); // re-render on a DJ hand-over (mini-next permission)
  const status = useJukebox((s) => s.library.status);
  const title = useJukebox((s) => (s.currentId ? (s.library.tracks.find((t) => t.id === s.currentId)?.title ?? null) : null));
  const idle = !currentId && !playing && !wantPlaying;
  const wantMini = !idle;

  const topbarWide = useWide('(min-width: 1180px)');
  const topbarMid = useWide('(min-width: 721px)');

  // --- placement -----------------------------------------------------------
  const evaluate = useCallback(
    (floatToo: boolean) => {
      const m = findMachineHost(document);
      machineRef.current = m;
      setMachine((prev) => (prev === m ? prev : m));
      const found = findSlotHost(document, hostRef.current);
      if (found) {
        if (hostRef.current && hostRef.current !== found.host) dropHost(hostRef.current);
        hostRef.current = found.host;
        signature.current = slotSignature();
        setSlot((prev) => (prev && prev.host === found.host && prev.kind === found.kind ? prev : found));
        setFloat(null);
        return;
      }
      if (hostRef.current) {
        dropHost(hostRef.current);
        hostRef.current = null;
      }
      signature.current = slotSignature();
      setSlot(null);
      if (!floatToo && float) return;
      const vp = { w: window.innerWidth, h: window.innerHeight, safe: readSafeArea() };
      const candidates = floatCandidates(vp, wantMini);
      const obstacles = scanObstacles(
        document.body,
        vp,
        candidates.map((c) => c.box),
      );
      const { candidate } = choosePlacement(candidates, obstacles);
      setFloat((prev) => (prev && prev.kind === candidate.kind && prev.corner === candidate.corner ? prev : candidate));
    },
    [wantMini, float],
  );
  const evaluateRef = useRef(evaluate);
  evaluateRef.current = evaluate;

  // Route changes (+ late-rendering lazy screens), size changes and the idle/mini switch re-place us.
  useLayoutEffect(() => {
    evaluateRef.current(true);
    const t1 = window.setTimeout(() => evaluateRef.current(true), 350);
    const t2 = window.setTimeout(() => evaluateRef.current(true), 1400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pathname, wantMini]);

  useEffect(() => {
    let t = 0;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => evaluateRef.current(true), 160);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // Toolbars mount/unmount without a route change (lobby → game, immersive menu open/close):
  // watch for them, cheaply (a couple of selector lookups at most every 250 ms).
  useEffect(() => {
    let scheduled = 0;
    const check = () => {
      scheduled = 0;
      const host = hostRef.current;
      const lost = (host !== null && !host.isConnected) || (machineRef.current !== null && !machineRef.current.isConnected);
      if (lost || slotSignature() !== signature.current) evaluateRef.current(true);
    };
    const mo = new MutationObserver(() => {
      if (!scheduled) scheduled = window.setTimeout(check, 250);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      window.clearTimeout(scheduled);
    };
  }, []);

  useEffect(
    () => () => {
      if (hostRef.current) dropHost(hostRef.current);
    },
    [],
  );

  const kind: DockKind = slot ? slot.kind : 'float';
  const corner = float?.corner ?? null;
  useEffect(() => onDock({ kind, corner }), [kind, corner, onDock]);

  // --- render --------------------------------------------------------------
  const nowText = title ? `${playing ? 'Now playing' : 'Paused'}: ${title}` : 'Nothing playing';
  // Stable name; aria-expanded carries open/closed (the player's own close button is "Close jukebox").
  const openLabel = `Jukebox — ${nowText}`;
  const toggleLabel = transportOn ? 'Pause music' : needsGesture ? 'Resume music' : 'Play music';
  const canPlay = status === 'ready';

  const toggleBtn = (
    <button
      type="button"
      className="jb-btn jb-btn--icon jb-mini__btn"
      data-part="mini-toggle"
      data-playing={transportOn ? 'true' : undefined}
      data-needs-gesture={needsGesture && wantPlaying ? 'true' : undefined}
      onClick={() => jukebox.toggle()}
      disabled={!canPlay}
      aria-label={toggleLabel}
      title={toggleLabel}
    >
      <Glyph name={transportOn ? 'pause' : 'play'} size={14} />
    </button>
  );
  const nextBtn = (
    <button
      type="button"
      className="jb-btn jb-btn--icon jb-mini__btn"
      data-part="mini-next"
      onClick={() => jukebox.next()}
      disabled={!canPlay || (source === 'room' && !jukebox.djPermissions().control)}
      aria-label="Next track"
      title="Next track"
    >
      <Glyph name="next" size={14} />
    </button>
  );
  const openBtn = (withIcon: 'jukebox' | 'expand') => (
    <button
      type="button"
      className="jb-btn jb-btn--icon jb-mini__btn jb-mini__open"
      data-part="mini-open"
      aria-expanded={expanded}
      aria-haspopup="dialog"
      onClick={(e) => onToggleOpen('control', e.currentTarget)}
      aria-label={openLabel}
      title={title ? `Jukebox — ${title}` : 'Jukebox'}
    >
      <Glyph name={withIcon} size={withIcon === 'jukebox' ? 18 : 14} />
      {withIcon === 'jukebox' ? <Eq active={playing} /> : null}
    </button>
  );
  const titleEl = (
    <span className="jb-mini__title" data-part="mini-title" onClick={() => onToggleOpen('control')} title={title ?? undefined}>
      <Eq active={playing} />
      <span className="jb-mini__text">{title ?? 'Jukebox'}</span>
    </span>
  );

  const attrs = {
    className: 'jb-root jb-dock',
    'data-jukebox': '',
    'data-state': expanded ? 'expanded' : 'collapsed',
    'data-source': source,
    'data-playing': playing ? 'true' : undefined,
    'data-idle': idle ? 'true' : undefined,
  } as const;

  // The machine itself: one button that walks you up to it (opens the player).
  const nudge = needsGesture && wantPlaying;
  const machineEl = machine
    ? createPortal(
        <div {...attrs} data-dock="floor">
          <button
            type="button"
            className="jb-floor"
            data-part="machine-open"
            data-needs-gesture={nudge ? 'true' : undefined}
            aria-expanded={expanded}
            aria-haspopup="dialog"
            onClick={(e) => onToggleOpen('machine', e.currentTarget)}
            aria-label={openLabel}
          >
            <span className="jb-floor__machine" data-part="machine">
              <FloorJukeboxArt />
            </span>
            {/* Shown on hover / focus (and when it needs a tap): the button's name carries the same text. */}
            <span className="jb-floor__tag" data-part="machine-tag" aria-hidden>
              {/* Whatever a theme calls its music player, the thing standing on the floor is a jukebox. */}
              <span className="jb-floor__name">Jukebox</span>
              <span className="jb-floor__now" data-part="machine-now">
                {title ? <Eq active={playing} /> : null}
                <span className="jb-floor__now-text">{nudge ? 'Tap to resume' : (title ?? 'Pick a song')}</span>
              </span>
            </span>
          </button>
        </div>,
        machine,
      )
    : null;

  /** The compact control: in a toolbar slot, or floating in a free corner. */
  function renderControl() {
    if (slot && slot.kind === 'hidden') return null;
    if (slot) {
      let inner;
      if (slot.kind === 'menu') {
        inner = (
          <div className="jb-mini" data-part="mini" data-variant="menu">
            <button
              type="button"
              className="jb-menu-open"
              data-part="mini-open"
              aria-expanded={expanded}
              aria-haspopup="dialog"
              onClick={() => openFromMenu(() => onToggleOpen('control'))}
              aria-label={openLabel}
            >
              <Glyph name="jukebox" size={16} />
              <span className="jb-menu-open__text">
                <span>Jukebox</span>
                <span className="jb-menu-open__now" data-part="mini-title">
                  {title ?? 'Nothing playing'}
                </span>
              </span>
              <Eq active={playing} />
            </button>
            {currentId ? toggleBtn : null}
          </div>
        );
      } else {
        // A compact slot (the arcade floor, where the machine itself shows what's playing) is just the
        // jukebox button — its equalizer still dances while music plays.
        const compact = slot.host.dataset.jukeboxVariant === 'compact';
        const variant = idle || compact ? 'icon' : topbarWide ? 'wide' : topbarMid ? 'mid' : 'icon';
        inner = (
          <div className="jb-mini" data-part="mini" data-variant={variant}>
            {variant === 'wide' ? titleEl : null}
            {variant !== 'icon' ? toggleBtn : null}
            {variant === 'wide' ? nextBtn : null}
            {openBtn(variant === 'wide' ? 'expand' : 'jukebox')}
          </div>
        );
      }
      return createPortal(
        <div {...attrs} data-dock={slot.kind}>
          {inner}
        </div>,
        slot.host,
      );
    }

    if (!float) return null;
    const style = {
      '--jb-x': `${Math.round(float.box.x)}px`,
      '--jb-y': `${Math.round(float.box.y)}px`,
    } as CSSProperties;
    return (
      <div {...attrs} data-dock="float" data-corner={float.corner} data-kind={float.kind} style={style}>
        {float.kind === 'mini' ? (
          <div className="jb-mini" data-part="mini" data-variant="float">
            {titleEl}
            {toggleBtn}
            {nextBtn}
            {openBtn('expand')}
          </div>
        ) : float.kind === 'pill' ? (
          <div className="jb-mini" data-part="mini" data-variant="pill">
            {openBtn('jukebox')}
            {toggleBtn}
          </div>
        ) : (
          <div className="jb-mini" data-part="mini" data-variant="tab">
            {openBtn('jukebox')}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {machineEl}
      {renderControl()}
    </>
  );
}

function slotSignature(): string {
  return Array.from(document.querySelectorAll(SLOT_WATCH_SELECTOR), (el) => el.className).join('|');
}

function dropHost(host: HTMLElement): void {
  if (host.hasAttribute('data-jukebox-host') && host.isConnected) host.remove();
}

/** Close the immersive shell menu (its own toggle) before opening the player over the game. */
function openFromMenu(open: () => void): void {
  document.querySelector<HTMLButtonElement>('.shell-menu > button[aria-expanded="true"]')?.click();
  open();
}
