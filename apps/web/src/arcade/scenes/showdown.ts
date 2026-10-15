/**
 * DAS Survey Showdown attract scene: a game-show board under chasing marquee bulbs — tiles flip to
 * their answers one by one, a strike X slams in, and the board clears to a sparkle.
 */
import { blinkOn, clamp, cyc, drawText, drawTextC, easeOut, rect, sparkle, textWidth, type AttractFrame, type Scene } from '../attractKit.ts';

const SHOW_C = 8.4;
const ANSWERS = [
  { word: 'COFFEE', pts: 40 },
  { word: 'PAPERS', pts: 26 },
  { word: 'PENS', pts: 14 },
  { word: 'MUGS', pts: 9 },
  { word: 'PLANT', pts: 6 },
  { word: 'CABLES', pts: 5 },
];
/** When each tile flips (the X lands at 4.5 s, between flips). */
const FLIP_AT = [1.0, 1.8, 2.7, 3.5, 5.5, 6.2];
const STRIKE_AT = 4.5;

export const showdown: Scene = {
  label: 'SHOWDOWN',
  length: SHOW_C,
  still: 3.9,
  draw(f: AttractFrame) {
    const { ctx, W, H } = f;
    const tt = cyc(f.t, SHOW_C);
    rect(ctx, 0, 0, W, H, '#0b0620');
    // stage glow
    for (let y = 0; y < H; y += 2) {
      const a = 0.12 * (y / H);
      rect(ctx, 0, y, W, 2, `rgba(255,79,216,${a.toFixed(3)})`);
    }
    // marquee bulbs around the edge
    const phase = f.still ? 0 : Math.floor(tt * 8);
    let n = 0;
    const bulb = (x: number, y: number) => {
      rect(ctx, x, y, 1, 1, (n + phase) % 2 === 0 ? '#ffe7a1' : '#5b3c0d');
      n++;
    };
    for (let x = 1; x < W - 1; x += 3) bulb(x, 0);
    for (let y = 2; y < H - 1; y += 3) bulb(W - 1, y);
    for (let x = W - 2; x > 0; x -= 3) bulb(x, H - 1);
    for (let y = H - 3; y > 1; y -= 3) bulb(0, y);

    const o = f.top;
    const title = textWidth('SURVEY SAYS!') <= W - 8 ? 'SURVEY SAYS!' : 'SURVEY!';
    drawTextC(ctx, title, W / 2, 3 + o, blinkOn(f, tt, 2) ? '#ffd36b' : '#fff8ec', 1, '#3a1d00');

    // the board
    const bx = 4;
    const by = 12 + o;
    const bw = W - 8;
    const bh = H - by - 5;
    rect(ctx, bx - 1, by - 1, bw + 2, bh + 2, '#b07a1a');
    rect(ctx, bx, by, bw, bh, '#07041a');
    const cols = 2;
    const rows = 3;
    const gap = 2;
    const tw = Math.floor((bw - gap * (cols + 1)) / cols);
    const th = Math.max(5, Math.floor((bh - gap * (rows + 1)) / rows));
    const allDone = tt > FLIP_AT[FLIP_AT.length - 1]! + 0.5;
    ANSWERS.forEach((a, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const x = bx + gap + col * (tw + gap);
      const y = by + gap + row * (th + gap);
      const k = clamp((tt - FLIP_AT[i]!) / 0.36, 0, 1);
      // A flip: the tile squashes to a line and opens on the other face.
      const squash = k < 0.5 ? 1 - k * 2 : (k - 0.5) * 2;
      const revealed = k >= 0.5;
      const h = Math.max(1, Math.round(th * (k > 0 && k < 1 ? easeOut(squash) : 1)));
      const yy = y + Math.round((th - h) / 2);
      if (!revealed) {
        rect(ctx, x, yy, tw, h, '#1d3fc4');
        rect(ctx, x, yy, tw, 1, '#6f8cff');
        if (h >= 5) drawTextC(ctx, String(i + 1), x + tw / 2, yy + Math.round((h - 5) / 2), '#fff6d0');
      } else {
        rect(ctx, x, yy, tw, h, allDone && blinkOn(f, tt + i * 0.1, 4) ? '#6aa8ff' : '#3d8bff');
        rect(ctx, x, yy, tw, 1, '#ffe9a3');
        if (h >= 5) {
          const pts = String(a.pts);
          const pw = textWidth(pts) + 2;
          const fits = textWidth(a.word) + pw + 3 <= tw;
          if (fits) {
            rect(ctx, x + tw - pw, yy, pw, h, '#f2a516');
            drawText(ctx, pts, x + tw - pw + 1, yy + Math.round((h - 5) / 2), '#1b0f33');
          }
          drawText(ctx, fits ? a.word : a.word.slice(0, Math.max(1, Math.floor((tw - 2) / 4))), x + 2, yy + Math.round((h - 5) / 2), '#ffffff');
        }
      }
      if (k > 0 && k < 1) sparkle(ctx, x + tw - 2, y + 1, tt * 6, '#ffffff');
    });

    // the strike
    const sk = tt - STRIKE_AT;
    if (sk > 0 && sk < 0.8) {
      const s = Math.max(2, Math.round(Math.min(W, H) * 0.32 * (sk < 0.12 ? 1.6 - sk * 5 : 1)));
      const cx = W / 2;
      const cy = by + bh / 2;
      for (let d = -s; d <= s; d++) {
        rect(ctx, cx + d - 1, cy + d - 1, 3, 3, '#ff2d55');
        rect(ctx, cx + d - 1, cy - d - 1, 3, 3, '#ff2d55');
      }
    }
    if (allDone && !f.still) {
      for (let i = 0; i < 8; i++) sparkle(ctx, (i * 37 + tt * 23) % W, by + ((i * 53) % Math.max(1, bh)), tt * 5 + i, i % 2 ? '#ffd36b' : '#ff4fd8');
    }
  },
};
