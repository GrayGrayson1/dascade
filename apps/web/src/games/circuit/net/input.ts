/**
 * Input sampling: keyboard (WASD / arrows + alternates), Gamepad API and touch.
 * Produces a CarInput on demand at the simulation rate. Keyboard steering is
 * shaped (ramped) so digital keys feel smooth; analog sources pass through.
 */
import type { CarInput } from '@dascade/shared/games/circuit';

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

export interface TouchState {
  steer: number;
  gas: boolean;
  brake: boolean;
  drift: boolean;
  boost: boolean;
  autoGas: boolean;
  active: boolean;
}

const KEYMAP: Record<string, 'up' | 'down' | 'left' | 'right' | 'drift' | 'boost'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'drift',
  KeyZ: 'drift',
  KeyJ: 'drift',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  KeyX: 'boost',
  KeyK: 'boost',
};

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export class InputSampler {
  readonly touch: TouchState = { steer: 0, gas: false, brake: false, drift: false, boost: false, autoGas: false, active: false };
  lastDevice: InputDevice = 'keyboard';
  private readonly held = new Set<string>();
  private steerShaped = 0;
  private lastSampleAt = 0;
  private attached = false;
  enabled = true;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const action = KEYMAP[e.code];
    if (!action) return;
    if (this.enabled) e.preventDefault();
    this.held.add(e.code);
    this.lastDevice = 'keyboard';
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  private action(name: 'up' | 'down' | 'left' | 'right' | 'drift' | 'boost'): boolean {
    for (const code of this.held) if (KEYMAP[code] === name) return true;
    return false;
  }

  private readonly onBlur = () => {
    this.held.clear();
    Object.assign(this.touch, { steer: 0, gas: false, brake: false, drift: false, boost: false });
  };

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.onBlur();
  }

  private gamepad(): CarInput | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = (i: number) => pad.buttons[i];
      const pressed = (i: number) => Boolean(b(i)?.pressed);
      const value = (i: number) => b(i)?.value ?? 0;
      const ax = pad.axes[0] ?? 0;
      const dead = 0.14;
      let steer = Math.abs(ax) > dead ? ((Math.abs(ax) - dead) / (1 - dead)) * Math.sign(ax) : 0;
      if (pressed(14)) steer = -1;
      if (pressed(15)) steer = 1;
      const throttle = Math.max(value(7), pressed(12) ? 1 : 0, pressed(0) && pad.mapping !== 'standard' ? 1 : 0);
      const brake = Math.max(value(6), pressed(13) ? 1 : 0);
      const drift = pressed(0) || pressed(2) || pressed(4);
      const boost = pressed(1) || pressed(3) || pressed(5);
      const any = Math.abs(steer) > 0 || throttle > 0.05 || brake > 0.05 || drift || boost;
      if (!any) continue;
      this.lastDevice = 'gamepad';
      return { throttle, brake, steer, drift, boost };
    }
    return null;
  }

  /** Current controls; `now` in ms (used for keyboard steer shaping). */
  sample(now: number): CarInput {
    const dt = this.lastSampleAt ? Math.min(0.1, Math.max(0, (now - this.lastSampleAt) / 1000)) : 1 / 60;
    this.lastSampleAt = now;
    if (!this.enabled) return { throttle: 0, brake: 0, steer: 0, drift: false, boost: false };

    const pad = this.gamepad();
    if (pad) return pad;

    const t = this.touch;
    if (t.active && this.lastDevice === 'touch') {
      return {
        throttle: t.gas || (t.autoGas && !t.brake) ? 1 : 0,
        brake: t.brake ? 1 : 0,
        steer: Math.max(-1, Math.min(1, t.steer)),
        drift: t.drift,
        boost: t.boost,
      };
    }

    const target = (this.action('right') ? 1 : 0) - (this.action('left') ? 1 : 0);
    const rate = target === 0 ? 11 : Math.sign(target) !== Math.sign(this.steerShaped) && this.steerShaped !== 0 ? 14 : 7.5;
    const delta = target - this.steerShaped;
    const step = Math.min(Math.abs(delta), rate * dt);
    this.steerShaped += Math.sign(delta) * step;
    if (Math.abs(this.steerShaped) < 0.02 && target === 0) this.steerShaped = 0;
    return {
      throttle: this.action('up') ? 1 : 0,
      brake: this.action('down') ? 1 : 0,
      steer: this.steerShaped,
      drift: this.action('drift'),
      boost: this.action('boost'),
    };
  }

  /** Called by touch controls whenever they change. */
  touched(): void {
    this.touch.active = true;
    this.lastDevice = 'touch';
  }
}
