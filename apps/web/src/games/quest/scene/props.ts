/**
 * Focal props drawn over an environment (node `art` ids). Each prop owns its
 * placement so combinations like ['printer', 'paper'] compose naturally.
 * Unknown ids are ignored, so packs can reference props this client lacks.
 */
import { H, W, frame, glitch, hash, hline, light, particles, px, rect, sprite, text, textWidth, vline, withAlpha, type Paint } from './pixel.ts';

type Prop = (p: Paint) => void;

const bob = (p: Paint, speed = 2, amp = 1, phase = 0) => (p.motion ? Math.round(Math.sin(p.t * speed + phase) * amp) : 0);
const mid = (p: Paint) => Math.round(p.px * 7);

const printer: Prop = (p) => {
  const { g } = p;
  const x = 94 + mid(p);
  const y = 60;
  const ink = '#1a1530';
  // Floor shadow.
  rect(g, withAlpha('#000000', 0.45), x - 4, y + 38, 60, 4);
  // Paper feeder at the back with a stack of sheets.
  rect(g, ink, x + 8, y - 9, 36, 10);
  rect(g, '#9d95c4', x + 9, y - 8, 34, 8);
  for (let i = 0; i < 3; i++) hline(g, '#f8f6ff', x + 11, y - 7 + i * 2, 30);
  // Body: top, front, base with an outline.
  rect(g, ink, x - 1, y - 1, 54, 40);
  rect(g, '#e4dff7', x, y, 52, 7);
  rect(g, '#c3bcdf', x, y + 7, 52, 22);
  rect(g, '#8f88b3', x, y + 29, 52, 9);
  hline(g, '#f8f6ff', x + 1, y + 1, 50);
  vline(g, '#a49dc9', x + 51, y + 7, 22);
  // Output slot and a sheet sliding out.
  rect(g, '#2a2548', x + 5, y + 11, 30, 4);
  const out = p.motion ? (p.t * 7) % 10 : 6;
  rect(g, '#f8f6ff', x + 7, y + 13 + out, 26, 2 + Math.min(4, out));
  hline(g, '#0b0914', x + 10, y + 14 + out, 16);
  // Output tray.
  rect(g, '#6f6896', x + 3, y + 24, 34, 3);
  // Control panel with an unimpressed face.
  rect(g, ink, x + 38, y + 9, 12, 16);
  rect(g, '#0f2a12', x + 39, y + 10, 10, 7);
  const angry = p.motion ? Math.sin(p.t * 2.6) > -0.2 : true;
  px(g, '#a3e635', x + 41, y + 12 + (angry ? 0 : 1));
  px(g, '#a3e635', x + 46, y + 12 + (angry ? 0 : 1));
  if (angry) {
    px(g, '#a3e635', x + 40, y + 11);
    px(g, '#a3e635', x + 47, y + 11);
  }
  hline(g, '#a3e635', x + 42, y + 15, 4);
  light(p, x + 44, y + 13, 9, '#a3e635', 0.55);
  px(g, '#ff5a5f', x + 40, y + 20);
  px(g, '#2de38f', x + 43, y + 20);
  rect(g, '#d8d2ee', x + 45, y + 19, 4, 3);
  // Base feet + model plate.
  rect(g, ink, x + 3, y + 38, 6, 2);
  rect(g, ink, x + 43, y + 38, 6, 2);
  text(g, 'PRN-3000', x + 4, y + 31, '#4a4270');
};

const paper: Prop = (p) => {
  const n = p.fx === 'off' ? 3 : 7;
  for (let i = 0; i < n; i++) {
    const t = p.motion ? p.t * (0.6 + (i % 3) * 0.2) + i : i * 1.3;
    const x = 60 + ((i * 37 + t * 22) % 130) + mid(p);
    const y = 20 + ((i * 23 + t * 9) % 60);
    const flip = Math.floor(t * 3 + i) % 2;
    rect(p.g, '#f8f6ff', x, y, flip ? 5 : 3, flip ? 4 : 5);
    px(p.g, '#0b0914', x + 1, y + 1);
  }
};

const map: Prop = (p) => {
  const { g } = p;
  const x = 180 + mid(p);
  const y = 30 + bob(p, 1.4, 2);
  rect(g, '#efe6c8', x, y, 26, 20);
  frame(g, '#b9ac86', x, y, 26, 20);
  for (let i = 0; i < 5; i++) hline(g, '#a3e635', x + 3 + (i % 2) * 4, y + 3 + i * 3, 10 + (i * 3) % 8);
  rect(g, '#ff5a5f', x + 18, y + 12, 2, 2);
  light(p, x + 13, y + 10, 16, '#a3e635', 0.35);
};

const coffee: Prop = (p) => {
  const { g } = p;
  const x = 104 + mid(p);
  const y = 44;
  rect(g, '#0a0914', x - 2, y + 44, 38, 3);
  rect(g, '#b8bfd6', x, y, 34, 44);
  rect(g, '#e3e8f5', x + 2, y + 2, 30, 4);
  rect(g, '#8a92b2', x, y + 30, 34, 14);
  // Face display.
  rect(g, '#12091c', x + 7, y + 9, 20, 11);
  const blink = p.motion && Math.sin(p.t * 1.3) > 0.96;
  rect(g, '#ffb86b', x + 11, y + 12, 3, blink ? 1 : 3);
  rect(g, '#ffb86b', x + 20, y + 12, 3, blink ? 1 : 3);
  hline(g, '#ffb86b', x + 13, y + 17, 8);
  light(p, x + 17, y + 14, 16, '#ffb86b', 0.55);
  // Spout + cup.
  rect(g, '#4a5070', x + 14, y + 24, 6, 4);
  rect(g, '#f1ebff', x + 13, y + 34, 8, 7);
  rect(g, '#6b3f23', x + 14, y + 35, 6, 2);
  // Steam.
  for (let i = 0; i < 5; i++) {
    const t = p.motion ? p.t * 8 + i * 3 : i * 3;
    const sy = y - 2 - ((t * 1.5) % 14);
    px(g, withAlpha('#ffffff', 0.5), x + 16 + Math.round(Math.sin(t) * 2), sy);
  }
};

const keypad: Prop = (p) => {
  const { g } = p;
  const x = 150 + mid(p);
  rect(g, '#1b2536', x, 30, 40, 74);
  frame(g, '#2e3d58', x, 30, 40, 74);
  rect(g, '#0a1320', x + 8, 38, 24, 16);
  rect(g, withAlpha('#22d3ee', 0.2), x + 9, 39, 22, 14);
  // Keypad.
  rect(g, '#2a2f45', x + 44, 58, 10, 14);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) px(g, '#8f88b3', x + 46 + c * 4, 60 + r * 4);
  const red = p.motion ? Math.sin(p.t * 4) > 0 : true;
  px(g, red ? '#ff5a5f' : '#4a1a1c', x + 52, 70);
  if (red) light(p, x + 52, 70, 5, '#ff5a5f', 0.8);
  rect(g, '#fff27a', x + 12, 60, 12, 10);
  text(g, 'NO', x + 14, 62, '#6b5a00');
};

const mannequin: Prop = (p) => {
  const { g } = p;
  const x = 60 + mid(p);
  const y = 44;
  const tilt = p.motion && Math.sin(p.t * 0.35) > 0.85 ? 1 : 0;
  // Head.
  rect(g, '#d9d2c4', x + 4 + tilt, y, 10, 11);
  px(g, '#0b0914', x + 7 + tilt, y + 5);
  px(g, '#0b0914', x + 11 + tilt, y + 5);
  // Hoodie.
  rect(g, '#3a4a6a', x, y + 11, 18, 26);
  rect(g, '#2d3a55', x + 2, y + 11, 14, 3);
  rect(g, '#3a4a6a', x - 3, y + 14, 3, 18);
  rect(g, '#3a4a6a', x + 18, y + 14, 3, 18);
  // Lanyard + keycard.
  vline(g, '#a3e635', x + 7, y + 12, 8);
  vline(g, '#a3e635', x + 11, y + 12, 8);
  rect(g, '#f8f6ff', x + 6, y + 20, 7, 6);
  rect(g, '#a3e635', x + 7, y + 21, 5, 1);
  light(p, x + 9, y + 23, 6, '#a3e635', 0.4);
  // Legs + stand.
  rect(g, '#23283a', x + 3, y + 37, 5, 20);
  rect(g, '#23283a', x + 10, y + 37, 5, 20);
  rect(g, '#0b0914', x - 2, y + 57, 22, 2);
};

const rack: Prop = (p) => {
  const { g } = p;
  const x = 118 + mid(p);
  const y = 24;
  rect(g, '#0e1828', x, y, 40, 80);
  frame(g, '#2e3d58', x, y, 40, 80);
  const cascade = p.motion ? Math.floor(p.t * 10) % 16 : 6;
  for (let k = 0; k < 15; k++) {
    rect(g, '#15233a', x + 3, y + 4 + k * 5, 34, 4);
    const lit = k === cascade || k === (cascade + 15) % 16;
    const c = lit ? '#a3e635' : hash(k, 4) > 0.5 ? '#1f5c2a' : '#15384a';
    rect(g, c, x + 30, y + 5 + k * 5, 4, 2);
    if (lit) light(p, x + 32, y + 6 + k * 5, 10, '#a3e635', 0.7);
    px(g, '#22d3ee', x + 6, y + 6 + k * 5);
  }
};

const elevatorPanel: Prop = (p) => {
  const { g } = p;
  const x = 172 + mid(p);
  const y = 34;
  rect(g, '#1a1d2c', x, y, 30, 56);
  frame(g, '#8a90b0', x, y, 30, 56);
  const labels = ['7', '6', '5', '4', '3', '2', '1', 'L', 'B'];
  labels.forEach((l, i) => {
    const bx = x + 5 + (i % 2) * 12;
    const by = y + 4 + Math.floor(i / 2) * 9;
    rect(g, '#3a3f58', bx, by, 8, 7);
    text(g, l, bx + 2, by + 1, '#c9c3e6');
  });
  const glow = p.motion ? 0.6 + Math.sin(p.t * 3) * 0.3 : 0.8;
  rect(g, '#a3e635', x + 11, y + 46, 8, 7);
  text(g, '½', x + 13, y + 47, '#0b1a05');
  light(p, x + 15, y + 49, 14, '#a3e635', glow);
  // Closed doors.
  rect(g, '#555b78', 60 + mid(p), 30, 50, 82);
  rect(g, '#555b78', 112 + mid(p), 30, 50, 82);
  vline(g, '#23263a', 111 + mid(p), 30, 82);
};

const elevatorOpen: Prop = (p) => {
  const { g } = p;
  const x = 70 + mid(p);
  rect(g, '#1a0a33', x + 10, 28, 80, 84);
  light(p, x + 50, 70, 60, '#a78bfa', 0.7);
  for (let i = 0; i < 20; i++) px(g, i % 2 ? '#a3e635' : '#ff4fd8', x + 12 + hash(i, 1) * 76, 30 + ((hash(i, 2) * 80 + (p.motion ? p.t * 8 : 0)) % 80));
  rect(g, '#555b78', x, 28, 12, 84);
  rect(g, '#555b78', x + 88, 28, 12, 84);
};

const shaft: Prop = (p) => {
  const { g } = p;
  rect(g, '#07060d', 0, 0, W, H);
  for (let c = 0; c < 4; c++) vline(g, '#3a3f58', 70 + c * 30 + mid(p), 0, H);
  // Ladder.
  vline(g, '#8a90b0', 180 + mid(p), 0, H);
  vline(g, '#8a90b0', 192 + mid(p), 0, H);
  for (let y = 4; y < H; y += 7) hline(g, '#8a90b0', 180 + mid(p), y, 13);
  light(p, 120, 130, 80, '#a78bfa', 0.5);
  // The pigeon.
  const y = 40 + bob(p, 3, 1);
  sprite(g, ['..kk..', '.kgkk.', 'kkkkkk', '.kkkk.', '..yy..'], { k: '#8f88b3', g: '#2de38f', y: '#ffd23f' }, 40 + mid(p), y);
  // Emergency kit on a ledge.
  rect(g, '#3a3f58', 120 + mid(p), 60, 26, 3);
  rect(g, '#ff5a5f', 126 + mid(p), 52, 12, 8);
  rect(g, '#f8f6ff', 131 + mid(p), 53, 2, 6);
  rect(g, '#f8f6ff', 129 + mid(p), 55, 6, 2);
};

const guard: Prop = (p) => {
  const { g } = p;
  const x = 150 + mid(p);
  rect(g, '#3a2f52', x - 20, 84, 64, 20);
  rect(g, '#4a3d66', x - 20, 82, 64, 3);
  // Doug.
  rect(g, '#d9a77a', x + 4, 60, 10, 10);
  rect(g, '#23283a', x + 3, 58, 12, 3);
  rect(g, '#2b3b66', x + 1, 70, 16, 12);
  rect(g, '#ffd23f', x + 3, 72, 2, 2);
  // Crossword + lamp.
  rect(g, '#f8f6ff', x + 20, 78, 12, 4);
  rect(g, '#ffd23f', x - 14, 72, 6, 3);
  vline(g, '#8f88b3', x - 11, 75, 7);
  light(p, x - 11, 76, 22, '#ffd23f', 0.5);
};

const poster: Prop = (p) => {
  const { g } = p;
  const x = 30 + Math.round(p.px * 3);
  rect(g, '#f1ebff', x, 20, 26, 30);
  sprite(g, ['..k..k..', '..kkkk..', '.kwkkwk.', '.kkkkkk.', '..kkkk..', '...kk...', '..k..k..'], { k: '#ff8a3d', w: '#0b0914' }, x + 9, 24);
  text(g, 'HANG', x + 5, 36, '#23283a');
  text(g, 'IN', x + 9, 42, '#23283a');
};

const intern: Prop = (p) => {
  const { g } = p;
  const x = 150 + mid(p);
  const y = 58 + bob(p, 2.5, 1);
  rect(g, '#8b5a2b', x + 3, y - 2, 11, 4);
  rect(g, '#f5c9a0', x + 4, y, 9, 9);
  px(g, '#0b0914', x + 6, y + 4);
  px(g, '#0b0914', x + 10, y + 4);
  hline(g, '#0b0914', x + 7, y + 7, 3);
  rect(g, '#4f7cf0', x + 2, y + 9, 13, 16);
  vline(g, '#ff4fd8', x + 8, y + 9, 7);
  rect(g, '#f8f6ff', x + 6, y + 16, 5, 4);
  // Waving arm.
  const wave = p.motion ? Math.round(Math.sin(p.t * 6) * 2) : 0;
  rect(g, '#4f7cf0', x + 15, y + 6 + wave, 3, 8);
  rect(g, '#f5c9a0', x + 15, y + 3 + wave, 3, 3);
  rect(g, '#2a2f45', x + 3, y + 25, 5, 14);
  rect(g, '#2a2f45', x + 9, y + 25, 5, 14);
  // Overturned trash can.
  rect(g, '#6f6896', x - 22, y + 30, 16, 9);
};

const usb: Prop = (p) => {
  const { g } = p;
  const x = 196 + mid(p);
  const y = 40 + bob(p, 2, 3);
  rect(g, '#d8cfb0', x, y, 10, 18);
  rect(g, '#9aa0b8', x + 2, y - 5, 6, 5);
  text(g, '0', x + 3, y + 6, '#6b5a00');
  light(p, x + 5, y + 8, 20, '#a3e635', 0.55);
};

const projector: Prop = (p) => {
  const { g } = p;
  const x = 76 + Math.round(p.px * 3);
  rect(g, '#e9e5ff', x, 16, 88, 44);
  frame(g, '#8f88b3', x, 16, 88, 44);
  text(g, 'SYNERGY', x + 6, 22, '#4a3d8a');
  text(g, 'ROADMAP', x + 6, 29, '#4a3d8a');
  text(g, 'DRAFT 47', x + 6, 36, '#ff4fd8');
  text(g, '1/∞', x + 62, 50, '#8f88b3');
  for (let i = 0; i < 4; i++) rect(g, '#a3e635', x + 50 + i * 8, 44 - i * 5, 6, 8 + i * 5);
  light(p, x + 44, 38, 60, '#e9e5ff', 0.3);
};

function ghostSprite(p: Paint, x: number, y: number, scale: number, alpha: number, phase: number): void {
  const rows = ['..wwww..', '.wwwwww.', 'wwkwwkww', 'wwwwwwww', 'wwwwwwww', 'wwwwwwww', 'w.ww.w.w'];
  const g = p.g;
  const yy = y + bob(p, 1.8, 2, phase);
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      g.fillStyle = ch === 'k' ? '#1a0a33' : withAlpha('#c8c2ff', alpha);
      g.fillRect(x + i * scale, yy + j * scale, scale, scale);
    }
  });
  light(p, x + 4 * scale, yy + 4 * scale, 10 * scale, '#a78bfa', 0.25);
}

const ghosts: Prop = (p) => {
  for (let i = 0; i < 4; i++) ghostSprite(p, 52 + i * 38 + mid(p), 66 + (i % 2) * 6, 2, 0.55, i);
};

const manager: Prop = (p) => {
  const { g } = p;
  const x = 92 + mid(p);
  // Deb: a towering ghost in a cardigan, with reading glasses.
  ghostSprite(p, x + 4, 22, 4, 0.8, 0);
  const yy = 22 + bob(p, 1.8, 2, 0);
  rect(g, '#1a0a33', x + 11, yy + 8, 8, 5);
  rect(g, '#1a0a33', x + 23, yy + 8, 8, 5);
  rect(g, withAlpha('#c8f0ff', 0.6), x + 12, yy + 9, 6, 3);
  rect(g, withAlpha('#c8f0ff', 0.6), x + 24, yy + 9, 6, 3);
  hline(g, '#1a0a33', x + 19, yy + 10, 4);
  rect(g, '#d9733a', x + 6, yy + 22, 30, 9);
  rect(g, '#b85c2c', x + 20, yy + 22, 2, 9);
  // Her desk spans the foreground.
  rect(g, '#0b0714', x - 42, 83, 132, 2);
  rect(g, '#3b2f52', x - 42, 85, 132, 22);
  rect(g, '#4f4070', x - 42, 85, 132, 3);
  rect(g, '#ffd23f', x + 52, 78, 24, 7);
  text(g, 'DEB', x + 58, 79, '#3b2a00');
  rect(g, '#f1ebff', x - 30, 79, 18, 6);
  rect(g, '#a3e635', x - 28, 81, 10, 1);
  light(p, x + 20, 50, 44, '#a78bfa', 0.3);
};

const closet: Prop = (p) => {
  const { g } = p;
  const x = 40 + mid(p);
  for (let s = 0; s < 4; s++) {
    const y = 22 + s * 22;
    rect(g, '#4a3d66', x, y + 16, 160, 3);
    for (let k = 0; k < 14; k++) {
      const kind = hash(s, k) * 3;
      const c = kind < 1 ? '#ffd23f' : kind < 2 ? '#f1ebff' : '#ff5a5f';
      rect(g, c, x + 3 + k * 11, y + 16 - (kind < 1 ? 6 : 10), kind < 1 ? 8 : 6, kind < 1 ? 6 : 10);
    }
  }
  light(p, 120, 50, 80, '#ffd23f', 0.15);
};

const doorWet: Prop = (p) => {
  const { g } = p;
  const x = 100 + mid(p);
  rect(g, '#3a2f52', x, 30, 40, 72);
  frame(g, '#5a4a7a', x, 30, 40, 72);
  rect(g, '#ffd23f', x + 26, 64, 4, 4);
  rect(g, '#f8f6ff', x + 4, 38, 32, 9);
  text(g, 'BREAK', x + 8, 40, '#2a1d4a');
  // Puddle with reflections.
  rect(g, '#1f6b73', x - 14, 102, 68, 4);
  hline(g, '#5cd9d9', x - 6 + bob(p, 2, 2), 103, 10);
  hline(g, '#5cd9d9', x + 26 + bob(p, 2.4, 2, 1), 104, 8);
  light(p, x + 20, 104, 24, '#22d3ee', 0.35);
};

const fridge: Prop = (p) => {
  const { g } = p;
  const x = 20 + mid(p);
  const shake = p.motion && Math.sin(p.t * 9) > 0.7 ? 1 : 0;
  rect(g, '#d6dae8', x + shake, 20, 34, 64);
  rect(g, '#b9bfd6', x + shake, 46, 34, 2);
  rect(g, '#8a92b2', x + 28 + shake, 28, 2, 10);
  rect(g, '#8a92b2', x + 28 + shake, 52, 2, 14);
  rect(g, '#ffd23f', x + 6 + shake, 26, 8, 6);
};

const vending: Prop = (p) => {
  const { g } = p;
  const x = 188 + mid(p);
  rect(g, '#2a1d4a', x, 18, 38, 64);
  rect(g, withAlpha('#9ad7ff', 0.25), x + 3, 22, 24, 44);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const col = ['#a3e635', '#ffd23f', '#ff8a3d', '#22d3ee'][(r + c) % 4]!;
      rect(g, col, x + 5 + c * 8, 25 + r * 10, 5, 5);
    }
  }
  rect(g, '#0b0914', x + 29, 30, 7, 12);
  px(g, '#a3e635', x + 31, 32);
  light(p, x + 16, 44, 30, '#22d3ee', 0.4);
};

const kraken: Prop = (p) => {
  const { g } = p;
  const x = 92 + mid(p);
  const ink = '#141826';
  // Fridge cabinet with its door swung open.
  rect(g, ink, x - 1, 13, 58, 88);
  rect(g, '#d6dae8', x, 14, 56, 86);
  rect(g, '#b3b9d0', x + 50, 14, 6, 86);
  rect(g, '#0c1418', x + 5, 20, 44, 76);
  for (let k = 0; k < 3; k++) hline(g, '#243238', x + 5, 44 + k * 18, 44);
  light(p, x + 27, 30, 26, '#e8fff4', 0.35);
  rect(g, ink, x - 17, 14, 16, 86);
  rect(g, '#c9cee2', x - 16, 15, 14, 84);
  rect(g, '#8a92b2', x - 12, 44, 2, 14);
  // Lid tentacles curling out of the fridge.
  const lids = ['#ff5a5f', '#22d3ee', '#a3e635', '#ffd23f', '#ff4fd8', '#f1ebff'];
  const arms = [
    { ox: 8, oy: 52, dir: -1, len: 12, lift: 1.4 },
    { ox: 12, oy: 70, dir: -1, len: 11, lift: 0.4 },
    { ox: 42, oy: 54, dir: 1, len: 12, lift: 1.2 },
    { ox: 40, oy: 74, dir: 1, len: 11, lift: 0.2 },
    { ox: 26, oy: 84, dir: 1, len: 8, lift: -0.3 },
  ];
  arms.forEach((a, ai) => {
    for (let s2 = 0; s2 < a.len; s2++) {
      const wave = p.motion ? Math.sin(p.t * 2.2 + ai + s2 * 0.5) * (s2 * 0.35) : Math.sin(ai + s2 * 0.5) * s2 * 0.35;
      const tx = x + a.ox + a.dir * s2 * 4.2;
      const ty = a.oy - Math.sin((s2 / a.len) * Math.PI) * 10 * a.lift + wave;
      const w = Math.max(3, 7 - Math.floor(s2 / 3));
      rect(g, ink, tx - 1, ty - 1, w + 2, 5);
      rect(g, lids[(ai + s2) % lids.length]!, tx, ty, w, 3);
      hline(g, withAlpha('#ffffff', 0.45), tx, ty, w);
    }
  });
  // Body blob of fused leftovers.
  const by = 30 + bob(p, 1.6, 1);
  rect(g, ink, x + 9, by - 1, 38, 30);
  rect(g, '#6b8f5a', x + 10, by, 36, 28);
  rect(g, '#8fb870', x + 12, by + 2, 30, 4);
  rect(g, '#4a6a3e', x + 10, by + 22, 36, 6);
  for (let i = 0; i < 6; i++) px(g, '#a8d080', x + 14 + i * 5, by + 12 + (i % 2) * 5);
  // Boiled-egg eyes.
  const look = p.motion ? Math.round(Math.sin(p.t * 0.9) * 1.5) : 0;
  for (const ex of [x + 15, x + 31]) {
    rect(g, ink, ex - 1, by + 7, 12, 10);
    rect(g, '#f8f6ff', ex, by + 8, 10, 8);
    rect(g, '#ffd23f', ex + 3 + look, by + 10, 4, 4);
    rect(g, '#ff9f1a', ex + 4 + look, by + 11, 2, 2);
  }
  // PROPERTY OF GREG sticker.
  rect(g, '#f8f6ff', x + 17, by - 5, 22, 7);
  text(g, 'GREG', x + 20, by - 4, '#23283a');
};

const fish: Prop = (p) => {
  const { g } = p;
  const x = 90 + mid(p);
  rect(g, '#0b1d24', x, 26, 60, 44);
  rect(g, withAlpha('#22d3ee', 0.25), x + 2, 30, 56, 38);
  frame(g, '#5a6080', x, 26, 60, 44);
  rect(g, '#3a2f52', x - 4, 70, 68, 6);
  // Gerald.
  const fx = x + 22 + (p.motion ? Math.round(Math.sin(p.t * 0.8) * 10) : 0);
  const fy = 44 + bob(p, 1.5, 2);
  const flip = p.motion ? Math.cos(p.t * 0.8) < 0 : false;
  sprite(g, ['..ooo...', '.oooooo.', 'oowoooooo', '.oooooo.', '..ooo...'], { o: '#ff8a3d', w: '#0b0914' }, fx, fy, flip);
  // Bubbles that spell things.
  for (let i = 0; i < 5; i++) {
    const t = p.motion ? (p.t * 10 + i * 7) % 30 : i * 6;
    px(g, '#dff7ff', fx + 4 + (i % 2), fy - 3 - t);
  }
  light(p, x + 30, 48, 34, '#22d3ee', 0.4);
};

const drain: Prop = (p) => {
  const { g } = p;
  const cx = 120 + mid(p);
  const cy = 104;
  const spin = p.motion ? p.t * 2 : 0;
  for (let r = 26; r > 4; r -= 4) {
    for (let a = 0; a < 16; a++) {
      const ang = spin + a * 0.39 + r * 0.2;
      px(g, r % 8 ? '#3aa7ad' : '#a3e635', cx + Math.cos(ang) * r * 1.6, cy + Math.sin(ang) * r * 0.45);
    }
  }
  const on = p.motion ? Math.floor(p.t * 2) % 2 === 0 : true;
  rect(g, '#1b2030', cx - 16, cy - 4, 32, 8);
  for (let i = 0; i < 6; i++) vline(g, on ? '#a3e635' : '#22d3ee', cx - 14 + i * 5, cy - 3, 6);
  light(p, cx, cy, 40, on ? '#a3e635' : '#22d3ee', 0.7);
};

const raft: Prop = (p) => {
  const { g } = p;
  const x = 80 + mid(p) + (p.motion ? Math.round(Math.sin(p.t * 1.5) * 10) : 0);
  const y = 88 + bob(p, 3, 2);
  rect(g, '#c98a4b', x, y, 70, 8);
  rect(g, '#e8b070', x, y, 70, 2);
  text(g, 'PIZZA', x + 22, y + 3, '#6b2a10');
  for (let i = 0; i < 4; i++) {
    rect(g, '#f5c9a0', x + 10 + i * 14, y - 12, 7, 7);
    rect(g, ['#a3e635', '#ff4fd8', '#22d3ee', '#ffd23f'][i]!, x + 9 + i * 14, y - 5, 9, 5);
  }
};

const pipe: Prop = (p) => {
  const { g } = p;
  for (let r = 0; r < 6; r++) {
    const s = 60 - r * 10;
    frame(g, r % 2 ? '#1f5c4a' : '#a3e635', 120 - s * 1.6, 60 - s * 0.8, s * 3.2, s * 1.6);
  }
  light(p, 120, 60, 40, '#a3e635', 0.6);
};

const ferry: Prop = (p) => {
  const { g } = p;
  const x = 120 + mid(p) + (p.motion ? Math.round(Math.sin(p.t * 0.6) * 12) : 0);
  const y = 78 + bob(p, 2, 1);
  rect(g, '#2a1d33', x - 30, y, 70, 6);
  rect(g, '#3b2a47', x - 34, y - 2, 78, 3);
  // Hooded figure in email robes.
  rect(g, '#e9e5ff', x, y - 26, 12, 26);
  for (let i = 0; i < 6; i++) hline(g, '#9d95c4', x + 1, y - 22 + i * 4, 10);
  rect(g, '#0b0914', x + 3, y - 30, 7, 6);
  px(g, '#a3e635', x + 5, y - 28);
  px(g, '#a3e635', x + 7, y - 28);
  vline(g, '#8b5a2b', x + 16, y - 36, 38);
  rect(g, '#ffd23f', x + 14, y - 40, 5, 5);
  light(p, x + 16, y - 38, 24, '#ffd23f', 0.7);
};

const mail: Prop = (p) => {
  for (let i = 0; i < (p.fx === 'off' ? 5 : 14); i++) {
    const t = p.motion ? p.t * (1 + (i % 4) * 0.3) : i;
    const x = ((hash(i, 8) * W + t * 30) % (W + 20)) - 10;
    const y = 10 + ((hash(i, 9) * 70 + Math.sin(t + i) * 6) % 70);
    rect(p.g, '#f8f6ff', x, y, 7, 5);
    px(p.g, '#8f88b3', x + 3, y + 2);
    hline(p.g, '#8f88b3', x + 1, y + 1, 5);
  }
};

const bridge: Prop = (p) => {
  const { g } = p;
  const m = mid(p);
  for (let i = 0; i < 16; i++) {
    const x = 10 + i * 14 + m;
    const sag = Math.sin((i / 15) * Math.PI) * 10;
    const y = 72 + sag + bob(p, 2, 1, i);
    rect(g, i % 5 === 3 ? '#ff5a5f' : '#2a3a2a', x, y, 12, 3);
    hline(g, i % 5 === 3 ? '#ff9a9d' : '#a3e635', x + 1, y + 1, 4 + (i * 3) % 7);
  }
  hline(g, '#6b5a80', 0, 60 + m * 0, W);
  text(g, '// FIX THIS LATER', 72 + m, 52, '#8f88b3');
};

const arch: Prop = (p) => {
  const { g } = p;
  const x = 120 + mid(p);
  const word = 'DASCADE';
  const w = textWidth(word);
  rect(g, '#1b0a2a', x - 44, 24, 88, 4);
  vline(g, '#ff4fd8', x - 44, 24, 76);
  vline(g, '#22d3ee', x + 43, 24, 76);
  text(g, word, x - w / 2, 16, '#ff4fd8');
  sprite(g, ['k.k', 'kkk', '.k.'], { k: '#ff8a3d' }, x - w / 2 + 12, 22);
  light(p, x, 18, 40, '#ff4fd8', 0.5);
};

function cabinet(p: Paint, screen: string, label: string): void {
  const { g } = p;
  const x = 98 + mid(p);
  rect(g, '#26173f', x, 20, 44, 88);
  rect(g, '#34205a', x - 2, 16, 48, 12);
  text(g, label, x + 22 - textWidth(label) / 2, 19, '#ffd23f');
  rect(g, '#0b0714', x + 4, 32, 36, 28);
  rect(g, withAlpha(screen, 0.35), x + 5, 33, 34, 26);
  const t = p.motion ? p.t : 1;
  if (label === 'TURBO') {
    for (let i = 0; i < 6; i++) hline(g, screen, x + 6, 36 + ((i * 5 + t * 20) % 22), 4 + i * 2);
    rect(g, '#f8f6ff', x + 20, 52, 4, 4);
  } else if (label === 'QUIZ') {
    text(g, 'Q?', x + 16, 38, screen);
    for (let i = 0; i < 3; i++) rect(g, i === Math.floor(t * 2) % 3 ? screen : '#2a1d4a', x + 8 + i * 10, 48, 8, 5);
  } else {
    for (let i = 0; i < 4; i++) text(g, ['<', '>', '+', '-'][i]!, x + 8 + i * 8, 34 + ((i * 7 + t * 18) % 20), screen);
  }
  light(p, x + 22, 46, 30, screen, 0.55);
  rect(g, '#1d1233', x + 2, 62, 40, 10);
  rect(g, '#ff5a5f', x + 10, 64, 4, 4);
  rect(g, '#22d3ee', x + 28, 64, 4, 4);
  rect(g, '#0b0714', x + 18, 72, 8, 3);
  text(g, 'INSERT COIN', x + 1, 100 + 0, p.motion && Math.sin(p.t * 5) > 0 ? '#a3e635' : '#26173f');
}

const prizes: Prop = (p) => {
  const { g } = p;
  const x = 70 + mid(p);
  rect(g, '#3b2a55', x, 70, 100, 30);
  rect(g, withAlpha('#9ad7ff', 0.15), x + 4, 30, 92, 40);
  frame(g, '#8f88b3', x + 4, 30, 92, 40);
  // Prizes on shelves.
  rect(g, '#ffd23f', x + 10, 58, 10, 10);
  rect(g, '#ff5a5f', x + 26, 60, 12, 8);
  rect(g, '#f8f6ff', x + 44, 58, 10, 10);
  // Golden token on a velvet pillow.
  rect(g, '#7a1f4a', x + 62, 44, 24, 6);
  const shine = p.motion ? 0.6 + Math.sin(p.t * 3) * 0.3 : 0.8;
  rect(g, '#ffd23f', x + 69, 36, 10, 10);
  rect(g, '#fff2b0', x + 71, 38, 3, 3);
  light(p, x + 74, 41, 22, '#ffd23f', shine);
  // Claw arm.
  vline(g, '#8f88b3', x + 40, 30, 10 + bob(p, 1.5, 3));
};

const crate: Prop = (p) => {
  const { g } = p;
  const x = 124 + mid(p);
  rect(g, '#8b5a2b', x, 72, 52, 32);
  for (let i = 0; i < 4; i++) hline(g, '#6b4220', x, 76 + i * 8, 52);
  text(g, 'PROTOTYPE-0', x + 4, 84, '#1a0f05');
  // Scratch marks leading off to a glowing hole.
  for (let i = 0; i < 6; i++) hline(g, '#3a3f58', x - 10 - i * 12, 104 + (i % 2), 8);
  rect(g, '#0b0714', 8, 70, 30, 34);
  light(p, 22, 86, 34, '#a3e635', 0.8);
  glitch(p, 0.3);
};

const chasm: Prop = (p) => {
  const { g } = p;
  rect(g, '#05030a', 0, 0, 20, H);
  rect(g, '#05030a', W - 20, 0, 20, H);
  for (let i = 0; i < 8; i++) {
    const y = 20 + i * 12;
    rect(g, '#2a1d4a', 100 + (i % 2 ? 10 : -10) + mid(p), y, 30, 3);
    rect(g, '#a3e635', 100 + (i % 2 ? 10 : -10) + mid(p), y, 30, 1);
  }
};

const prototype: Prop = (p) => {
  const { g } = p;
  const x = 72 + mid(p);
  const y = 8 + bob(p, 1.2, 2);
  const ink = '#07040d';
  const frame6 = p.motion ? Math.floor(p.t * 6) : 1;
  // Colossal cabinet silhouette with neon trim.
  rect(g, ink, x - 2, y - 2, 100, 120);
  rect(g, '#1b1030', x, y, 96, 116);
  rect(g, '#241540', x + 4, y + 14, 88, 100);
  vline(g, '#a3e635', x + 1, y + 12, 100);
  vline(g, '#ff4fd8', x + 94, y + 12, 100);
  // Marquee.
  rect(g, '#2b1a4a', x - 4, y - 4, 104, 16);
  rect(g, ink, x - 4, y + 11, 104, 1);
  const titles = ['PROTOTYPE-0', 'PLAYER 2?', '???', 'INSERT COIN'];
  const title = titles[p.motion ? Math.floor(p.t * 0.8) % titles.length : 0]!;
  text(g, title, x + 48 - textWidth(title) / 2, y + 1, '#a3e635');
  light(p, x + 48, y + 3, 26, '#a3e635', 0.35);
  // Storm screen with a bezel.
  rect(g, ink, x + 10, y + 18, 76, 54);
  rect(g, '#050208', x + 12, y + 20, 72, 50);
  for (let i = 0; i < 120; i++) {
    const sx = x + 13 + hash(i, frame6) * 70;
    const sy = y + 21 + hash(i, 3, frame6) * 48;
    px(g, ['#a3e635', '#22d3ee', '#ff4fd8', '#ffd23f', '#f8f6ff'][i % 5]!, sx, sy);
  }
  for (let k = 0; k < 3; k++) {
    const gy = y + 24 + ((frame6 * 7 + k * 17) % 44);
    hline(g, withAlpha('#a3e635', 0.7), x + 12, gy, 72);
  }
  light(p, x + 48, y + 45, 40, '#22d3ee', 0.3);
  // Control deck: star slot, rusty USB port, buttons.
  rect(g, ink, x + 4, y + 76, 88, 18);
  rect(g, '#2b1a4a', x + 5, y + 77, 86, 16);
  rect(g, '#ffd23f', x + 43, y + 80, 10, 10);
  px(g, '#1b1030', x + 48, y + 82);
  px(g, '#1b1030', x + 47, y + 84);
  px(g, '#1b1030', x + 49, y + 84);
  light(p, x + 48, y + 85, 12, '#ffd23f', 0.5);
  rect(g, '#6b4220', x + 64, y + 83, 9, 4);
  rect(g, '#0b0714', x + 66, y + 84, 5, 2);
  for (let b = 0; b < 3; b++) rect(g, ['#ff5a5f', '#22d3ee', '#a3e635'][b]!, x + 14 + b * 8, y + 82, 5, 5);
  // Joystick "flowers" blooming from its sides.
  for (let j = 0; j < 4; j++) {
    const jx = j < 2 ? x - 16 - j * 10 : x + 104 + (j - 2) * 10;
    const jy = y + 58 + (j % 2) * 22 + bob(p, 2, 2, j);
    vline(g, '#8f88b3', jx + 2, jy, 12);
    rect(g, ink, jx - 1, jy - 5, 7, 6);
    rect(g, ['#ff5a5f', '#22d3ee', '#a3e635', '#ff4fd8'][j]!, jx, jy - 4, 5, 4);
  }
  glitch(p, 0.6);
};

const popups: Prop = (p) => {
  const n = p.fx === 'off' ? 5 : 12;
  for (let i = 0; i < n; i++) {
    const t = p.motion ? p.t : 0;
    const x = 20 + hash(i, 31) * 180 + Math.sin(t * 1.3 + i) * 6 + mid(p);
    const y = 12 + hash(i, 32) * 80 + Math.cos(t * 1.1 + i) * 4;
    rect(p.g, '#e9e5ff', x, y, 30, 18);
    rect(p.g, '#4f7cf0', x, y, 30, 4);
    rect(p.g, '#ff5a5f', x + 25 + Math.round(Math.sin(t * 5 + i) * 2), y + 1, 3, 2);
    hline(p.g, '#8f88b3', x + 3, y + 8, 18);
    hline(p.g, '#8f88b3', x + 3, y + 12, 12);
  }
};

const joysticks: Prop = (p) => {
  for (let j = 0; j < 5; j++) {
    const x = 20 + j * 48 + mid(p);
    const y = 100 + bob(p, 2, 3, j);
    vline(p.g, '#8f88b3', x + 3, y - 14, 14);
    rect(p.g, ['#ff5a5f', '#22d3ee', '#a3e635', '#ff4fd8', '#ffd23f'][j]!, x, y - 20, 8, 7);
    rect(p.g, '#2b1a4a', x - 4, y, 16, 5);
  }
};

const healthbar: Prop = (p) => {
  const { g } = p;
  rect(g, '#0b0714', 40, 4, 160, 8);
  frame(g, '#f8f6ff', 40, 4, 160, 8);
  const hp = p.motion ? 0.45 + Math.sin(p.t * 0.7) * 0.05 : 0.5;
  rect(g, '#ff5a5f', 42, 6, Math.round(156 * hp), 4);
  text(g, 'PROTOTYPE-0', 44, 14, '#f8f6ff');
};

const cable: Prop = (p) => {
  const { g } = p;
  const pulse = p.motion ? (p.t * 30) % 120 : 40;
  for (let y = 0; y < H; y++) {
    const x = 120 + Math.sin(y * 0.05) * 16 + mid(p);
    rect(g, '#1a1033', x - 8, y, 16, 1);
    if (Math.abs(y - pulse) < 6 || Math.abs(y - pulse + 60) < 6) rect(g, '#a3e635', x - 3, y, 6, 1);
  }
  light(p, 120 + mid(p), pulse, 30, '#a3e635', 0.7);
};

const desk: Prop = () => undefined;

export const PROPS: Record<string, Prop> = {
  printer,
  paper,
  map,
  coffee,
  keypad,
  mannequin,
  rack,
  'elevator-panel': elevatorPanel,
  'elevator-open': elevatorOpen,
  shaft,
  guard,
  poster,
  intern,
  usb,
  projector,
  ghosts,
  manager,
  closet,
  'door-wet': doorWet,
  fridge,
  vending,
  kraken,
  fish,
  drain,
  raft,
  pipe,
  ferry,
  mail,
  bridge,
  arch,
  'cabinet-race': (p) => cabinet(p, '#22d3ee', 'TURBO'),
  'cabinet-quiz': (p) => cabinet(p, '#ffd23f', 'QUIZ'),
  'cabinet-dance': (p) => cabinet(p, '#ff4fd8', 'DANCE'),
  prizes,
  crate,
  chasm,
  prototype,
  popups,
  joysticks,
  healthbar,
  cable,
  desk,
  'monitor-msg': desk,
  stairs: desk,
  cubicles: desk,
  river: (p) => particles(p, 10, '#dff7c0', { rise: 0, drift: 12, area: [0, 70, W, 30] }),
  cabinets: desk,
};
