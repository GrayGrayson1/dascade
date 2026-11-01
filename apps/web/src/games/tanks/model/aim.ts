/**
 * AimController — the local player's gunner console. Holds my aim (angle, power, weapon),
 * streams it to the server while I may act (throttled), drives in held steps, switches on
 * items, fires with the current turn id, and owns the keyboard bindings.
 *
 * Turns mode: I act on my own turn. Volley mode: everyone acts during the shared aim window
 * until they lock in (FIRE = lock in). Players may pre-aim at any time; the aim is pushed the
 * moment they may act. Weapons cycle over what my crew owns (fleet inventory).
 */
import {
  ANGLE_MAX,
  ANGLE_MIN,
  POWER_MAX,
  POWER_MIN,
  TANKS_MSG,
  emptyAmmo,
  emptyItems,
  type Ammo,
  type BattleStage,
  type Items,
  type ShieldKind,
  type TanksPublicState,
  type UsableItemId,
  type WeaponId,
} from '@dascade/shared/games/tanks';
import { getStateSnapshot, session, subscribeState, useSessionStore } from '../../../net/session.ts';
import { bestShield, ownedWeapons } from '../shop/helpers.ts';

/** What my tank and crew look like right now (pure read of the room state). */
export interface AimView {
  /** I have a live tank in this battle. */
  inBattle: boolean;
  /** I may aim, drive, use items and fire right now (before any local "already fired"). */
  acting: boolean;
  volley: boolean;
  /** Volley: the server has my shot locked in. */
  locked: boolean;
  stage: BattleStage;
  turnId: number;
  /** Changes with every battlefield built. */
  serial: number;
  ammo: Ammo;
  items: Items;
  fuel: number;
  maxFuel: number;
  shield: number;
  shieldMax: number;
  shieldKind: ShieldKind;
  hp: number;
  maxHp: number;
  buried: boolean;
  /** My tank's aim as the server knows it. */
  tankAim: { angle: number; power: number; weapon: WeaponId };
}

export function readAimView(s: TanksPublicState | null | undefined, me: string | null | undefined): AimView | null {
  const b = s?.battle;
  const mine = me && s?.tanks ? s.tanks[me] : undefined;
  if (!s || !b || !mine || !me) return null;
  const crew = s.fleet?.[me];
  const volley = b.turnMode === 'volley';
  const alive = mine.alive && !mine.gone;
  const acting = s.phase === 'PLAYING' && b.stage === 'aim' && alive && (volley ? !mine.locked : b.activeId === me);
  return {
    inBattle: alive,
    acting,
    volley,
    locked: volley && Boolean(mine.locked),
    stage: b.stage,
    turnId: b.turnId,
    serial: b.battleSerial ?? 0,
    ammo: crew?.ammo ?? emptyAmmo(),
    items: crew?.items ?? emptyItems(),
    fuel: mine.fuel,
    maxFuel: mine.maxFuel,
    shield: mine.shield ?? 0,
    shieldMax: mine.shieldMax ?? 0,
    shieldKind: mine.shieldKind ?? '',
    hp: mine.hp,
    maxHp: mine.maxHp,
    buried: (mine.buried ?? 0) > 0,
    tankAim: { angle: mine.angle, power: mine.power, weapon: mine.weapon },
  };
}

/** Why an item can't be switched on right now (null = it can). */
export function itemBlock(
  item: UsableItemId,
  v: Pick<AimSnapshot, 'items' | 'hp' | 'maxHp' | 'maxFuel' | 'canAct' | 'inBattle' | 'locked' | 'volley'>,
): string | null {
  if ((v.items[item] ?? 0) <= 0) return 'None left';
  if (!v.inBattle) return 'Not in battle';
  if (v.volley && v.locked) return 'Locked in';
  if (!v.canAct) return v.volley ? 'Wait for the next volley' : 'Wait for your turn';
  if (item === 'battery' && v.hp >= v.maxHp) return 'Armor is full';
  if (item === 'fuel' && v.maxFuel <= 0) return 'Driving is off';
  return null;
}

export interface AimSnapshot {
  angle: number;
  power: number;
  weapon: WeaponId;
  /** I may act and haven't fired / locked in yet. */
  canAct: boolean;
  /** I have a live tank in this battle. */
  inBattle: boolean;
  /** Shot sent (turns) or locked in (volley), waiting for it to fly. */
  firing: boolean;
  volley: boolean;
  locked: boolean;
  ammo: Ammo;
  items: Items;
  fuel: number;
  maxFuel: number;
  shield: number;
  shieldMax: number;
  shieldKind: ShieldKind;
  hp: number;
  maxHp: number;
  buried: boolean;
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
    volley: false,
    locked: false,
    ammo: emptyAmmo(),
    items: emptyItems(),
    fuel: 0,
    maxFuel: 0,
    shield: 0,
    shieldMax: 0,
    shieldKind: '',
    hp: 0,
    maxHp: 0,
    buried: false,
    moving: 0,
    turnId: 0,
  };
  private listeners = new Set<() => void>();
  private battleKey = -1;
  private sentTurn = -1;
  private firedTurn = -1;
  private dirty = false;
  private lastSent = 0;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private moveTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: Array<() => void> = [];
  /** Called on fire (for immediate local feedback). */
  onFire: (() => void) | null = null;
  onBlocked: ((why: string) => void) | null = null;
  /** Called when an item was sent to the server. */
  onItem: ((item: UsableItemId) => void) | null = null;

  start(): void {
    this.unsubs.push(subscribeState(() => this.sync()));
    this.sync();
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.stopMove();
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.sendTimer = null;
    this.retryTimer = null;
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
    const v = readAimView(s, me);
    if (!v) {
      if (this.snap.inBattle || this.snap.canAct || this.snap.firing)
        this.set({ inBattle: false, canAct: false, firing: false, locked: false });
      this.stopMove();
      return;
    }
    // A brand-new battlefield (or first sight of this one): adopt my tank's aim.
    if (v.serial !== this.battleKey) {
      this.battleKey = v.serial;
      this.sentTurn = -1;
      this.firedTurn = -1;
      this.set({ angle: v.tankAim.angle, power: v.tankAim.power, weapon: v.tankAim.weapon });
    }
    let weapon = this.snap.weapon;
    if ((v.ammo[weapon] ?? 0) === 0 && weapon !== 'shell') weapon = 'shell';
    const sentThisTurn = this.firedTurn === v.turnId;
    const canAct = v.acting && !sentThisTurn;
    const firing = v.stage === 'aim' && v.inBattle && (v.locked || (sentThisTurn && (v.acting || v.volley)));
    this.set({
      inBattle: v.inBattle,
      canAct,
      firing,
      volley: v.volley,
      locked: v.locked,
      ammo: v.ammo,
      items: v.items,
      fuel: v.fuel,
      maxFuel: v.maxFuel,
      shield: v.shield,
      shieldMax: v.shieldMax,
      shieldKind: v.shieldKind,
      hp: v.hp,
      maxHp: v.maxHp,
      buried: v.buried,
      turnId: v.turnId,
      weapon,
    });
    if (!canAct || v.buried) this.stopMove();
    // I may act from now on: push my (pre-)aim right away.
    if (canAct && this.sentTurn !== v.turnId) {
      this.sentTurn = v.turnId;
      if (v.tankAim.angle !== this.snap.angle || v.tankAim.power !== this.snap.power || v.tankAim.weapon !== this.snap.weapon) {
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
    if (w !== 'shell' && (this.snap.ammo[w] ?? 0) === 0) {
      this.onBlocked?.('Out of that ammo');
      return;
    }
    if (w === this.snap.weapon) return;
    this.set({ weapon: w });
    this.queueSend();
  }

  cycleWeapon(dir: 1 | -1 = 1): void {
    const list = ownedWeapons(this.snap.ammo);
    if (list.length <= 1 && list[0] === this.snap.weapon) return;
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
  // Items
  // ---------------------------------------------------------------------------

  /** Switch on an item. Returns false (and says why) when it can't be used now. */
  useItem(item: UsableItemId): boolean {
    const why = itemBlock(item, this.snap);
    if (why) {
      this.onBlocked?.(why);
      return false;
    }
    session.send(TANKS_MSG.item, { item, turnId: this.snap.turnId });
    this.onItem?.(item);
    return true;
  }

  /** Key S: the strongest shield in stock. */
  useBestShield(): boolean {
    const id = bestShield(this.snap.items);
    if (!id) {
      this.onBlocked?.('No shields in stock');
      return false;
    }
    return this.useItem(id);
  }

  // ---------------------------------------------------------------------------
  // Drive + fire
  // ---------------------------------------------------------------------------

  startMove(dir: -1 | 1): void {
    if (!this.snap.canAct) return;
    if (this.snap.buried) {
      this.onBlocked?.('Buried — dig out first');
      return;
    }
    if (this.snap.fuel <= 0) {
      this.onBlocked?.(this.snap.maxFuel > 0 ? 'Out of fuel this turn' : 'Driving is off in this battle');
      return;
    }
    if (this.moveTimer && this.snap.moving === dir) return;
    this.stopMove();
    this.set({ moving: dir });
    const step = () => {
      if (!this.snap.canAct || this.snap.fuel <= 0 || this.snap.buried) {
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

  /** Fire (turns) or lock in (volley). */
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
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const s = getStateSnapshot<TanksPublicState>();
      const v = readAimView(s, useSessionStore.getState().playerId);
      if (this.firedTurn === turn && v && v.turnId === turn && v.acting) {
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
  if (el.closest('[role="dialog"], .dc-modal, .shell-menu__panel, .chat, .tk-shop')) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return type !== 'range' && type !== 'button' && type !== 'checkbox' && type !== 'radio';
  }
  return false;
}

/**
 * Keyboard: ←/→ angle, ↑/↓ power (Shift = ×5), A/D drive, Tab / Q·E weapon, Space / Enter fire
 * (lock in during a volley), S shield, B battery, F fuel can.
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
    const onSlider =
      (e.target instanceof HTMLInputElement && e.target.type === 'range') || role === 'radio' || role === 'tab' || role === 'slider';
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
      case 's':
      case 'S':
        if (!aim.getSnapshot().inBattle) return;
        e.preventDefault();
        if (!e.repeat) aim.useBestShield();
        return;
      case 'b':
      case 'B':
        if (!aim.getSnapshot().inBattle) return;
        e.preventDefault();
        if (!e.repeat) aim.useItem('battery');
        return;
      case 'f':
      case 'F':
        if (!aim.getSnapshot().inBattle) return;
        e.preventDefault();
        if (!e.repeat) aim.useItem('fuel');
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
