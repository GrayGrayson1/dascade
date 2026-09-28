/**
 * DASphalt GP input sampling: keyboard, Gamepad API and touch → `KartInput` on demand at the
 * simulation rate. Nothing here touches React or the network.
 *
 * Conventions (from the shared contract): steer is -1..1 and POSITIVE = LEFT.
 *
 * Keyboard: W/↑ throttle · S/↓ brake · A/← D/→ steer · Space / Shift / J hop + drift ·
 * E / K / Enter item (hold to trail) · hold S/↓ while using = throw it back ·
 * Q / I = use it aimed ahead (lob traps forward; also a modifier held with E) · Esc menu.
 * Gamepad (standard mapping): left stick / d-pad steer · RT or A throttle · LT or B brake ·
 * RB or X drift · LB or Y item · stick/d-pad up aims ahead, down aims back · Start menu.
 */
import { NEUTRAL_KART_INPUT, type KartInput } from '@dascade/shared/games/kart';

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

type Action = 'up' | 'down' | 'left' | 'right' | 'drift' | 'item' | 'ahead';

export const KART_KEYMAP: Readonly<Record<string, Action>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'drift',
  ShiftLeft: 'drift',
  ShiftRight: 'drift',
  KeyJ: 'drift',
  KeyE: 'item',
  KeyK: 'item',
  Enter: 'item',
  NumpadEnter: 'item',
  KeyQ: 'ahead',
  KeyI: 'ahead',
};

/** Touch surface state, written by the touch controls (no React state per frame). */
export interface TouchState {
  /** -1..1, positive = left. */
  steer: number;
  gas: boolean;
  brake: boolean;
  drift: boolean;
  item: boolean;
  back: boolean;
  ahead: boolean;
  /** Auto-accelerate (on by default on touch devices). */
  autoGas: boolean;
  active: boolean;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

/** Focus on a real control (button, link…): let Enter/Space activate it instead of driving. */
function isControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'button' || tag === 'a' || el.getAttribute?.('role') === 'button' || el.getAttribute?.('role') === 'radio';
}

/**
 * Keyboard steering ramp: digital keys ease in (≈130 ms to full lock), snap back faster and
 * reverse fastest, so tapping feels precise and holding feels smooth.
 */
export function shapeSteer(current: number, target: number, dt: number): number {
  const rate = target === 0 ? 11 : current !== 0 && Math.sign(target) !== Math.sign(current) ? 16 : 7.5;
  const delta = target - current;
  const step = Math.min(Math.abs(delta), rate * dt);
  const next = current + Math.sign(delta) * step;
  return Math.abs(next) < 0.02 && target === 0 ? 0 : next;
}

/** Radial dead zone with rescale + a mild response curve (fine control near centre). */
export function stickAxis(v: number, dead = 0.15): number {
  const a = Math.abs(v);
  if (!Number.isFinite(v) || a <= dead) return 0;
  const t = Math.min(1, (a - dead) / (1 - dead));
  return Math.sign(v) * (0.35 * t + 0.65 * t * t);
}

/** Minimal Gamepad shape (so tests can pass plain objects). */
export interface PadLike {
  connected: boolean;
  mapping: string;
  axes: readonly number[];
  buttons: ReadonlyArray<{ pressed: boolean; value: number } | undefined>;
}

/** Map one gamepad to an input (null when nothing is touched, so other devices still work). */
export function padInput(pad: PadLike): { input: KartInput; menu: boolean } | null {
  const pressed = (i: number) => Boolean(pad.buttons[i]?.pressed);
  const value = (i: number) => {
    const b = pad.buttons[i];
    return b ? Math.max(b.value || 0, b.pressed ? 1 : 0) : 0;
  };
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  // Stick right = steer right = negative in our convention.
  let steer = -stickAxis(ax);
  if (pressed(14)) steer = 1;
  if (pressed(15)) steer = -1;
  const throttle = Math.min(1, Math.max(value(7), pressed(0) ? 1 : 0));
  const brake = Math.min(1, Math.max(value(6), pressed(1) ? 1 : 0));
  const drift = pressed(5) || pressed(2);
  const item = pressed(4) || pressed(3);
  // Item aim: stick (or d-pad) down = back, up = ahead; neither = the item's default direction.
  const back = ay > 0.55 || pressed(13);
  const ahead = !back && (ay < -0.55 || pressed(12));
  const menu = pressed(9);
  const any = steer !== 0 || throttle > 0.05 || brake > 0.05 || drift || item || back || ahead || menu;
  if (!any) return null;
  return { input: { throttle, brake, steer, drift, item, back, ahead }, menu };
}

export class KartInputSampler {
  readonly touch: TouchState = {
    steer: 0,
    gas: false,
    brake: false,
    drift: false,
    item: false,
    back: false,
    ahead: false,
    autoGas: false,
    active: false,
  };
  lastDevice: InputDevice = 'keyboard';
  /** False while menus/results are up: sample() returns neutral and keys aren't swallowed. */
  enabled = true;
  /** Called on Esc / gamepad Start. */
  onMenu: (() => void) | null = null;
  /** Called when the device family changes (HUD hints). */
  onDevice: ((d: InputDevice) => void) | null = null;

  private readonly held = new Set<string>();
  private steerShaped = 0;
  private lastSampleAt = 0;
  private attached = false;
  private padMenuDown = false;
  /** Keeps `back` set briefly after a touch swipe-release so the release frame carries it. */
  private backLatchUntil = 0;
  private aheadLatchUntil = 0;

  private setDevice(d: InputDevice): void {
    if (this.lastDevice === d) return;
    this.lastDevice = d;
    this.onDevice?.(d);
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Escape') {
      if (!e.repeat) this.onMenu?.();
      return;
    }
    const action = KART_KEYMAP[e.code];
    if (!action) return;
    // Enter/Space on a focused button activates the button (menus, spectator arrows).
    if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') && isControl(e.target)) return;
    if (!this.enabled) return;
    e.preventDefault();
    this.held.add(e.code);
    this.setDevice('keyboard');
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  private readonly onBlur = () => {
    this.held.clear();
    Object.assign(this.touch, { steer: 0, gas: false, brake: false, drift: false, item: false, back: false, ahead: false });
  };

  private readonly onVisibility = () => {
    if (document.visibilityState !== 'visible') this.onBlur();
  };

  private action(name: Action): boolean {
    for (const code of this.held) if (KART_KEYMAP[code] === name) return true;
    return false;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.onBlur();
  }

  /** Called by the touch controls whenever they change. */
  touched(): void {
    this.touch.active = true;
    this.setDevice('touch');
  }

  /**
   * Gamepad Start → menu. Polled every animation frame (not only while driving), so Start also
   * closes the menu and resumes a paused race.
   */
  pollMenu(): void {
    const pad = this.gamepad();
    const down = Boolean(pad?.menu);
    if (down && !this.padMenuDown) this.onMenu?.();
    this.padMenuDown = down;
  }

  /** Touch ITEM released after a swipe: keep the aim for the release frame (a trailed item fires then). */
  latchAim(now: number, dir: 'back' | 'ahead', ms = 120): void {
    if (dir === 'back') this.backLatchUntil = now + ms;
    else this.aheadLatchUntil = now + ms;
  }

  private gamepad(): { input: KartInput; menu: boolean } | null {
    const pads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const r = padInput(pad);
      if (r) return r;
    }
    return null;
  }

  /**
   * Current controls; `now` in ms (keyboard steer shaping, touch latches). `locked` = waiting on
   * the grid: auto-gas holds off until GO (holding the throttle through the whole countdown would
   * stall the start), so touch players rev with the GAS button for a rocket start.
   */
  sample(now: number, locked = false): KartInput {
    const dt = this.lastSampleAt ? Math.min(0.1, Math.max(0, (now - this.lastSampleAt) / 1000)) : 1 / 60;
    this.lastSampleAt = now;

    const pad = this.gamepad();
    if (!this.enabled) return { ...NEUTRAL_KART_INPUT };
    if (pad) {
      this.setDevice('gamepad');
      return pad.input;
    }

    const t = this.touch;
    if (t.active && this.lastDevice === 'touch') {
      return {
        throttle: t.gas || (t.autoGas && !t.brake && !locked) ? 1 : 0,
        brake: t.brake ? 1 : 0,
        steer: Math.max(-1, Math.min(1, t.steer)),
        drift: t.drift,
        item: t.item,
        back: t.back || now < this.backLatchUntil,
        ahead: t.ahead || now < this.aheadLatchUntil,
      };
    }

    const target = (this.action('left') ? 1 : 0) - (this.action('right') ? 1 : 0);
    this.steerShaped = shapeSteer(this.steerShaped, target, dt);
    const down = this.action('down');
    const ahead = this.action('ahead');
    return {
      throttle: this.action('up') ? 1 : 0,
      brake: down ? 1 : 0,
      steer: this.steerShaped,
      drift: this.action('drift'),
      // Q / I is its own "use it ahead" key (and works as a modifier held with E).
      item: this.action('item') || ahead,
      back: down && !ahead,
      ahead,
    };
  }
}
