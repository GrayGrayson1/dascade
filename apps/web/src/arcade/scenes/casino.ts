/**
 * DASino floor-table scenes: European roulette and High/Low dice.
 * (Slots, Hold'em and Blackjack live with the original programs in attract.ts.)
 */
import {
  CHIP_COLORS,
  banner,
  blinkOn,
  clamp,
  disc,
  drawChip,
  drawTextC,
  easeOut,
  frame,
  hash,
  rect,
  scratchImage,
  smooth,
  sparkle,
  type AttractFrame,
  type Scene,
} from '../attractKit.ts';

// ---------------------------------------------------------------------------
// Roulette — the wheel turns, the ball rides the track, drops into a pocket.
// ---------------------------------------------------------------------------
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const TAU = Math.PI * 2;
const POCKET = TAU / WHEEL_ORDER.length;

function pocketRgb(n: number): [number, number, number] {
  if (n === 0) return [22, 160, 92];
  return REDS.has(n) ? [206, 36, 58] : [24, 18, 30];
}

const ROULETTE_C = 7.2;
const LAND = 4.3;

function rouletteCycle(t: number): { cycle: number; tt: number; slot: number } {
  const cycle = Math.floor(t / ROULETTE_C);
  const tt = t - cycle * ROULETTE_C;
  const slot = Math.floor(hash(cycle * 2.71 + 5) * WHEEL_ORDER.length);
  return { cycle, tt, slot };
}

export const roulette: Scene = {
  label: 'ROULETTE',
  length: ROULETTE_C,
  still: 5.2,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const { tt, slot } = rouletteCycle(f.t);
    const number = WHEEL_ORDER[slot]!;
    const wide = W >= H * 1.2;
    const R = Math.floor(Math.min(wide ? W * 0.3 : W * 0.42, H * 0.44));
    const cx = wide ? Math.round(W * 0.34) : Math.round(W / 2);
    const cy = Math.round(H * 0.52);
    const wheelRot = f.t * 0.7;
    const { img } = scratchImage(ctx, W, H, 'roulette');
    const d = img.data;
    const landed = tt >= LAND;
    const flash = landed && blinkOn(f, tt, 6, 0.5);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx + 0.5;
        const dy = y - cy + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let r: number;
        let g: number;
        let b: number;
        if (dist > R + 1) {
          // felt with a soft vignette
          const v = clamp(1 - dist / (Math.max(W, H) * 0.9), 0, 1);
          const weave = (x + y) % 4 === 0 ? 6 : 0;
          r = 8 + v * 10 + weave * 0.3;
          g = 60 + v * 46 + weave;
          b = 38 + v * 22 + weave * 0.5;
        } else if (dist > R - 2) {
          r = 122;
          g = 74;
          b = 22; // wooden rim
          if (dist > R) {
            r = 70;
            g = 40;
            b = 12;
          }
        } else if (dist > R * 0.66) {
          const a = Math.atan2(dy, dx) - wheelRot;
          const k = (((a / POCKET) % WHEEL_ORDER.length) + WHEEL_ORDER.length) % WHEEL_ORDER.length;
          const idx = Math.floor(k);
          const edge = (k - idx) * POCKET * dist;
          const n = WHEEL_ORDER[idx]!;
          [r, g, b] = pocketRgb(n);
          if (flash && idx === slot) {
            r = 255;
            g = 226;
            b = 120;
          } else if (edge < 0.8) {
            r = 201;
            g = 162;
            b = 47; // gold frets
          }
          if (dist < R * 0.7) {
            r *= 0.7;
            g *= 0.7;
            b *= 0.7;
          }
        } else if (dist > R * 0.3) {
          // cone: warm wood with turret spokes
          const a = Math.atan2(dy, dx) - wheelRot;
          const spoke = Math.abs(((((a / (TAU / 4)) % 1) + 1) % 1) - 0.5) < 0.05;
          const shade = 0.55 + 0.45 * (dist / (R * 0.66));
          r = (spoke ? 230 : 120) * shade;
          g = (spoke ? 190 : 70) * shade;
          b = (spoke ? 90 : 26) * shade;
        } else {
          r = 214;
          g = 170;
          b = 66;
          if (dist < R * 0.12) {
            r = 255;
            g = 238;
            b = 170;
          }
        }
        const i = (y * W + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // ball
    const pocketAngle = (slot + 0.5) * POCKET;
    const landAngle = LAND * 0.7 + pocketAngle;
    const p = clamp((tt - 0.4) / (LAND - 0.4), 0, 1);
    let ballA: number;
    let ballR: number;
    if (tt < LAND) {
      ballA = landAngle - 5 * TAU * (1 - easeOut(p));
      const drop = smooth(0.72, 1, p);
      ballR = R * (0.9 - drop * 0.12) + (p > 0.8 && p < 1 ? Math.abs(Math.sin(p * 60)) * (1 - p) * 8 : 0);
    } else {
      ballA = wheelRot + pocketAngle;
      ballR = R * 0.78;
    }
    const bx = cx + Math.cos(ballA) * ballR;
    const by = cy + Math.sin(ballA) * ballR;
    disc(ctx, bx + 0.5, by + 1, 1.5, 'rgba(0,0,0,0.5)');
    disc(ctx, bx, by, 1.5, '#f8f6ff');
    rect(ctx, bx - 1, by - 1, 1, 1, '#ffffff');

    // betting board (wide layouts): three columns of numbers with chips
    if (wide) {
      const bx0 = Math.round(cx + R + 5);
      const bw = W - bx0 - 3;
      const cols = 3;
      const cw = Math.max(3, Math.floor(bw / cols));
      const rows = Math.max(4, Math.min(12, Math.floor((H - 10) / Math.max(4, cw * 0.8))));
      const ch = Math.max(3, Math.floor((H - 8) / rows));
      const by0 = Math.round((H - ch * rows) / 2) + 1;
      rect(ctx, bx0 - 1, by0 - 1, cw * cols + 2, ch * rows + 2, '#e8e0c8');
      for (let rr = 0; rr < rows; rr++)
        for (let c = 0; c < cols; c++) {
          const n = rr * 3 + c + 1;
          const [pr, pg, pb] = pocketRgb(n);
          const win = landed && n === number && flash;
          rect(ctx, bx0 + c * cw, by0 + rr * ch, cw - 1, ch - 1, win ? '#ffe27a' : `rgb(${pr},${pg},${pb})`);
        }
      // chips placed during the betting window
      const bets = [4, 11, 19, 26];
      bets.forEach((cell, i) => {
        const at = 0.2 + i * 0.35;
        if (tt < at) return;
        const rr = Math.floor(cell / 3) % rows;
        const c = cell % 3;
        const k = easeOut((tt - at) / 0.3);
        const tx = bx0 + c * cw + cw / 2 - 2.5;
        const ty = by0 + rr * ch + ch / 2 - 1.5;
        drawChip(ctx, tx, ty - (1 - k) * 10, CHIP_COLORS[i % CHIP_COLORS.length]!);
      });
      if (landed) {
        const rr = Math.floor((number - 1) / 3);
        if (number > 0 && rr < rows) {
          const c = (number - 1) % 3;
          frame(ctx, bx0 + c * cw - 1, by0 + rr * ch - 1, cw + 1, ch + 1, '#ffffff');
        }
      }
    }

    // result
    if (landed && tt < ROULETTE_C - 0.3) {
      const colour = number === 0 ? 'GREEN' : REDS.has(number) ? 'RED' : 'BLACK';
      const label = `${number} ${colour}`;
      const ty = Math.round(cy - 4);
      if (f.hud) {
        const w = label.length * 4 + 5;
        const lx = Math.round(cx - w / 2);
        rect(ctx, lx, ty - 1, w, 8, 'rgba(6,4,14,0.82)');
        frame(ctx, lx, ty - 1, w, 8, number === 0 ? '#2de38f' : REDS.has(number) ? '#ff5a5f' : '#c9c3e6');
        drawTextC(ctx, label, cx + 0.5, ty + 1, flash ? '#ffd23f' : '#ffffff');
      }
      for (let i = 0; i < 5; i++)
        sparkle(ctx, cx + Math.cos(i * 1.3 + f.t) * (R + 3), cy + Math.sin(i * 1.3 + f.t) * (R + 3), tt * 3 + i * 0.3, '#fff3b0');
    } else if (f.hud && tt < 1.6 && !f.still) {
      if (blinkOn(f, tt, 3, 0.6)) drawTextC(ctx, 'PLACE BETS', cx + 0.5, Math.max(f.top + 2, cy - R - 7), '#ffd23f', 1, '#021a10');
    }
  },
};

// ---------------------------------------------------------------------------
// High/Low — call it, roll it: HIGHER!
// ---------------------------------------------------------------------------
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

function drawDie(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, face: number, glow: boolean): void {
  const x = Math.round(cx - s / 2);
  const y = Math.round(cy - s / 2);
  rect(ctx, x + 1, y + 2, s, s, 'rgba(0,0,0,0.5)');
  if (glow) rect(ctx, x - 1, y - 1, s + 2, s + 2, '#ffd23f');
  rect(ctx, x + 1, y, s - 2, s, '#fbf8ff');
  rect(ctx, x, y + 1, s, s - 2, '#fbf8ff');
  rect(ctx, x + 1, y + s - 2, s - 2, 1, '#cfc6e8');
  const step = Math.max(2, Math.floor((s - 3) / 3));
  const pip = s >= 11 ? 2 : 1;
  const mid = Math.floor(s / 2);
  for (const [px, py] of PIPS[face] ?? [])
    rect(ctx, x + mid + px * step - (pip >> 1), y + mid + py * step - (pip >> 1), pip, pip, face === 1 ? '#e8364f' : '#1c0b2e');
}

const HL_C = 6.4;

export const highlow: Scene = {
  label: 'HIGH/LOW',
  length: HL_C,
  still: 3.6,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const cycle = Math.floor(f.t / HL_C);
    const tt = f.t - cycle * HL_C;
    // felt table with a neon rail oval
    rect(ctx, 0, 0, W, H, '#150a26');
    for (let y = 0; y < H; y += 2) rect(ctx, 0, y, W, 1, y % 4 ? '#180c2c' : '#130824');
    const cx = Math.round(W / 2);
    const cy = Math.round(H * 0.54);
    const rx = W * 0.47;
    const ry = H * 0.4;
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      rect(ctx, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 1, 1, i % 2 ? '#7c3fbf' : '#c084fc');
    }
    const prev = 3 + Math.floor(hash(cycle * 1.9) * 4); // last roll total = prev * 2 (6‥12)
    const total = Math.min(9, prev + 3);
    const big = W >= 110 ? 2 : 1;
    // LAST roll plate (left)
    const plateW = 5 * 4 * big + 4;
    const plateH = 5 * big + 12;
    const px = Math.round(cx - rx * 0.62 - plateW / 2);
    const py = Math.round(cy - plateH / 2);
    rect(ctx, px + 1, py + 1, plateW, plateH, 'rgba(0,0,0,0.5)');
    rect(ctx, px, py, plateW, plateH, '#0a0614');
    frame(ctx, px, py, plateW, plateH, '#6d3fa0');
    drawTextC(ctx, 'LAST', px + plateW / 2 + 0.5, py + 2, '#a78bfa');
    drawTextC(ctx, String(total), px + plateW / 2 + 0.5, py + 9, '#ffd23f', big);
    // HI / LO call buttons (right)
    const bw = plateW;
    const bh = Math.max(9, 5 * big + 5);
    const bx = Math.round(cx + rx * 0.62 - bw / 2);
    const picked = tt > 0.7;
    const upOn = picked && blinkOn(f, tt, 4, 0.6);
    const calls: Array<{ y: number; label: string; up: boolean; on: boolean }> = [
      { y: cy - bh - 1, label: 'HI', up: true, on: upOn },
      { y: cy + 1, label: 'LO', up: false, on: false },
    ];
    for (const c of calls) {
      const y = Math.round(c.y);
      rect(ctx, bx + 1, y + 1, bw, bh, 'rgba(0,0,0,0.5)');
      rect(ctx, bx, y, bw, bh, c.on ? '#2de38f' : '#0a0614');
      frame(ctx, bx, y, bw, bh, c.up ? '#2de38f' : '#ff5a5f');
      const ax = bx + 4;
      const ay = y + Math.round(bh / 2);
      for (let i = 0; i < 3; i++)
        rect(ctx, ax + 1 - i, c.up ? ay - 1 + i : ay + 1 - i, i * 2 + 1, 1, c.on ? '#05301b' : c.up ? '#2de38f' : '#ff5a5f');
      drawTextC(ctx, c.label, bx + bw / 2 + 3, y + Math.round((bh - 5) / 2), c.on ? '#05301b' : '#ffffff');
    }
    // the dice tumble in from the top and land in the middle
    const s = W >= 110 ? 13 : 9;
    const rollAt = 1.3;
    const land = 2.5;
    const faces = [Math.min(6, 3 + Math.floor(hash(cycle * 3.3) * 3)), Math.min(6, 4 + Math.floor(hash(cycle * 5.1) * 3))];
    const won = tt > land + 0.15 && tt < HL_C - 0.4;
    faces.forEach((face, i) => {
      if (tt < rollAt + i * 0.1) return;
      const k = clamp((tt - rollAt - i * 0.1) / (land - rollAt), 0, 1);
      const e = easeOut(k);
      const tx = cx + (i ? s * 0.62 : -s * 0.62);
      const x = tx + (1 - e) * (i ? W * 0.3 : -W * 0.3);
      const hop = k < 1 ? Math.abs(Math.sin(k * 10)) * (1 - k) * H * 0.3 : 0;
      const shown = k < 1 ? 1 + Math.floor(hash(Math.floor(tt * 16) + i * 7) * 5.99) : face;
      drawDie(ctx, x, cy - hop, s, shown, won && blinkOn(f, tt));
    });
    if (won) {
      const sum = faces[0]! + faces[1]!;
      if (f.hud)
        banner(
          ctx,
          sum > total ? `${sum} HIGHER!` : `${sum} PUSH`,
          W,
          Math.round(cy + s / 2 + 6),
          blinkOn(f, tt) ? '#ffd23f' : '#ffffff',
          '#150a26',
          1,
        );
      const since = tt - land - 0.15;
      for (let i = 0; i < 8; i++) {
        const k = clamp(since / 0.7 - i * 0.07, 0, 1);
        if (k <= 0 || k >= 1) continue;
        drawChip(
          ctx,
          px + plateW / 2 + (cx - px - plateW / 2) * k - 2,
          py - 4 - Math.sin(k * Math.PI) * H * 0.25,
          CHIP_COLORS[i % CHIP_COLORS.length]!,
        );
      }
    } else if (f.hud && tt > 0.7 && tt < rollAt + 0.4) {
      drawTextC(ctx, 'HIGHER?', cx + 0.5, cy - 2, '#2de38f', 1, '#05301b');
    }
  },
};
