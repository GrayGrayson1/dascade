/**
 * Procedural top-down car art. The same drawing code renders the lobby preview
 * (customizer) and the in-race Phaser textures, so what you build is what races.
 * Cars face +x; (0,0) is the car centre; units are world pixels (scale via ctx).
 */
import type { CarLookView, ChassisId, DecalId, WheelId } from '@dascade/shared/games/circuit';
import { CHASSIS } from '@dascade/game-core/circuit';
import { DISPLAY_FONT, PIXEL_FONT, readableOn, rgba, shade } from './palette.ts';

type Pt = [number, number];

export interface CarDims {
  L: number;
  W: number;
}

export function carDims(chassis: ChassisId): CarDims {
  const spec = CHASSIS[chassis] ?? CHASSIS.volt;
  return { L: spec.length, W: spec.width };
}

/** Texture padding around the body (wheels, wing, outline). */
export const CAR_PAD = 4;

function bodyOutline(chassis: ChassisId, { L, W }: CarDims): Pt[] {
  const hl = L / 2;
  const hw = W / 2;
  switch (chassis) {
    case 'brick':
      return roundedRectPts(-hl, -hw + 0.5, L, W - 1, [W * 0.22, W * 0.22, W * 0.08, W * 0.08]);
    case 'comet':
      return smooth([
        [hl, -W * 0.1],
        [hl - 2, -W * 0.2],
        [L * 0.3, -W * 0.44],
        [L * 0.16, -W * 0.46],
        [L * 0.02, -W * 0.38],
        [-L * 0.2, -W * 0.46],
        [-L * 0.36, -hw],
        [-hl + 1, -W * 0.4],
        [-hl, -W * 0.3],
        [-hl, W * 0.3],
        [-hl + 1, W * 0.4],
        [-L * 0.36, hw],
        [-L * 0.2, W * 0.46],
        [L * 0.02, W * 0.38],
        [L * 0.16, W * 0.46],
        [L * 0.3, W * 0.44],
        [hl - 2, W * 0.2],
        [hl, W * 0.1],
      ]);
    case 'pixel':
      return roundedRectPts(-hl, -hw, L, W, [W * 0.45, W * 0.45, W * 0.34, W * 0.34]);
    case 'volt':
    default:
      return [
        [hl, -W * 0.18],
        [hl - 1, -W * 0.26],
        [L * 0.26, -hw],
        [-L * 0.38, -hw],
        [-hl, -W * 0.4],
        [-hl, W * 0.4],
        [-L * 0.38, hw],
        [L * 0.26, hw],
        [hl - 1, W * 0.26],
        [hl, W * 0.18],
      ];
  }
}

/** Chaikin smoothing for organic shapes. */
function smooth(pts: Pt[], passes = 2): Pt[] {
  let out = pts;
  for (let p = 0; p < passes; p++) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      const b = out[(i + 1) % out.length]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out = next;
  }
  return out;
}

/** Rounded rect as a polygon; radii = [frontLeft, frontRight, rearRight, rearLeft] (front = +x). */
function roundedRectPts(x: number, y: number, w: number, h: number, r: [number, number, number, number]): Pt[] {
  const pts: Pt[] = [];
  const arc = (cx: number, cy: number, rad: number, a0: number, a1: number) => {
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
  };
  const [fl, fr, rr, rl] = r;
  arc(x + w - fl, y + fl, fl, -Math.PI / 2, 0); // front-left (top-right in +x space)
  arc(x + w - fr, y + h - fr, fr, 0, Math.PI / 2);
  arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  arc(x + rl, y + rl, rl, Math.PI, Math.PI * 1.5);
  return pts;
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawWheel(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, style: WheelId, accent: string, steer: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(steer);
  ctx.fillStyle = '#07060d';
  roundRect(ctx, -len / 2, -wid / 2, len, wid, 1.4);
  ctx.fill();
  // Tread blocks.
  ctx.fillStyle = '#1b1a26';
  for (let i = -len / 2 + 1; i < len / 2 - 0.5; i += 2) ctx.fillRect(i, -wid / 2 + 0.6, 1, wid - 1.2);
  const outer = y < 0 ? -wid / 2 : wid / 2 - 1.3;
  if (style === 'disc') {
    ctx.fillStyle = accent;
    ctx.fillRect(-len / 2 + 1.2, outer, len - 2.4, 1.3);
  } else if (style === 'turbo') {
    ctx.fillStyle = shade(accent, 0.35);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 4;
    ctx.fillRect(-len / 2 + 0.6, outer, len - 1.2, 1.3);
    ctx.shadowBlur = 0;
  } else {
    ctx.fillStyle = '#c9cbe0';
    for (let i = -len / 2 + 1.2; i < len / 2 - 1; i += 1.8) ctx.fillRect(i, outer, 0.9, 1.3);
  }
  ctx.restore();
}

function drawDecal(ctx: CanvasRenderingContext2D, decal: DecalId, look: CarLookView, { L, W }: CarDims): void {
  const hl = L / 2;
  const hw = W / 2;
  const sec = look.secondary;
  switch (decal) {
    case 'stripes':
      ctx.fillStyle = sec;
      ctx.fillRect(-hl, -W * 0.16, L, W * 0.1);
      ctx.fillRect(-hl, W * 0.06, L, W * 0.1);
      ctx.fillStyle = rgba('#ffffff', 0.35);
      ctx.fillRect(-hl, -W * 0.16, L, 0.5);
      ctx.fillRect(-hl, W * 0.06, L, 0.5);
      break;
    case 'flames': {
      const grad = ctx.createLinearGradient(hl, 0, -L * 0.1, 0);
      grad.addColorStop(0, '#ffd23f');
      grad.addColorStop(0.45, sec);
      grad.addColorStop(1, shade(sec, -0.35));
      ctx.fillStyle = grad;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hl + 1, side * W * 0.05);
        const tongues = [
          [0.36, 0.34],
          [0.2, 0.2],
          [0.1, 0.44],
          [-0.04, 0.26],
          [-0.14, 0.5],
          [-0.02, 0.5],
        ];
        for (const [fx, fy] of tongues) ctx.lineTo(L * fx!, side * W * fy!);
        ctx.lineTo(hl + 1, side * hw);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'checker': {
      const size = W / 6;
      const x0 = -L * 0.34;
      for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 6; r++) {
          ctx.fillStyle = (c + r) % 2 === 0 ? '#f8f6ff' : '#0b0914';
          ctx.fillRect(x0 + c * size, -hw + r * size, size, size);
        }
      }
      ctx.fillStyle = sec;
      ctx.fillRect(x0 + 3 * size, -hw, 1.2, W);
      ctx.fillRect(x0 - 1.2, -hw, 1.2, W);
      break;
    }
    case 'bolt': {
      ctx.fillStyle = sec;
      ctx.strokeStyle = rgba('#ffffff', 0.8);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(hl - 1, -W * 0.06);
      ctx.lineTo(L * 0.12, -W * 0.2);
      ctx.lineTo(L * 0.14, -W * 0.02);
      ctx.lineTo(-L * 0.18, -W * 0.16);
      ctx.lineTo(-L * 0.02, W * 0.04);
      ctx.lineTo(-L * 0.04, -W * 0.02);
      ctx.lineTo(L * 0.3, W * 0.12);
      ctx.lineTo(L * 0.28, -W * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'panel':
      ctx.fillStyle = sec;
      ctx.fillRect(-hl, -hw, L * 0.12, W);
      ctx.fillRect(L * 0.38, -hw, L * 0.12, W);
      break;
    case 'none':
    default:
      break;
  }
}

function drawCockpit(ctx: CanvasRenderingContext2D, chassis: ChassisId, look: CarLookView, { L, W }: CarDims): void {
  const glass = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
  glass.addColorStop(0, '#2c3a5c');
  glass.addColorStop(0.5, '#0c1222');
  glass.addColorStop(1, '#1d2740');
  const roofCol = look.decal === 'panel' ? look.primary : shade(look.primary, -0.12);
  const hl = L / 2;
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = 'rgba(5,4,11,0.9)';
  if (chassis === 'brick') {
    ctx.fillStyle = glass;
    roundRect(ctx, L * 0.2, -W * 0.4, L * 0.16, W * 0.8, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = shade(look.primary, -0.14);
    roundRect(ctx, -hl + 2, -W * 0.38, L * 0.66, W * 0.76, 1.5);
    ctx.fill();
    // Roof rack in the accent colour.
    ctx.fillStyle = look.secondary;
    for (let i = 0; i < 4; i++) ctx.fillRect(-hl + 4 + i * (L * 0.15), -W * 0.32, 1.3, W * 0.64);
    ctx.fillRect(-hl + 4, -W * 0.33, L * 0.47, 1);
    ctx.fillRect(-hl + 4, W * 0.33 - 1, L * 0.47, 1);
    return;
  }
  if (chassis === 'comet') {
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.ellipse(-L * 0.1, 0, L * 0.17, W * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba('#bfe9ff', 0.45);
    ctx.beginPath();
    ctx.ellipse(-L * 0.04, -W * 0.1, L * 0.07, W * 0.06, -0.3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (chassis === 'pixel') {
    ctx.fillStyle = glass;
    roundRect(ctx, -L * 0.2, -W * 0.36, L * 0.46, W * 0.72, W * 0.26);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = roofCol;
    roundRect(ctx, -L * 0.16, -W * 0.3, L * 0.26, W * 0.6, W * 0.2);
    ctx.fill();
    return;
  }
  // volt
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.moveTo(L * 0.16, -W * 0.24);
  ctx.lineTo(L * 0.16, W * 0.24);
  ctx.lineTo(-L * 0.02, W * 0.34);
  ctx.lineTo(-L * 0.26, W * 0.32);
  ctx.lineTo(-L * 0.26, -W * 0.32);
  ctx.lineTo(-L * 0.02, -W * 0.34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = roofCol;
  ctx.fillRect(-L * 0.2, -W * 0.28, L * 0.18, W * 0.56);
}

function drawNumber(ctx: CanvasRenderingContext2D, look: CarLookView, chassis: ChassisId, { L, W }: CarDims): void {
  const num = String(look.number);
  if (look.decal === 'panel') {
    ctx.fillStyle = '#f8f6ff';
    roundRect(ctx, L * 0.18, -W * 0.3, L * 0.18, W * 0.6, 2);
    ctx.fill();
    ctx.fillStyle = '#0b0914';
    ctx.save();
    ctx.translate(L * 0.27, 0);
    ctx.rotate(Math.PI / 2);
    ctx.font = `${W * 0.46}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(num, 0, 0.5);
    ctx.restore();
    return;
  }
  const cx = chassis === 'brick' ? -L * 0.12 : chassis === 'comet' ? -L * 0.34 : chassis === 'pixel' ? -L * 0.04 : -L * 0.11;
  const r = W * 0.2;
  ctx.fillStyle = '#f8f6ff';
  ctx.beginPath();
  ctx.arc(cx, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b0914';
  ctx.save();
  ctx.translate(cx, 0);
  ctx.rotate(Math.PI / 2);
  ctx.font = `${r * (num.length > 1 ? 1.15 : 1.4)}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num, 0, 0.4);
  ctx.restore();
}

function drawLights(ctx: CanvasRenderingContext2D, chassis: ChassisId, { L, W }: CarDims): void {
  const hl = L / 2;
  const front = chassis === 'comet' ? W * 0.12 : chassis === 'pixel' ? W * 0.28 : W * 0.3;
  ctx.fillStyle = '#fff6c8';
  ctx.shadowColor = '#fff6c8';
  ctx.shadowBlur = 2;
  const fx = hl - (chassis === 'volt' ? 2.2 : 1.8);
  if (chassis === 'pixel') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(fx - 1, s * front, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (const s of [-1, 1]) ctx.fillRect(fx, s * front - (s > 0 ? 2.2 : 0), 1.6, 2.2);
  }
  ctx.fillStyle = '#ff2a4a';
  ctx.shadowColor = '#ff2a4a';
  const rear = W * 0.3;
  for (const s of [-1, 1]) ctx.fillRect(-hl + 0.2, s * rear - (s > 0 ? 2.4 : 0), 1.4, 2.4);
  ctx.shadowBlur = 0;
}

function drawWing(ctx: CanvasRenderingContext2D, chassis: ChassisId, look: CarLookView, { L, W }: CarDims): void {
  const hl = L / 2;
  const hw = W / 2;
  ctx.strokeStyle = 'rgba(5,4,11,0.95)';
  ctx.lineWidth = 0.6;
  if (chassis === 'volt') {
    ctx.fillStyle = look.secondary;
    ctx.fillRect(-hl - 1.5, -hw - 1, 4.2, W + 2);
    ctx.strokeRect(-hl - 1.5, -hw - 1, 4.2, W + 2);
    ctx.fillStyle = shade(look.secondary, -0.35);
    ctx.fillRect(-hl - 1.5, -hw - 1.6, 4.2, 1.2);
    ctx.fillRect(-hl - 1.5, hw + 0.4, 4.2, 1.2);
  } else if (chassis === 'comet') {
    ctx.fillStyle = look.secondary;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-hl + 1, s * W * 0.34);
      ctx.lineTo(-hl - 2, s * W * 0.46);
      ctx.lineTo(-L * 0.3, s * W * 0.44);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (chassis === 'pixel') {
    ctx.fillStyle = '#c9cbe0';
    ctx.fillRect(hl - 1.2, -W * 0.34, 1.4, W * 0.68);
    ctx.fillRect(-hl - 0.2, -W * 0.3, 1.4, W * 0.6);
  } else {
    ctx.fillStyle = '#c9cbe0';
    ctx.fillRect(hl - 0.8, -W * 0.44, 1.2, W * 0.88);
  }
}

export interface DrawCarOptions {
  /** Front wheel angle (radians). */
  steer?: number;
  /** Include the soft drop shadow (preview only; the race uses a separate shadow sprite). */
  shadow?: boolean;
}

/** Draw a car centred at the current origin, facing +x. */
export function drawCar(ctx: CanvasRenderingContext2D, look: CarLookView, opts: DrawCarOptions = {}): void {
  const chassis = (CHASSIS[look.chassis] ? look.chassis : 'volt') as ChassisId;
  const dims = carDims(chassis);
  const { L, W } = dims;
  const outline = bodyOutline(chassis, dims);
  ctx.save();
  ctx.lineJoin = 'round';

  if (opts.shadow) {
    ctx.save();
    ctx.translate(2.5, 3.5);
    ctx.filter = 'blur(2.5px)';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    tracePath(ctx, outline);
    ctx.fill();
    ctx.restore();
  }

  // Wheels under the body.
  const wl = L * 0.2;
  const ww = Math.max(4.2, W * 0.2);
  const wy = W / 2 - ww / 2 + 1.2;
  const axleF = chassis === 'comet' ? L * 0.24 : L * 0.29;
  const axleR = -L * 0.29;
  for (const s of [-1, 1]) {
    drawWheel(ctx, axleF, s * wy, wl, ww, look.wheels, look.secondary, opts.steer ?? 0);
    drawWheel(ctx, axleR, s * wy, wl, ww, look.wheels, look.secondary, 0);
  }

  // Body paint with a soft top-down gloss.
  tracePath(ctx, outline);
  const paint = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
  paint.addColorStop(0, shade(look.primary, 0.28));
  paint.addColorStop(0.45, look.primary);
  paint.addColorStop(1, shade(look.primary, -0.38));
  ctx.fillStyle = paint;
  ctx.fill();

  ctx.save();
  tracePath(ctx, outline);
  ctx.clip();
  drawDecal(ctx, look.decal, look, dims);
  // Specular sweep.
  const spec = ctx.createLinearGradient(-L / 2, -W / 2, L / 2, W / 2);
  spec.addColorStop(0, 'rgba(255,255,255,0)');
  spec.addColorStop(0.42, 'rgba(255,255,255,0.18)');
  spec.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.fillRect(-L / 2, -W / 2, L, W);
  ctx.restore();

  drawCockpit(ctx, chassis, look, dims);
  drawNumber(ctx, look, chassis, dims);
  drawWing(ctx, chassis, look, dims);
  drawLights(ctx, chassis, dims);

  // Crisp outline + rim light.
  tracePath(ctx, outline);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = 'rgba(5,4,11,0.95)';
  ctx.stroke();
  ctx.save();
  tracePath(ctx, outline);
  ctx.clip();
  ctx.strokeStyle = rgba('#ffffff', 0.35);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-L / 2, -W / 2 + 1);
  ctx.lineTo(L / 2, -W / 2 + 1);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/** Canvas sized for a car texture at `scale`. */
export function renderCarCanvas(look: CarLookView, scale: number): HTMLCanvasElement {
  const { L, W } = carDims(look.chassis);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((L + CAR_PAD * 2) * scale);
  canvas.height = Math.ceil((W + CAR_PAD * 2) * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(L / 2 + CAR_PAD, W / 2 + CAR_PAD);
  drawCar(ctx, look);
  return canvas;
}

/** Nameplate pill: [number | NAME]. */
export function renderNameplate(look: CarLookView, scale: number, highlight: boolean): HTMLCanvasElement {
  const h = 13;
  const font = `${8}px ${PIXEL_FONT}`;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const num = String(look.number).padStart(2, '0');
  const name = look.nameplate || 'RACER';
  const numW = Math.ceil(measure.measureText(num).width) + 8;
  const nameW = Math.ceil(measure.measureText(name).width) + 10;
  const w = numW + nameW + (highlight ? 2 : 0);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + 4) * scale);
  canvas.height = Math.ceil((h + 4) * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(2, 2);
  ctx.fillStyle = highlight ? '#f8f6ff' : 'rgba(7,5,15,0.82)';
  roundRect(ctx, 0, 0, w, h, 3);
  ctx.fill();
  ctx.fillStyle = look.primary;
  roundRect(ctx, highlight ? 1 : 0, highlight ? 1 : 0, numW, h - (highlight ? 2 : 0), 3);
  ctx.fill();
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = readableOn(look.primary);
  ctx.fillText(num, numW / 2 + (highlight ? 1 : 0), h / 2 + 0.5);
  ctx.fillStyle = highlight ? '#07050f' : '#f8f6ff';
  ctx.fillText(name, numW + nameW / 2, h / 2 + 0.5);
  return canvas;
}
