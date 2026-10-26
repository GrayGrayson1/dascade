/**
 * Press-and-hold (PRS-03 D): a button that only acts once it has been held for `ms` (0.8 s for
 * actions Undo can take back; 1.2 s for End show). A ring fills while it's held; letting go early,
 * sliding off it or losing focus does nothing at all. Keyboard: hold Enter or Space. Under reduced
 * motion the ring doesn't animate: the progress is written out instead.
 *
 * A pointer click never acts: it only says "press and hold". Screen readers can't hold (VoiceOver
 * and TalkBack double-taps, NVDA's browse-mode Enter all arrive as a click with `detail === 0` and no
 * key events): for them a first such click arms "press again to confirm" (announced), and a second
 * one within 4 s acts. The console's R key drives the same button through its handle (`start` on
 * keydown, `cancel` on keyup), so the ring shows a held key too.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Kbd, PixelIcon, cx, type IconName } from '@dascade/ui';
import { useMotion } from './state.ts';

// ---------------------------------------------------------------------------
// The timing (pure; unit-tested with fake timers)
// ---------------------------------------------------------------------------

export interface HoldController {
  /** Starts a hold (false: already holding). */
  start(): boolean;
  /** Lets go: true if a hold was running and hadn't fired (an early release). */
  cancel(): boolean;
  readonly holding: boolean;
  /** 0…1 of the hold so far (0 when not holding). */
  progress(): number;
  /** Stops everything (unmount). */
  dispose(): void;
}

/**
 * The hold's clock: `onFire` runs once, `ms` after `start()`, unless `cancel()` came first. A second
 * `start()` while holding is ignored (a key's auto-repeat, a second finger).
 */
export function createHoldController(ms: number, onFire: () => void, now: () => number = () => Date.now()): HoldController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startedAt = 0;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    start() {
      if (timer !== null) return false;
      startedAt = now();
      timer = setTimeout(() => {
        timer = null;
        onFire();
      }, ms);
      return true;
    },
    cancel() {
      if (timer === null) return false;
      clear();
      return true;
    },
    get holding() {
      return timer !== null;
    },
    progress() {
      return timer === null ? 0 : Math.max(0, Math.min(1, (now() - startedAt) / ms));
    },
    dispose: clear,
  };
}

/** An assistive technology's confirm: the second synthetic click must come within this window. */
export const AT_CONFIRM_MS = 4000;

/**
 * A screen reader's click (detail 0): the first arms, a second within `windowMs` fires. Returns
 * whether to act, and when the confirm was armed (null once it fired).
 */
export function atClick(armedAt: number | null, now: number, windowMs = AT_CONFIRM_MS): { fire: boolean; armedAt: number | null } {
  if (armedAt !== null && now - armedAt <= windowMs) return { fire: true, armedAt: null };
  return { fire: false, armedAt: now };
}

/** A click this soon after Enter / Space on the button came from that key, not from a screen reader. */
const KEY_CLICK_MS = 600;

// ---------------------------------------------------------------------------
// The button
// ---------------------------------------------------------------------------

export interface HoldButtonHandle {
  /** Starts a hold as if the button were pressed (the console's R key). */
  start(): void;
  /** Lets go (keyup). */
  cancel(): void;
}

export interface HoldButtonProps {
  /** The accessible name (the visible text may be shorter). */
  label: string;
  children: ReactNode;
  onFire: () => void;
  ms?: number;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Keycap shown after the text (e.g. R). */
  kbd?: string;
  block?: boolean;
  disabled?: boolean;
  className?: string;
  /** Extra attributes for tests and the tour. */
  'data-part'?: string;
  'data-urgent'?: string;
}

type Phase = 'idle' | 'holding' | 'early' | 'confirm' | 'done';

const SECONDS = (ms: number) => `${(ms / 1000).toFixed(1).replace(/\.0$/, '')} s`;

export const HoldButton = forwardRef<HoldButtonHandle, HoldButtonProps>(function HoldButton(
  { label, children, onFire, ms = 800, variant = 'secondary', size = 'md', icon, kbd, block, disabled, className, ...data },
  ref,
) {
  const { motion } = useMotion();
  const hintId = useId();
  const fire = useRef(onFire);
  fire.current = onFire;
  const [phase, setPhase] = useState<Phase>('idle');
  const [p, setP] = useState(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When Enter / Space last touched this button (their clicks are suppressed; never an AT confirm). */
  const keyAt = useRef(0);
  /** A screen reader's first click armed the confirm at… (null: not armed). */
  const atArmed = useRef<number | null>(null);

  const ctl = useMemo(
    () =>
      createHoldController(ms, () => {
        setP(1);
        setPhase('done');
        fire.current();
      }),
    [ms],
  );
  useEffect(
    () => () => {
      ctl.dispose();
      if (settle.current) clearTimeout(settle.current);
    },
    [ctl],
  );

  const after = useCallback((next: Phase, wait: number) => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      setPhase((cur) => (cur === next ? 'idle' : cur));
      setP(0);
    }, wait);
  }, []);

  const start = useCallback(() => {
    if (disabled || !ctl.start()) return;
    if (settle.current) clearTimeout(settle.current);
    setP(0);
    setPhase('holding');
  }, [ctl, disabled]);

  const cancel = useCallback(() => {
    if (!ctl.cancel()) return;
    setP(0);
    setPhase('early');
    after('early', 1800);
  }, [ctl, after]);

  useImperativeHandle(ref, () => ({ start, cancel }), [start, cancel]);

  // The fill follows the hold frame by frame (or 10× a second, written out, under reduced motion).
  useEffect(() => {
    if (phase !== 'holding') return;
    let raf = 0;
    let iv: ReturnType<typeof setInterval> | null = null;
    if (motion) {
      const step = () => {
        setP(ctl.progress());
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    } else iv = setInterval(() => setP(ctl.progress()), 100);
    return () => {
      cancelAnimationFrame(raf);
      if (iv) clearInterval(iv);
    };
  }, [phase, motion, ctl]);

  // A fired hold shows its full ring for a moment, then rests.
  useEffect(() => {
    if (phase === 'done') after('done', 600);
  }, [phase, after]);

  // Disabled mid-hold (the action stopped making sense): let go quietly.
  useEffect(() => {
    if (disabled && ctl.holding) {
      ctl.cancel();
      setPhase('idle');
      setP(0);
    }
  }, [disabled, ctl]);

  // What a screen reader hears (and, for an early release, what everyone reads under the button).
  const status =
    phase === 'holding'
      ? 'Keep holding…'
      : phase === 'early'
        ? 'Press and hold — a click alone does nothing'
        : phase === 'confirm'
          ? `Press again to confirm: ${label}`
          : '';
  /** Reduced motion: the progress, written out in place of the label while it's held. */
  const progressText = !motion && phase === 'holding' ? `Keep holding… ${Math.round(p * 100)}%` : '';

  return (
    <button
      type="button"
      className={cx('dc-btn', `dc-btn--${variant}`, size !== 'md' && `dc-btn--${size}`, block && 'dc-btn--block', 'sdc-hold', className)}
      style={{ '--hold': p } as CSSProperties}
      data-phase={phase}
      data-motion={motion ? 'on' : 'off'}
      disabled={disabled}
      aria-label={label}
      aria-describedby={hintId}
      title={`${label} — press and hold for ${SECONDS(ms)}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onContextMenu={(e) => {
        // A long press on a touch screen would open the context menu.
        if (ctl.holding) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        keyAt.current = Date.now();
        // Never the native click, and never the console's own shortcuts (Space takes the special).
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        keyAt.current = Date.now();
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
      onClick={(e) => {
        e.preventDefault();
        if (disabled || ctl.holding) return;
        // A screen reader's activation: two in a row (within 4 s) confirm, announced in between.
        if (e.detail === 0 && Date.now() - keyAt.current > KEY_CLICK_MS) {
          const step = atClick(atArmed.current, Date.now());
          atArmed.current = step.armedAt;
          if (step.fire) {
            setPhase('done');
            setP(1);
            fire.current();
          } else {
            setPhase('confirm');
            after('confirm', AT_CONFIRM_MS);
          }
          return;
        }
        // A pointer click alone never acts: it gets the hint.
        if (phase === 'idle') {
          setPhase('early');
          after('early', 1800);
        }
      }}
      {...data}
    >
      <span className="sdc-hold__fill" aria-hidden />
      {motion ? (
        <span className="sdc-hold__ring" aria-hidden>
          <svg viewBox="0 0 20 20" focusable="false">
            <circle cx="10" cy="10" r="8" />
            <circle cx="10" cy="10" r="8" className="sdc-hold__arc" style={{ strokeDashoffset: 50.27 * (1 - p) }} />
          </svg>
        </span>
      ) : icon ? (
        <PixelIcon name={icon} />
      ) : null}
      <span className="sdc-hold__text">{progressText || children}</span>
      {kbd ? <Kbd>{kbd}</Kbd> : null}
      <span id={hintId} className="visually-hidden">
        Press and hold for {SECONDS(ms)}, or hold Enter.
      </span>
      <span className="sdc-hold__status" aria-live="polite" data-on={phase === 'early' || phase === 'confirm' ? 'true' : undefined}>
        {status}
      </span>
    </button>
  );
});
