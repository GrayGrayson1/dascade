/**
 * Pure math + input state for the cabinet lineup carousel (no DOM, unit tested).
 *
 * Positions are measured in "slots": the active cabinet sits at offset 0, its
 * neighbours at ±1, ±2… Offsets may be fractional while the lineup is moving
 * (dragging, springing). Horizontal distances are returned in *face widths* of
 * the active cabinet so the layout scales with any viewport.
 */

export interface SlotStyle {
  /** Horizontal offset of the cabinet's face centre, in active-face widths. */
  x: number;
  /** Vertical lift (negative = up, towards the horizon), in active-face widths. */
  y: number;
  scale: number;
  /** Stacking order (active on top). */
  z: number;
  /** 0 → fully lit, 1 → black. Applied as a shade overlay (cheaper than a filter). */
  shade: number;
  /**
   * Which side panel shows and how much: > 0 reveals the LEFT panel (cabinet is
   * right of centre, its left side faces the camera), < 0 the RIGHT panel.
   * Magnitude 0‥1.
   */
  side: number;
  opacity: number;
  /** rotateY in degrees (0 when motion is reduced). */
  tilt: number;
}

export const COVERFLOW = {
  /** Perspective falloff: scale = 1 / (1 + k·|offset|). */
  k: 0.32,
  /** Spacing multiplier for the log-compressed horizontal curve. */
  spread: 1.2,
  /** Horizon lift for far cabinets. */
  lift: 0.2,
  /** Offsets beyond this fade out. */
  maxVisible: 3.5,
  /** Shade per slot away from centre (capped). */
  shadeStep: 0.3,
  shadeMax: 0.74,
  tilt: 7,
} as const;

export function slotScale(u: number): number {
  return 1 / (1 + COVERFLOW.k * Math.abs(u));
}

/** Distance from centre for |offset| = u (monotonic, log-compressed so far cabinets bunch up). */
export function slotX(u: number, spread: number = COVERFLOW.spread): number {
  const a = Math.abs(u);
  return (spread * Math.log(1 + COVERFLOW.k * a)) / COVERFLOW.k;
}

export interface CoverflowOptions {
  reduced?: boolean;
  /** Horizontal spacing multiplier (wide screens spread the lineup out). */
  spread?: number;
  /** Offsets beyond this fade out over one slot. */
  maxVisible?: number;
}

/**
 * Chooses spacing + visible range for a stage: wide stages spread the lineup so
 * more cabinets fit edge to edge; narrow ones keep the default spacing (the
 * neighbours peek in from the edges). All values in active-face widths.
 *
 * `clear`: the stage's ends are taken (the floor's machines stand there), so a
 * cabinet only shows if it fits entirely inside the half width — the next one
 * out is fully faded rather than peeking in over them.
 */
export function lineupFit(halfWidthInFaces: number, count: number, clear = false): Required<Pick<CoverflowOptions, 'spread' | 'maxVisible'>> {
  const side = Math.max(1, Math.floor((count - 1) / 2) + 1);
  // Try to show every cabinet on each side; fall back to what fits at the default spread.
  const base = slotX(side, 1);
  const wanted = (halfWidthInFaces - 0.45) / base;
  const spread = Math.max(COVERFLOW.spread, Math.min(1.75, wanted));
  let maxVisible: number = COVERFLOW.maxVisible;
  for (let u = 1; u <= count; u++) {
    const overflows = clear
      ? slotX(u, spread) + slotScale(u) * 0.5 > halfWidthInFaces
      : slotX(u, spread) - slotScale(u) * 0.5 > halfWidthInFaces + 0.2;
    if (overflows) {
      maxVisible = clear ? Math.max(1, u - 1) : Math.max(1.2, u - 0.5);
      break;
    }
    maxVisible = u + 0.5;
  }
  return { spread, maxVisible };
}

export function coverflowSlot(offset: number, opts: CoverflowOptions | boolean = {}): SlotStyle {
  const o: CoverflowOptions = typeof opts === 'boolean' ? { reduced: opts } : opts;
  const reduced = o.reduced ?? false;
  const maxVisible = o.maxVisible ?? COVERFLOW.maxVisible;
  const u = Math.abs(offset);
  const sign = offset < 0 ? -1 : offset > 0 ? 1 : 0;
  const scale = slotScale(u);
  const fade = u <= maxVisible ? 1 : Math.max(0, 1 - (u - maxVisible));
  const side = Math.max(-1, Math.min(1, offset * 1.4));
  return {
    x: sign * slotX(u, o.spread),
    y: -(1 - scale) * COVERFLOW.lift,
    scale,
    z: Math.round(1000 - u * 100),
    shade: Math.min(COVERFLOW.shadeMax, u * COVERFLOW.shadeStep),
    side: Object.is(side, -0) ? 0 : side,
    opacity: fade,
    tilt: reduced ? 0 : -Math.max(-1, Math.min(1, offset)) * COVERFLOW.tilt,
  };
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------
export function clampIndex(i: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(i)));
}

export function stepIndex(i: number, delta: number, count: number): number {
  return clampIndex(i + delta, count);
}

/** The lineup opens centred on the remembered cabinet, else on the middle of the row. */
export function initialIndex<T>(ids: readonly T[], remembered: T | null | undefined): number {
  const at = remembered == null ? -1 : ids.indexOf(remembered);
  return at >= 0 ? at : Math.floor((ids.length - 1) / 2);
}

/**
 * Where a released drag should settle. `pos` is the fractional position when
 * released, `velocity` is in slots per millisecond (positive = towards higher
 * indices). A flick projects forward; a slow release rounds to the nearest.
 * Always moves at least one slot for a clear flick even if the drag was short.
 */
export function releaseTarget(pos: number, velocity: number, start: number, count: number): number {
  const v = Number.isFinite(velocity) ? velocity : 0;
  const here = Math.round(pos);
  // Momentum carries at most one cabinet past where the finger let go.
  let target = Math.max(here - 1, Math.min(here + 1, Math.round(pos + v * 120)));
  // A deliberate flick (fast, short) should still advance one cabinet.
  if (target === start && Math.abs(v) > 0.0025) target = start + Math.sign(v);
  // Never jump more than 3 cabinets from where the drag started in one throw.
  target = Math.max(start - 3, Math.min(start + 3, target));
  return clampIndex(target, count);
}

// ---------------------------------------------------------------------------
// Spring (critically damped) for the lineup position
// ---------------------------------------------------------------------------
export interface SpringState {
  pos: number;
  vel: number;
}

/**
 * Advances a critically damped spring towards `target` by `dt` seconds.
 * `omega` controls stiffness (higher = snappier). Stable for any dt.
 */
export function springStep(s: SpringState, target: number, dt: number, omega = 13): SpringState {
  const x = s.pos - target;
  const e = Math.exp(-omega * dt);
  const c = s.vel + omega * x;
  const pos = target + (x + c * dt) * e;
  const vel = (s.vel - omega * c * dt) * e;
  return { pos, vel };
}

export function springSettled(s: SpringState, target: number): boolean {
  return Math.abs(s.pos - target) < 0.0015 && Math.abs(s.vel) < 0.01;
}

// ---------------------------------------------------------------------------
// Wheel / trackpad: one cabinet per gesture
// ---------------------------------------------------------------------------
export interface WheelInput {
  /** event.timeStamp (ms). */
  t: number;
  deltaX: number;
  deltaY: number;
  /** 0 = pixels, 1 = lines, 2 = pages. */
  deltaMode: number;
  /** Whether vertical wheel movement may browse (false when the page itself scrolls vertically). */
  allowVertical: boolean;
}

const LINE_PX = 33;
const PAGE_PX = 600;

/**
 * Turns a stream of wheel events into discrete steps:
 *  - a trackpad swipe (a continuous ~60 Hz stream of small deltas, then
 *    inertia) → exactly one step;
 *  - a notched mouse wheel (isolated large deltas) → one step per notch, at
 *    most one per `notchGapMs`; spinning it continuously counts as one gesture.
 * A gesture ends after `quietMs` without events.
 */
export class WheelStepper {
  private last = -Infinity;
  private acc = 0;
  private locked = false;
  private lastStep = -Infinity;

  constructor(
    private readonly threshold = 26,
    private readonly quietMs = 180,
    private readonly notchGapMs = 110,
  ) {}

  /** Returns -1, 0 or 1 (the step to take for this event). */
  push(e: WheelInput): -1 | 0 | 1 {
    const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
    const dx = e.deltaX * unit;
    const dy = e.allowVertical ? e.deltaY * unit : 0;
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    if (delta === 0) return 0;
    const gap = e.t - this.last;
    this.last = e.t;
    if (gap > this.quietMs) {
      this.acc = 0;
      this.locked = false;
    }
    if (this.locked) {
      // An isolated large delta after a pause is another wheel notch; a steady stream is inertia.
      const notch = Math.abs(delta) >= 40 && gap >= 70;
      if (notch && e.t - this.lastStep >= this.notchGapMs) return this.fire(delta < 0 ? -1 : 1, e.t);
      return 0;
    }
    this.acc += delta;
    if (Math.abs(this.acc) >= this.threshold) return this.fire(this.acc < 0 ? -1 : 1, e.t);
    return 0;
  }

  reset(): void {
    this.last = -Infinity;
    this.acc = 0;
    this.locked = false;
    this.lastStep = -Infinity;
  }

  private fire(dir: -1 | 1, t: number): -1 | 1 {
    this.locked = true;
    this.acc = 0;
    this.lastStep = t;
    return dir;
  }
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
export type CarouselKeyAction = { kind: 'move'; to: number } | { kind: 'open' } | null;

export function keyAction(key: string, index: number, count: number): CarouselKeyAction {
  switch (key) {
    case 'ArrowRight':
      return { kind: 'move', to: stepIndex(index, 1, count) };
    case 'ArrowLeft':
      return { kind: 'move', to: stepIndex(index, -1, count) };
    case 'Home':
      return { kind: 'move', to: 0 };
    case 'End':
      return { kind: 'move', to: Math.max(0, count - 1) };
    case 'PageDown':
      return { kind: 'move', to: stepIndex(index, 3, count) };
    case 'PageUp':
      return { kind: 'move', to: stepIndex(index, -3, count) };
    case 'Enter':
    case ' ':
    case 'Spacebar':
      return { kind: 'open' };
    default:
      return null;
  }
}
