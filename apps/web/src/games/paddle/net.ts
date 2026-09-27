/**
 * Pixel Paddle client netcode (no rendering here).
 *
 *  - Own paddle: predicted locally with the engine's exact paddle rule (move towards the target at
 *    the capped speed), so it answers instantly; the server receives the same target ~30×/s.
 *  - Ball + opponent: the latest server snapshot is loaded into a mirror match and stepped
 *    forward to the estimated current server tick with the shared engine (walls and paddle
 *    bounces included). When a new snapshot disagrees with what we showed, the difference is
 *    kept as a decaying visual offset (big jumps snap) so corrections never pop.
 *  - The server decides every hit and point; the client only animates them.
 */
import { PADDLE_MSG, type PaddleSettings } from '@dascade/shared/games/paddle';
import { createSeededRng } from '@dascade/shared';
import {
  PADDLE,
  applyPaddleSnapshot,
  clamp,
  decodePaddleSnapshot,
  stepMatch,
  type PaddleMatch,
  type PaddleRules,
  type PaddleSnapshot,
  type Side,
} from '@dascade/game-core/paddle';
import { session, useSessionStore } from '../../net/session.ts';
import { subscribeBytes } from '../_classics/index.ts';

const TICK_MS = 1000 / PADDLE.tickRate;
const MIN_Y = PADDLE.paddleH / 2;
const MAX_Y = PADDLE.height - PADDLE.paddleH / 2;
/** Most ticks we extrapolate past the last snapshot (then the ball holds). */
const MAX_AHEAD = 12;

export interface PaddleFrame {
  ball: { x: number; y: number; vx: number; vy: number; speed: number };
  paddles: [number, number];
  status: PaddleSnapshot['status'];
  server: Side;
  rally: number;
  tick: number;
  /** True once at least one snapshot for the current match has arrived. */
  live: boolean;
}

function cloneMatch(m: PaddleMatch): PaddleMatch {
  return {
    ...m,
    ball: { ...m.ball },
    sides: [
      { ...m.sides[0], history: [...m.sides[0].history] },
      { ...m.sides[1], history: [...m.sides[1].history] },
    ],
  };
}

export class PaddleNet {
  private mirror: PaddleMatch | null = null;
  private snap: PaddleSnapshot | null = null;
  private snapAt = 0;
  private matchId = -1;
  private rules: PaddleRules = { target: 7, winBy2: true, speed: 'classic' };
  private readonly dummyRng = createSeededRng('paddle-view');
  private offset = { x: 0, y: 0 };
  private oppOffset = 0;
  private stepCount = 0;
  private serveQueued = false;
  private unsub: (() => void) | null = null;

  /** Which side this client steers (-1 = spectator / not seated). */
  mySide: Side | -1 = -1;
  /** Predicted own paddle position and the target we steer to. */
  myY = PADDLE.height / 2;
  myTarget = PADDLE.height / 2;
  /** Listeners notified on each new snapshot (for effects). */
  onSnapshot: ((s: PaddleSnapshot) => void) | null = null;

  attach(): void {
    this.unsub = subscribeBytes(PADDLE_MSG.snap, (bytes) => this.receive(bytes));
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  setRules(s: Pick<PaddleSettings, 'target' | 'winBy2' | 'speed'>): void {
    this.rules = { target: s.target, winBy2: s.winBy2, speed: s.speed };
  }

  /** A new match started (or the side changed): re-centre the prediction. */
  reset(side: Side | -1): void {
    this.mySide = side;
    this.mirror = null;
    this.snap = null;
    this.matchId = -1;
    this.myY = PADDLE.height / 2;
    this.myTarget = this.myY;
    this.offset = { x: 0, y: 0 };
    this.oppOffset = 0;
  }

  private receive(bytes: Uint8Array): void {
    const s = decodePaddleSnapshot(bytes);
    if (!s) return;
    const now = performance.now();
    const fresh = s.matchId !== this.matchId;
    const before = fresh ? null : this.frame(now);
    this.matchId = s.matchId;
    this.snap = s;
    this.snapAt = now;
    this.mirror = applyPaddleSnapshot(this.mirror && !fresh ? this.mirror : null, s, this.rules);
    const side = this.mySide;
    if (fresh && side !== -1) {
      // Adopt the server's paddle position at the start of a match.
      this.myY = s.paddles[side].y;
      this.myTarget = this.myY;
    }
    if (before && before.live) {
      const after = this.frame(now);
      const dx = before.ball.x + this.offset.x - after.ball.x;
      const dy = before.ball.y + this.offset.y - after.ball.y;
      if (dx * dx + dy * dy < 90 * 90 && s.status === 'play') this.offset = { x: dx, y: dy };
      else this.offset = { x: 0, y: 0 };
      if (side !== -1) {
        const opp = (1 - side) as Side;
        const d = before.paddles[opp] + this.oppOffset - after.paddles[opp];
        this.oppOffset = Math.abs(d) < 120 ? d : 0;
      }
    }
    this.onSnapshot?.(s);
  }

  /** Steer: absolute target (pointer / drag). */
  steerTo(y: number): void {
    this.myTarget = clamp(y, MIN_Y, MAX_Y);
  }

  /** Steer: held direction (keyboard / gamepad / buttons). 0 = stop where the paddle is. */
  steerDir(dir: -1 | 0 | 1): void {
    this.myTarget = dir === 0 ? this.myY : clamp(this.myY + dir * PADDLE.paddleSpeed * 6, MIN_Y, MAX_Y);
  }

  serve(): void {
    this.serveQueued = true;
  }

  /** Fixed 60 Hz step: predict our paddle and send intents every other tick. */
  step(canPlay: boolean): void {
    if (this.mySide === -1) return;
    const dy = clamp(this.myTarget - this.myY, -PADDLE.paddleSpeed, PADDLE.paddleSpeed);
    if (canPlay) this.myY = clamp(this.myY + dy, MIN_Y, MAX_Y);
    this.stepCount++;
    if (this.stepCount % 2 === 0 && canPlay) {
      const rtt = useSessionStore.getState().pingMs;
      session.send(PADDLE_MSG.input, {
        y: Math.round(this.myTarget * 10) / 10,
        ...(this.serveQueued ? { serve: true } : {}),
        ...(typeof rtt === 'number' && rtt > 0 ? { rtt: Math.min(2000, Math.round(rtt)) } : {}),
      });
      this.serveQueued = false;
    }
  }

  /** What to draw now: the server's world extrapolated to the present, plus our own paddle. */
  frame(now = performance.now()): PaddleFrame {
    const s = this.snap;
    const m = this.mirror;
    if (!s || !m) {
      const mid = PADDLE.height / 2;
      return {
        ball: { x: PADDLE.width / 2, y: mid, vx: 0, vy: 0, speed: 0 },
        paddles: [this.mySide === 0 ? this.myY : mid, this.mySide === 1 ? this.myY : mid],
        status: 'serve',
        server: 0,
        rally: 0,
        tick: 0,
        live: false,
      };
    }
    const rtt = useSessionStore.getState().pingMs || 40;
    const ahead = Math.max(0, Math.min(MAX_AHEAD, Math.floor((now - this.snapAt + rtt / 2) / TICK_MS)));
    const sim = cloneMatch(m);
    const side = this.mySide;
    if (side !== -1) {
      sim.sides[side].y = this.myY;
      sim.sides[side].target = this.myTarget;
      sim.sides[side].history = [this.myY];
    }
    if (s.status === 'play') {
      for (let i = 0; i < ahead && sim.status === 'play'; i++) stepMatch(sim, this.dummyRng);
    }
    const paddles: [number, number] = [sim.sides[0].y, sim.sides[1].y];
    if (side !== -1) paddles[side] = this.myY;
    const bx = sim.ball.x;
    let by = sim.ball.y;
    if (s.status === 'serve') {
      // The ball rides the serving paddle (ours is predicted).
      by = paddles[s.server];
    }
    return {
      ball: { x: bx + this.offset.x, y: by + this.offset.y, vx: sim.ball.vx, vy: sim.ball.vy, speed: sim.ball.speed },
      paddles: side === -1 ? paddles : side === 0 ? [paddles[0], paddles[1] + this.oppOffset] : [paddles[0] + this.oppOffset, paddles[1]],
      status: s.status,
      server: s.server,
      rally: s.rally,
      tick: s.tick + ahead,
      live: true,
    };
  }

  /** Decay the visual correction offsets (call once per render with the frame time). */
  decay(frameMs: number): void {
    const k = Math.pow(0.001, Math.min(0.1, frameMs / 1000) / 0.12);
    this.offset.x *= k;
    this.offset.y *= k;
    this.oppOffset *= k;
    if (Math.abs(this.offset.x) < 0.05) this.offset.x = 0;
    if (Math.abs(this.offset.y) < 0.05) this.offset.y = 0;
  }

  get hasSnapshot(): boolean {
    return this.snap !== null;
  }

  get snapshot(): PaddleSnapshot | null {
    return this.snap;
  }
}
