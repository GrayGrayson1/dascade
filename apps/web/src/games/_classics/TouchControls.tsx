/**
 * On-screen controls for the Classics: hold-able pixel buttons, a d-pad, and a gesture hook
 * (tap / swipe / drag) for the playfield. Every control is a real <button> with an accessible
 * name; targets are ≥ 48px. Buttons feed an IntentInput (press/release/tap).
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { PixelIcon, cx, type IconName } from '@dascade/ui';
import type { IntentInput } from './input.ts';

export interface TouchButtonProps<I extends string> {
  input: IntentInput<I>;
  intent: I;
  label: string;
  icon?: IconName;
  text?: string;
  /** 'hold' keeps the intent down while pressed (movement); 'tap' fires once (rotate, drop). */
  mode?: 'hold' | 'tap';
  size?: 'md' | 'lg';
  tone?: 'accent' | 'plain' | 'hot';
  className?: string;
}

export function TouchButton<I extends string>({ input, intent, label, icon, text, mode = 'hold', size = 'md', tone = 'plain', className }: TouchButtonProps<I>) {
  const held = useRef(false);
  const release = () => {
    if (!held.current) return;
    held.current = false;
    input.release(intent);
  };
  useEffect(() => () => release(), []); // eslint-disable-line react-hooks/exhaustive-deps -- release on unmount only
  return (
    <button
      type="button"
      className={cx('cl-tbtn', `cl-tbtn--${size}`, `cl-tbtn--${tone}`, className)}
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture?.(e.pointerId);
        if (mode === 'tap') {
          input.tap(intent);
          return;
        }
        held.current = true;
        input.press(intent);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // Keyboard activation of the on-screen button (accessibility): one tap.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.tap(intent);
        }
      }}
    >
      {icon ? <PixelIcon name={icon} size={size === 'lg' ? 22 : 18} /> : null}
      {text ? <span className="cl-tbtn__text">{text}</span> : null}
    </button>
  );
}

/** Pixel d-pad. Pass only the directions a game uses (missing ones render as blanks). */
export function DPad<I extends string>({
  input,
  up,
  down,
  left,
  right,
  labels = {},
  upMode = 'tap',
  downMode = 'hold',
}: {
  input: IntentInput<I>;
  up?: I;
  down?: I;
  left?: I;
  right?: I;
  labels?: { up?: string; down?: string; left?: string; right?: string };
  upMode?: 'hold' | 'tap';
  downMode?: 'hold' | 'tap';
}) {
  return (
    <div className="cl-dpad" role="group" aria-label="Direction pad">
      <span className="cl-dpad__cell cl-dpad__up">{up ? <TouchButton input={input} intent={up} mode={upMode} label={labels.up ?? 'Up'} icon="chevron-up" /> : null}</span>
      <span className="cl-dpad__cell cl-dpad__left">{left ? <TouchButton input={input} intent={left} label={labels.left ?? 'Left'} icon="arrow-left" /> : null}</span>
      <span className="cl-dpad__hub" aria-hidden />
      <span className="cl-dpad__cell cl-dpad__right">{right ? <TouchButton input={input} intent={right} label={labels.right ?? 'Right'} icon="arrow-right" /> : null}</span>
      <span className="cl-dpad__cell cl-dpad__down">{down ? <TouchButton input={input} intent={down} mode={downMode} label={labels.down ?? 'Down'} icon="chevron-down" /> : null}</span>
    </div>
  );
}

/**
 * Virtual analog stick. Reports a vector in [-1, 1]² through `onVector` (for analog games) and/or
 * holds mapped intents on an IntentInput past a dead zone (left/right/up/down). Released → centred.
 */
export function TouchStick<I extends string>({
  input,
  map,
  onVector,
  label = 'Movement stick',
  size = 124,
  dead = 0.3,
}: {
  input?: IntentInput<I>;
  map?: { left?: I; right?: I; up?: I; down?: I };
  onVector?: (x: number, y: number, active: boolean) => void;
  label?: string;
  size?: number;
  dead?: number;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLSpanElement>(null);
  const held = useRef(new Set<I>());
  const id = useRef<number | null>(null);
  const setHeld = (want: Set<I>) => {
    if (!input) return;
    for (const i of held.current) if (!want.has(i)) input.release(i);
    for (const i of want) if (!held.current.has(i)) input.press(i);
    held.current = want;
  };
  const update = (clientX: number, clientY: number) => {
    const el = baseRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const radius = r.width / 2;
    let x = (clientX - (r.left + radius)) / radius;
    let y = (clientY - (r.top + radius)) / radius;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${x * radius * 0.55}px, ${y * radius * 0.55}px)`;
    onVector?.(x, y, true);
    const want = new Set<I>();
    if (map?.left && x < -dead) want.add(map.left);
    if (map?.right && x > dead) want.add(map.right);
    if (map?.up && y < -dead) want.add(map.up);
    if (map?.down && y > dead) want.add(map.down);
    setHeld(want);
  };
  const end = () => {
    id.current = null;
    if (knobRef.current) knobRef.current.style.transform = '';
    onVector?.(0, 0, false);
    setHeld(new Set());
  };
  useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps -- release on unmount only
  return (
    <div
      ref={baseRef}
      className="cl-stick"
      style={{ width: size, height: size }}
      role="group"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        id.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === id.current) update(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => e.pointerId === id.current && end()}
      onPointerCancel={(e) => e.pointerId === id.current && end()}
      onLostPointerCapture={(e) => e.pointerId === id.current && end()}
    >
      <span ref={knobRef} className="cl-stick__knob" aria-hidden />
    </div>
  );
}

/** Bottom control deck: left cluster + right cluster (hidden on fine pointers unless `always`). */
export function TouchDeck({ left, right, center, always, className }: { left?: ReactNode; right?: ReactNode; center?: ReactNode; always?: boolean; className?: string }) {
  return (
    <div className={cx('cl-deck', always && 'cl-deck--always', className)} data-part="controls">
      <div className="cl-deck__side">{left}</div>
      {center ? <div className="cl-deck__center">{center}</div> : null}
      <div className="cl-deck__side cl-deck__side--right">{right}</div>
    </div>
  );
}

export interface GestureHandlers {
  onTap?: (x: number, y: number) => void;
  onSwipe?: (dir: 'left' | 'right' | 'up' | 'down', velocity: number) => void;
  /** Continuous drag: total dx/dy (CSS px) since the gesture started. */
  onDrag?: (dx: number, dy: number, phase: 'start' | 'move' | 'end', e: PointerEvent) => void;
}

/**
 * Tap / swipe / drag recognition on an element (touch and pen; mouse too when `mouse`).
 * A tap is < 10 px of travel within 260 ms; a swipe is a quick flick (> 0.5 px/ms).
 */
export function useGestures(ref: RefObject<HTMLElement | null>, handlers: GestureHandlers, opts: { mouse?: boolean } = {}): void {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let id: number | null = null;
    let sx = 0;
    let sy = 0;
    let st = 0;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let vx = 0;
    let vy = 0;
    const accept = (e: PointerEvent) => opts.mouse || e.pointerType !== 'mouse';
    const down = (e: PointerEvent) => {
      if (!accept(e) || id !== null) return;
      id = e.pointerId;
      sx = lastX = e.clientX;
      sy = lastY = e.clientY;
      st = lastT = performance.now();
      vx = vy = 0;
      el.setPointerCapture?.(e.pointerId);
      h.current.onDrag?.(0, 0, 'start', e);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      vx = vx * 0.6 + ((e.clientX - lastX) / dt) * 0.4;
      vy = vy * 0.6 + ((e.clientY - lastY) / dt) * 0.4;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = now;
      h.current.onDrag?.(e.clientX - sx, e.clientY - sy, 'move', e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      const dur = performance.now() - st;
      h.current.onDrag?.(dx, dy, 'end', e);
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dur < 260) {
        h.current.onTap?.(e.clientX, e.clientY);
        return;
      }
      const speed = Math.max(Math.abs(vx), Math.abs(vy));
      if (speed > 0.5) {
        if (Math.abs(vx) > Math.abs(vy)) h.current.onSwipe?.(vx > 0 ? 'right' : 'left', speed);
        else h.current.onSwipe?.(vy > 0 ? 'down' : 'up', speed);
      }
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      h.current.onDrag?.(0, 0, 'end', e);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [ref, opts.mouse]);
}
