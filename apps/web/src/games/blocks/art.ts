/**
 * Block Drop art: an original neon palette (deliberately not the colour scheme of any
 * commercial falling-block game) and the canvas renderer for the well, pieces and effects.
 */
import { CLEAR_DELAY, COLS, HIDDEN, LOCK_DELAY, ROWS, SHAPES, VISIBLE_ROWS, type BlocksEvent, type BlocksSim, type PieceId } from '@dascade/game-core/blocks';
import { Particles, Popups, Shake, alpha, beginFrame, blockSprite, canvasFonts, drawBlock, fxSettings, type Surface } from '../_classics/index.ts';
import type { Materials } from '../_classics/palette.ts';
import { WELL_ART, wellArt, type WellArt } from './palette.ts';

/** Cell value (1–7) → colour. Index 0 unused. */
export const BLOCK_COLORS = ['#000000', '#ff4fd8', '#2dd4bf', '#ffb020', '#a78bfa', '#a3e635', '#ff6b6b', '#60a5fa'] as const;
export const PIECE_COLOR: Record<PieceId, string> = {
  I: BLOCK_COLORS[1],
  O: BLOCK_COLORS[2],
  T: BLOCK_COLORS[3],
  S: BLOCK_COLORS[4],
  Z: BLOCK_COLORS[5],
  J: BLOCK_COLORS[6],
  L: BLOCK_COLORS[7],
};

export const CELL = 32;
export const WELL_W = COLS * CELL;
export const WELL_H = VISIBLE_ROWS * CELL;


interface Flash {
  cells: Array<[number, number]>;
  t: number;
}
interface Trail {
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
  color: string;
  t: number;
}

const CLEAR_TITLES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];

export class BlocksRenderer {
  readonly particles = new Particles(500);
  readonly popups = new Popups();
  readonly shake = new Shake();
  private flashes: Flash[] = [];
  private trails: Trail[] = [];
  private overAt: number | null = null;
  private levelFlash = 0;
  private fonts = canvasFonts();
  private well: WellArt = WELL_ART;

  /** Theme materials changed: the well re-colours on the next frame (render-only). */
  setMaterials(m: Materials): void {
    this.well = wellArt(m);
  }

  reset(): void {
    this.particles.clear();
    this.popups.clear();
    this.flashes = [];
    this.trails = [];
    this.overAt = null;
    this.levelFlash = 0;
  }

  /** Turn engine events into effects (call after every step with sim.drainEvents()). */
  onEvents(events: BlocksEvent[], sim: BlocksSim, sound: (name: string, opts?: { pitch?: number; index?: number }) => void): void {
    for (const e of events) {
      switch (e.t) {
        case 'move':
          sound('move');
          break;
        case 'rotate':
          sound('rotate');
          break;
        case 'hold':
          sound('hold');
          break;
        case 'harddrop': {
          if (e.rows > 0) {
            const xs = e.cells.map(([x]) => x);
            const ys = e.cells.map(([, y]) => y);
            const bottom = Math.max(...ys) + 1;
            const color = PIECE_COLOR[e.piece];
            this.trails.push({
              x0: Math.min(...xs) * CELL,
              x1: (Math.max(...xs) + 1) * CELL,
              yTop: (Math.min(...ys) - e.rows - HIDDEN) * CELL,
              yBottom: (bottom - HIDDEN) * CELL,
              color,
              t: 0,
            });
            this.shake.kick(Math.min(4, 1 + e.rows / 6));
          }
          sound('harddrop');
          break;
        }
        case 'lock': {
          this.flashes.push({ cells: e.cells, t: 0 });
          const color = PIECE_COLOR[e.piece];
          for (const [x, y] of e.cells) {
            if (y < HIDDEN) continue;
            this.particles.burst((x + 0.5) * CELL, (y - HIDDEN + 1) * CELL, color, 2, { speed: 60, life: 0.35, size: 2.5, gravity: 120 });
          }
          sound('lock');
          break;
        }
        case 'clear': {
          for (const row of e.rows) {
            for (let x = 0; x < COLS; x++) {
              const v = sim.board[row * COLS + x] ?? 0;
              this.particles.burst((x + 0.5) * CELL, (row - HIDDEN + 0.5) * CELL, BLOCK_COLORS[v] ?? '#ffffff', e.lines >= 4 ? 5 : 3, {
                speed: 180,
                life: 0.8,
                size: 3,
                gravity: 320,
              });
            }
          }
          const midRow = e.rows.reduce((a, b) => a + b, 0) / e.rows.length - HIDDEN;
          const y = Math.max(40, midRow * CELL);
          const title = e.allClear ? 'ALL CLEAR' : e.tspin ? `T-SPIN ${CLEAR_TITLES[e.lines]}` : CLEAR_TITLES[e.lines] ?? '';
          this.popups.add(WELL_W / 2, y - 18, title, e.lines >= 4 || e.tspin || e.allClear ? '#ffd23f' : '#f8f6ff', e.lines >= 4 || e.allClear ? 26 : 20, 1.2);
          this.popups.add(WELL_W / 2, y + 10, `+${e.points.toLocaleString('en-US')}`, '#7cf5ff', 16, 1.1);
          if (e.b2b) this.popups.add(WELL_W / 2, y + 34, 'BACK-TO-BACK', '#ff4fd8', 13, 1.1);
          if (e.combo > 0) this.popups.add(WELL_W / 2, y + (e.b2b ? 54 : 34), `COMBO ×${e.combo}`, '#a3e635', 13, 1.1);
          if (e.lines >= 4 || e.allClear) {
            this.shake.kick(5);
            sound('quad', { pitch: e.combo });
          } else sound('line', { index: e.lines, pitch: e.combo });
          break;
        }
        case 'tspin':
          this.popups.add(WELL_W / 2, WELL_H / 2, 'T-SPIN', '#ffd23f', 18, 1);
          sound('line', { index: 1 });
          break;
        case 'level':
          this.levelFlash = 1;
          this.popups.add(WELL_W / 2, WELL_H * 0.32, `LEVEL ${e.level}`, '#ffd23f', 24, 1.4);
          sound('levelup');
          break;
        case 'over':
          this.overAt = performance.now();
          sound('gameover');
          break;
        default:
          break;
      }
    }
  }

  draw(s: Surface, sim: BlocksSim | null, dtMs: number, opts: { paused: boolean; danger?: boolean }): void {
    const ctx = beginFrame(s);
    const fx = fxSettings();
    const dt = dtMs / 1000;
    this.particles.update(dt);
    this.popups.update(dt);
    const off = this.shake.offset(dtMs);
    ctx.save();
    ctx.translate(off.x, off.y);

    // Well backdrop + grid.
    const bg = ctx.createLinearGradient(0, 0, 0, WELL_H);
    bg.addColorStop(0, this.well.top);
    bg.addColorStop(1, this.well.bottom);
    ctx.fillStyle = bg;
    ctx.fillRect(-12, -12, WELL_W + 24, WELL_H + 24);
    ctx.strokeStyle = this.well.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, WELL_H);
    }
    for (let y = 1; y < VISIBLE_ROWS; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(WELL_W, y * CELL + 0.5);
    }
    ctx.stroke();

    if (opts.paused) {
      this.drawPaused(ctx);
      ctx.restore();
      return;
    }
    if (!sim) {
      ctx.restore();
      return;
    }

    // Danger glow when the stack reaches the top rows.
    let high = VISIBLE_ROWS;
    for (let y = HIDDEN; y < ROWS; y++) {
      let any = false;
      for (let x = 0; x < COLS; x++) if (sim.board[y * COLS + x]) any = true;
      if (any) {
        high = y - HIDDEN;
        break;
      }
    }
    if (high < 5 && !sim.over) {
      const pulse = fx.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(performance.now() / 180);
      const g = ctx.createLinearGradient(0, 0, 0, CELL * 4);
      g.addColorStop(0, `rgba(255, 70, 90, ${0.22 + 0.16 * pulse})`);
      g.addColorStop(1, 'rgba(255, 70, 90, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WELL_W, CELL * 4);
    }

    const p = sim.piece;
    // Drop guide beam under the active piece.
    if (p && !sim.over) {
      const cells = sim.cellsOf(p.id, p.rot, p.x, p.y);
      const minX = Math.min(...cells.map(([x]) => x));
      const maxX = Math.max(...cells.map(([x]) => x));
      const beam = ctx.createLinearGradient(0, 0, 0, WELL_H);
      beam.addColorStop(0, alpha(PIECE_COLOR[p.id], 0));
      beam.addColorStop(1, alpha(PIECE_COLOR[p.id], 0.08));
      ctx.fillStyle = beam;
      ctx.fillRect(minX * CELL, 0, (maxX - minX + 1) * CELL, WELL_H);
    }

    // Locked stack (rows being cleared animate out).
    const clearing = new Set(sim.clearing);
    const clearT = sim.clearTimer > 0 ? 1 - sim.clearTimer / CLEAR_DELAY : 0;
    const grey = this.overAt !== null ? Math.min(1, (performance.now() - this.overAt) / 900) : 0;
    for (let y = HIDDEN; y < ROWS; y++) {
      const vy = (y - HIDDEN) * CELL;
      const greyRow = grey > 0 && (ROWS - 1 - y) / VISIBLE_ROWS < grey;
      for (let x = 0; x < COLS; x++) {
        const v = sim.board[y * COLS + x]!;
        if (!v) continue;
        if (clearing.has(y)) {
          const shrink = fx.reducedMotion ? 0 : clearT;
          const size = CELL * (1 - shrink * 0.9);
          const cx = x * CELL + CELL / 2;
          ctx.globalAlpha = 1 - clearT * 0.6;
          drawBlock(ctx, s, BLOCK_COLORS[v]!, cx - size / 2, vy + (CELL - size) / 2, size, size);
          ctx.globalAlpha = 1;
          continue;
        }
        drawBlock(ctx, s, greyRow ? '#4a4763' : BLOCK_COLORS[v]!, x * CELL, vy, CELL, CELL, greyRow ? 'flat' : 'gem');
      }
      if (clearing.has(y)) {
        ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - clearT)})`;
        ctx.fillRect(0, vy, WELL_W, CELL);
      }
    }

    // Ghost + active piece.
    if (p && !sim.over) {
      const gy = sim.ghostY();
      const color = PIECE_COLOR[p.id];
      if (gy !== p.y) {
        for (const [x, y] of sim.cellsOf(p.id, p.rot, p.x, gy)) {
          if (y < HIDDEN) continue;
          ctx.drawImage(blockSprite(color, CELL, CELL, s.scale, 'ghost'), x * CELL, (y - HIDDEN) * CELL, CELL, CELL);
        }
      }
      const lockFade = sim.lockTimer > 0 ? sim.lockTimer / LOCK_DELAY : 0;
      if (fx.glow > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14 * fx.glow;
      }
      for (const [x, y] of sim.cellsOf(p.id, p.rot, p.x, p.y)) {
        if (y < HIDDEN) continue;
        drawBlock(ctx, s, color, x * CELL, (y - HIDDEN) * CELL, CELL, CELL);
      }
      ctx.shadowBlur = 0;
      if (lockFade > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.28 * lockFade})`;
        for (const [x, y] of sim.cellsOf(p.id, p.rot, p.x, p.y)) if (y >= HIDDEN) ctx.fillRect(x * CELL, (y - HIDDEN) * CELL, CELL, CELL);
      }
    }

    // Hard-drop trails and lock flashes.
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i]!;
      tr.t += dt;
      const a = 1 - tr.t / 0.22;
      if (a <= 0) {
        this.trails.splice(i, 1);
        continue;
      }
      const g = ctx.createLinearGradient(0, tr.yTop, 0, tr.yBottom);
      g.addColorStop(0, alpha(tr.color, 0));
      g.addColorStop(1, alpha(tr.color, 0.45 * a));
      ctx.fillStyle = g;
      ctx.fillRect(tr.x0 + 3, Math.max(0, tr.yTop), tr.x1 - tr.x0 - 6, tr.yBottom - Math.max(0, tr.yTop));
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.t += dt;
      const a = 1 - f.t / 0.16;
      if (a <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`;
      for (const [x, y] of f.cells) if (y >= HIDDEN) ctx.fillRect(x * CELL, (y - HIDDEN) * CELL, CELL, CELL);
    }

    if (this.levelFlash > 0) {
      ctx.fillStyle = `rgba(255, 210, 63, ${0.18 * this.levelFlash})`;
      ctx.fillRect(0, 0, WELL_W, WELL_H);
      this.levelFlash = Math.max(0, this.levelFlash - dt * 1.6);
    }

    this.particles.draw(ctx);
    this.popups.draw(ctx, this.fonts.display);
    ctx.restore();
  }

  private drawPaused(ctx: CanvasRenderingContext2D): void {
    // The well is hidden while paused (no pause-to-think).
    ctx.fillStyle = this.well.pausedInk;
    for (let y = 0; y < VISIBLE_ROWS; y++) for (let x = (y % 2) * 1; x < COLS; x += 2) ctx.fillRect(x * CELL + 6, y * CELL + 6, CELL - 12, CELL - 12);
  }
}

/** Draw a piece centred in a small preview canvas (Hold / Next). */
export function drawPiecePreview(ctx: CanvasRenderingContext2D, id: PieceId | null, w: number, h: number, scale: number, dim = false): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!id) return;
  const cells = SHAPES[id][0];
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const cw = Math.max(...xs) - Math.min(...xs) + 1;
  const ch = Math.max(...ys) - Math.min(...ys) + 1;
  const size = Math.min((w - 8) / 4, (h - 8) / 2.2);
  const ox = (w - cw * size) / 2 - Math.min(...xs) * size;
  const oy = (h - ch * size) / 2 - Math.min(...ys) * size;
  ctx.globalAlpha = dim ? 0.35 : 1;
  for (const [x, y] of cells) ctx.drawImage(blockSprite(PIECE_COLOR[id], size, size, scale, 'gem'), ox + x * size, oy + y * size, size, size);
  ctx.globalAlpha = 1;
}

/** Tiny stack preview (opponents / spectators) from a 200-char board string. */
export function drawMiniBoard(ctx: CanvasRenderingContext2D, board: string, w: number, h: number, scale: number, art: WellArt = WELL_ART): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = art.bottom;
  ctx.fillRect(0, 0, w, h);
  const c = Math.min(w / COLS, h / VISIBLE_ROWS);
  const ox = (w - c * COLS) / 2;
  const oy = (h - c * VISIBLE_ROWS) / 2;
  for (let i = 0; i < Math.min(board.length, COLS * VISIBLE_ROWS); i++) {
    const v = board.charCodeAt(i) - 48;
    if (v <= 0 || v > 7) continue;
    const x = i % COLS;
    const y = Math.floor(i / COLS);
    if (c >= 12) ctx.drawImage(blockSprite(BLOCK_COLORS[v]!, c, c, scale, 'gem'), ox + x * c, oy + y * c, c, c);
    else {
      ctx.fillStyle = BLOCK_COLORS[v]!;
      ctx.fillRect(ox + x * c + 0.5, oy + y * c + 0.5, c - 1, c - 1);
    }
  }
}
