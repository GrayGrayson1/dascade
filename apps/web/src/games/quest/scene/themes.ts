/**
 * Environment painters — one per QUEST_THEMES entry. Each paints the far, mid and
 * floor layers (with parallax) plus ambient particles and lights. Focal props are
 * painted on top by props.ts.
 */
import type { QuestThemeId } from '@dascade/shared/games/quest';
import {
  H,
  W,
  bands,
  ceilingLight,
  desk,
  dither,
  frame,
  glitch,
  hash,
  hline,
  light,
  monitor,
  particles,
  perspectiveFloor,
  plant,
  px,
  rect,
  text,
  textWidth,
  vline,
  withAlpha,
  type Paint,
} from './pixel.ts';

type Painter = (p: Paint) => void;

const par = (p: Paint, depth: number) => Math.round(p.px * depth);

function skyline(p: Paint, x: number, y: number, w: number, h: number, sky: readonly string[], lit = '#ffd23f'): void {
  const { g } = p;
  bands(g, sky, x, y, w, h);
  for (let b = 0; b < Math.ceil(w / 7); b++) {
    const bh = 6 + hash(p.seed, b, x) * (h * 0.6);
    const bw = 5 + Math.floor(hash(b, x) * 5);
    const bx = x + b * 7;
    rect(g, '#0a0818', bx, y + h - bh, Math.min(bw, x + w - bx), bh);
    for (let k = 0; k < 8; k++) {
      if (hash(b, k, x) > 0.62) {
        const wx = bx + 1 + (k % 3) * 2;
        const wy = y + h - bh + 2 + Math.floor(k / 3) * 3;
        if (wx < x + w - 1 && wy < y + h - 1) px(g, lit, wx, wy);
      }
    }
  }
}

function windowPane(p: Paint, x: number, y: number, w: number, h: number): void {
  const { g } = p;
  rect(g, '#05040c', x - 1, y - 1, w + 2, h + 2);
  skyline(p, x, y, w, h, ['#070a22', '#11133a', '#231b4f']);
  vline(g, '#05040c', x + Math.floor(w / 2), y, h);
  hline(g, withAlpha('#ffffff', 0.08), x, y + 2, w);
}

// ---------------------------------------------------------------------------

const office: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 7);
  bands(g, ['#0c0a1e', '#131130', '#1a1740'], 0, 0, W, 80);
  for (let i = 0; i < 6; i++) windowPane(p, -14 + i * 44 + far, 14, 36, 40);
  rect(g, '#0b091a', 0, 0, W, 6);
  for (let i = 0; i < 4; i++) ceilingLight(p, 10 + i * 62 + mid, 6, 30, '#e7ffd0', i === 1 ? 2.5 : 0.3);
  perspectiveFloor(g, 80, '#15122e', '#1d1a3d', W / 2 + mid, 22);
  for (let i = 0; i < 5; i++) {
    const dx = -8 + i * 54 + mid;
    desk(g, dx, 86, 42, '#3b3563', '#221e40');
    monitor(p, dx + 13, 73, '#a3e635', 'msg');
    rect(g, '#2a2548', dx + 30, 80, 6, 6);
  }
  plant(g, 2 + mid, 70);
  plant(g, W - 10 + mid, 70);
  particles(p, 16, '#3b3563', { rise: 1.2, drift: 2 });
  if (p.motion && Math.sin(p.t * 0.9) > 0.92) glitch(p, 0.4);
};

const copyRoom: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 6);
  bands(g, ['#171428', '#1e1a33', '#241f3d'], 0, 0, W, 84);
  // Shelves with paper reams.
  for (let s = 0; s < 3; s++) {
    const sy = 18 + s * 20;
    rect(g, '#3a3150', 6 + far, sy + 12, 70, 3);
    rect(g, '#3a3150', 168 + far, sy + 12, 66, 3);
    for (let k = 0; k < 7; k++) {
      const c = hash(s, k) > 0.5 ? '#e9e4ff' : '#cfc8f0';
      rect(g, c, 9 + far + k * 9, sy + 4, 7, 8);
      rect(g, '#9d95c4', 9 + far + k * 9, sy + 11, 7, 1);
      if (k < 6) {
        rect(g, c, 171 + far + k * 10, sy + 5, 8, 7);
        rect(g, '#9d95c4', 171 + far + k * 10, sy + 11, 8, 1);
      }
    }
  }
  ceilingLight(p, 90 + mid, 5, 60, '#f1f7ff', 0.6);
  // Tiled floor.
  rect(g, '#1b1830', 0, 84, W, H - 84);
  for (let y = 84; y < H; y += 8) for (let x = (y / 8) % 2 ? 0 : 8; x < W; x += 16) rect(g, '#231f3c', x + mid, y, 8, 8);
  hline(g, '#0e0c1c', 0, 84, W);
  // Recycling bin and stacked boxes.
  rect(g, '#1c4d9a', 18 + mid, 92, 14, 18);
  rect(g, '#2a63c0', 18 + mid, 92, 14, 3);
  rect(g, '#8b5a2b', 204 + mid, 96, 22, 14);
  rect(g, '#a66f3a', 208 + mid, 86, 16, 10);
  particles(p, 10, '#8f88b3', { rise: 0.6, drift: 1.5 });
};

const breakArea: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 6);
  bands(g, ['#1a1222', '#23182c', '#2b1d33'], 0, 0, W, 82);
  // Backsplash tiles.
  for (let y = 40; y < 64; y += 4) for (let x = 0; x < W; x += 6) rect(g, (x + y) % 12 ? '#34253f' : '#3b2a47', x + far, y, 5, 3);
  // Upper cabinets.
  for (let i = 0; i < 5; i++) {
    rect(g, '#3f2d4a', 8 + i * 30 + far, 12, 28, 22);
    frame(g, '#2a1d33', 8 + i * 30 + far, 12, 28, 22);
    rect(g, '#b48cff', 30 + i * 30 + far, 22, 2, 3);
  }
  windowPane(p, 168 + far, 10, 54, 34);
  // Counter.
  rect(g, '#4a3656', 0, 64, W, 5);
  rect(g, '#2d2036', 0, 69, W, 16);
  for (let i = 0; i < 8; i++) frame(g, '#241a2c', i * 32 + mid, 70, 30, 14);
  // Hanging warm lamps.
  for (let i = 0; i < 3; i++) {
    const lx = 40 + i * 80 + mid;
    vline(g, '#120c18', lx, 0, 10);
    rect(g, '#ffb86b', lx - 4, 10, 9, 3);
    light(p, lx, 14, 34, '#ffb86b', 0.5);
  }
  rect(g, '#1b1320', 0, 85, W, H - 85);
  dither(g, '#1b1320', '#241a2a', 0, 85, W, H - 85, 0.25);
  particles(p, 8, '#6d4f7a', { rise: 0.8 });
};

const serverRoom: Painter = (p) => {
  const { g } = p;
  const mid = par(p, 6);
  bands(g, ['#04070f', '#07101c', '#0a1626'], 0, 0, W, H);
  // Cable trays.
  for (let i = 0; i < 3; i++) hline(g, '#1a2a3d', 0, 6 + i * 3, W);
  // Racks receding on both sides.
  for (let side = 0; side < 2; side++) {
    for (let r = 0; r < 5; r++) {
      const depth = r / 5;
      const h = 90 - r * 12;
      const w = 22 - r * 3;
      const x = side === 0 ? 4 + r * 20 + mid * (1 - depth) : W - 4 - w - r * 20 + mid * (1 - depth);
      const y = 22 + r * 6;
      rect(g, '#0d1726', x, y, w, h);
      frame(g, '#1c2c44', x, y, w, h);
      for (let k = 0; k < Math.floor(h / 5); k++) {
        hline(g, '#132236', x + 2, y + 3 + k * 5, w - 4);
        const blink = hash(r, k, side, p.motion ? Math.floor(p.t * (2 + ((r + k) % 3))) : 1);
        const c = blink > 0.82 ? '#ff5a5f' : blink > 0.45 ? '#a3e635' : '#22d3ee';
        if (blink > 0.3) {
          px(g, c, x + w - 4, y + 3 + k * 5);
          if (r < 2) light(p, x + w - 4, y + 3 + k * 5, 4, c, 0.5);
        }
      }
    }
  }
  // Perforated floor.
  rect(g, '#0a1320', 0, 104, W, H - 104);
  for (let y = 106; y < H; y += 4) for (let x = (y % 8) / 2; x < W; x += 4) px(g, '#12213a', x + mid, y);
  light(p, W / 2, 60, 70, '#22d3ee', 0.18);
  particles(p, 12, '#1f4a66', { rise: 0.5 });
};

const elevator: Painter = (p) => {
  const { g } = p;
  const mid = par(p, 4);
  // Brushed-steel walls.
  rect(g, '#2b2f45', 0, 0, W, H);
  for (let x = 0; x < W; x += 3) vline(g, x % 6 ? '#32374f' : '#272b40', x + mid, 0, H);
  // Floor-indicator display.
  rect(g, '#07060d', 92 + mid, 6, 56, 14);
  frame(g, '#4a5070', 91 + mid, 5, 58, 16);
  const floors = ['7', '5', '3', '1', 'B', '½', '?'];
  const f = floors[p.motion ? Math.floor(p.t * 1.2) % floors.length : 5]!;
  text(g, `FLOOR ${f}`, 96 + mid, 10, '#a3e635');
  light(p, 120 + mid, 13, 22, '#a3e635', 0.5);
  // Handrail.
  rect(g, '#8a90b0', 0, 88, W, 2);
  rect(g, '#5a6080', 0, 90, W, 1);
  // Floor.
  rect(g, '#1a1c2a', 0, 112, W, H - 112);
  dither(g, '#1a1c2a', '#23263a', 0, 112, W, H - 112, 0.35);
  ceilingLight(p, 70 + mid, 0, 100, '#fff6dc', 0.4);
};

const stairwell: Painter = (p) => {
  const { g } = p;
  const mid = par(p, 6);
  bands(g, ['#15141f', '#1e1c2b', '#252334'], 0, 0, W, H);
  // Zig-zag stairs descending into darkness.
  for (let flight = 0; flight < 4; flight++) {
    const dir = flight % 2 === 0 ? 1 : -1;
    const baseX = flight % 2 === 0 ? 20 : 220;
    const baseY = 30 + flight * 26;
    for (let s = 0; s < 10; s++) {
      const x = baseX + dir * s * 9 + mid * (1 - flight * 0.2) - (dir < 0 ? 12 : 0);
      const y = baseY + s * 2.4;
      const shade = ['#3a3850', '#34324a', '#2c2a40', '#23213a'][flight]!;
      rect(g, shade, x, y, 12, 3);
      hline(g, '#4a4866', x, y, 12);
    }
    // Railing.
    for (let s = 0; s < 10; s += 1) px(g, '#c9b33a', baseX + dir * s * 9 + mid, baseY - 8 + s * 2.4);
  }
  // Exit sign.
  rect(g, '#0d2a16', 104 + mid, 8, 32, 10);
  text(g, 'EXIT', 112 + mid, 11, '#2de38f');
  light(p, 120 + mid, 13, 26, '#2de38f', 0.6);
  // Glitching floor number.
  const n = p.motion ? ['3', '3', '3', '2½', '2¼', '?'][Math.floor(p.t * 1.5) % 6]! : '2½';
  text(g, n, 196 + mid, 16, '#e2e0f0');
  rect(g, '#0a0912', 0, 120, W, 15);
  dither(g, '#0a0912', '#16141f', 0, 110, W, 10, 0.5);
  particles(p, 10, '#4a4866', { rise: -2 });
};

const lobby: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 7);
  bands(g, ['#0d0c1a', '#15142a', '#1b1a36'], 0, 0, W, 90);
  // Glass doors onto the street.
  rect(g, '#05040a', 60 + far, 14, 120, 70);
  skyline(p, 61 + far, 15, 118, 52, ['#081026', '#16204a', '#2a2458'], '#ffe28a');
  rect(g, '#11101f', 61 + far, 67, 118, 16);
  for (let i = 0; i < 4; i++) {
    rect(g, '#ffd23f', 72 + i * 30 + far, 58, 1, 9);
    light(p, 72 + i * 30 + far, 58, 10, '#ffd23f', 0.5);
  }
  for (let i = 0; i < 4; i++) vline(g, '#05040a', 90 + i * 30 + far, 14, 70);
  hline(g, withAlpha('#ffffff', 0.08), 61 + far, 20, 118);
  // Marble checker floor.
  rect(g, '#1b1a2e', 0, 90, W, H - 90);
  for (let y = 90; y < H; y += 6) for (let x = (y / 6) % 2 ? 0 : 10; x < W; x += 20) rect(g, '#25243d', x + mid, y, 10, 6);
  hline(g, '#0a0914', 0, 90, W);
  plant(g, 30 + mid, 76);
  plant(g, 204 + mid, 76);
  text(g, 'DELTA ALPHA SIERRA', 120 - textWidth('DELTA ALPHA SIERRA') / 2 + far, 4, '#8f88b3');
};

const cubicleMaze: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 8);
  bands(g, ['#0a0516', '#120926', '#1b0d38', '#27124c'], 0, 0, W, 72);
  // Distant glitch-heart pulse at the vanishing point.
  const pulse = p.motion ? 0.55 + Math.sin(p.t * 2.2) * 0.25 : 0.6;
  light(p, 120 + far, 50, 46, '#a3e635', pulse * 0.55);
  rect(g, '#a3e635', 118 + far, 48, 4, 4);
  rect(g, '#e7ffc6', 119 + far, 49, 2, 2);
  // Carpet in perspective with a pattern that hurts to look at.
  rect(g, '#1d1131', 0, 62, W, H - 62);
  for (let y = 62; y < H; y += 3) {
    const k = (y - 62) / (H - 62);
    const step = Math.max(3, Math.round(4 + k * 10));
    for (let x = ((y / 3) % 2) * (step / 2); x < W; x += step) px(g, '#2c1a48', x + mid * k, y);
  }
  // Rows of cubicles receding toward the pulse.
  const rows = [
    { y: 58, h: 10, w: 22, gap: 4, shade: '#2a1d4a', top: '#3b2d5c', off: far },
    { y: 66, h: 16, w: 32, gap: 6, shade: '#342458', top: '#4a3a72', off: far * 1.5 },
    { y: 80, h: 25, w: 48, gap: 8, shade: '#3e2b68', top: '#5a4788', off: mid * 0.7 },
    { y: 102, h: 36, w: 70, gap: 10, shade: '#4a3378', top: '#6d58a4', off: mid },
  ];
  rows.forEach((r, ri) => {
    const count = Math.ceil(W / (r.w + r.gap)) + 2;
    for (let i = -1; i < count; i++) {
      const x = i * (r.w + r.gap) + r.off + (ri % 2 ? r.w / 2 : 0);
      // Peeking monitors glow above some walls.
      if (hash(ri, i, 5) > 0.45) {
        const mw = Math.max(3, Math.round(r.w * 0.22));
        const mh = Math.max(2, Math.round(r.h * 0.2));
        rect(g, '#0b0718', x + r.w * 0.35, r.y - mh, mw, mh);
        rect(g, withAlpha('#a3e635', 0.75), x + r.w * 0.35 + 1, r.y - mh + 1, mw - 2, mh - 1);
        if (ri >= 2) light(p, x + r.w * 0.35 + mw / 2, r.y - mh / 2, 8, '#a3e635', 0.3);
      }
      rect(g, '#0b0718', x - 1, r.y - 1, r.w + 2, r.h + 1);
      rect(g, r.shade, x, r.y, r.w, r.h);
      dither(g, r.shade, withAlpha('#000000', 0.35), x, r.y + 2, r.w, r.h - 2, 0.1);
      rect(g, r.top, x, r.y, r.w, Math.max(1, Math.round(r.h * 0.08)));
      vline(g, '#0b0718', x + Math.round(r.w / 2), r.y + 2, r.h - 2);
      if (ri === 3 && hash(i, 7) > 0.6) {
        // A pinned sticky note.
        rect(g, '#ffd23f', x + 8, r.y + 8, 5, 5);
      }
    }
  });
  particles(p, 22, '#a3e635', { rise: 3, drift: 4, area: [0, 0, W, 100] });
  glitch(p, 0.5);
};

const meetingRoom: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 7);
  bands(g, ['#0f0d1e', '#171431', '#1f1a3f'], 0, 0, W, 84);
  // Glass wall panels.
  for (let i = 0; i < 8; i++) {
    rect(g, withAlpha('#9ad7ff', 0.06), i * 32 + far, 8, 30, 70);
    vline(g, '#2b2850', i * 32 + far, 8, 70);
  }
  hline(g, '#2b2850', 0, 8, W);
  // Long table in perspective.
  g.fillStyle = '#3b2f52';
  g.beginPath();
  g.moveTo(96 + mid, 70);
  g.lineTo(144 + mid, 70);
  g.lineTo(206 + mid, 126);
  g.lineTo(34 + mid, 126);
  g.closePath();
  g.fill();
  hline(g, '#5a4a7a', 96 + mid, 70, 48);
  // Chairs.
  for (let i = 0; i < 4; i++) {
    const k = i / 4;
    const lx = 90 - k * 58 + mid;
    const rx = 150 + k * 58 + mid;
    const y = 72 + k * 48;
    const s = 4 + k * 6;
    rect(g, '#211c36', lx - s, y - s, s, s * 1.4);
    rect(g, '#211c36', rx, y - s, s, s * 1.4);
  }
  rect(g, '#120f22', 0, 84, 34 + mid, H);
  rect(g, '#120f22', 206 + mid, 84, W, H);
  particles(p, 10, '#4a4270', { rise: 0.6 });
};

const breakRoom: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 7);
  bands(g, ['#0a1418', '#0f1d23', '#15272e'], 0, 0, W, 78);
  for (let y = 16; y < 76; y += 5) for (let x = (y % 10) / 2; x < W; x += 7) rect(g, '#1a2f37', x + far, y, 6, 4);
  ceilingLight(p, 30 + mid, 4, 40, '#c8fff6', 1.2);
  ceilingLight(p, 170 + mid, 4, 40, '#c8fff6', 0.3);
  // Water.
  const top = 74;
  bands(g, ['#0f3b44', '#0c2f37', '#08222a', '#061a20'], 0, top, W, H - top);
  for (let i = 0; i < 26; i++) {
    const y = top + 3 + (i % 9) * 6 + (i % 2);
    const phase = p.motion ? p.t * (1.2 + (i % 3) * 0.4) : i;
    const x = ((hash(i, p.seed) * W + phase * 12) % (W + 40)) - 20;
    hline(g, i % 3 ? '#1f6b73' : '#3aa7ad', x + mid * (y / H), y, 6 + (i % 4) * 3);
  }
  // Reflections of the lights.
  for (let k = 0; k < 4; k++) hline(g, withAlpha('#c8fff6', 0.35), 40 + mid + Math.sin(p.t * 2 + k) * 2, top + 6 + k * 4, 18 - k * 3);
  // Floating paper cups.
  for (let c = 0; c < 4; c++) {
    const bob = p.motion ? Math.sin(p.t * 1.6 + c * 2) * 1.2 : 0;
    const x = ((hash(c, 3) * W + (p.motion ? p.t * (3 + c) : 0)) % (W + 20)) - 10;
    const y = top + 10 + c * 12 + bob;
    rect(g, '#f1ebff', x, y, 4, 3);
    rect(g, '#ff8a3d', x, y + 1, 4, 1);
  }
  light(p, W / 2, top + 10, 90, '#22d3ee', 0.12);
  particles(p, 10, '#5cc9c9', { rise: 2, area: [0, top, W, H - top] });
};

const dataRiver: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 8);
  bands(g, ['#040308', '#07060f', '#0c0a18'], 0, 0, W, H);
  // Cave ceiling with stalactites.
  for (let i = 0; i < 30; i++) {
    const x = i * 8 + far;
    const h = 4 + hash(i, 9) * 18;
    rect(g, '#120f22', x, 0, 7, h);
    rect(g, '#120f22', x + 2, h, 3, 3);
  }
  // Far shore: arcade glow.
  light(p, 190 + far, 58, 44, '#ff4fd8', 0.35);
  for (let i = 0; i < 6; i++) rect(g, i % 2 ? '#ff4fd8' : '#22d3ee', 168 + i * 7 + far, 54, 3, 5);
  rect(g, '#0d0b1a', 0, 60, W, 10);
  // The river of data.
  bands(g, ['#062a1f', '#0a3d2a', '#0b4a39', '#0a3d2a'], 0, 70, W, 32);
  for (let i = 0; i < 40; i++) {
    const lane = i % 8;
    const speed = 14 + (lane % 3) * 6;
    const x = ((hash(i, 2) * W + (p.motion ? p.t * speed : 0)) % (W + 20)) - 10;
    const y = 72 + lane * 3.6;
    const c = i % 5 === 0 ? '#ffffff' : i % 2 ? '#a3e635' : '#22d3ee';
    rect(g, c, x + mid * 0.4, y, i % 3 === 0 ? 4 : 2, 1);
    if (i % 7 === 0) {
      // Little envelope glyphs.
      frame(g, '#dff7c0', x + 6, y - 1, 5, 4);
      px(g, '#dff7c0', x + 8, y);
    }
  }
  light(p, W / 2, 86, 110, '#a3e635', 0.25);
  // Near shore sand.
  rect(g, '#1a1426', 0, 102, W, H - 102);
  dither(g, '#1a1426', '#261d36', 0, 102, W, H - 102, 0.3);
  particles(p, 18, '#a3e635', { rise: 3, area: [0, 20, W, 80] });
};

const arcade: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 7);
  bands(g, ['#07040f', '#0d0719', '#140a24'], 0, 0, W, 90);
  // Neon marquee sign.
  const sign = 'DASCADE';
  const sx = 120 - textWidth(sign) + far;
  rect(g, '#1b0a2a', sx - 4, 6, textWidth(sign) * 2 + 8, 14);
  g.save();
  g.scale(2, 2);
  text(g, sign, sx / 2, 4.5, p.motion && Math.sin(p.t * 5) > 0.9 ? '#7a2a6a' : '#ff4fd8');
  g.restore();
  light(p, 120 + far, 13, 60, '#ff4fd8', 0.55);
  // Cabinet rows receding.
  for (let row = 2; row >= 0; row--) {
    const y = 36 + row * 16;
    const h = 26 + row * 10;
    const w = 14 + row * 5;
    const offset = row === 2 ? mid : far;
    for (let i = -1; i < 12; i++) {
      const x = i * (w + 6) + offset + (row % 2 ? 8 : 0);
      rect(g, ['#1d1233', '#26173f', '#301c4d'][row]!, x, y, w, h);
      const sc = ['#22d3ee', '#a3e635', '#ff4fd8', '#ffd23f'][(i + row + 4) % 4]!;
      const flick = p.motion ? 0.6 + 0.4 * Math.sin(p.t * 3 + i) : 1;
      rect(g, withAlpha(sc, 0.55 + 0.35 * flick), x + 2, y + 3, w - 4, Math.round(h * 0.35));
      rect(g, '#0b0714', x + 1, y + Math.round(h * 0.55), w - 2, 2);
      if (row === 2) light(p, x + w / 2, y + 8, 12, sc, 0.35);
    }
  }
  // Neon confetti carpet.
  rect(g, '#10091c', 0, 100, W, H - 100);
  for (let i = 0; i < 70; i++) {
    const x = hash(i, 1) * W + mid;
    const y = 100 + hash(i, 2) * (H - 100);
    px(g, ['#ff4fd8', '#22d3ee', '#a3e635', '#ffd23f'][i % 4]!, x, y);
  }
  particles(p, 8, '#ff4fd8', { rise: 1 });
};

const vault: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 6);
  bands(g, ['#0c0e16', '#141824', '#1b2030'], 0, 0, W, H);
  // Rivets on the walls.
  for (let y = 10; y < 90; y += 12) for (let x = 6; x < W; x += 14) px(g, '#2c3348', x + far, y);
  // Open round vault door on the left.
  g.fillStyle = '#39405a';
  g.beginPath();
  g.arc(26 + far, 58, 34, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a3048';
  g.beginPath();
  g.arc(26 + far, 58, 26, 0, Math.PI * 2);
  g.fill();
  for (let a = 0; a < 8; a++) {
    const ax = 26 + far + Math.cos((a / 8) * Math.PI * 2) * 20;
    const ay = 58 + Math.sin((a / 8) * Math.PI * 2) * 20;
    rect(g, '#8a92b2', ax - 1, ay - 1, 3, 3);
  }
  // Work lamp cone.
  vline(g, '#0a0c14', 150 + mid, 0, 14);
  rect(g, '#d9c38a', 145 + mid, 14, 11, 4);
  light(p, 150 + mid, 50, 60, '#ffd88a', 0.45);
  rect(g, '#141824', 0, 104, W, H - 104);
  dither(g, '#141824', '#1d2233', 0, 104, W, H - 104, 0.4);
  hline(g, '#0a0c14', 0, 104, W);
  particles(p, 14, '#8a7a5a', { rise: 0.6, area: [110, 20, 80, 90] });
};

const glitchCore: Painter = (p) => {
  const { g } = p;
  const far = par(p, 4);
  const mid = par(p, 9);
  bands(g, ['#020105', '#07031a', '#10062a', '#1a0a33'], 0, 0, W, H);
  // Stars of broken sprites.
  for (let i = 0; i < 60; i++) {
    const x = hash(i, 11) * W + far;
    const y = hash(i, 12) * 90;
    const on = !p.motion || Math.sin(p.t * (1 + (i % 5)) + i) > -0.4;
    if (on) px(g, ['#a3e635', '#22d3ee', '#ff4fd8', '#8f88b3'][i % 4]!, x, y);
  }
  // The pulsing core far below.
  const beat = p.motion ? (Math.sin(p.t * 3.1) + 1) / 2 : 0.5;
  const cy = 118;
  for (let r = 44; r > 0; r -= 4) {
    const c = r % 8 === 0 ? '#1f0b3a' : '#2b0f4f';
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(120 + mid * 0.3, cy, r * 1.8, r * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  light(p, 120 + mid * 0.3, cy, 70 + beat * 20, '#a3e635', 0.5 + beat * 0.2);
  light(p, 110 + mid * 0.3, cy - 4, 40, '#ff4fd8', 0.35);
  // Floating pixel platforms.
  for (let i = 0; i < 6; i++) {
    const x = 10 + i * 40 + (i % 2 ? far : mid);
    const y = 40 + (i % 3) * 18 + (p.motion ? Math.sin(p.t + i) * 1.5 : 0);
    rect(g, '#2a1d4a', x, y, 18, 3);
    rect(g, '#a3e635', x, y, 18, 1);
  }
  particles(p, 30, '#a3e635', { rise: 6, drift: 6 });
  glitch(p, 1.2);
};

const dawn: Painter = (p) => {
  const { g } = p;
  const far = par(p, 3);
  const mid = par(p, 7);
  bands(g, ['#1a1040', '#3b1f5c', '#7a2f6a', '#ff6b5a', '#ff9a4a', '#ffd23f'], 0, 0, W, 92);
  // Rising sun.
  const rise = p.motion ? Math.min(8, p.t * 0.8) : 6;
  g.fillStyle = '#ffe9a0';
  g.beginPath();
  g.arc(168 + far, 66 - rise, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff6d0';
  g.beginPath();
  g.arc(168 + far, 66 - rise, 12, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 4; i++) hline(g, '#ff9a4a', 146 + far, 70 - rise + i * 4, 44);
  light(p, 168 + far, 64 - rise, 60, '#ffd23f', 0.55);
  // Skyline silhouettes.
  for (let b = 0; b < 30; b++) {
    const bx = b * 9 + mid;
    const bh = 8 + hash(b, 21) * 26;
    rect(g, '#1a0f2e', bx, 92 - bh, 8, bh);
    if (hash(b, 5) > 0.6) px(g, '#ffd23f', bx + 3, 92 - bh + 4);
  }
  // Delta Alpha tower with a lime crown.
  rect(g, '#120a22', 40 + mid, 30, 20, 62);
  rect(g, '#a3e635', 40 + mid, 30, 20, 2);
  light(p, 50 + mid, 31, 16, '#a3e635', 0.6);
  rect(g, '#0e0820', 0, 92, W, H - 92);
  dither(g, '#0e0820', '#1a1030', 0, 92, W, H - 92, 0.3);
  // Birds.
  for (let i = 0; i < 4; i++) {
    const bx = ((p.motion ? p.t * 8 : 0) + i * 40) % (W + 20);
    const by = 24 + i * 6 + (p.motion ? Math.sin(p.t * 4 + i) : 0);
    px(g, '#1a0f2e', bx, by);
    px(g, '#1a0f2e', bx + 1, by - 1);
    px(g, '#1a0f2e', bx + 2, by);
  }
};

export const THEMES: Record<QuestThemeId, Painter> = {
  office,
  copyRoom,
  breakArea,
  serverRoom,
  elevator,
  stairwell,
  lobby,
  cubicleMaze,
  meetingRoom,
  breakRoom,
  dataRiver,
  arcade,
  vault,
  glitchCore,
  dawn,
};

/** Accent tint per theme (used for the frame glow around the scene). */
export const THEME_TINT: Record<QuestThemeId, string> = {
  office: '#a3e635',
  copyRoom: '#c8c2f0',
  breakArea: '#ffb86b',
  serverRoom: '#22d3ee',
  elevator: '#a3e635',
  stairwell: '#2de38f',
  lobby: '#ffd23f',
  cubicleMaze: '#a78bfa',
  meetingRoom: '#9ad7ff',
  breakRoom: '#22d3ee',
  dataRiver: '#a3e635',
  arcade: '#ff4fd8',
  vault: '#ffd88a',
  glitchCore: '#a3e635',
  dawn: '#ffd23f',
};

export function paintFallback(p: Paint): void {
  bands(p.g, ['#0b0a16', '#141226', '#1c1934'], 0, 0, W, H);
  particles(p, 20, '#a3e635', { rise: 2 });
}
