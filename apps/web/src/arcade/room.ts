/**
 * The DASCADE room: a procedural pixel-art arcade interior rendered to a
 * low-resolution canvas and scaled up crisply (image-rendering: pixelated).
 *
 * - `layout()` rebuilds the static layer (ceiling, dithered wall, perspective
 *   cosmic carpet, posters, props) once per resize.
 * - `frame(t)` blits the static layer and draws only the living details: the
 *   flickering neon sign, humming tubes, EXIT sign, prize-counter chaser bulbs,
 *   the claw machine and drifting dust motes.
 */
import { bayer, clamp, drawText, drawTextC, frame as outline, hash, hash2, line, rect, sprite, textWidth } from './pixel.ts';

export interface RoomHints {
  /** Viewport-relative CSS px. */
  headerBottom: number;
  rowTop: number;
  rowBottom: number;
  rowLeft: number;
  rowRight: number;
  /** The floor's jukebox stands at the left end of the row: no change machine there. */
  jukebox?: boolean;
  /** Paint the room's own pixel claw machine at the right end (default true; off while the floor's
   *  interactive claw machine stands there, and on floors whose right end is too narrow). */
  claw?: boolean;
}

export interface RoomGeometry {
  W: number;
  H: number;
  /** CSS px per logical pixel. */
  scale: number;
  floorY: number;
  sign: { x: number; y: number; w: number; h: number } | null;
  fixtures: number[];
  ceilY: number;
}

type FxLevel = 'high' | 'low' | 'off';

interface SignLayout {
  u: number;
  th: number;
  x: number;
  y: number;
  lw: number;
  gap: number;
  board: { x: number; y: number; w: number; h: number };
  sub: boolean;
}

interface Prop {
  kind: 'exit' | 'prizes' | 'claw' | 'change';
  x: number;
  y: number;
  w: number;
  h: number;
}

// Letter strokes on a 4×6 grid.
export const NEON_LETTERS: Record<string, Array<Array<[number, number]>>> = {
  D: [
    [
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 5],
      [3, 6],
      [0, 6],
      [0, 0],
    ],
  ],
  A: [
    [
      [0, 6],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 6],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ],
  S: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 3],
      [3, 3],
      [4, 4],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
    ],
  ],
  C: [
    [
      [4, 1],
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
    ],
  ],
  E: [
    [
      [4, 0],
      [0, 0],
      [0, 6],
      [4, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ],
};
const WORD = 'DASCADE';

const PLUSH = ['.a..a.', 'aaaaaa', 'awaawa', 'aaaaaa', '.aaaa.'];
const PLUSH_COLORS = ['#ff4fd8', '#22d3ee', '#ffd23f', '#2de38f', '#a78bfa', '#ff8a3d'];

export class RoomRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly signLit: HTMLCanvasElement;
  private readonly signDim: HTMLCanvasElement;
  private readonly strip: HTMLCanvasElement;
  private geo: RoomGeometry | null = null;
  private signL: SignLayout | null = null;
  private props: Prop[] = [];
  private railY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.base = document.createElement('canvas');
    this.signLit = document.createElement('canvas');
    this.signDim = document.createElement('canvas');
    this.strip = document.createElement('canvas');
  }

  /** Recomputes geometry and repaints the static layer. */
  layout(vw: number, vh: number, dpr: number, hints: RoomHints): RoomGeometry {
    const k = Math.max(Math.round(2 * dpr), Math.round((Math.min(vw, (vh * 16) / 9) * dpr) / 480));
    const scale = k / dpr;
    const W = Math.ceil(vw / scale);
    const H = Math.ceil(vh / scale);
    const L = (v: number) => v / scale;
    const ceilY = Math.round(clamp(L(hints.headerBottom) * 0.7, 3, H * 0.1));
    const rowTop = L(hints.rowTop);
    const rowBottom = L(hints.rowBottom);
    const floorY = Math.round(clamp(rowBottom - (rowBottom - rowTop) * 0.2, H * 0.4, H * 0.93));
    this.railY = Math.round(floorY - (floorY - ceilY) * 0.3);
    const fixtures: number[] = [];
    const nFix = W > 300 ? 5 : 3;
    for (let i = 0; i < nFix; i++) fixtures.push(Math.round(W * ((i + 0.5) / nFix)));

    const sign = this.layoutSign(W, L(hints.headerBottom) + 3, rowTop - 5);
    this.signL = sign;
    this.props = this.layoutProps(
      W,
      H,
      sign,
      L(hints.headerBottom) + 3,
      rowTop - 5,
      floorY,
      L(hints.rowLeft),
      L(hints.rowRight),
      rowTop,
      !hints.jukebox,
      hints.claw !== false,
    );

    for (const c of [this.canvas, this.base]) {
      c.width = W;
      c.height = H;
    }
    this.canvas.style.width = `${W * scale}px`;
    this.canvas.style.height = `${H * scale}px`;

    this.geo = {
      W,
      H,
      scale,
      floorY,
      ceilY,
      fixtures,
      sign: sign ? { ...sign.board } : null,
    };
    this.paintStatic();
    return this.geo;
  }

  // -------------------------------------------------------------------------
  private layoutSign(W: number, top: number, bottom: number): SignLayout | null {
    const zone = bottom - top;
    if (zone < 16) return null;
    const availW = Math.min(W * 0.56, W - 24);
    const maxLetter = Math.max(14, Math.min(zone * 0.56, 30));
    for (let u = 6; u >= 2; u--) {
      const th = u >= 7 ? 3 : 2;
      const lw = 4 * u + th;
      const gap = Math.max(3, Math.round(u * 1.2));
      const totalW = lw * WORD.length + gap * (WORD.length - 1);
      const lh = 6 * u + th;
      const pad = Math.max(4, Math.round(u * 1.1));
      const sub = u >= 3 && zone >= lh + pad * 2 + 10 && totalW + pad * 2 >= textWidth('DELTA ALPHA SIERRA ARCADE') + 8;
      const boardH = lh + pad * 2 + (sub ? 9 : 0);
      if (totalW + pad * 2 > availW || boardH > zone - 2 || lh > maxLetter) continue;
      const bx = Math.round((W - totalW) / 2) - pad;
      const by = Math.round(top + (zone - boardH) / 2);
      return { u, th, lw, gap, x: bx + pad, y: by + pad, sub, board: { x: bx, y: by, w: totalW + pad * 2, h: boardH } };
    }
    return null;
  }

  private layoutProps(
    W: number,
    H: number,
    sign: SignLayout | null,
    top: number,
    bottom: number,
    floorY: number,
    rowLeft: number,
    rowRight: number,
    rowTop: number,
    changeMachine: boolean,
    clawMachine: boolean,
  ): Prop[] {
    const props: Prop[] = [];
    const zone = bottom - top;
    const leftLimit = sign ? sign.board.x - 6 : W * 0.35;
    const rightStart = sign ? sign.board.x + sign.board.w + 6 : W * 0.65;
    if (zone >= 12 && leftLimit >= 30) props.push({ kind: 'exit', x: 6, y: Math.round(top + 2), w: 25, h: 9 });
    if (zone >= 24 && W - rightStart >= 34)
      props.push({ kind: 'prizes', x: W - 34, y: Math.round(top + 2), w: 29, h: Math.min(zone - 4, 30) });
    const sideL = rowLeft - 3;
    const sideR = W - rowRight - 3;
    const machineH = Math.round(clamp((floorY - rowTop) * 0.95, 24, 90));
    const baseY = Math.round(floorY + Math.min(10, (H - floorY) * 0.2));
    if (clawMachine && sideR >= 16) {
      const w = Math.round(clamp(sideR - 2, 16, 34));
      props.push({ kind: 'claw', x: W - w - 2, y: baseY - machineH, w, h: machineH });
    }
    if (changeMachine && sideL >= 14) {
      const w = Math.round(clamp(sideL - 3, 13, 22));
      const h = Math.round(machineH * 0.82);
      props.push({ kind: 'change', x: 2, y: baseY - h, w, h });
    }
    return props;
  }

  // -------------------------------------------------------------------------
  private paintStatic(): void {
    const geo = this.geo!;
    const { W, H, floorY, ceilY } = geo;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const sign = this.signL;
    const scx = sign ? sign.board.x + sign.board.w / 2 : W / 2;
    const scy = sign ? sign.board.y + sign.board.h / 2 : H * 0.2;
    const sr = sign ? Math.max(sign.board.w, 40) : W * 0.4;
    const railY = this.railY;
    // perspective floor
    const hz = Math.max(6, (H - floorY) * 0.42);
    const yv = floorY - hz;
    const D = H - yv;
    const T = 26;
    const carpet: Array<[number, number, number]> = [
      [214, 58, 176],
      [30, 180, 204],
      [214, 176, 52],
      [128, 98, 226],
      [36, 178, 116],
      [214, 110, 50],
    ];
    const q = (v: number, x: number, y: number) => {
      const step = 10;
      return clamp(Math.floor(v / step + bayer(x, y)) * step, 0, 255);
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r: number;
        let g: number;
        let b: number;
        if (y < ceilY) {
          const tile = x % 20 === 0 || y % 6 === 0;
          r = tile ? 16 : 9;
          g = tile ? 12 : 6;
          b = tile ? 30 : 16;
        } else if (y < floorY) {
          const ty = (y - ceilY) / Math.max(1, floorY - ceilY);
          r = 13 + ty * 14;
          g = 9 + ty * 8;
          b = 30 + ty * 26;
          if (y < railY) {
            if ((x + y) % 8 === 0 && (x - y + 800) % 8 === 0) {
              r += 10;
              g += 6;
              b += 18;
            }
          } else {
            const px = x % 24;
            if (px === 0) {
              r -= 6;
              g -= 5;
              b -= 10;
            } else if (px === 1) {
              r += 6;
              g += 4;
              b += 12;
            }
          }
          // neon spill from the sign
          const dx = (x - scx) / (sr * 0.95);
          const dy = (y - scy) / (sr * 0.5);
          const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
          r += glow * glow * 90;
          g += glow * glow * 26;
          b += glow * glow * 110;
          // cyan kick from the baseboard strip
          const kick = Math.max(0, 1 - (floorY - y) / 14);
          g += kick * kick * 30;
          b += kick * kick * 36;
        } else {
          const z = D / Math.max(0.5, y - yv);
          const X = (x - W / 2) * z;
          const Z = D * z;
          const ix = Math.floor(X / T);
          const iz = Math.floor(Z / T);
          const lx = X - ix * T;
          const lz = Z - iz * T;
          const hsh = hash2(ix, iz);
          const motif = Math.floor(hsh * 8);
          const col = carpet[Math.floor(hash2(iz + 3, ix - 5) * carpet.length)]!;
          const cx = T / 2 + (hash2(ix + 9, iz) - 0.5) * 6;
          const cz = T / 2 + (hash2(ix, iz + 9) - 0.5) * 6;
          const ddx = lx - cx;
          const ddz = lz - cz;
          const dist = Math.sqrt(ddx * ddx + ddz * ddz);
          const w = 0.9 + z * 0.35;
          let on: boolean;
          switch (motif) {
            case 0:
              on = Math.abs(dist - 5.5) < w;
              break;
            case 1:
              on = dist < 2.6 || Math.abs(Math.sqrt(ddx * ddx * 0.35 + ddz * ddz * 4) - 5) < w * 0.8;
              break;
            case 2:
              on = lx > 3 && lx < T - 3 && Math.abs(lz - (T / 2 + 3 * Math.sin(lx * 0.6 + hsh * 20))) < w;
              break;
            case 3: {
              const ax = Math.abs(ddx);
              const az = Math.abs(ddz);
              on = (ax < w * 0.8 && az < 5) || (az < w * 0.8 && ax < 5) || ax + az < 2.4;
              break;
            }
            case 4:
              on = Math.abs(Math.abs(ddx) + Math.abs(ddz) * 1.4 - 5) < w && ddz > -3;
              break;
            case 5:
              on = hash2(Math.floor(X / 4), Math.floor(Z / 4)) > 0.9;
              break;
            default:
              on = false;
          }
          const depth = (y - floorY) / Math.max(1, H - floorY);
          const shade = 0.16 + depth * depth * 0.5 + depth * 0.34;
          if (on) {
            r = col[0] * shade * 0.8;
            g = col[1] * shade * 0.8;
            b = col[2] * shade * 0.8;
          } else {
            const speck = hash2(Math.floor(X), Math.floor(Z)) > 0.9 ? 8 : 0;
            r = (10 + speck) * (0.6 + depth * 0.5);
            g = (7 + speck) * (0.6 + depth * 0.5);
            b = (22 + speck * 2) * (0.6 + depth * 0.5);
          }
          // neon reflection pooling on the floor below the sign
          const fdx = (x - scx) / (W * 0.45);
          const fdy = (y - floorY) / Math.max(1, H - floorY);
          const pool = Math.max(0, 1 - Math.sqrt(fdx * fdx + fdy * fdy * 1.6));
          r += pool * pool * 44;
          g += pool * pool * 10;
          b += pool * pool * 52;
          // baseboard light bleed
          const bleed = Math.max(0, 1 - (y - floorY) / 10);
          g += bleed * bleed * 34;
          b += bleed * bleed * 40;
        }
        // ceiling light cones (dithered)
        if (y >= ceilY) {
          for (const fx of geo.fixtures) {
            const spread = (y - ceilY) * 0.34 + 2;
            const ax = Math.abs(x - fx);
            if (ax < spread) {
              const fall = (1 - ax / spread) * Math.max(0, 1 - (y - ceilY) / (H * 0.8));
              if (bayer(x, y) < fall * 0.55) {
                r += 18;
                g += 14;
                b += 28;
              }
            }
          }
        }
        const i = (y * W + x) * 4;
        d[i] = q(r, x, y);
        d[i + 1] = q(g, x, y);
        d[i + 2] = q(b, x, y);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // chair rail + baseboard
    rect(ctx, 0, this.railY - 1, W, 1, '#2a2150');
    rect(ctx, 0, this.railY + 2, W, 1, '#0a0716');
    rect(ctx, 0, floorY - 3, W, 3, '#06040c');
    // sign board (letters are animated)
    if (sign) this.paintSignBoard(ctx, sign);
    this.paintPosters(ctx);
    for (const p of this.props) this.paintPropStatic(ctx, p);
    this.prerenderSign();
    // neon strip colors (one row, reused every frame)
    this.strip.width = W;
    this.strip.height = 1;
    const sc = this.strip.getContext('2d')!;
    for (let x = 0; x < W; x++) {
      const k = x / W;
      rect(sc, x, 0, 1, 1, k < 0.5 ? lerpHex('#ff4fd8', '#a78bfa', k * 2) : lerpHex('#a78bfa', '#22d3ee', (k - 0.5) * 2));
    }
  }

  private paintSignBoard(ctx: CanvasRenderingContext2D, s: SignLayout): void {
    const b = s.board;
    // hanging wires
    rect(ctx, b.x + 8, 0, 1, b.y, '#1a1530');
    rect(ctx, b.x + b.w - 9, 0, 1, b.y, '#1a1530');
    rect(ctx, b.x + 2, b.y + 2, b.w, b.h, '#05030a');
    rect(ctx, b.x, b.y, b.w, b.h, '#0c0918');
    outline(ctx, b.x, b.y, b.w, b.h, '#1f1838');
    if (s.sub) drawTextC(ctx, 'DELTA ALPHA SIERRA ARCADE', b.x + b.w / 2, b.y + b.h - 8, '#1d6f86');
  }

  private prerenderSign(): void {
    const s = this.signL;
    if (!s) return;
    const b = s.board;
    for (const [cv, lit] of [
      [this.signLit, true],
      [this.signDim, false],
    ] as const) {
      cv.width = b.w;
      cv.height = b.h;
      const c = cv.getContext('2d')!;
      c.clearRect(0, 0, b.w, b.h);
      // frame tube
      const tube = lit ? '#22d3ee' : '#0f4a58';
      outline(c, 1, 1, b.w - 2, b.h - 2, tube);
      if (lit) {
        rect(c, 2, 1, b.w - 4, 1, '#bff6ff');
        rect(c, 2, b.h - 2, b.w - 4, 1, '#7fe9fb');
      }
      if (s.sub && lit) drawTextC(c, 'DELTA ALPHA SIERRA ARCADE', b.w / 2, b.h - 8, '#7fe9fb');
      for (let i = 0; i < WORD.length; i++) this.drawNeonLetter(c, WORD[i]!, s.x - b.x + i * (s.lw + s.gap), s.y - b.y, s, lit);
    }
  }

  private drawNeonLetter(c: CanvasRenderingContext2D, ch: string, x: number, y: number, s: SignLayout, lit: boolean): void {
    const strokes = NEON_LETTERS[ch];
    if (!strokes) return;
    const off = Math.floor(s.th / 2);
    for (const pass of [0, 1, 2] as const) {
      if (!lit && pass !== 1) continue;
      const color = pass === 0 ? 'rgba(255,79,216,0.35)' : pass === 1 ? (lit ? '#ff4fd8' : '#4a1a44') : '#ffe1f7';
      const size = pass === 0 ? s.th + 2 : pass === 1 ? s.th : 1;
      for (const st of strokes)
        for (let i = 1; i < st.length; i++) {
          const a = st[i - 1]!;
          const bb = st[i]!;
          line(c, x + off + a[0] * s.u, y + off + a[1] * s.u, x + off + bb[0] * s.u, y + off + bb[1] * s.u, color, size);
        }
    }
  }

  private paintPosters(ctx: CanvasRenderingContext2D): void {
    const s = this.signL;
    if (!s) return;
    const b = s.board;
    const zoneTop = b.y - 2;
    const pw = clamp(Math.round(b.h * 0.62), 14, 30);
    const ph = Math.min(Math.round(pw * 1.34), b.h + 6);
    const py = Math.round(b.y + (b.h - ph) / 2);
    const leftEdge = this.props.some((p) => p.kind === 'exit') ? 36 : 6;
    const rightEdge = this.geo!.W - (this.props.some((p) => p.kind === 'prizes') ? 40 : 6);
    let slot = 0;
    for (let x = b.x - 10 - pw; x >= leftEdge && slot < 2; x -= pw + 10) this.paintPoster(ctx, x, Math.max(zoneTop, py), pw, ph, slot++);
    slot = 2;
    for (let x = b.x + b.w + 10; x + pw <= rightEdge && slot < 4; x += pw + 10)
      this.paintPoster(ctx, x, Math.max(zoneTop, py), pw, ph, slot++);
  }

  private paintPoster(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: number): void {
    rect(ctx, x + 2, y + 2, w, h, '#05030a');
    rect(ctx, x - 1, y - 1, w + 2, h + 2, '#2c2350');
    const cx = x + w / 2;
    switch (kind % 4) {
      case 0: {
        rect(ctx, x, y, w, h, '#150a3a');
        for (let i = 0; i < 6; i++) rect(ctx, x + hash(i) * w, y + hash(i + 9) * h, 1, 1, '#8f88ff');
        disc(ctx, cx, y + h * 0.48, w * 0.24, '#a78bfa');
        disc(ctx, cx - w * 0.06, y + h * 0.44, w * 0.1, '#c9b8ff');
        line(ctx, x + w * 0.14, y + h * 0.58, x + w * 0.86, y + h * 0.4, '#ffd23f');
        if (w >= 18) drawTextC(ctx, 'GO', cx, y + h - 7, '#ffd23f');
        break;
      }
      case 1: {
        rect(ctx, x, y, w, h, '#3a0c3a');
        rect(ctx, x, y, w, 7, '#ff4fd8');
        drawTextC(ctx, 'HI', cx, y + 1, '#3a0c3a');
        sprite(ctx, ['y.yyy.y', 'yyyyyyy', '.yyyyy.', '..yyy..', '...y...', '..yyy..'], cx - 3.5, y + h * 0.36, { y: '#ffd23f' });
        if (w >= 18) drawTextC(ctx, '999', cx, y + h - 7, '#ffd23f');
        break;
      }
      case 2: {
        rect(ctx, x, y, w, h, '#062a36');
        for (let yy = y + 2; yy < y + h; yy += 4) rect(ctx, x, yy, w, 1, '#0a3c4c');
        sprite(ctx, ['...w...', '..www..', '..wcw..', '..www..', '.wwwww.', 'ww.w.ww', '...o...', '..ooo..'], cx - 3.5, y + h * 0.26, {
          w: '#e6fbff',
          c: '#22d3ee',
          o: '#ff8a3d',
        });
        if (w >= 18) drawTextC(ctx, 'UP', cx, y + h - 7, '#22d3ee');
        break;
      }
      default: {
        rect(ctx, x, y, w, h, '#2a1405');
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          line(ctx, cx, y + h * 0.45, cx + Math.cos(a) * w, y + h * 0.45 + Math.sin(a) * w, i % 2 ? '#5a2c0a' : '#3d1d06');
        }
        ctx.restore();
        disc(ctx, cx, y + h * 0.45, w * 0.18, '#ffb020');
        if (w >= 18) drawTextC(ctx, 'WIN', cx, y + h - 7, '#ffb020');
        outline(ctx, x, y, w, h, '#2c2350');
      }
    }
    outline(ctx, x - 1, y - 1, w + 2, h + 2, '#3a2f66');
  }

  private paintPropStatic(ctx: CanvasRenderingContext2D, p: Prop): void {
    switch (p.kind) {
      case 'exit':
        rect(ctx, p.x - 1, p.y - 1, p.w + 2, p.h + 2, '#0a2a16');
        rect(ctx, p.x, p.y, p.w, p.h, '#04180c');
        break;
      case 'prizes': {
        rect(ctx, p.x, p.y, p.w, 11, '#1a0c2a');
        const shelfY = p.y + 20;
        if (p.h >= 26) {
          rect(ctx, p.x - 2, shelfY, p.w + 4, 2, '#5a3a14');
          rect(ctx, p.x - 2, shelfY + 2, p.w + 4, 1, '#2a1a08');
          for (let i = 0; i < 4; i++) sprite(ctx, PLUSH, p.x + 1 + i * 7, shelfY - 5, { a: PLUSH_COLORS[i]!, w: '#ffffff' });
        }
        break;
      }
      case 'claw': {
        const { x, y, w, h } = p;
        const cabH = Math.round(h * 0.38);
        const glassY = y + 7;
        const glassH = h - cabH - 7;
        rect(ctx, x + 2, y + h, w, 2, '#030206');
        rect(ctx, x, y, w, 7, '#3a0c3a');
        rect(ctx, x + 1, y + 1, w - 2, 5, '#ff4fd8');
        if (w >= 19) drawTextC(ctx, 'CLAW', x + w / 2, y + 1, '#3a0c3a');
        rect(ctx, x, glassY, w, glassH, '#0b1030');
        outline(ctx, x, glassY, w, glassH, '#31407a');
        rect(ctx, x + 2, glassY + 1, 1, glassH - 2, '#1f2b5c');
        for (let i = 0; i < Math.floor(w / 5); i++)
          sprite(ctx, PLUSH, x + 1 + i * 5 - (i % 2), glassY + glassH - 5 - (i % 2) * 2, {
            a: PLUSH_COLORS[(i + 2) % PLUSH_COLORS.length]!,
            w: '#ffffff',
          });
        rect(ctx, x, glassY + glassH, w, cabH, '#1b1433');
        rect(ctx, x, glassY + glassH, w, 1, '#3a2f66');
        rect(ctx, x + w / 2 - 3, glassY + glassH + cabH * 0.3, 6, 3, '#07050d');
        rect(ctx, x + w / 2 - 1, glassY + glassH + cabH * 0.3 + 4, 2, 1, '#ffd23f');
        break;
      }
      case 'change': {
        const { x, y, w, h } = p;
        rect(ctx, x + 2, y + h, w, 2, '#030206');
        rect(ctx, x, y, w, h, '#1c1a2e');
        rect(ctx, x, y, 1, h, '#2e2a4a');
        rect(ctx, x + 1, y + 2, w - 2, 8, '#3b2f08');
        rect(ctx, x + 2, y + 3, w - 4, 6, '#ffd23f');
        disc(ctx, x + w / 2, y + 6, 2, '#b8860b');
        rect(ctx, x + 2, y + 14, w - 4, 3, '#0b0914');
        rect(ctx, x + w / 2 - 2, y + h * 0.62, 4, 4, '#0b0914');
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  /** Draws one frame. `t` in seconds; `live` false renders the calm still. */
  frame(t: number, fx: FxLevel, live: boolean): void {
    const geo = this.geo;
    if (!geo) return;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0);
    const { W, H, floorY } = geo;

    // humming neon rail + baseboard strip (pink→violet→cyan along the wall)
    const hum = live ? 0.78 + 0.22 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 1.7)) : 1;
    ctx.globalAlpha = hum;
    ctx.drawImage(this.strip, 0, this.railY);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.strip, 0, floorY - 2);
    if (live) {
      const px = (((t * 0.16) % 1.5) - 0.25) * W;
      rect(ctx, px - 4, floorY - 2, 8, 1, '#ffffff');
      rect(ctx, px - 8, floorY - 2, 4, 1, '#d8f8ff');
    }

    // DASCADE sign
    const s = this.signL;
    if (s) {
      const b = s.board;
      for (let i = 0; i < WORD.length; i++) {
        const lx = s.x - b.x + i * (s.lw + s.gap) - 2;
        const on = !live || fx === 'off' || !flicker(i, t);
        ctx.drawImage(on ? this.signLit : this.signDim, lx, 0, s.lw + 4, b.h, b.x + lx, b.y, s.lw + 4, b.h);
      }
      // frame tube (static lit copy of the outer ring)
      const edge = live && fx !== 'off' && Math.sin(t * 50) > 0.96 ? this.signDim : this.signLit;
      ctx.drawImage(edge, 0, 0, b.w, 2, b.x, b.y, b.w, 2);
      ctx.drawImage(edge, 0, b.h - 2, b.w, 2, b.x, b.y + b.h - 2, b.w, 2);
      ctx.drawImage(edge, 0, 0, 2, b.h, b.x, b.y, 2, b.h);
      ctx.drawImage(edge, b.w - 2, 0, 2, b.h, b.x + b.w - 2, b.y, 2, b.h);
      if (s.sub) ctx.drawImage(this.signLit, 3, b.h - 9, b.w - 6, 7, b.x + 3, b.y + b.h - 9, b.w - 6, 7);
    }

    for (const p of this.props) this.drawPropLive(ctx, p, t, live);

    // dust motes
    const motes = !live || fx === 'off' ? 0 : fx === 'low' ? 18 : 44;
    for (let i = 0; i < motes; i++) {
      const sp = 0.6 + hash(i * 2.1) * 1.6;
      const x = (hash(i * 7.7) * W + t * sp * 1.6 + Math.sin(t * 0.4 + i) * 5) % W;
      const y = (hash(i * 3.3) * H + t * sp * 0.9) % H;
      const tw = 0.5 + 0.5 * Math.sin(t * (1.2 + hash(i) * 2) + i * 4);
      if (tw < 0.25) continue;
      rect(ctx, x, y, 1, 1, tw > 0.8 ? '#f4ecff' : tw > 0.5 ? '#9d8fd0' : '#5b4f8a');
    }
  }

  private drawPropLive(ctx: CanvasRenderingContext2D, p: Prop, t: number, live: boolean): void {
    switch (p.kind) {
      case 'exit': {
        const glowOn = !live || Math.sin(t * 1.3) > -0.85;
        drawText(ctx, 'EXIT', p.x + 8, p.y + 2, glowOn ? '#46ff9a' : '#1d7a4a');
        const arrowOn = !live || Math.floor(t * 1.6) % 2 === 0;
        drawText(ctx, '<', p.x + 2, p.y + 2, arrowOn ? '#46ff9a' : '#0f4a2a');
        break;
      }
      case 'prizes': {
        const phase = live ? Math.floor(t * 8) : 0;
        let i = 0;
        const bulb = (x: number, y: number) => {
          rect(ctx, x, y, 1, 1, (i + phase) % 3 === 0 ? '#ffd23f' : '#5a3a14');
          i++;
        };
        for (let x = p.x; x < p.x + p.w; x += 2) bulb(x, p.y);
        for (let y = p.y; y < p.y + 11; y += 2) bulb(p.x + p.w - 1, y);
        for (let x = p.x + p.w - 1; x >= p.x; x -= 2) bulb(x, p.y + 10);
        for (let y = p.y + 10; y > p.y; y -= 2) bulb(p.x, y);
        drawTextC(ctx, 'PRIZES', p.x + p.w / 2, p.y + 3, live && Math.sin(t * 2.2) < -0.9 ? '#b0357f' : '#ff7ae3');
        break;
      }
      case 'claw': {
        const glassY = p.y + 7;
        const span = p.w - 8;
        const cx = Math.round(p.x + 4 + (live ? (Math.sin(t * 0.45) * 0.5 + 0.5) * span : span * 0.4));
        const drop = live ? Math.max(0, Math.sin(t * 0.3)) * 6 : 2;
        rect(ctx, p.x + 1, glassY + 1, p.w - 2, 1, '#8f88b3');
        rect(ctx, cx, glassY + 2, 1, 3 + drop, '#8f88b3');
        rect(ctx, cx - 1, glassY + 5 + drop, 3, 1, '#c9c3e6');
        rect(ctx, cx - 1, glassY + 6 + drop, 1, 1, '#c9c3e6');
        rect(ctx, cx + 1, glassY + 6 + drop, 1, 1, '#c9c3e6');
        break;
      }
      case 'change': {
        const on = !live || Math.floor(t * 1.2) % 2 === 0;
        rect(ctx, p.x + p.w / 2 - 1, p.y + p.h * 0.62 + 1, 2, 2, on ? '#ff5a5f' : '#4a1418');
        break;
      }
    }
  }
}

function flicker(i: number, t: number): boolean {
  // occasional single-frame blinks on any letter…
  if (hash(Math.floor(t * 14) + i * 97.3) < 0.006) return true;
  // …and a buzzing "C" every ~9 seconds.
  if (i === 3) {
    const phase = t % 9.3;
    if (phase > 6.1 && phase < 6.7) return hash(Math.floor(t * 24)) < 0.55;
  }
  return false;
}

function lerpHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * k);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * k);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * k);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -Math.floor(r); dy <= Math.floor(r); dy++) {
    const dx = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    ctx.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
  }
}
