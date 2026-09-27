/**
 * Brick Blitz — deterministic brick-breaker engine (60 Hz ticks, logical 480 × 640 field).
 *
 * Runs identically on the client and the server replay (classics kit model 2): only + − × ÷,
 * Math.sqrt/floor/round/min/max/abs and the shared 64-direction table are used (CONTRACT §7);
 * randomness comes from seeded substreams of the run seed.
 *
 * Rules
 *  - 3 lives; +1 life every 25,000 points (max 9). Lose a life when every ball has fallen.
 *  - The ball rests on the paddle until launched (Space / tap) — or auto-launches after 5 s.
 *  - Where the ball hits the paddle sets its angle (up to ±56° from vertical).
 *  - Bricks: normal (1 hit), armored (2–3 hits), explosive (blasts its 8 neighbours, chains),
 *    moving (slides along its row), steel (indestructible, not needed to clear), power
 *    (always drops a capsule; any breakable brick drops one 1 time in 9).
 *  - Capsules: WIDE paddle, MULTI (every ball splits in three), LASER (fire twin bolts),
 *    SLOW ball, STICKY (catch and aim the ball), +1 LIFE (rare). Timed effects last 12 s.
 *  - Clear every breakable brick to advance: 8 designed levels, then procedural sectors.
 *    The ball gets faster with each level and with every 12 paddle hits.
 *
 * Scoring: normal 50 · armored 20 per crack, 120 to break · explosive 80 · moving 150 · power
 * 100 · chain bonus +10 per extra brick in one flight (max +100) · capsule 100 · level clear
 * 1000 × level · flawless level (no life lost) +2000 × level.
 *
 * Input codes (anything else is invalid → a tampered log):
 *   0…480  paddle target x (pointer / touch)      1000 no direction · 1001 left · 1002 right
 *   1010   launch / fire
 */
import type { RunSummary } from '@dascade/shared/games/classics';
import { DIRS, clamp, substream, type ClassicsSim, type Rng } from '../classics/shared/index.ts';
import { COLS, levelDef, type BrickKind } from './levels.ts';

export const FIELD_W = 480;
export const FIELD_H = 640;
export const BRICK_TOP = 64;
export const CELL_W = FIELD_W / COLS; // 40
export const CELL_H = 20;
export const BRICK_INSET_X = 2;
export const BRICK_INSET_Y = 2;
export const PADDLE_Y = 596;
export const PADDLE_H = 12;
export const PADDLE_W = 84;
export const PADDLE_WIDE = 128;
export const BALL_R = 5;
export const KEY_SPEED = 7.5;
export const POINTER_SPEED = 30;
export const CAPSULE_W = 30;
export const CAPSULE_H = 14;
export const CAPSULE_SPEED = 2.2;
export const BOLT_SPEED = 11;
export const EFFECT_TICKS = 720;
export const AUTO_LAUNCH = 300;
export const STICKY_HOLD = 180;
export const MAX_BALLS = 12;
export const START_LIVES = 3;
export const EXTRA_LIFE_EVERY = 25_000;
export const LEVEL_CLEAR_TICKS = 110;
export const RESPAWN_TICKS = 70;

export const CODE = { axisNone: 1000, axisLeft: 1001, axisRight: 1002, action: 1010 } as const;
export const MAX_CODE = 1010;

export const POWER_KINDS = ['wide', 'multi', 'laser', 'slow', 'sticky', 'life'] as const;
export type PowerKind = (typeof POWER_KINDS)[number];

export interface Brick {
  id: number;
  kind: BrickKind;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  /** Row colour index (normal bricks). */
  tone: number;
  alive: boolean;
  row: number;
  col: number;
  /** Movers: horizontal speed (px/tick). */
  vx: number;
  /** Last hit tick (render flash). */
  hitAt: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  stuck: boolean;
  /** Offset from the paddle centre while stuck. */
  stuckDx: number;
  stuckAt: number;
}

export interface Capsule {
  x: number;
  y: number;
  kind: PowerKind;
}

export interface Bolt {
  x: number;
  y: number;
}

export type BricksPhase = 'serve' | 'play' | 'dead' | 'clear' | 'over';

export type BricksEvent =
  | { t: 'hit'; x: number; y: number; kind: BrickKind; destroyed: boolean; points: number; tone: number }
  | { t: 'steel'; x: number; y: number }
  | { t: 'blast'; x: number; y: number }
  | { t: 'paddle'; x: number }
  | { t: 'wall' }
  | { t: 'capsule'; kind: PowerKind; x: number; y: number }
  | { t: 'power'; kind: PowerKind }
  | { t: 'laser' }
  | { t: 'launch' }
  | { t: 'miss' }
  | { t: 'life'; lives: number }
  | { t: 'clear'; level: number; bonus: number; flawless: boolean }
  | { t: 'level'; level: number; name: string }
  | { t: 'over' };

export interface BricksOptions {
  startLevel?: number;
}

const BRICK_POINTS: Record<BrickKind, number> = { N: 50, A: 120, X: 80, S: 0, P: 100, M: 150 };
const UP = 48;

export class BricksSim implements ClassicsSim {
  tick = 0;
  ended = false;
  private endSettled = false;
  private stepping = false;
  phase: BricksPhase = 'serve';
  phaseTimer = 0;
  score = 0;
  lives = START_LIVES;
  level = 1;
  levelName = '';
  bricksBroken = 0;
  nextLifeAt = EXTRA_LIFE_EVERY;
  bricks: Brick[] = [];
  private grid: Array<Brick | null> = [];
  balls: Ball[] = [];
  capsules: Capsule[] = [];
  bolts: Bolt[] = [];
  paddleX = FIELD_W / 2;
  prevPaddleX = FIELD_W / 2;
  paddleW = PADDLE_W;
  axis: -1 | 0 | 1 = 0;
  target: number | null = null;
  /** Remaining ticks of timed effects. */
  wide = 0;
  laser = 0;
  slow = 0;
  sticky = 0;
  laserCooldown = 0;
  paddleHits = 0;
  private chain = 0;
  private lostLifeThisLevel = false;
  private idleTicks = 0;
  private nextId = 1;
  private readonly seed: string;
  private readonly dropRng: Rng;
  readonly events: BricksEvent[] = [];
  private readonly recordEvents: boolean;

  constructor(seed: string, options: BricksOptions = {}, recordEvents = true) {
    this.seed = seed;
    this.dropRng = substream(seed, 'drops');
    this.recordEvents = recordEvents;
    this.level = Math.max(1, Math.min(8, Math.floor(options.startLevel ?? 1)));
    this.loadLevel();
  }

  // ---------------------------------------------------------------------------
  // ClassicsSim
  // ---------------------------------------------------------------------------

  get over(): boolean {
    return this.ended && this.endSettled;
  }

  input(code: number): boolean {
    if (!Number.isInteger(code) || code < 0 || code > MAX_CODE) return false;
    if (code > FIELD_W && code !== CODE.axisNone && code !== CODE.axisLeft && code !== CODE.axisRight && code !== CODE.action) return false;
    if (this.ended) return true;
    if (code <= FIELD_W) {
      this.target = code;
      this.axis = 0;
    } else if (code === CODE.axisNone) this.axis = 0;
    else if (code === CODE.axisLeft) {
      this.axis = -1;
      this.target = null;
    } else if (code === CODE.axisRight) {
      this.axis = 1;
      this.target = null;
    } else if (code === CODE.action) this.action();
    return true;
  }

  step(): void {
    if (this.ended) {
      if (!this.endSettled) {
        this.tick++;
        this.endSettled = true;
      }
      return;
    }
    this.tick++;
    this.stepping = true;
    try {
      this.stepInner();
    } finally {
      this.stepping = false;
    }
  }

  summary(): RunSummary {
    return { score: this.score, level: this.level, lives: this.lives, stat: this.bricksBroken };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  ballSpeed(): number {
    const base = Math.min(8.2, 4.6 + (this.level - 1) * 0.28 + Math.min(1.2, Math.floor(this.paddleHits / 12) * 0.2));
    return this.slow > 0 ? base * 0.68 : base;
  }

  breakableLeft(): number {
    let n = 0;
    for (const b of this.bricks) if (b.alive && b.kind !== 'S') n++;
    return n;
  }

  drainEvents(): BricksEvent[] {
    return this.events.splice(0);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private emit(e: BricksEvent): void {
    if (!this.recordEvents) return;
    if (this.events.length >= 128) this.events.shift();
    this.events.push(e);
  }

  private loadLevel(): void {
    const def = levelDef(this.seed, this.level - 1);
    this.levelName = def.name;
    this.bricks = [];
    this.grid = new Array<Brick | null>(COLS * def.rows.length).fill(null);
    const armorHp = this.level >= 9 ? 3 : 2;
    def.rows.forEach((row, r) => {
      const moverSpeed = (r % 2 === 0 ? 1 : -1) * Math.min(2.2, 0.9 + this.level * 0.08);
      for (let c = 0; c < COLS; c++) {
        const ch = row[c] as BrickKind | '.' | undefined;
        if (!ch || ch === '.') continue;
        const hp = ch === 'A' ? armorHp : 1;
        const brick: Brick = {
          id: this.nextId++,
          kind: ch,
          x: c * CELL_W + BRICK_INSET_X,
          y: BRICK_TOP + r * CELL_H + BRICK_INSET_Y,
          w: CELL_W - BRICK_INSET_X * 2,
          h: CELL_H - BRICK_INSET_Y * 2,
          hp,
          maxHp: hp,
          tone: r % 7,
          alive: true,
          row: r,
          col: c,
          vx: ch === 'M' ? moverSpeed : 0,
          hitAt: -100,
        };
        this.bricks.push(brick);
        if (ch !== 'M') this.grid[r * COLS + c] = brick;
      }
    });
    this.capsules = [];
    this.bolts = [];
    this.wide = this.laser = this.slow = this.sticky = 0;
    this.paddleW = PADDLE_W;
    this.lostLifeThisLevel = false;
    this.serve();
    this.emit({ t: 'level', level: this.level, name: this.levelName });
  }

  private serve(): void {
    this.phase = 'serve';
    this.balls = [this.newBall(this.paddleX, PADDLE_Y - BALL_R - 1, 0, 0, true)];
    this.balls[0]!.stuckDx = 0;
    this.phaseTimer = AUTO_LAUNCH;
    this.chain = 0;
    this.idleTicks = 0;
  }

  private newBall(x: number, y: number, vx: number, vy: number, stuck: boolean): Ball {
    return { x, y, vx, vy, px: x, py: y, stuck, stuckDx: 0, stuckAt: this.tick };
  }

  private action(): void {
    if (this.phase !== 'serve' && this.phase !== 'play') return;
    let launched = false;
    for (const b of this.balls) {
      if (b.stuck) {
        this.launchBall(b);
        launched = true;
      }
    }
    if (launched) {
      this.phase = 'play';
      this.emit({ t: 'launch' });
      return;
    }
    if (this.laser > 0 && this.laserCooldown === 0 && this.bolts.length < 10) {
      const half = this.paddleW / 2 - 6;
      this.bolts.push({ x: this.paddleX - half, y: PADDLE_Y - 4 }, { x: this.paddleX + half, y: PADDLE_Y - 4 });
      this.laserCooldown = 14;
      this.emit({ t: 'laser' });
    }
  }

  private launchBall(b: Ball): void {
    const t = clamp(b.stuckDx / (this.paddleW / 2), -1, 1);
    let idx = UP + Math.round(t * 10);
    if (idx === UP) idx = UP + 3;
    const [dx, dy] = DIRS[idx]!;
    const sp = this.ballSpeed();
    b.vx = dx * sp;
    b.vy = dy * sp;
    b.stuck = false;
    b.y = PADDLE_Y - BALL_R - 1;
    this.chain = 0;
  }

  private stepInner(): void {
    this.movePaddle();
    if (this.laserCooldown > 0) this.laserCooldown--;
    if (this.wide > 0 && --this.wide === 0) this.paddleW = PADDLE_W;
    if (this.laser > 0) this.laser--;
    if (this.slow > 0 && --this.slow === 0) this.rescaleBalls();
    if (this.sticky > 0) this.sticky--;

    if (this.phase === 'clear') {
      if (--this.phaseTimer <= 0) {
        this.level++;
        this.loadLevel();
      }
      return;
    }
    if (this.phase === 'dead') {
      if (--this.phaseTimer <= 0) this.serve();
      return;
    }

    this.moveMovers();
    // Stuck balls ride the paddle; auto-launch keeps the game moving.
    let anyStuck = false;
    for (const b of this.balls) {
      b.px = b.x;
      b.py = b.y;
      if (!b.stuck) continue;
      anyStuck = true;
      b.x = clamp(this.paddleX + b.stuckDx, BALL_R, FIELD_W - BALL_R);
      b.y = PADDLE_Y - BALL_R - 1;
    }
    if (anyStuck) {
      const serveWait = this.phase === 'serve';
      for (const b of this.balls) {
        if (!b.stuck) continue;
        const held = this.tick - b.stuckAt;
        if ((serveWait && --this.phaseTimer <= 0) || (!serveWait && held >= STICKY_HOLD)) {
          this.launchBall(b);
          this.phase = 'play';
          this.emit({ t: 'launch' });
        }
      }
    }

    this.moveBalls();
    this.moveBolts();
    this.moveCapsules();

    if (this.phase === 'play' && this.balls.length === 0) this.loseLife();
    if (!this.ended && this.phase === 'play' && this.breakableLeft() === 0) this.levelClear();
  }

  private movePaddle(): void {
    this.prevPaddleX = this.paddleX;
    const half = this.paddleW / 2;
    if (this.axis !== 0) this.paddleX += this.axis * KEY_SPEED;
    else if (this.target !== null) {
      const d = this.target - this.paddleX;
      this.paddleX += clamp(d, -POINTER_SPEED, POINTER_SPEED);
    }
    this.paddleX = clamp(this.paddleX, half, FIELD_W - half);
  }

  private moveMovers(): void {
    const rows = new Map<number, Brick[]>();
    for (const b of this.bricks) {
      if (!b.alive || b.kind !== 'M') continue;
      const list = rows.get(b.row) ?? [];
      list.push(b);
      rows.set(b.row, list);
    }
    for (const list of rows.values()) {
      const vx = list[0]!.vx;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const b of list) {
        minX = Math.min(minX, b.x + vx);
        maxX = Math.max(maxX, b.x + b.w + vx);
      }
      const bounce = minX < BRICK_INSET_X || maxX > FIELD_W - BRICK_INSET_X;
      for (const b of list) {
        if (bounce) b.vx = -b.vx;
        else b.x += b.vx;
      }
    }
  }

  private rescaleBalls(): void {
    const sp = this.ballSpeed();
    for (const b of this.balls) {
      if (b.stuck) continue;
      const len = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (len > 0) {
        b.vx = (b.vx / len) * sp;
        b.vy = (b.vy / len) * sp;
      }
    }
  }

  private moveBalls(): void {
    const survivors: Ball[] = [];
    for (const b of this.balls) {
      if (b.stuck) {
        survivors.push(b);
        continue;
      }
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      const steps = Math.max(1, Math.ceil(speed / 3));
      let alive = true;
      for (let s = 0; s < steps && alive && !b.stuck; s++) {
        b.x += b.vx / steps;
        b.y += b.vy / steps;
        alive = this.collide(b);
      }
      if (alive) survivors.push(b);
    }
    this.balls = survivors;
    // Anti-stall: when nothing breakable has been hit for 20 s (e.g. a loop between steel and the
    // walls), every flying ball is turned a few degrees.
    if (++this.idleTicks > 1200) {
      this.idleTicks = 0;
      for (const b of this.balls) {
        if (b.stuck) continue;
        const [c, s] = DIRS[3]!;
        const vx = b.vx * c - b.vy * s;
        const vy = b.vx * s + b.vy * c;
        b.vx = vx;
        b.vy = vy;
      }
    }
  }

  /** Resolve collisions for one sub-step. Returns false when the ball fell out. */
  private collide(b: Ball): boolean {
    // Walls.
    if (b.x < BALL_R) {
      b.x = BALL_R;
      b.vx = Math.abs(b.vx);
      this.emit({ t: 'wall' });
    } else if (b.x > FIELD_W - BALL_R) {
      b.x = FIELD_W - BALL_R;
      b.vx = -Math.abs(b.vx);
      this.emit({ t: 'wall' });
    }
    if (b.y < BALL_R) {
      b.y = BALL_R;
      b.vy = Math.abs(b.vy);
      this.emit({ t: 'wall' });
    }
    if (b.y - BALL_R > FIELD_H) return false;

    // Paddle (only while moving down, from above).
    const half = this.paddleW / 2;
    if (
      b.vy > 0 &&
      b.y + BALL_R >= PADDLE_Y &&
      b.y - BALL_R <= PADDLE_Y + PADDLE_H &&
      b.x >= this.paddleX - half - BALL_R &&
      b.x <= this.paddleX + half + BALL_R &&
      b.y <= PADDLE_Y + PADDLE_H / 2
    ) {
      this.paddleHits++;
      this.chain = 0;
      const t = clamp((b.x - this.paddleX) / half, -1, 1);
      if (this.sticky > 0) {
        b.stuck = true;
        b.stuckDx = b.x - this.paddleX;
        b.stuckAt = this.tick;
        b.y = PADDLE_Y - BALL_R - 1;
        b.vx = 0;
        b.vy = 0;
      } else {
        let idx = UP + Math.round(t * 10);
        // Never perfectly vertical (endless straight up-and-down loops are no fun): lean 1 step.
        if (idx === UP) idx = UP + (t < 0 || (t === 0 && b.vx < 0) ? -1 : 1);
        const [dx, dy] = DIRS[idx]!;
        const sp = this.ballSpeed();
        b.vx = dx * sp;
        b.vy = dy * sp;
        b.y = PADDLE_Y - BALL_R - 0.01;
      }
      this.emit({ t: 'paddle', x: b.x });
      return true;
    }

    // Bricks: the one with the deepest overlap decides the bounce.
    let best: Brick | null = null;
    let bestArea = 0;
    let bestOx = 0;
    let bestOy = 0;
    const consider = (br: Brick) => {
      if (!br.alive) return;
      const ox = Math.min(b.x + BALL_R - br.x, br.x + br.w - (b.x - BALL_R));
      const oy = Math.min(b.y + BALL_R - br.y, br.y + br.h - (b.y - BALL_R));
      if (ox <= 0 || oy <= 0) return;
      const area = ox * oy;
      if (area > bestArea) {
        bestArea = area;
        best = br;
        bestOx = ox;
        bestOy = oy;
      }
    };
    const rowsCount = this.grid.length / COLS;
    const c0 = Math.max(0, Math.floor((b.x - BALL_R) / CELL_W));
    const c1 = Math.min(COLS - 1, Math.floor((b.x + BALL_R) / CELL_W));
    const r0 = Math.max(0, Math.floor((b.y - BALL_R - BRICK_TOP) / CELL_H));
    const r1 = Math.min(rowsCount - 1, Math.floor((b.y + BALL_R - BRICK_TOP) / CELL_H));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const br = this.grid[r * COLS + c];
      if (br) consider(br);
    }
    for (const br of this.bricks) if (br.kind === 'M') consider(br);
    const hit = best as Brick | null;
    if (!hit) return true;
    if (bestOx < bestOy) {
      if (b.x < hit.x + hit.w / 2) {
        b.x -= bestOx;
        b.vx = -Math.abs(b.vx);
      } else {
        b.x += bestOx;
        b.vx = Math.abs(b.vx);
      }
    } else if (b.y < hit.y + hit.h / 2) {
      b.y -= bestOy;
      b.vy = -Math.abs(b.vy);
    } else {
      b.y += bestOy;
      b.vy = Math.abs(b.vy);
    }
    this.damage(hit, true);
    return true;
  }

  private damage(br: Brick, byBall: boolean): void {
    if (!br.alive) return;
    br.hitAt = this.tick;
    const cx = br.x + br.w / 2;
    const cy = br.y + br.h / 2;
    if (br.kind === 'S') {
      this.emit({ t: 'steel', x: cx, y: cy });
      return;
    }
    this.idleTicks = 0;
    br.hp--;
    if (br.hp > 0) {
      this.addScore(20);
      this.emit({ t: 'hit', x: cx, y: cy, kind: br.kind, destroyed: false, points: 20, tone: br.tone });
      return;
    }
    br.alive = false;
    if (br.kind !== 'M') this.grid[br.row * COLS + br.col] = null;
    this.bricksBroken++;
    if (byBall) this.chain++;
    const chainBonus = byBall ? Math.min(100, Math.max(0, this.chain - 1) * 10) : 0;
    const points = BRICK_POINTS[br.kind] + chainBonus;
    this.addScore(points);
    this.emit({ t: 'hit', x: cx, y: cy, kind: br.kind, destroyed: true, points, tone: br.tone });
    // Capsules: power bricks always, others 1 in 9.
    const roll = this.dropRng.int(90);
    if (br.kind === 'P' || roll < 10) this.spawnCapsule(cx, cy);
    if (br.kind === 'X') this.explode(br);
  }

  private explode(center: Brick): void {
    this.emit({ t: 'blast', x: center.x + center.w / 2, y: center.y + center.h / 2 });
    const rowsCount = this.grid.length / COLS;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = center.row + dr;
        const c = center.col + dc;
        if (r < 0 || c < 0 || c >= COLS || r >= rowsCount) continue;
        const br = this.grid[r * COLS + c];
        if (br && br.alive) this.damage(br, false);
      }
    }
  }

  private spawnCapsule(x: number, y: number): void {
    if (this.capsules.length >= 6) return;
    // Weighted: wide 22, multi 20, laser 18, slow 16, sticky 16, life 8 (of 100).
    const r = this.dropRng.int(100);
    const kind: PowerKind = r < 22 ? 'wide' : r < 42 ? 'multi' : r < 60 ? 'laser' : r < 76 ? 'slow' : r < 92 ? 'sticky' : 'life';
    this.capsules.push({ x, y, kind });
    this.emit({ t: 'capsule', kind, x, y });
  }

  private moveCapsules(): void {
    const half = this.paddleW / 2;
    const keep: Capsule[] = [];
    for (const c of this.capsules) {
      c.y += CAPSULE_SPEED;
      const caught =
        c.y + CAPSULE_H / 2 >= PADDLE_Y && c.y - CAPSULE_H / 2 <= PADDLE_Y + PADDLE_H && c.x + CAPSULE_W / 2 >= this.paddleX - half && c.x - CAPSULE_W / 2 <= this.paddleX + half;
      if (caught && this.phase === 'play') {
        this.applyPower(c.kind);
        continue;
      }
      if (c.y - CAPSULE_H / 2 > FIELD_H) continue;
      keep.push(c);
    }
    this.capsules = keep;
  }

  private applyPower(kind: PowerKind): void {
    this.addScore(100);
    this.emit({ t: 'power', kind });
    switch (kind) {
      case 'wide':
        this.wide = EFFECT_TICKS;
        this.paddleW = PADDLE_WIDE;
        break;
      case 'multi': {
        const extra: Ball[] = [];
        for (const b of this.balls) {
          if (this.balls.length + extra.length >= MAX_BALLS) break;
          if (b.stuck) continue;
          for (const turn of [-7, 7]) {
            if (this.balls.length + extra.length >= MAX_BALLS) break;
            const [c, s] = DIRS[(turn + 64) % 64]!;
            extra.push(this.newBall(b.x, b.y, b.vx * c - b.vy * s, b.vx * s + b.vy * c, false));
          }
        }
        for (const e of extra) {
          // Keep every ball heading at least a little vertically.
          if (Math.abs(e.vy) < 1.2) e.vy = e.vy < 0 ? -1.2 : 1.2;
        }
        this.balls.push(...extra);
        break;
      }
      case 'laser':
        this.laser = EFFECT_TICKS;
        break;
      case 'slow':
        this.slow = EFFECT_TICKS;
        this.rescaleBalls();
        break;
      case 'sticky':
        this.sticky = EFFECT_TICKS;
        break;
      case 'life':
        if (this.lives < 9) {
          this.lives++;
          this.emit({ t: 'life', lives: this.lives });
        }
        break;
    }
  }

  private moveBolts(): void {
    const keep: Bolt[] = [];
    for (const bolt of this.bolts) {
      bolt.y -= BOLT_SPEED;
      if (bolt.y < 0) continue;
      let hit: Brick | null = null;
      const c = Math.floor(bolt.x / CELL_W);
      const r = Math.floor((bolt.y - BRICK_TOP) / CELL_H);
      const rowsCount = this.grid.length / COLS;
      if (c >= 0 && c < COLS && r >= 0 && r < rowsCount) {
        const br = this.grid[r * COLS + c];
        if (br && br.alive && bolt.x >= br.x && bolt.x <= br.x + br.w && bolt.y <= br.y + br.h && bolt.y >= br.y - BOLT_SPEED) hit = br;
      }
      if (!hit) {
        for (const br of this.bricks) {
          if (br.kind === 'M' && br.alive && bolt.x >= br.x && bolt.x <= br.x + br.w && bolt.y <= br.y + br.h && bolt.y >= br.y) {
            hit = br;
            break;
          }
        }
      }
      if (hit) {
        this.damage(hit, false);
        continue;
      }
      keep.push(bolt);
    }
    this.bolts = keep;
  }

  private addScore(points: number): void {
    this.score += points;
    while (this.score >= this.nextLifeAt) {
      this.nextLifeAt += EXTRA_LIFE_EVERY;
      if (this.lives < 9) {
        this.lives++;
        this.emit({ t: 'life', lives: this.lives });
      }
    }
  }

  private loseLife(): void {
    this.lives--;
    this.lostLifeThisLevel = true;
    this.capsules = [];
    this.bolts = [];
    this.wide = this.laser = this.slow = this.sticky = 0;
    this.paddleW = PADDLE_W;
    this.emit({ t: 'miss' });
    if (this.lives <= 0) {
      this.lives = 0;
      this.phase = 'over';
      this.ended = true;
      this.endSettled = this.stepping;
      this.emit({ t: 'over' });
      return;
    }
    this.phase = 'dead';
    this.phaseTimer = RESPAWN_TICKS;
  }

  private levelClear(): void {
    const bonus = 1000 * this.level;
    const flawless = !this.lostLifeThisLevel;
    this.addScore(bonus + (flawless ? 2000 * this.level : 0));
    this.emit({ t: 'clear', level: this.level, bonus: bonus + (flawless ? 2000 * this.level : 0), flawless });
    this.phase = 'clear';
    this.phaseTimer = LEVEL_CLEAR_TICKS;
    this.balls = [];
    this.capsules = [];
    this.bolts = [];
  }
}

export function createBricksSim(seed: string, options: Record<string, number | string | boolean> = {}, recordEvents = true): BricksSim {
  const startLevel = typeof options.startLevel === 'number' ? options.startLevel : 1;
  return new BricksSim(seed, { startLevel }, recordEvents);
}
