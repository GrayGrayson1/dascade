/**
 * The record crate ("Crate Dig"): the shelf of records as sleeves standing in a wooden crate under the
 * dome, plus the "All records" mixtape. Hover or focus tilts a sleeve forward; picking one puts the record
 * on, the way a real one goes on:
 *
 *   lift  the sleeve rises out of the crate, the tone arm lifts and the old disc comes off the platter
 *   fly   the vinyl slides out of the sleeve and hops across onto the turntable (RecordFlyer)
 *   land  it settles on the platter, the needle drops and the record's first song starts; the title
 *         strips flip to its songs
 *
 * Reduced motion or visual effects off: the record goes on at once, nothing flies. The swap is only a
 * picture of `jukebox.setRecord(id, { play: true })` — closing the player mid-swap still puts it on.
 * Shows only with two or more records (records.ts `hasShelf`).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { JukeboxRecord } from '@dascade/shared';
import { useApp } from '../app/store.ts';
import { ALL_RECORDS, jukebox, useJukebox } from '../audio/jukebox/index.ts';
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
 * phase in progress for the crate, the turntable and the flyer to draw.
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

  // Closing the player (or anything unmounting the crate) mid-swap still puts the record on.
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

export function RecordCrate({
  records,
  current,
  swap,
  onPick,
}: {
  records: readonly JukeboxRecord[];
  /** The record in effect (ALL_RECORDS = the mix). */
  current: string;
  swap: RecordSwap | null;
  onPick: (id: string, title: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const shelf = [...records, mixRecord(records)];
  const named = shelf.find((r) => r.id === (hover ?? swap?.id ?? current)) ?? shelf[0]!;
  const onTurntable = !swap && named.id === current;
  return (
    <div className="jb-crate" data-part="crate" data-swapping={swap ? 'true' : undefined}>
      <div className="jb-crate__row" role="group" aria-label="Records" onPointerLeave={() => setHover(null)}>
        {shelf.map((r, i) => {
          const state = swap?.id === r.id && swap.phase === 'lift' ? 'lift' : swap?.id === r.id ? 'empty' : r.id === current && !swap ? 'playing' : 'rest';
          const label = r.id === ALL_RECORDS ? `Put on the All records mix (every record, shuffled)` : `Put on ${r.title} (${songs(r.tracks)})`;
          return (
            <button
              key={r.id}
              type="button"
              className="jb-sleeve"
              data-part="sleeve"
              data-record={r.id}
              data-state={state}
              data-pair={r.theme}
              aria-pressed={r.id === current}
              aria-label={r.id === current ? `${r.title} is on the turntable` : label}
              title={r.title}
              style={{ ...accentVars(r), zIndex: i + 1 } as CSSProperties}
              onPointerEnter={() => setHover(r.id)}
              onFocus={() => setHover(r.id)}
              onBlur={() => setHover(null)}
              onClick={() => onPick(r.id, r.title)}
            >
              <span className="jb-sleeve__cover">
                <SleeveArt record={r} />
                <span className="jb-sleeve__band" aria-hidden>
                  {r.id === ALL_RECORDS ? 'Mix' : r.title}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="jb-crate__front" aria-hidden>
        <span className="jb-crate__card" data-on={onTurntable ? 'true' : undefined}>
          <span className="jb-crate__name">{named.title}</span>
          <span className="jb-crate__meta">
            {onTurntable ? 'On now · ' : ''}
            {named.id === ALL_RECORDS ? `${songs(named.tracks)}, shuffled` : songs(named.tracks)}
          </span>
        </span>
      </div>
    </div>
  );
}

/** The record (or the mix) a swap is putting on, for the flyer. */
export function swapRecord(records: readonly JukeboxRecord[], id: string): JukeboxRecord | null {
  if (id === ALL_RECORDS) return mixRecord(records);
  return records.find((r) => r.id === id) ?? null;
}
