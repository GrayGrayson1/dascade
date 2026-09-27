/**
 * Seek bar + time readout. A native range input (slider semantics, keyboard, touch for free) whose
 * value is driven from `jukebox.currentTime()` at rAF rate while the player is open and playing —
 * written straight to the DOM, never through React state. With reduced motion or effects MINIMAL
 * there is no loop: the store-rate (≤ 4/s) update keeps the bar and readout right.
 */
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useApp } from '../app/store.ts';
import { jukebox, useJukebox } from '../audio/jukebox/index.ts';
import { formatTime, spokenTime } from './format.ts';

export interface SeekProps {
  active: boolean;
  disabled?: boolean;
  /** Where a seek goes (personal engine or the Room DJ). */
  onSeek: (seconds: number) => void;
  /** Precise position source (defaults to the engine's element clock). */
  now?: () => number;
}

export function Seek({ active, disabled, onSeek, now = () => jukebox.currentTime() }: SeekProps) {
  const duration = useJukebox((s) => s.duration);
  const position = useJukebox((s) => s.position);
  const playing = useJukebox((s) => s.playing);
  const currentId = useJukebox((s) => s.currentId);
  const smooth = useApp((s) => !s.settings.reducedMotion && s.settings.fx !== 'off');
  const inputRef = useRef<HTMLInputElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const nowRef = useRef(now);
  nowRef.current = now;
  const max = duration > 0 ? duration : 0;

  // Paint helper shared by the rAF loop and the store-rate fallback.
  const paint = useRef((t: number, force = false) => {
    const input = inputRef.current;
    if (!input) return;
    const d = Number(input.max) || 0;
    const v = Math.max(0, Math.min(d, t));
    if (!dragging.current || force) {
      input.value = String(v);
      input.style.setProperty('--fill', d > 0 ? `${(v / d) * 100}%` : '0%');
    }
    const secs = Math.floor(v);
    if (curRef.current && curRef.current.dataset.s !== String(secs)) {
      curRef.current.dataset.s = String(secs);
      curRef.current.textContent = formatTime(v);
      input.setAttribute('aria-valuetext', `${spokenTime(v)} of ${spokenTime(d)}`);
    }
  });

  // Store-rate (≤ 4/s) update: always, so the readout is right even when the loop isn't running.
  useEffect(() => {
    paint.current(position);
  }, [position, max, currentId]);

  useEffect(() => {
    if (!active || !playing || !smooth) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      paint.current(nowRef.current());
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, playing, smooth]);

  const commit = (v: number) => {
    dragging.current = false;
    if (!disabled && Number.isFinite(v)) onSeek(Math.max(0, Math.min(max, v)));
  };

  // React's onChange on a range is the *input* event; seeking must wait for the native `change`
  // (pointer released), or a drag would fire dozens of seeks.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onChange = () => commitRef.current(Number(input.value));
    input.addEventListener('change', onChange);
    return () => input.removeEventListener('change', onChange);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled || max <= 0) return;
    const cur = Number(e.currentTarget.value) || 0;
    const delta: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -15, PageUp: 15 };
    let target: number | null = null;
    if (e.key in delta) target = cur + delta[e.key]!;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = Math.max(0, max - 1);
    if (target === null) return;
    e.preventDefault();
    paint.current(target, true);
    commit(target);
  };

  return (
    <div className="jb-seek-row">
      <input
        ref={inputRef}
        type="range"
        className="jb-seek"
        data-part="seek"
        min={0}
        max={max}
        step="any"
        defaultValue={0}
        disabled={disabled || max <= 0}
        aria-label="Seek"
        onPointerDown={() => (dragging.current = true)}
        onInput={(e) => {
          dragging.current = true;
          const v = Number(e.currentTarget.value);
          e.currentTarget.style.setProperty('--fill', max > 0 ? `${(v / max) * 100}%` : '0%');
          if (curRef.current) {
            curRef.current.textContent = formatTime(v);
            curRef.current.dataset.s = '';
          }
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={onKeyDown}
      />
      <span className="jb-time" data-part="time">
        <span ref={curRef} className="jb-time__cur">
          0:00
        </span>
        <span className="jb-time__sep" aria-hidden>
          /
        </span>
        <span className="jb-time__dur">{formatTime(max)}</span>
      </span>
    </div>
  );
}
