/**
 * Input abstraction for the Classics: keyboard, gamepad and on-screen touch controls all
 * become the same game *intents* ('left', 'rotate', 'fire'…), configured per game.
 *
 *   const input = new IntentInput(BLOCKS_INTENTS);   // spec: keys + gamepad buttons per intent
 *   input.attach();                                  // window listeners (remove with detach())
 *   input.poll();                                    // once per fixed step (reads gamepads)
 *   input.isDown('left'); input.pressed('rotate');   // held state / edge since last poll
 *
 * Touch controls call input.press(intent) / input.release(intent). Pointer-driven games (the
 * Brick Blitz paddle) read `input.pointer`. Typing in text fields never triggers intents.
 */

export interface IntentSpec<I extends string> {
  /** KeyboardEvent.code values per intent (e.g. { left: ['ArrowLeft', 'KeyA'] }). */
  keys: Partial<Record<I, readonly string[]>>;
  /** Standard-mapping gamepad button indices per intent (0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 Back, 9 Start, 12–15 d-pad). */
  buttons?: Partial<Record<I, readonly number[]>>;
  /** Left stick → intents: [negative, positive] per axis. */
  stick?: { x?: readonly [I, I]; y?: readonly [I, I] };
}

export type InputDevice = 'keyboard' | 'gamepad' | 'touch' | 'mouse';

export interface PointerState {
  /** Logical x/y set by the game's pointer mapping (null when no pointer is tracked). */
  x: number | null;
  y: number | null;
  /** A button/finger is down. */
  down: boolean;
  /** Increments on every pointer move (lets a sampler detect new positions cheaply). */
  version: number;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

const STICK_DEAD = 0.45;

export class IntentInput<I extends string> {
  private readonly keyToIntents = new Map<string, I[]>();
  private readonly heldKeys = new Set<string>();
  private readonly touchHeld = new Map<I, number>();
  private readonly padHeld = new Set<I>();
  private prevDown = new Set<I>();
  private readonly queuedPresses: I[] = [];
  private framePresses: I[] = [];
  private attached = false;
  private listeners = new Set<(intent: I) => void>();
  readonly pointer: PointerState = { x: null, y: null, down: false, version: 0 };
  /** Starts as 'touch' on coarse-pointer devices so on-screen hints read "tap", not "press Space". */
  lastDevice: InputDevice = prefersTouch() ? 'touch' : 'keyboard';
  /** When false, keys are not captured (e.g. while a menu with its own controls is open). */
  enabled = true;

  constructor(private readonly spec: IntentSpec<I>) {
    for (const [intent, codes] of Object.entries(spec.keys) as Array<[I, readonly string[] | undefined]>) {
      for (const code of codes ?? []) {
        const list = this.keyToIntents.get(code) ?? [];
        list.push(intent);
        this.keyToIntents.set(code, list);
      }
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const intents = this.keyToIntents.get(e.code);
    if (!intents) return;
    if (!this.enabled) return;
    e.preventDefault();
    this.lastDevice = 'keyboard';
    if (e.repeat || this.heldKeys.has(e.code)) return;
    this.heldKeys.add(e.code);
    for (const intent of intents) this.queuePress(intent);
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private readonly onBlur = () => {
    this.heldKeys.clear();
    this.touchHeld.clear();
    this.padHeld.clear();
    this.pointer.down = false;
  };

  private queuePress(intent: I): void {
    this.queuedPresses.push(intent);
    for (const l of this.listeners) l(intent);
  }

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
    this.listeners.clear();
  }

  /** Subscribe to intent presses as they happen (menus, "press any key"). Returns an unsubscribe. */
  onPress(listener: (intent: I) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- touch / on-screen controls -------------------------------------------------
  press(intent: I): void {
    this.lastDevice = 'touch';
    this.touchHeld.set(intent, (this.touchHeld.get(intent) ?? 0) + 1);
    this.queuePress(intent);
  }

  release(intent: I): void {
    const n = (this.touchHeld.get(intent) ?? 0) - 1;
    if (n <= 0) this.touchHeld.delete(intent);
    else this.touchHeld.set(intent, n);
  }

  /** A one-shot press (tap/swipe) that is never "held". */
  tap(intent: I): void {
    this.lastDevice = 'touch';
    this.queuePress(intent);
  }

  setPointer(x: number | null, y: number | null, down: boolean, device: InputDevice = 'mouse'): void {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.down = down;
    this.pointer.version++;
    this.lastDevice = device;
  }

  // --- polling ---------------------------------------------------------------------
  private pollGamepad(): void {
    this.padHeld.clear();
    if (!this.spec.buttons && !this.spec.stick) return;
    const pads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      let any = false;
      for (const [intent, idxs] of Object.entries(this.spec.buttons ?? {}) as Array<[I, readonly number[] | undefined]>) {
        for (const i of idxs ?? []) {
          if (pad.buttons[i]?.pressed) {
            this.padHeld.add(intent);
            any = true;
          }
        }
      }
      const stick = this.spec.stick;
      if (stick?.x) {
        const ax = pad.axes[0] ?? 0;
        if (ax < -STICK_DEAD) this.padHeld.add(stick.x[0]);
        if (ax > STICK_DEAD) this.padHeld.add(stick.x[1]);
        if (Math.abs(ax) > STICK_DEAD) any = true;
      }
      if (stick?.y) {
        const ay = pad.axes[1] ?? 0;
        if (ay < -STICK_DEAD) this.padHeld.add(stick.y[0]);
        if (ay > STICK_DEAD) this.padHeld.add(stick.y[1]);
        if (Math.abs(ay) > STICK_DEAD) any = true;
      }
      if (any) this.lastDevice = 'gamepad';
    }
  }

  /**
   * Once per fixed step: reads gamepads, turns new holds into presses, and makes this step's
   * presses available through pressed()/presses().
   */
  poll(): void {
    this.pollGamepad();
    const down = this.downSet();
    for (const intent of this.padHeld) if (!this.prevDown.has(intent)) this.queuePress(intent);
    this.prevDown = down;
    this.framePresses = this.enabled ? this.queuedPresses.splice(0) : (this.queuedPresses.splice(0), []);
  }

  private downSet(): Set<I> {
    const out = new Set<I>(this.padHeld);
    for (const code of this.heldKeys) for (const intent of this.keyToIntents.get(code) ?? []) out.add(intent);
    for (const intent of this.touchHeld.keys()) out.add(intent);
    return out;
  }

  isDown(intent: I): boolean {
    if (!this.enabled) return false;
    if (this.padHeld.has(intent) || this.touchHeld.has(intent)) return true;
    for (const code of this.heldKeys) if (this.keyToIntents.get(code)?.includes(intent)) return true;
    return false;
  }

  /** Pressed during the last poll window (edge-triggered). */
  pressed(intent: I): boolean {
    return this.framePresses.includes(intent);
  }

  /** All presses of the last poll window, in order. */
  presses(): readonly I[] {
    return this.framePresses;
  }

  /** Forget held keys/buttons (e.g. when a pause menu opens). */
  clear(): void {
    this.onBlur();
    this.queuedPresses.length = 0;
    this.framePresses = [];
  }
}

/** True on devices whose primary pointer is coarse (phones/tablets) — show on-screen controls. */
export function prefersTouch(): boolean {
  return typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches);
}
