/**
 * PuttController — the client brain of DAS Putt. It never decides anything: it
 *  - reads the synchronized room state and the server's `putt:shot` paths and animates every
 *    ball on the shared server clock (so all screens show the same roll at the same time),
 *  - turns drags / keys / buttons into a bounded stroke INTENT ({angle, power, at}),
 *  - computes a limited trajectory preview (up to the first bounce) with the same
 *    deterministic engine the server uses,
 *  - fires sounds, particles and callouts exactly when a rolling ball reaches each event.
 * Per-frame data stays out of React; the HUD subscribes to a small UI snapshot.
 */
import {
  PUTT_ANGLE_UNITS,
  PUTT_LAUNCH_DELAY_MS,
  PUTT_MSG,
  PUTT_PATH_EVENTS,
  PUTT_POWER_MAX,
  PUTT_POWER_MIN,
  PUTT_TICK_HZ,
  type GolferView,
  type PuttAimRelay,
  type PuttEvent,
  type PuttPathEventKind,
  type PuttPublicState,
  type PuttShotView,
} from '@dascade/shared/games/putt';
import { PHYS, decodePath, getHole, pathPosition, simulateShot, type HoleDef } from '@dascade/game-core/putt';
import { getLastMessage, getStateSnapshot, serverNow, session, subscribeMessage, subscribeState, useSessionStore } from '../../../net/session.ts';
import { puttSound } from './sound.ts';

export interface Callout {
  id: number;
  text: string;
  tone: 'good' | 'great' | 'bad' | 'info';
  sub?: string;
  at: number;
}

export interface PuttUi {
  canAim: boolean;
  myTurn: boolean;
  aiming: boolean;
  angle: number;
  power: number;
  spectator: boolean;
  rolling: boolean;
  callouts: Callout[];
  /** Whether a drag is currently inside the cancel zone. */
  cancelZone: boolean;
}

export interface BallDraw {
  id: string;
  x: number;
  y: number;
  color: string;
  name: string;
  me: boolean;
  active: boolean;
  moving: boolean;
  alpha: number;
  scale: number;
  trail: number[];
}

export interface AimDraw {
  x: number;
  y: number;
  angle: number;
  power: number;
  mine: boolean;
  color: string;
  /** World polyline of the limited preview (x, y pairs). */
  preview: number[];
  /** First contact point (world) if the preview reached one. */
  contact: { x: number; y: number } | null;
  /** Screen-space drag (anchor → pointer) for the slingshot band. */
  drag: { ax: number; ay: number; px: number; py: number } | null;
}

export type FxEvent =
  | { kind: 'impact'; x: number; y: number; v: number; what: PuttPathEventKind; index: number }
  | { kind: 'cup'; x: number; y: number; big: boolean; color: string }
  | { kind: 'splash'; x: number; y: number }
  | { kind: 'fall'; x: number; y: number }
  | { kind: 'portal'; x: number; y: number; index: number }
  | { kind: 'strike'; x: number; y: number; power: number };

export interface Frame {
  state: PuttPublicState | null;
  hole: HoleDef | null;
  holeIndex: number;
  obstacleMs: number;
  balls: BallDraw[];
  aim: AimDraw | null;
  bumperHits: Map<number, number>;
  portalHits: Map<number, number>;
}

interface Anim {
  shot: PuttShotView;
  pos: Float64Array;
  endAt: number;
  nextEvent: number;
  trail: number[];
  mine: boolean;
}

const TICKS_PER_MS = PUTT_TICK_HZ / 1000;
const EVENT_KINDS = PUTT_PATH_EVENTS;

function wrapAngle(a: number): number {
  return ((Math.round(a) % PUTT_ANGLE_UNITS) + PUTT_ANGLE_UNITS) % PUTT_ANGLE_UNITS;
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export class PuttController {
  private anims = new Map<string, Anim>();
  private holeIndex = -1;
  private holeKey = '';
  private ui: PuttUi = { canAim: false, myTurn: false, aiming: false, angle: 0, power: 350, spectator: false, rolling: false, callouts: [], cancelZone: false };
  private readonly uiListeners = new Set<() => void>();
  private readonly unsubs: Array<() => void> = [];
  private fxQueue: FxEvent[] = [];
  private pendingUntil = 0;
  private lastRelaySent = 0;
  private lastRelayKey = '';
  private remoteAim: (PuttAimRelay & { at: number }) | null = null;
  private drag: { id: number; ax: number; ay: number; px: number; py: number } | null = null;
  private keyAimShown = false;
  private calloutSeq = 0;
  private previewCache: { key: string; preview: number[]; contact: { x: number; y: number } | null } | null = null;
  private readonly display = new Map<string, { x: number; y: number }>();
  private lastFan = 0;
  readonly bumperHits = new Map<number, number>();
  readonly portalHits = new Map<number, number>();
  /** Screen ↔ world mapping + drag scale, provided by the renderer. */
  toWorldDir: (dx: number, dy: number) => { x: number; y: number } = (dx, dy) => ({ x: dx, y: dy });
  maxDragPx = 180;

  /** Subscribe to the room (idempotent; pairs with destroy() — React StrictMode safe). */
  start(): void {
    if (this.unsubs.length) return;
    this.unsubs.push(subscribeMessage(PUTT_MSG.shot, (p) => this.addShot(p as PuttShotView)));
    this.unsubs.push(
      subscribeMessage(PUTT_MSG.replay, (p) => {
        for (const s of (p as PuttShotView[]) ?? []) this.addShot(s);
      }),
    );
    this.unsubs.push(subscribeMessage(PUTT_MSG.event, (p) => this.onEvent(p as PuttEvent)));
    this.unsubs.push(
      subscribeMessage(PUTT_MSG.aim, (p) => {
        const a = p as PuttAimRelay;
        this.remoteAim = { ...a, at: performance.now() };
      }),
    );
    this.unsubs.push(subscribeState(() => this.syncUi()));
    this.unsubs.push(
      subscribeMessage('sys:error', (p) => {
        const e = p as { type?: string };
        if (e?.type === PUTT_MSG.stroke) {
          this.pendingUntil = 0;
          this.syncUi();
        }
      }),
    );
    // A roll may already be on screen (we mounted mid-roll): pick it up from the replay cache.
    const replay = getLastMessage<PuttShotView[]>(PUTT_MSG.replay);
    for (const shot of replay ?? []) this.addShot(shot);
    this.syncUi();
  }

  destroy(): void {
    for (const u of this.unsubs.splice(0)) u();
    this.anims.clear();
    this.drag = null;
  }

  /** Periodic housekeeping from the render loop (callout expiry, pending-stroke timeout). */
  tick(): void {
    this.pruneCallouts();
    if (this.pendingUntil && performance.now() > this.pendingUntil) {
      this.pendingUntil = 0;
      this.syncUi();
    } else if (!this.ui.canAim) this.syncUi();
  }

  // ---------------------------------------------------------------------------
  // UI store (useSyncExternalStore)
  // ---------------------------------------------------------------------------

  subscribeUi = (fn: () => void): (() => void) => {
    this.uiListeners.add(fn);
    return () => this.uiListeners.delete(fn);
  };
  getUi = (): PuttUi => this.ui;

  private setUi(patch: Partial<PuttUi>): void {
    let changed = false;
    for (const k of Object.keys(patch) as Array<keyof PuttUi>) {
      if (this.ui[k] !== patch[k]) changed = true;
    }
    if (!changed) return;
    this.ui = { ...this.ui, ...patch };
    for (const l of [...this.uiListeners]) l();
  }

  private state(): PuttPublicState | null {
    return getStateSnapshot<PuttPublicState>();
  }

  private me(): string | null {
    return useSessionStore.getState().playerId;
  }

  private myGolfer(s: PuttPublicState | null = this.state()): GolferView | null {
    const id = this.me();
    return id && s?.golfers ? (s.golfers[id] ?? null) : null;
  }

  /** Recompute the aim eligibility snapshot from the latest state. */
  private syncUi(): void {
    const s = this.state();
    const me = this.me();
    if (s && s.holeIndex !== this.holeIndex) this.resetHole(s);
    const g = this.myGolfer(s);
    const spectator = Boolean(me && s?.players?.[me]?.spectator) || !g;
    const anim = me ? this.anims.get(me) : undefined;
    const rollingMine = Boolean(g?.moving) || Boolean(anim && serverNow() < anim.endAt + 200);
    const myTurn = Boolean(s && me && s.mode === 'turns' && s.turnId === me);
    const canAim = Boolean(
      s &&
        g &&
        s.phase === 'PLAYING' &&
        s.holeStatus === 'play' &&
        !g.moving &&
        !g.holed &&
        !g.pickedUp &&
        !g.retired &&
        !rollingMine &&
        (s.mode === 'ghost' || myTurn) &&
        !(s.playoffIds?.length && me && !s.playoffIds.includes(me)) &&
        performance.now() > this.pendingUntil,
    );
    const rolling = Boolean(s && Object.values(s.golfers ?? {}).some((x) => x.moving));
    if (canAim && !this.ui.canAim) this.onAimOpened(s!, g!);
    if (!canAim && this.drag) this.drag = null;
    this.setUi({ canAim, myTurn, spectator, rolling, aiming: canAim ? this.ui.aiming : false, cancelZone: canAim ? this.ui.cancelZone : false });
  }

  private resetHole(s: PuttPublicState): void {
    this.holeIndex = s.holeIndex;
    this.anims.clear();
    this.previewCache = null;
    this.remoteAim = null;
    this.keyAimShown = false;
    this.bumperHits.clear();
    this.portalHits.clear();
  }

  /** My ball just became puttable: point the keyboard aim at the cup, gently. */
  private onAimOpened(s: PuttPublicState, g: GolferView): void {
    const hole = this.holeFor(s);
    if (hole) {
      const a = (Math.atan2(hole.cup[1] - g.y, hole.cup[0] - g.x) * 18000) / Math.PI;
      const key = `${s.holeIndex}:${g.strokes}`;
      if (key !== this.holeKey) {
        this.holeKey = key;
        this.ui = { ...this.ui, angle: wrapAngle(a), power: Math.min(this.ui.power || 350, 600) };
      }
    }
    if (s.mode === 'turns' && (Object.keys(s.golfers ?? {}).length > 1 || !s.solo)) {
      puttSound.turn();
      if (Object.keys(s.golfers ?? {}).length > 1) this.callout('Your turn', 'info');
    }
  }

  private holeFor(s: PuttPublicState | null): HoleDef | null {
    if (!s || !s.route?.length) return null;
    const n = s.route[Math.min(s.holeIndex, s.route.length - 1)];
    try {
      return n ? getHole(n) : null;
    } catch {
      return null;
    }
  }

  callout(text: string, tone: Callout['tone'], sub?: string): void {
    const now = performance.now();
    const list = [...this.ui.callouts.filter((c) => now - c.at < 2600), { id: ++this.calloutSeq, text, tone, sub, at: now }].slice(-3);
    this.setUi({ callouts: list });
  }

  /** Drop expired callouts (called from the render loop at a low rate). */
  pruneCallouts(): void {
    const now = performance.now();
    if (this.ui.callouts.some((c) => now - c.at >= 2600)) this.setUi({ callouts: this.ui.callouts.filter((c) => now - c.at < 2600) });
  }

  // ---------------------------------------------------------------------------
  // Server messages
  // ---------------------------------------------------------------------------

  private addShot(shot: PuttShotView): void {
    if (!shot || typeof shot.seq !== 'number') return;
    const existing = this.anims.get(shot.playerId);
    if (existing && existing.shot.seq >= shot.seq) return;
    const s = this.state();
    if (s && shot.holeIndex !== s.holeIndex) return;
    const me = this.me();
    const mine = shot.playerId === me;
    this.anims.set(shot.playerId, {
      shot,
      pos: decodePath(shot.path),
      endAt: shot.startedAt + shot.durationMs,
      nextEvent: 0,
      trail: [],
      mine,
    });
    if (mine) {
      this.pendingUntil = 0;
      this.drag = null;
    } else if (serverNow() < shot.startedAt + 400) {
      // Someone else struck: hear the club (our own strike played at release).
      puttSound.strike(shot.power / PUTT_POWER_MAX);
    }
    if (this.remoteAim?.playerId === shot.playerId) this.remoteAim = null;
    this.syncUi();
  }

  private nameOf(id: string): string {
    const s = this.state();
    return s?.golfers?.[id]?.name ?? s?.players?.[id]?.name ?? 'Someone';
  }

  private onEvent(e: PuttEvent): void {
    const me = this.me();
    const mine = 'playerId' in e && e.playerId === me;
    switch (e.kind) {
      case 'holed': {
        puttSound.holed(e.strokes, e.par);
        const who = mine ? '' : this.nameOf(e.playerId);
        const tone: Callout['tone'] = e.strokes === 1 || e.strokes <= e.par - 2 ? 'great' : e.strokes < e.par ? 'good' : e.strokes === e.par ? 'good' : 'info';
        this.callout(e.label, tone, mine ? `${e.strokes} ${e.strokes === 1 ? 'stroke' : 'strokes'}` : who);
        break;
      }
      case 'penalty':
        if (mine) puttSound.penalty();
        this.callout(e.reason === 'water' ? 'Splash! +1' : 'Out of bounds +1', 'bad', mine ? 'Back to your last lie' : this.nameOf(e.playerId));
        break;
      case 'timeout':
        if (mine) puttSound.timeout();
        this.callout('Time! +1 stroke', 'bad', mine ? 'The shot clock ran out' : this.nameOf(e.playerId));
        break;
      case 'pickup':
        if (e.reason !== 'away' || mine) this.callout(mine ? 'Ball picked up' : `${this.nameOf(e.playerId)} picked up`, 'info', `Scores ${e.strokes} on this hole`);
        break;
      case 'playoff':
        this.callout('Sudden death!', 'great', `Playoff on hole ${e.hole}`);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Aiming + intents
  // ---------------------------------------------------------------------------

  setAim(angle: number, power: number, source: 'keys' | 'drag'): void {
    const a = wrapAngle(angle);
    const p = Math.max(0, Math.min(PUTT_POWER_MAX, Math.round(power)));
    if (source === 'keys') this.keyAimShown = true;
    this.setUi({ angle: a, power: p });
    this.relayAim();
  }

  nudgeAngle(delta: number): void {
    if (!this.ui.canAim) return;
    this.setAim(this.ui.angle + delta, this.ui.power, 'keys');
  }

  nudgePower(delta: number): void {
    if (!this.ui.canAim) return;
    this.setAim(this.ui.angle, Math.max(PUTT_POWER_MIN, this.ui.power + delta), 'keys');
  }

  private relayAim(): void {
    const s = this.state();
    if (!s || s.mode !== 'turns' || !this.ui.canAim) return;
    const now = performance.now();
    const key = `${this.ui.angle}:${this.ui.power}`;
    if (key === this.lastRelayKey || now - this.lastRelaySent < 100) return;
    this.lastRelayKey = key;
    this.lastRelaySent = now;
    session.send(PUTT_MSG.aim, { angle: this.ui.angle, power: this.ui.power });
  }

  /** Send the stroke intent. Returns false if the putt could not be taken. */
  putt(): boolean {
    if (!this.ui.canAim) return false;
    const power = Math.round(this.ui.power);
    if (power < PUTT_POWER_MIN) return false;
    const angle = wrapAngle(this.ui.angle);
    session.send(PUTT_MSG.stroke, { angle, power, at: Math.round(serverNow()) });
    puttSound.strike(power / PUTT_POWER_MAX);
    const g = this.myGolfer();
    if (g) this.fxQueue.push({ kind: 'strike', x: g.x, y: g.y, power: power / PUTT_POWER_MAX });
    this.pendingUntil = performance.now() + 2500;
    this.drag = null;
    this.keyAimShown = false;
    this.setUi({ aiming: false, cancelZone: false });
    this.syncUi();
    return true;
  }

  pickUp(): void {
    session.send(PUTT_MSG.pickup, {});
  }

  // Pointer (slingshot) ---------------------------------------------------------

  pointerDown(id: number, x: number, y: number): boolean {
    if (!this.ui.canAim || this.drag) return false;
    this.drag = { id, ax: x, ay: y, px: x, py: y };
    this.setUi({ aiming: true, cancelZone: true });
    return true;
  }

  pointerMove(id: number, x: number, y: number): void {
    const d = this.drag;
    if (!d || d.id !== id) return;
    d.px = x;
    d.py = y;
    const dx = d.ax - x;
    const dy = d.ay - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const cancel = dist < 12;
    if (!cancel) {
      const w = this.toWorldDir(dx, dy);
      const angle = (Math.atan2(w.y, w.x) * 18000) / Math.PI;
      const power = Math.max(PUTT_POWER_MIN, Math.min(1, dist / this.maxDragPx) * PUTT_POWER_MAX);
      this.setAim(angle, power, 'drag');
    }
    this.setUi({ cancelZone: cancel });
  }

  pointerUp(id: number): void {
    const d = this.drag;
    if (!d || d.id !== id) return;
    const cancelled = this.ui.cancelZone;
    this.drag = null;
    this.setUi({ aiming: false, cancelZone: false });
    if (!cancelled) this.putt();
  }

  cancelDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.setUi({ aiming: false, cancelZone: false });
  }

  // Keyboard ---------------------------------------------------------------------

  onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      if (this.drag) {
        this.cancelDrag();
        e.preventDefault();
      }
      return;
    }
    if (!this.ui.canAim) return;
    const fine = e.shiftKey;
    const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
    switch (e.key) {
      case 'ArrowLeft':
        this.nudgeAngle(fine ? -10 : -100);
        break;
      case 'ArrowRight':
        this.nudgeAngle(fine ? 10 : 100);
        break;
      case 'ArrowUp':
        this.nudgePower(fine ? 5 : 25);
        break;
      case 'ArrowDown':
        this.nudgePower(fine ? -5 : -25);
        break;
      case ' ':
      case 'Enter':
        if (onButton) return;
        this.putt();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // ---------------------------------------------------------------------------
  // Per-frame scene
  // ---------------------------------------------------------------------------

  drainFx(): FxEvent[] {
    const q = this.fxQueue;
    this.fxQueue = [];
    return q;
  }

  frame(): Frame {
    const s = this.state();
    const now = serverNow();
    if (s && s.holeIndex !== this.holeIndex) this.resetHole(s);
    const hole = this.holeFor(s);
    const obstacleMs = s ? Math.max(0, now - s.holeStartedAt) : 0;
    const balls: BallDraw[] = [];
    const me = this.me();
    let anyAnimEnded = false;
    if (s && hole && (s.phase === 'PLAYING' || s.phase === 'INTERMISSION' || s.phase === 'COUNTDOWN' || s.phase === 'RESULTS')) {
      for (const [id, g] of Object.entries(s.golfers ?? {})) {
        if (g.retired) continue;
        if (s.playoffIds?.length && !s.playoffIds.includes(id)) continue;
        const anim = this.anims.get(id);
        const ball: BallDraw = {
          id,
          x: g.x,
          y: g.y,
          color: g.color,
          name: g.name,
          me: id === me,
          active: s.mode === 'turns' ? s.turnId === id : !g.holed && !g.pickedUp,
          moving: false,
          alpha: g.holed ? 0 : g.pickedUp ? 0.35 : 1,
          scale: 1,
          trail: [],
        };
        if (anim) {
          this.stepAnim(anim, now, hole, ball);
          if (now > anim.endAt + 900 && g.lastSeq >= anim.shot.seq && !g.moving) {
            this.anims.delete(id);
            anyAnimEnded = true;
          }
        } else if (g.holed) {
          ball.alpha = 0;
        }
        if (ball.alpha > 0.01) balls.push(ball);
      }
      this.fanOut(balls, hole);
      balls.sort((a, b) => Number(a.me) - Number(b.me));
    }
    if (anyAnimEnded) this.syncUi();
    return { state: s, hole, holeIndex: s?.holeIndex ?? 0, obstacleMs, balls, aim: this.aimDraw(s, hole, obstacleMs), bumperHits: this.bumperHits, portalHits: this.portalHits };
  }

  /**
   * Balls resting on the same spot (everyone on the tee) are fanned out a little for display
   * only — the lie itself is exact. The golfer to play (or me) keeps the true spot; displayed
   * positions glide so nothing jumps when the turn changes.
   */
  private fanOut(balls: BallDraw[], hole: HoleDef): void {
    const r = PHYS.ballR * 2.8;
    const resting = balls.filter((b) => !b.moving && b.scale >= 1 && b.trail.length === 0);
    const used = new Set<BallDraw>();
    for (const b of resting) {
      if (used.has(b)) continue;
      const group = resting.filter((o) => !used.has(o) && Math.abs(o.x - b.x) < 3 && Math.abs(o.y - b.y) < 3);
      group.forEach((o) => used.add(o));
      if (group.length < 2) continue;
      group.sort((a, c) => Number(c.active) - Number(a.active) || Number(c.me) - Number(a.me) || a.id.localeCompare(c.id));
      const ax = b.x - hole.cup[0];
      const ay = b.y - hole.cup[1];
      const base = Math.atan2(ay, ax);
      group.slice(1).forEach((o, i) => {
        const k = i - (group.length - 2) / 2;
        const a = base + k * 0.9;
        o.x += Math.cos(a) * r;
        o.y += Math.sin(a) * r;
        o.alpha *= 0.8;
      });
    }
    const now = performance.now();
    const dt = this.lastFan ? Math.min(0.1, (now - this.lastFan) / 1000) : 0;
    this.lastFan = now;
    for (const b of balls) {
      const prev = this.display.get(b.id);
      if (prev && !b.moving && b.trail.length === 0 && b.scale >= 1) {
        const d = Math.abs(prev.x - b.x) + Math.abs(prev.y - b.y);
        if (d > 0.05 && d < PHYS.ballR * 6) {
          const k = 1 - Math.exp(-dt * 10);
          b.x = prev.x + (b.x - prev.x) * k;
          b.y = prev.y + (b.y - prev.y) * k;
        }
      }
      this.display.set(b.id, { x: b.x, y: b.y });
    }
  }

  private stepAnim(anim: Anim, now: number, hole: HoleDef, ball: BallDraw): void {
    const shot = anim.shot;
    const tick = (now - shot.startedAt) * TICKS_PER_MS;
    const p = pathPosition(anim.pos, shot.ticks, tick, { x: 0, y: 0 });
    ball.x = p.x;
    ball.y = p.y;
    ball.moving = tick >= 0 && tick < shot.ticks;
    ball.alpha = 1;
    // Fire path events as the ball reaches them.
    while (anim.nextEvent < shot.events.length && shot.events[anim.nextEvent]![0] <= tick) {
      this.fireEvent(anim, shot.events[anim.nextEvent]!, hole);
      anim.nextEvent++;
    }
    if (ball.moving) {
      anim.trail.push(p.x, p.y);
      if (anim.trail.length > 28) anim.trail.splice(0, anim.trail.length - 28);
    } else if (anim.trail.length) anim.trail.splice(0, 2);
    ball.trail = anim.trail;
    if (tick >= shot.ticks) {
      const after = now - anim.endAt;
      if (shot.result === 'cup') {
        ball.x = hole.cup[0];
        ball.y = hole.cup[1];
        ball.scale = Math.max(0, 1 - after / 260);
        ball.alpha = ball.scale;
      } else if (shot.result === 'water' || shot.result === 'oob') {
        if (after < 650) {
          ball.alpha = shot.result === 'oob' ? Math.max(0, 1 - after / 400) : 0;
          ball.scale = shot.result === 'oob' ? Math.max(0.2, 1 - after / 450) : 1;
        } else {
          ball.x = shot.lie[0];
          ball.y = shot.lie[1];
          ball.alpha = Math.min(1, (after - 650) / 300);
          ball.scale = 1;
        }
      }
    }
  }

  private fireEvent(anim: Anim, ev: PuttShotView['events'][number], hole: HoleDef): void {
    const [, kindIdx, x10, y10, v] = ev;
    const kind = EVENT_KINDS[kindIdx];
    if (!kind) return;
    const x = x10 / 10;
    const y = y10 / 10;
    const now = performance.now();
    switch (kind) {
      case 'wall':
        puttSound.wall(v);
        this.fxQueue.push({ kind: 'impact', x, y, v, what: kind, index: -1 });
        break;
      case 'post':
        puttSound.post(v);
        this.fxQueue.push({ kind: 'impact', x, y, v, what: kind, index: -1 });
        break;
      case 'blade':
        puttSound.blade(v);
        this.fxQueue.push({ kind: 'impact', x, y, v, what: kind, index: -1 });
        break;
      case 'bumper':
        puttSound.bumper();
        this.bumperHits.set(v, now);
        this.fxQueue.push({ kind: 'impact', x, y, v: 500, what: kind, index: v });
        break;
      case 'portal':
        puttSound.portal();
        this.portalHits.set(v, now);
        this.fxQueue.push({ kind: 'portal', x, y, index: v });
        break;
      case 'sand':
        puttSound.sand();
        this.fxQueue.push({ kind: 'impact', x, y, v: 0, what: kind, index: -1 });
        break;
      case 'lip':
        puttSound.lip();
        if (anim.mine) this.callout('Lip out!', 'bad', 'So close');
        break;
      case 'cup': {
        puttSound.cup();
        const color = this.state()?.golfers?.[anim.shot.playerId]?.color ?? '#fde047';
        this.fxQueue.push({ kind: 'cup', x: hole.cup[0], y: hole.cup[1], big: anim.shot.strokes === 1, color });
        break;
      }
      case 'water':
        puttSound.splash();
        this.fxQueue.push({ kind: 'splash', x, y });
        break;
      case 'oob':
        puttSound.fall();
        this.fxQueue.push({ kind: 'fall', x, y });
        break;
    }
  }

  private aimDraw(s: PuttPublicState | null, hole: HoleDef | null, obstacleMs: number): AimDraw | null {
    if (!s || !hole) return null;
    if (this.ui.canAim) {
      const g = this.myGolfer(s);
      if (!g) return null;
      const d = this.drag;
      const show = Boolean(d) || this.keyAimShown || this.ui.aiming;
      const power = d && this.ui.cancelZone ? 0 : this.ui.power;
      const { preview, contact } = show && power >= PUTT_POWER_MIN ? this.preview(hole, g, this.ui.angle, power, obstacleMs) : { preview: [], contact: null };
      return {
        x: g.x,
        y: g.y,
        angle: this.ui.angle,
        power: show ? power : 0,
        mine: true,
        color: g.color,
        preview,
        contact,
        drag: d ? { ax: d.ax, ay: d.ay, px: d.px, py: d.py } : null,
      };
    }
    const r = this.remoteAim;
    if (r && s.mode === 'turns' && s.turnId === r.playerId && performance.now() - r.at < 1500) {
      const g = s.golfers?.[r.playerId];
      if (g && !g.moving) return { x: g.x, y: g.y, angle: r.angle, power: r.power, mine: false, color: g.color, preview: [], contact: null, drag: null };
    }
    return null;
  }

  /**
   * Limited preview: the path up to the first contact (plus a short stub after it), capped in
   * length and never shown entering the cup.
   */
  private preview(hole: HoleDef, g: GolferView, angle: number, power: number, obstacleMs: number): { preview: number[]; contact: { x: number; y: number } | null } {
    const moving = Boolean(hole.movers?.length);
    const t = obstacleMs + PUTT_LAUNCH_DELAY_MS;
    const key = `${hole.id}:${g.x}:${g.y}:${angle}:${power}${moving ? `:${Math.round(t / 50)}` : ''}`;
    if (this.previewCache?.key === key) return this.previewCache;
    const sim = simulateShot(hole, { x: g.x, y: g.y }, angle, power, t, { maxTicks: 160 });
    const firstContact = sim.events.find((e) => e.kind === 'wall' || e.kind === 'post' || e.kind === 'bumper' || e.kind === 'blade');
    const stopTick = firstContact ? firstContact.tick + 18 : sim.ticks;
    const out: number[] = [];
    let travelled = 0;
    const cupR = PHYS.cupR * 1.8;
    const maxLen = 330;
    let px = g.x;
    let py = g.y;
    let reached = false;
    out.push(px, py);
    for (let k = 1; k * 2 < sim.samples.length; k++) {
      const tick = k * 2;
      if (tick > stopTick) break;
      if (firstContact && tick >= firstContact.tick) reached = true;
      const x = sim.samples[k * 2]!;
      const y = sim.samples[k * 2 + 1]!;
      const seg = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      if (seg > 60) break; // teleported
      travelled += seg;
      if (travelled > maxLen && !(firstContact && tick > firstContact.tick)) break;
      if ((x - hole.cup[0]) * (x - hole.cup[0]) + (y - hole.cup[1]) * (y - hole.cup[1]) < cupR * cupR) break;
      out.push(x, y);
      px = x;
      py = y;
    }
    const contact = firstContact && reached ? { x: firstContact.x, y: firstContact.y } : null;
    this.previewCache = { key, preview: out, contact };
    return this.previewCache;
  }
}
