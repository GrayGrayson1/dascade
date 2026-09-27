/**
 * AimController — the local player's gunner console. Holds my aim (angle, power, weapon),
 * streams it to the server while it's my turn (throttled), drives in held steps, fires with
 * the current turn id, and owns the keyboard bindings. Players may pre-aim during other
 * turns; the aim is pushed the moment their turn starts.
 */
import {
  ANGLE_MAX,
  ANGLE_MIN,
  POWER_MAX,
  POWER_MIN,
  TANKS_MSG,
  WEAPON_IDS,
  type TanksPublicState,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { getStateSnapshot, session, subscribeState, useSessionStore } from '../../../net/session.ts';

export interface AimSnapshot {
  angle: number;
  power: number;
  weapon: WeaponId;
  /** It's my turn and I can act. */
  canAct: boolean;
  /** I have a live tank in this battle. */
  inBattle: boolean;
  /** Shot sent, waiting for the server. */
  firing: boolean;
  ammo: Record<WeaponId, number>;
  fuel: number;
  maxFuel: number;
  moving: -1 | 0 | 1;
  turnId: number;
}

const SEND_EVERY_MS = 90;
const MOVE_EVERY_MS = 70;

export class AimController {
  private snap: AimSnapshot = {
    angle: 45,
    power: 60,
    weapon: 'shell',
    canAct: false,
    inBattle: false,
    firing: false,
    ammo: { shell: -1, heavy: 0, cluster: 0, airburst: 0, driller: 0, dirt: 0 },
    fuel: 0,
    maxFuel: 0,
    moving: 0,
    turnId: 0,
  };
  private listeners = new Set<() => void>();
  private battleKey = '';
  private sentTurn = -1;
  private firedTurn = -1;
  private dirty = false;
  private lastSent = 0;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private moveTimer: ReturnType<typeof setInterval> | null = null;
  private unsubs: Array<() => void> = [];
  /** Called on fire (for immediate local feedback). */
  onFire: (() => void) | null = null;
  onBlocked: ((why: string) => void) | null = null;

  start(): void {
    this.unsubs.push(subscribeState(() => this.sync()));
    this.sync();
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.stopMove();
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    this.listeners.clear();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AimSnapshot => this.snap;

  private set(patch: Partial<AimSnapshot>): void {
    let changed = false;
    for (const k of Object.keys(patch) as Array<keyof AimSnapshot>) {
      if (this.snap[k] !== patch[k]) changed = true;
    }
    if (!changed) return;
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  /** Current aim for my turret (read every frame by the presenter). */
  live(): { angle: number; power: number; weapon: WeaponId } | null {
    return this.snap.inBattle ? { angle: this.snap.angle, power: this.snap.power, weapon: this.snap.weapon } : null;
  }

  private sync(): void {
    const s = getStateSnapshot<TanksPublicState>();
    const me = useSessionStore.getState().playerId;
    const b = s?.battle;
    const mine = me && s?.tanks ? s.tanks[me] : undefined;
    if (!s || !b || !mine) {
      if (this.snap.inBattle || this.snap.canAct) this.set({ inBattle: false, canAct: false, firing: false });
      this.stopMove();
      return;
    }
    const key = `${b.theme}:${b.terrain.slice(0, 32)}`;
    // First sight of this battle (fresh mount / page reload) or a brand-new battle: adopt my tank's aim.
    if (this.battleKey === '' || (key !== this.battleKey && b.shotSeq === 0)) {
      this.battleKey = key;
      this.sentTurn = -1;
      this.firedTurn = -1;
      this.set({ angle: mine.angle, power: mine.power, weapon: mine.weapon });
    }
    const myTurn = s.phase === 'PLAYING' && b.stage === 'aim' && b.activeId === me && mine.alive;
    let weapon = this.snap.weapon;
    if (mine.ammo[weapon] === 0) weapon = 'shell';
    this.set({
      inBattle: mine.alive && !mine.gone,
      canAct: myTurn && this.firedTurn !== b.turnId,
      firing: myTurn && this.firedTurn === b.turnId,
      ammo: mine.ammo,
      fuel: mine.fuel,
      maxFuel: mine.maxFuel,
      turnId: b.turnId,
      weapon,
    });
    if (!myTurn) this.stopMove();
    // My turn just started: push my (pre-)aim right away.
    if (myTurn && this.sentTurn !== b.turnId) {
      this.sentTurn = b.turnId;
      if (mine.angle !== this.snap.angle || mine.power !== this.snap.power || mine.weapon !== this.snap.weapon) {
        this.dirty = true;
        this.flush(true);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Aim
  // ---------------------------------------------------------------------------

  setAngle(v: number): void {
    const angle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, Math.round(v)));
    if (angle === this.snap.angle) return;
    this.set({ angle });
    this.queueSend();
  }

  setPower(v: number): void {
    const power = Math.max(POWER_MIN, Math.min(POWER_MAX, Math.round(v)));
    if (power === this.snap.power) return;
    this.set({ power });
    this.queueSend();
  }

  nudge(dAngle: number, dPower: number): void {
    if (dAngle) this.setAngle(this.snap.angle + dAngle);
    if (dPower) this.setPower(this.snap.power + dPower);
  }

  setWeapon(w: WeaponId): void {
    if (this.snap.ammo[w] === 0) {
      this.onBlocked?.('Out of that ammo');
      return;
    }
    if (w === this.snap.weapon) return;
    this.set({ weapon: w });
    this.queueSend();
  }

  cycleWeapon(dir: 1 | -1 = 1): void {
    const list = WEAPON_IDS.filter((w) => this.snap.ammo[w] !== 0);
    if (list.length === 0) return;
    const i = list.indexOf(this.snap.weapon);
    const next = list[(i + dir + list.length) % list.length]!;
    this.setWeapon(next);
  }

  private queueSend(): void {
    if (!this.snap.canAct) return;
    this.dirty = true;
    const wait = SEND_EVERY_MS - (performance.now() - this.lastSent);
    if (wait <= 0) this.flush(false);
    else if (!this.sendTimer) this.sendTimer = setTimeout(() => this.flush(false), wait);
  }

  private flush(force: boolean): void {
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    if (!this.dirty || (!force && !this.snap.canAct)) return;
    this.dirty = false;
    this.lastSent = performance.now();
    session.send(TANKS_MSG.aim, { angle: this.snap.angle, power: this.snap.power, weapon: this.snap.weapon });
  }

  // ---------------------------------------------------------------------------
  // Drive + fire
  // ---------------------------------------------------------------------------

  startMove(dir: -1 | 1): void {
    if (!this.snap.canAct) return;
    if (this.snap.fuel <= 0) {
      this.onBlocked?.(this.snap.maxFuel > 0 ? 'Out of fuel this turn' : 'Driving is off in this battle');
      return;
    }
    if (this.moveTimer && this.snap.moving === dir) return;
    this.stopMove();
    this.set({ moving: dir });
    const step = () => {
      if (!this.snap.canAct || this.snap.fuel <= 0) {
        this.stopMove();
        return;
      }
      session.send(TANKS_MSG.move, { dir });
    };
    step();
    this.moveTimer = setInterval(step, MOVE_EVERY_MS);
  }

  stopMove(): void {
    if (this.moveTimer) clearInterval(this.moveTimer);
    this.moveTimer = null;
    if (this.snap.moving !== 0) this.set({ moving: 0 });
  }

  fire(): boolean {
    if (!this.snap.canAct) return false;
    this.stopMove();
    this.flush(true);
    this.firedTurn = this.snap.turnId;
    session.send(TANKS_MSG.fire, { turnId: this.snap.turnId, angle: this.snap.angle, power: this.snap.power, weapon: this.snap.weapon });
    this.set({ canAct: false, firing: true });
    this.onFire?.();
    // If the server refuses (e.g. a stale turn), re-enable after a moment.
    const turn = this.snap.turnId;
    setTimeout(() => {
      const s = getStateSnapshot<TanksPublicState>();
      if (this.firedTurn === turn && s?.battle.turnId === turn && s.battle.stage === 'aim') {
        this.firedTurn = -1;
        this.sync();
      }
    }, 2500);
    return true;
  }
}

/** Hold-to-repeat with acceleration (keys and on-screen ± buttons). */
export class Repeater {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = 0;

  start(fn: () => void): void {
    this.stop();
    fn();
    this.started = performance.now();
    const loop = () => {
      fn();
      const held = performance.now() - this.started;
      this.timer = setTimeout(loop, held > 1400 ? 28 : held > 700 ? 45 : 70);
    };
    this.timer = setTimeout(loop, 300);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[role="dialog"], .dc-modal, .shell-menu__panel, .chat')) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type !== 'range' && type !== 'button' && type !== 'checkbox' && type !== 'radio';
  }
  return false;
}

/**
 * Keyboard: ←/→ angle, ↑/↓ power (Shift = ×5), A/D drive, Tab / Q·E weapon, Space / Enter fire.
 * Shift+Tab always moves focus normally (keyboard users can reach the menu and deck).
 * Returns an unbind function.
 */
export function bindKeyboard(aim: AimController): () => void {
  const angle = new Repeater();
  const power = new Repeater();
  const held = new Set<string>();

  const down = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const big = e.shiftKey ? 5 : 1;
    const el = e.target instanceof HTMLElement ? e.target : null;
    const role = el?.getAttribute('role');
    // Focused sliders / radio groups keep their own arrow keys; focused buttons keep Space/Enter.
    const onSlider = (e.target instanceof HTMLInputElement && e.target.type === 'range') || role === 'radio' || role === 'tab' || role === 'slider';
    const onButton = el?.tagName === 'BUTTON' || role === 'radio';
    switch (k) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (onSlider) return;
        e.preventDefault();
        if (e.repeat || held.has(k)) return;
        held.add(k);
        const d = k === 'ArrowLeft' ? big : -big;
        angle.start(() => aim.nudge(d, 0));
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        if (onSlider) return;
        e.preventDefault();
        if (e.repeat || held.has(k)) return;
        held.add(k);
        const d = k === 'ArrowUp' ? big : -big;
        power.start(() => aim.nudge(0, d));
        return;
      }
      case 'a':
      case 'A':
        e.preventDefault();
        if (!e.repeat) aim.startMove(-1);
        return;
      case 'd':
      case 'D':
        e.preventDefault();
        if (!e.repeat) aim.startMove(1);
        return;
      case 'Tab':
        // Tab cycles weapons while nothing is focused; Shift+Tab (and Tab from any focused
        // control) keeps native focus navigation so the menu and deck stay keyboard-reachable.
        if (!aim.getSnapshot().inBattle || e.shiftKey || (el && el !== document.body)) return;
        e.preventDefault();
        if (!e.repeat) aim.cycleWeapon(1);
        return;
      case 'q':
      case 'Q':
      case 'e':
      case 'E':
        if (!e.repeat) aim.cycleWeapon(k.toLowerCase() === 'q' ? -1 : 1);
        return;
      case ' ':
      case 'Enter':
        if (!aim.getSnapshot().inBattle || onButton) return;
        e.preventDefault();
        if (!e.repeat) aim.fire();
        return;
    }
  };
  const up = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      held.delete(k);
      if (!held.has('ArrowLeft') && !held.has('ArrowRight')) angle.stop();
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      held.delete(k);
      if (!held.has('ArrowUp') && !held.has('ArrowDown')) power.stop();
    } else if (k === 'a' || k === 'A' || k === 'd' || k === 'D') {
      aim.stopMove();
    } else if (k === ' ' && aim.getSnapshot().inBattle && !isTypingTarget(e.target) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
    }
  };
  const blur = () => {
    held.clear();
    angle.stop();
    power.stop();
    aim.stopMove();
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
    blur();
  };
}
