/**
 * The record carousel: the shelf of records as sleeves on a turning ring under the dome, plus the
 * "All records" mixtape. The sleeve in the middle faces you with its name plate; its neighbours turn
 * away to either side. The arrows, a swipe, a sideways scroll or ←/→ turn the ring; picking a sleeve
 * puts that record on, the way a real one goes on:
 *
 *   lift  the ring turns the sleeve to the middle and it rises, the tone arm lifts and the old disc
 *         comes off the platter
 *   fly   the vinyl slides out of the sleeve and hops across onto the turntable (RecordFlyer)
 *   land  it settles on the platter, the needle drops and the record's first song starts; the title
 *         strips flip to its songs
 *
 * Reduced motion or visual effects off: the ring turns and the record goes on at once, nothing flies.
 * The swap is only a picture of `jukebox.setRecord(id, { play: true })` — closing the player mid-swap
 * still puts it on. Shows only with two or more records (records.ts `hasShelf`). Geometry: carousel.ts.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type { JukeboxRecord } from '@dascade/shared';
import { useApp } from '../app/store.ts';
import { ALL_RECORDS, jukebox, useJukebox } from '../audio/jukebox/index.ts';
import { slotLook, slotOffset, swipeSteps } from './carousel.ts';
import { Glyph } from './icons.tsx';
import { SleeveArt } from './SleeveArt.tsx';

export type SwapPhase = 'lift' | 'fly' | 'land';
export interface RecordSwap {
  id: string;
  phase: SwapPhase;
}

/** Phase lengths (ms). */
export const SWAP_MS = { lift: 340, fly: 860, land: 420 } as const;

/** The mixtape on the shelf: the listener's "All records" pick, drawn as a record of its own. */
function mixRecord(records: readonly JukeboxRecord[]): JukeboxRecord {
  return {
    id: ALL_RECORDS,
    title: 'All records',
    order: records.length,
    tracks: records.reduce((n, r) => n + r.tracks, 0),
    duration: records.reduce((n, r) => n + r.duration, 0),
  };
}

const songs = (n: number) => `${n} song${n === 1 ? '' : 's'}`;

/** Sleeve accents as CSS variables (the record's own colours, else the theme's accents). */
function accentVars(r: Pick<JukeboxRecord, 'accent' | 'accent2'>): CSSProperties {
  const vars: Record<string, string> = {};
  if (r.accent) vars['--jb-rec-a1'] = r.accent;
  if (r.accent2) vars['--jb-rec-a2'] = r.accent2;
  return vars as CSSProperties;
}

/** The vinyl that flies from the sleeve to the turntable (inside the player panel, so it never escapes it). */
export function RecordFlyer({ swap, record, panel }: { swap: RecordSwap; record: JukeboxRecord; panel: HTMLElement | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !panel) return;
    const sleeve = panel.querySelector<HTMLElement>(`[data-part="sleeve"][data-record="${swap.id}"] .jb-sleeve__cover`);
    const disc = panel.querySelector<HTMLElement>('[data-part="dome"] [data-part="record"] .jb-record__disc');
    if (!sleeve || !disc || typeof el.animate !== 'function') return;
    const p = panel.getBoundingClientRect();
    const from = sleeve.getBoundingClientRect();
    const to = disc.getBoundingClientRect();
    const size = to.width;
    const at = (r: DOMRect, s: number, lift = 0) =>
      `translate(${r.left + r.width / 2 - p.left - size / 2}px, ${r.top + r.height / 2 - p.top - size / 2 - lift}px) scale(${s})`;
    const start = (from.width * 0.9) / size;
    // Slides up out of the sleeve, hops across in an arc spinning backwards, then drops onto the platter.
    const anim = el.animate(
      [
        { transform: `${at(from, start)} rotate(0deg)`, opacity: 0.4, offset: 0 },
        { transform: `${at(from, start, from.height * 0.55)} rotate(-40deg)`, opacity: 1, offset: 0.24 },
        { transform: `${at(to, 1.1, Math.max(36, (from.top - to.top) * 0.35))} rotate(-250deg)`, opacity: 1, offset: 0.7 },
        { transform: `${at(to, 1)} rotate(-360deg)`, opacity: 1, offset: 1 },
      ],
      { duration: SWAP_MS.fly, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' },
    );
    return () => anim.cancel();
  }, [swap.id, panel]);
  return (
    <span ref={ref} className="jb-flyer" data-part="flyer" aria-hidden>
      <svg className="jb-flyer__vinyl" viewBox="0 0 100 100" focusable="false">
        <circle className="jb-record__body" cx="50" cy="50" r="49.5" />
        {[46, 41, 36, 31, 26].map((r) => (
          <circle key={r} className="jb-record__groove" cx="50" cy="50" r={r} />
        ))}
      </svg>
      <span className="jb-flyer__label">
        <SleeveArt record={record} />
      </span>
    </span>
  );
}

/**
 * Runs record swaps: `pick` starts one (or puts the record on at once without motion); `swap` is the
 * phase in progress for the carousel, the turntable and the flyer to draw.
 */
export function useRecordSwap(announce: (msg: string) => void): { swap: RecordSwap | null; pick: (id: string, title: string) => void } {
  const [swap, setSwap] = useState<RecordSwap | null>(null);
  const timers = useRef<number[]>([]);
  const pendingId = useRef<string | null>(null);
  const motion = useApp((s) => !s.settings.reducedMotion && s.settings.fx !== 'off');

  const putOn = useCallback((id: string) => {
    pendingId.current = null;
    jukebox.setRecord(id, { play: true });
  }, []);

  // Closing the player (or anything unmounting the carousel) mid-swap still puts the record on.
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      if (pendingId.current) putOn(pendingId.current);
    },
    [putOn],
  );

  const pick = useCallback(
    (id: string, title: string) => {
      if (pendingId.current) return; // one record at a time
      const s = useJukebox.getState();
      if (id === s.record) {
        // Already on the turntable: just make sure it's playing.
        putOn(id);
        return;
      }
      announce(`Putting on ${title}`);
      if (!motion) {
        putOn(id);
        return;
      }
      pendingId.current = id;
      // Lifting the needle: the old record stops (its song isn't cut off by the new one mid-flight).
      if (s.source === 'personal' && s.wantPlaying) jukebox.pause();
      setSwap({ id, phase: 'lift' });
      const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
      later(SWAP_MS.lift, () => setSwap({ id, phase: 'fly' }));
      later(SWAP_MS.lift + SWAP_MS.fly, () => {
        putOn(id);
        setSwap({ id, phase: 'land' });
      });
      later(SWAP_MS.lift + SWAP_MS.fly + SWAP_MS.land, () => {
        timers.current = [];
        setSwap(null);
      });
    },
    [announce, motion, putOn],
  );

  return { swap, pick };
}

export function RecordCarousel({
  records,
  current,
  swap,
  onPick,
  announce,
}: {
  records: readonly JukeboxRecord[];
  /** The record in effect (ALL_RECORDS = the mix). */
  current: string;
  swap: RecordSwap | null;
  onPick: (id: string, title: string) => void;
  announce: (msg: string) => void;
}) {
  const shelf = useMemo(() => [...records, mixRecord(records)], [records]);
  const n = shelf.length;
  const currentAt = Math.max(0, shelf.findIndex((r) => r.id === current));
  const [at, setAt] = useState(currentAt);
  // The ring turns to the record in effect whenever that changes (a pick, the theme's default, a song
  // from another record); between changes it stays wherever the listener turned it.
  useEffect(() => setAt(currentAt), [currentAt]);
  const swapAt = swap ? shelf.findIndex((r) => r.id === swap.id) : -1;
  const middle = swapAt >= 0 ? swapAt : Math.min(at, n - 1);

  const stageRef = useRef<HTMLDivElement>(null);
  const sleeves = useRef<Array<HTMLButtonElement | null>>([]);
  const drag = useRef<{ x: number; y: number; id: number; moving: boolean } | null>(null);
  const swiped = useRef(false);
  const wheelAt = useRef(0);

  const turn = (steps: number, how: 'focus' | 'announce') => {
    if (swap || steps === 0) return;
    const next = (((middle + steps) % n) + n) % n;
    setAt(next);
    if (how === 'focus') sleeves.current[next]?.focus({ preventScroll: true });
    else announce(`${shelf[next]!.title}, record ${next + 1} of ${n}`);
  };

  const sleevePx = () => sleeves.current[middle]?.offsetWidth ?? 0;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!steps) return;
    e.preventDefault();
    turn(steps, 'focus');
  };

  // Swipe: the ring follows the finger, then settles on the nearest sleeve. A tap is still a pick.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (swap || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moving: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const stage = stageRef.current;
    if (!d || d.id !== e.pointerId || !stage) return;
    const dx = e.clientX - d.x;
    if (!d.moving) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
      d.moving = true;
      stage.setPointerCapture?.(e.pointerId);
      stage.dataset.dragging = 'true';
    }
    const w = sleevePx();
    if (w > 0) stage.style.setProperty('--jb-drag', String(dx / w));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    const stage = stageRef.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moving || !stage) return;
    stage.removeAttribute('data-dragging');
    stage.style.removeProperty('--jb-drag');
    swiped.current = true;
    window.setTimeout(() => (swiped.current = false), 0);
    if (!cancelled) turn(swipeSteps(e.clientX - d.x, sleevePx(), n), 'announce');
  };

  // A sideways scroll (trackpad) turns the ring one sleeve at a time.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) < 24 || Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    const now = performance.now();
    if (now - wheelAt.current < 380) return;
    wheelAt.current = now;
    turn(e.deltaX > 0 ? 1 : -1, 'announce');
  };

  const pickAt = (i: number) => {
    if (swiped.current) return;
    const r = shelf[i]!;
    setAt(i);
    onPick(r.id, r.title);
  };

  return (
    <div className="jb-carousel" data-part="carousel" data-swapping={swap ? 'true' : undefined}>
      <div
        ref={stageRef}
        className="jb-carousel__stage"
        role="group"
        aria-roledescription="carousel"
        aria-label="Records"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        onWheel={onWheel}
      >
        {shelf.map((r, i) => {
          const look = slotLook(slotOffset(i, middle, n));
          const state = swap?.id === r.id && swap.phase === 'lift' ? 'lift' : swap?.id === r.id ? 'empty' : r.id === current && !swap ? 'playing' : 'rest';
          const mix = r.id === ALL_RECORDS;
          const label = mix ? `Put on the All records mix (every record, shuffled)` : `Put on ${r.title} (${songs(r.tracks)})`;
          return (
            <button
              key={r.id}
              ref={(el) => {
                sleeves.current[i] = el;
              }}
              type="button"
              className="jb-sleeve"
              data-part="sleeve"
              data-record={r.id}
              data-state={state}
              data-pair={r.theme}
              data-middle={i === middle ? 'true' : undefined}
              data-far={look.far ? 'true' : undefined}
              aria-pressed={r.id === current}
              aria-label={r.id === current ? `${r.title} is on the turntable` : label}
              title={r.title}
              style={
                {
                  ...accentVars(r),
                  '--jb-x': look.x,
                  '--jb-turn': `${look.turn}deg`,
                  '--jb-scale': look.scale,
                  '--jb-dim': look.dim,
                  zIndex: look.z,
                } as CSSProperties
              }
              onFocus={(e) => {
                // Tabbing to a sleeve turns the ring to it (a click turns it as part of the pick).
                if (focusVisible(e.currentTarget)) setAt(i);
              }}
              onClick={() => pickAt(i)}
            >
              <span className="jb-sleeve__cover">
                <SleeveArt record={r} />
                <span className="jb-sleeve__plate" aria-hidden>
                  <b>{r.title}</b>
                  <i>{mix ? `Mix · ${songs(r.tracks)}` : r.artist ? `${r.artist} · ${songs(r.tracks)}` : songs(r.tracks)}</i>
                </span>
              </span>
              <span className="jb-sleeve__tag" aria-hidden>
                Now spinning
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="jb-btn jb-btn--icon jb-carousel__turn"
        data-part="carousel-prev"
        data-dir="prev"
        aria-label="Previous record"
        disabled={swap !== null}
        onClick={() => turn(-1, 'announce')}
      >
        <Glyph name="left" size={14} />
      </button>
      <button
        type="button"
        className="jb-btn jb-btn--icon jb-carousel__turn"
        data-part="carousel-next"
        data-dir="next"
        aria-label="Next record"
        disabled={swap !== null}
        onClick={() => turn(1, 'announce')}
      >
        <Glyph name="right" size={14} />
      </button>
      <div className="jb-carousel__dots" aria-hidden>
        {shelf.map((r, i) => (
          <span key={r.id} className="jb-carousel__dot" data-middle={i === middle ? 'true' : undefined} data-on={r.id === current ? 'true' : undefined} />
        ))}
      </div>
    </div>
  );
}

function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** The record (or the mix) a swap is putting on, for the flyer. */
export function swapRecord(records: readonly JukeboxRecord[], id: string): JukeboxRecord | null {
  if (id === ALL_RECORDS) return mixRecord(records);
  return records.find((r) => r.id === id) ?? null;
}
