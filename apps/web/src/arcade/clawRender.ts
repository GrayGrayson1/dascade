/**
 * Draws the inside of the claw machine's glass for the close-up (ClawCloseup.tsx): a fixed 3/4 view
 * looking slightly down into the case, so the pile has depth. Plushies live at (x, z) with heights;
 * everything is depth-sorted, the claw casts a shadow on whatever is under it (that shadow, the
 * gantry's bridge and the perspective are how you judge depth), and the plushies have a bit of
 * life: they blink, squash when they land, wobble when bumped and sweat when they're slipping.
 *
 * Canvas drawing only — the machine's state comes from clawPhysics.ts and is never changed here.
 * Colours are the machine's own printed/lit materials (fixed, like the floor machine's glass and plush
 * art); the chrome around the canvas takes the theme's cabinet tokens in CSS.
 */
import { SPRITES, spriteColor } from './clawArt.ts';
import { BOX, CHUTE, CLAW, GANTRY, KINDS, headPos, surfaceAt, type ClawSim, type ClawToy, type ToyKind } from './clawPhysics.ts';

/** The canvas's logical size (CSS scales it; the backing store follows devicePixelRatio). */
export const VIEW = { w: 480, h: 400 } as const;

const KX = 4.35;
const KY = 3.05;
const FLOOR_FRONT = 392;
const FLOOR_DEPTH = 2.85;
const PERSP = 0.0045;
/** Plush sprites overlap their footprints a little (soft toys squash into each other). */
const SPRITE_SCALE = 1.32;
const TOP = GANTRY.topY + 7;

const scaleAt = (z: number) => 1 - z * PERSP;
export function project(x: number, y: number, z: number): { x: number; y: number; s: number } {
  const s = scaleAt(z);
  return { x: VIEW.w / 2 + (x - BOX.w / 2) * KX * s, y: FLOOR_FRONT - z * FLOOR_DEPTH - y * KY * s, s };
}

/** Per-toy life the renderer adds on top of the physics (squash, wobble, blink, sweat). */
export interface ToyLife {
  squash: number;
  wobble: number;
  wobblePhase: number;
  sweat: number;
  happy: number;
}

export interface RenderFx {
  /** 0 = reduced motion / fx off: no wobble, no squash, no sway exaggeration. */
  motion: number;
  time: number;
  life: Map<number, ToyLife>;
  /** The case's shake (hard landings, high fx only). */
  shake: number;
  /** The interior light: 1 normal, more on a win, dimmer on a slip. */
  light: number;
  lightTint: string;
  /** 0‥1: the room dims to a pool of light around the claw while it drops and lifts (eased by the caller). */
  focus: number;
  /** Little pixel bits: dust when a plush lands hard, sparkles when one goes down the chute. */
  bits: Bit[];
}

export interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  color: string;
  size: number;
}

/** Throws a few bits from a point (world units). `kind` picks dust or sparkles. */
export function burstBits(fx: RenderFx, x: number, y: number, z: number, kind: 'dust' | 'sparkle', n: number): void {
  if (fx.motion <= 0) return;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + fx.time * 3.1;
    const sp = kind === 'dust' ? 10 + ((i * 37) % 10) : 14 + ((i * 53) % 16);
    fx.bits.push({
      x,
      y: y + 1,
      z,
      vx: Math.cos(a) * sp,
      vz: Math.sin(a) * sp * 0.6,
      vy: kind === 'dust' ? 6 + (i % 3) * 4 : 30 + (i % 4) * 12,
      life: kind === 'dust' ? 0.45 : 0.9,
      color: kind === 'dust' ? 'rgba(230,220,255,0.55)' : ['#ffd23f', '#ffffff', '#ff4fd8', '#22d3ee'][i % 4]!,
      size: kind === 'dust' ? 2 : 2.5,
    });
  }
  if (fx.bits.length > 160) fx.bits.splice(0, fx.bits.length - 160);
}

export function lifeOf(fx: RenderFx, id: number): ToyLife {
  let l = fx.life.get(id);
  if (!l) {
    l = { squash: 0, wobble: 0, wobblePhase: (id * 1.7) % 6.28, sweat: 0, happy: 0 };
    fx.life.set(id, l);
  }
  return l;
}

/** Ages the per-toy animation (called once a frame with real seconds). */
export function ageLife(fx: RenderFx, dt: number): void {
  for (const b of fx.bits) {
    b.life -= dt;
    b.vy -= 160 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    if (b.y < 0) {
      b.y = 0;
      b.vy *= -0.3;
      b.vx *= 0.6;
      b.vz *= 0.6;
    }
  }
  if (fx.bits.some((b) => b.life <= 0)) fx.bits = fx.bits.filter((b) => b.life > 0);
  for (const [id, l] of fx.life) {
    l.squash *= Math.max(0, 1 - dt * 7);
    l.wobble *= Math.max(0, 1 - dt * 2.6);
    l.wobblePhase += dt * 17;
    l.sweat = Math.max(0, l.sweat - dt * 0.8);
    l.happy = Math.max(0, l.happy - dt * 0.5);
    if (l.squash < 0.002 && l.wobble < 0.002 && l.sweat <= 0 && l.happy <= 0) fx.life.delete(id);
  }
}

// ---------------------------------------------------------------------------------------------------
// Sprites: one small canvas per kind × colour × face (drawn scaled, nearest-neighbour).

type Face = 'open' | 'blink' | 'happy';
/** Deeper in the heap = a little darker (the light comes from the top). */
const SHADES = [0.16, 0.07, 0] as const;
const shadeFor = (y: number) => (y < 2.5 ? 0 : y < 9 ? 1 : 2);
const spriteCache = new Map<string, HTMLCanvasElement>();

function faceRows(kind: ToyKind, face: Face): readonly string[] {
  const rows = SPRITES[kind];
  if (face === 'open') return rows;
  return rows.map((row) => {
    if (!row.includes('w')) return row;
    // Blink: the eyes shut to a soft line. Happy: squeezed shut (a dark line).
    return face === 'blink' ? row.replace(/[wk]/g, 'd') : row.replace(/w/g, 'k');
  });
}

function sprite(kind: ToyKind, color: number, face: Face, shade = 2): HTMLCanvasElement | null {
  const key = `${kind}:${color}:${face}:${shade}`;
  let c = spriteCache.get(key);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  const rows = faceRows(kind, face);
  c = document.createElement('canvas');
  c.width = rows[0]!.length;
  c.height = rows.length;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = spriteColor(row[x]!, color);
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  // A soft top-left highlight baked in (the plush fabric catching the machine's light).
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const dark = SHADES[shade] ?? 0;
  if (dark > 0) {
    ctx.fillStyle = `rgba(16,6,40,${dark})`;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  spriteCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------------------------------
// Static backdrop (cached per canvas size): walls, floor, the chute hole, the rails.

let backdrop: { key: string; canvas: HTMLCanvasElement } | null = null;

function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  const fl = (x: number, z: number) => project(x, 0, z);
  const tp = (x: number, z: number) => project(x, TOP, z);
  const quad = (pts: { x: number; y: number }[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  };
  // The case: deep blue, lit from the top.
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  bg.addColorStop(0, '#1b2360');
  bg.addColorStop(0.55, '#0f1440');
  bg.addColorStop(1, '#070a22');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  // Back wall, with the machine's star print.
  quad([tp(0, BOX.d), tp(BOX.w, BOX.d), fl(BOX.w, BOX.d), fl(0, BOX.d)]);
  const wall = ctx.createLinearGradient(0, tp(0, BOX.d).y, 0, fl(0, BOX.d).y);
  wall.addColorStop(0, '#2a1d5c');
  wall.addColorStop(1, '#171046');
  ctx.fillStyle = wall;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,79,216,0.16)';
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 13; col++) {
      const x = 4 + col * 7.8 + (row % 2) * 3.9;
      const y = 4 + row * 8.4;
      const p = project(x, y, BOX.d);
      const r = 2.2 * p.s;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r * 1.4);
      ctx.lineTo(p.x + r * 0.4, p.y - r * 0.4);
      ctx.lineTo(p.x + r * 1.4, p.y);
      ctx.lineTo(p.x + r * 0.4, p.y + r * 0.4);
      ctx.lineTo(p.x, p.y + r * 1.4);
      ctx.lineTo(p.x - r * 0.4, p.y + r * 0.4);
      ctx.lineTo(p.x - r * 1.4, p.y);
      ctx.lineTo(p.x - r * 0.4, p.y - r * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // A neon sign on the back wall.
  {
    const c = project(BOX.w / 2, 44, BOX.d);
    ctx.save();
    ctx.font = `${Math.round(30 * c.s)}px Silkscreen, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff4fd8';
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(255,120,230,0.55)';
    ctx.fillText('PLUSH PARADE', c.x, c.y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,220,250,0.55)';
    ctx.fillText('PLUSH PARADE', c.x, c.y);
    ctx.restore();
  }

  // Side walls (mirror panels, darker).
  for (const x of [0, BOX.w]) {
    quad([tp(x, BOX.d), tp(x, 0), fl(x, 0), fl(x, BOX.d)]);
    const side = ctx.createLinearGradient(tp(x, 0).x, 0, tp(x, BOX.d).x, 0);
    side.addColorStop(0, 'rgba(8,10,36,0.95)');
    side.addColorStop(1, 'rgba(30,26,80,0.9)');
    ctx.fillStyle = side;
    ctx.fill();
  }

  // Floor: plum felt with a faint weave.
  quad([fl(0, BOX.d), fl(BOX.w, BOX.d), fl(BOX.w, 0), fl(0, 0)]);
  const floor = ctx.createLinearGradient(0, fl(0, BOX.d).y, 0, fl(0, 0).y);
  floor.addColorStop(0, '#2b1450');
  floor.addColorStop(1, '#40195e');
  ctx.fillStyle = floor;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= BOX.w; x += 5) {
    const a = fl(x, 0);
    const b = fl(x, BOX.d);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (let z = 0; z <= BOX.d; z += 5) {
    const a = fl(0, z);
    const b = fl(BOX.w, z);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();

  // The chute: an open hole, a dark throat going down.
  quad([fl(CHUTE.x0, CHUTE.z1), fl(CHUTE.x1, CHUTE.z1), fl(CHUTE.x1, CHUTE.z0), fl(CHUTE.x0, CHUTE.z0)]);
  const hole = ctx.createLinearGradient(0, fl(0, CHUTE.z1).y, 0, fl(0, CHUTE.z0).y);
  hole.addColorStop(0, '#000');
  hole.addColorStop(1, '#0a0418');
  ctx.fillStyle = hole;
  ctx.fill();
  // The throat: a few dark rings going down, and a pink-lit rim.
  for (let i = 1; i <= 3; i++) {
    const k = i * 1.6;
    quad([fl(CHUTE.x0 + k, CHUTE.z1 - k), fl(CHUTE.x1 - k, CHUTE.z1 - k), fl(CHUTE.x1 - k, CHUTE.z0 + k), fl(CHUTE.x0 + k, CHUTE.z0 + k)]);
    ctx.strokeStyle = `rgba(255,79,216,${(0.18 - i * 0.04).toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  quad([fl(CHUTE.x0, CHUTE.z1), fl(CHUTE.x1, CHUTE.z1), fl(CHUTE.x1, CHUTE.z0), fl(CHUTE.x0, CHUTE.z0)]);
  ctx.save();
  ctx.shadowColor = '#ff4fd8';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = 'rgba(255,120,230,0.8)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  // Gantry rails along both sides, at the top.
  for (const x of [1.2, BOX.w - 1.2]) {
    const a = tp(x, 0);
    const b = tp(x, BOX.d);
    ctx.strokeStyle = '#141225';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = '#4a4668';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = '#c9c3e6';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 2);
    ctx.lineTo(b.x, b.y - 2);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------------------------------
// The frame

type Drawable = { z: number; y: number; draw: () => void };

export function drawClawScene(ctx: CanvasRenderingContext2D, sim: ClawSim, fx: RenderFx, scale: number): void {
  const key = `${ctx.canvas.width}x${ctx.canvas.height}`;
  if (!backdrop || backdrop.key !== key) {
    const c = document.createElement('canvas');
    c.width = ctx.canvas.width;
    c.height = ctx.canvas.height;
    const b = c.getContext('2d');
    if (b) {
      b.setTransform(scale, 0, 0, scale, 0, 0);
      drawBackdrop(b);
    }
    backdrop = { key, canvas: c };
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const shake = fx.shake * fx.motion;
  const sx = shake ? Math.round((((fx.time * 97) % 2) - 1) * shake * scale) : 0;
  const sy = shake ? Math.round((((fx.time * 71) % 2) - 1) * shake * scale * 0.6) : 0;
  ctx.drawImage(backdrop.canvas, sx, sy);
  ctx.setTransform(scale, 0, 0, scale, sx, sy);

  const head = headPos(sim);
  const items: Drawable[] = [];

  // Soft contact shadows under the resting pile (ambient occlusion), under everything else.
  for (const t of sim.toys) {
    if (t.mode !== 'pile') continue;
    const k = KINDS[t.kind];
    const p = project(t.x, t.y, t.z);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, k.r * KX * p.s * 0.95, k.r * FLOOR_DEPTH * p.s * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const t of sim.toys) {
    if (t.mode === 'held') continue; // drawn with the claw
    items.push({ z: t.z, y: t.y, draw: () => drawToy(ctx, t, fx, sim) });
    if (t.mode === 'fall') {
      const ground = surfaceAt(sim.toys, t.x, t.z, t.id);
      items.push({ z: t.z + 3, y: ground, draw: () => drawDropShadow(ctx, t.x, ground, t.z, KINDS[t.kind].r, t.y - ground) });
    }
  }
  // The chute's clear walls stand between the pile and the glass.
  items.push({ z: CHUTE.z1 - 0.5, y: 0, draw: () => drawChuteWalls(ctx) });
  items.sort((a, b) => b.z - a.z || a.y - b.y);

  // The bridge rides over everything at the top.
  drawBridge(ctx, sim);
  // Everything behind the claw (and the toys it's over), then its shadow on them — the depth cue —
  // then the claw with whatever it holds, then everything nearer the glass.
  const split = head.z - 6;
  for (const it of items) if (it.z >= split) it.draw();
  const surf = surfaceAt(sim.toys, head.x, head.z);
  drawClawShadow(ctx, head.x, surf, head.z, sim.hubY - CLAW.prong - surf);
  drawClaw(ctx, sim, fx);
  let infront = false;
  for (const it of items) {
    if (it.z >= split) continue;
    it.draw();
    infront = true;
  }
  // X-ray: wherever the plushies nearer the glass hide the claw, a faint ghost of it still shows.
  if (infront && sim.hubY < 40) {
    ctx.globalAlpha = 0.28;
    drawClaw(ctx, sim, fx, true);
    ctx.globalAlpha = 1;
  }
  for (const b of fx.bits) {
    const p = project(b.x, b.y, b.z);
    ctx.globalAlpha = Math.min(1, b.life * 3);
    ctx.fillStyle = b.color;
    const sz = Math.max(1, Math.round(b.size * p.s * 1.4));
    ctx.fillRect(Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz);
  }
  ctx.globalAlpha = 1;
  drawForeground(ctx, fx);

  // Anticipation: while the claw goes down and comes up, the case dims around it.
  if (fx.focus > 0.01) {
    const hp = project(head.x, Math.max(0, sim.hubY - CLAW.prong * 0.5), head.z);
    const v = ctx.createRadialGradient(hp.x, hp.y, 40, hp.x, hp.y, 260);
    v.addColorStop(0, 'rgba(4,2,16,0)');
    v.addColorStop(1, `rgba(4,2,16,${(0.5 * fx.focus).toFixed(3)})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  // The machine's light: a warm pool from the top, and the glass's own glow.
  const lp = project(BOX.w / 2, TOP, BOX.d / 2);
  const light = ctx.createRadialGradient(lp.x, lp.y - 30, 10, lp.x, lp.y + 60, 330);
  light.addColorStop(0, withAlpha(fx.lightTint, 0.2 * fx.light));
  light.addColorStop(0.6, withAlpha(fx.lightTint, 0.05 * fx.light));
  light.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.globalCompositeOperation = 'source-over';
  if (fx.light < 1) {
    ctx.fillStyle = `rgba(4,2,16,${(1 - fx.light) * 0.5})`;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** The front top beam with the machine's light tube under it (in front of everything). */
function drawForeground(ctx: CanvasRenderingContext2D, fx: RenderFx): void {
  const a = project(0, TOP + 4, 0);
  const b = project(BOX.w, TOP + 4, 0);
  const y = Math.min(a.y, 34);
  // The light tube's glow spilling down the glass.
  const glow = ctx.createLinearGradient(0, y, 0, y + 70);
  glow.addColorStop(0, withAlpha(fx.lightTint, 0.28 * Math.min(1.4, fx.light)));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, y, VIEW.w, 70);
  // The beam.
  const beam = ctx.createLinearGradient(0, 0, 0, y);
  beam.addColorStop(0, '#0b0918');
  beam.addColorStop(1, '#221d3e');
  ctx.fillStyle = beam;
  ctx.fillRect(0, 0, VIEW.w, y);
  // The tube.
  ctx.fillStyle = withAlpha('#fff8e6', 0.85 * Math.min(1, fx.light));
  ctx.fillRect(Math.min(a.x, 30), y - 5, Math.max(b.x, VIEW.w - 30) - Math.min(a.x, 30), 3);
  ctx.fillStyle = withAlpha(fx.lightTint, 0.5 * Math.min(1, fx.light));
  ctx.fillRect(Math.min(a.x, 30), y - 2, Math.max(b.x, VIEW.w - 30) - Math.min(a.x, 30), 2);
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function drawDropShadow(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, r: number, height: number): void {
  const p = project(x, y, z);
  const k = Math.max(0.25, 1 - height / 60);
  ctx.fillStyle = `rgba(0,0,0,${(0.35 * k).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, r * KX * p.s * (1.2 - k * 0.3), r * FLOOR_DEPTH * p.s * (1.1 - k * 0.3), 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawClawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, height: number): void {
  const p = project(x, y, z);
  const h = Math.max(0, height);
  // Sharper and darker as the claw comes down onto it.
  const k = Math.max(0, Math.min(1, 1 - h / 55));
  const rx = (CLAW.openR * 0.9 + h * 0.08) * KX * p.s;
  const ry = rx * 0.42;
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rx);
  g.addColorStop(0, `rgba(0,0,0,${(0.3 + 0.35 * k).toFixed(3)})`);
  g.addColorStop(0.55, `rgba(0,0,0,${(0.18 + 0.25 * k).toFixed(3)})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1, ry / rx);
  ctx.translate(-p.x, -p.y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // A tiny centre mark: where the axis lands.
  ctx.fillStyle = `rgba(0,0,0,${(0.25 + 0.3 * k).toFixed(3)})`;
  ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
}

function drawChuteWalls(ctx: CanvasRenderingContext2D): void {
  const w = CHUTE.wall;
  const pts = (a: [number, number], b: [number, number]) => [
    project(a[0], 0, a[1]),
    project(b[0], 0, b[1]),
    project(b[0], w, b[1]),
    project(a[0], w, a[1]),
  ];
  const panel = (p: { x: number; y: number }[]) => {
    ctx.beginPath();
    p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    const g = ctx.createLinearGradient(0, p[3]!.y, 0, p[0]!.y);
    g.addColorStop(0, 'rgba(255,170,240,0.16)');
    g.addColorStop(1, 'rgba(191,233,255,0.06)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,195,230,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // top edge catches the light
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p[3]!.x, p[3]!.y);
    ctx.lineTo(p[2]!.x, p[2]!.y);
    ctx.stroke();
  };
  panel(pts([CHUTE.x0, CHUTE.z1], [CHUTE.x1, CHUTE.z1]));
  panel(pts([CHUTE.x1, CHUTE.z1], [CHUTE.x1, CHUTE.z0]));
  // PRIZE label on the chute's side
  const lab = project((CHUTE.x0 + CHUTE.x1) / 2, w * 0.45, CHUTE.z1);
  ctx.fillStyle = 'rgba(255,79,216,0.7)';
  ctx.font = `${Math.round(9 * lab.s)}px Silkscreen, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('PRIZE', lab.x, lab.y + 3);
}

function drawBridge(ctx: CanvasRenderingContext2D, sim: ClawSim): void {
  const a = project(0, TOP, sim.gz);
  const b = project(BOX.w, TOP, sim.gz);
  // The bridge's carriages on the side rails (where along the depth it is).
  for (const p of [project(1.2, TOP, sim.gz), project(BOX.w - 1.2, TOP, sim.gz)]) {
    ctx.fillStyle = '#1a1830';
    ctx.fillRect(p.x - 7 * p.s, p.y - 5 * p.s, 14 * p.s, 10 * p.s);
    ctx.fillStyle = '#ff4fd8';
    ctx.fillRect(p.x - 6 * p.s, p.y - 4 * p.s, 12 * p.s, 3 * p.s);
    ctx.fillStyle = '#6f6a8e';
    ctx.fillRect(p.x - 6 * p.s, p.y - 1 * p.s, 12 * p.s, 5 * p.s);
  }
  ctx.strokeStyle = '#2a2742';
  ctx.lineWidth = 7 * a.s;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y + 1);
  ctx.lineTo(b.x, b.y + 1);
  ctx.stroke();
  ctx.strokeStyle = '#8f88b3';
  ctx.lineWidth = 3.2 * a.s;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y - 1);
  ctx.lineTo(b.x, b.y - 1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y - 2.2);
  ctx.lineTo(b.x, b.y - 2.2);
  ctx.stroke();
}

const PRONGS: readonly [number, number][] = [
  [0, 1],
  [-0.8660254, -0.5],
  [0.8660254, -0.5],
];

function drawClaw(ctx: CanvasRenderingContext2D, sim: ClawSim, fx: RenderFx, ghost = false): void {
  const head = headPos(sim);
  // Trolley on the bridge.
  const tr = project(sim.gx, TOP, sim.gz);
  const hub = project(head.x, sim.hubY, head.z);
  const s = hub.s;
  ctx.fillStyle = '#1a1830';
  roundRect(ctx, tr.x - 9 * tr.s, tr.y - 5 * tr.s, 18 * tr.s, 10 * tr.s, 2);
  ctx.fill();
  ctx.fillStyle = '#c9c3e6';
  roundRect(ctx, tr.x - 8 * tr.s, tr.y - 6 * tr.s, 16 * tr.s, 7 * tr.s, 2);
  ctx.fill();
  ctx.fillStyle = '#6f6a8e';
  ctx.fillRect(tr.x - 6 * tr.s, tr.y - 2.5 * tr.s, 12 * tr.s, 1.4 * tr.s);
  // A little motor light: on while the gantry's moving.
  const moving = Math.abs(sim.vx) + Math.abs(sim.vz) > 1 || sim.phase === 'drop' || sim.phase === 'lift';
  ctx.fillStyle = moving ? '#ff3d6e' : '#5a1a30';
  ctx.fillRect(tr.x + 4 * tr.s, tr.y - 5 * tr.s, 2 * tr.s, 2 * tr.s);

  // Cable.
  ctx.strokeStyle = '#8f88b3';
  ctx.lineWidth = Math.max(1.4, 2 * s);
  ctx.beginPath();
  ctx.moveTo(tr.x, tr.y + 3 * tr.s);
  ctx.lineTo(hub.x, hub.y - 6.5 * KY * s);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(tr.x - 0.5, tr.y + 3 * tr.s);
  ctx.lineTo(hub.x - 0.5, hub.y - 6.5 * KY * s);
  ctx.stroke();

  const r = CLAW.closedR + (CLAW.openR - CLAW.closedR) * sim.open;
  const prong = (i: number) => {
    const [ux, uz] = PRONGS[i]!;
    const at = (rad: number, dy: number) => project(head.x + ux * rad, sim.hubY + dy, head.z + uz * rad);
    const base = at(3.2, -1.2);
    const knee = at(r * 1.08 + 1.2, -CLAW.prong * 0.45);
    const tip = at(r * 0.92, -CLAW.prong);
    const hook = at(Math.max(0, r * 0.92 - 2.2), -CLAW.prong + 0.8);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(hook.x, hook.y);
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    path();
    ctx.strokeStyle = '#1a1830';
    ctx.lineWidth = 6.2 * s;
    ctx.stroke();
    path();
    ctx.strokeStyle = i === 0 ? '#8f88b3' : '#d7d2ec';
    ctx.lineWidth = 3.8 * s;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.1 * s;
    ctx.beginPath();
    ctx.moveTo(base.x - 0.6, base.y);
    ctx.lineTo(knee.x - 0.6, knee.y);
    ctx.stroke();
  };

  // Back prong, the prize (tucked up under the hub), the hub, then the front prongs.
  prong(0);
  const held = !ghost && sim.held ? sim.toys.find((t) => t.id === sim.held!.id) : undefined;
  if (held) drawToy(ctx, held, fx, sim);
  const hubW = 8.5 * KX * s;
  const hubH = 6.5 * KY * s;
  ctx.fillStyle = '#1a1830';
  roundRect(ctx, hub.x - hubW / 2 - 1.5, hub.y - hubH - 1.5, hubW + 3, hubH + 3, 4 * s);
  ctx.fill();
  const g = ctx.createLinearGradient(hub.x - hubW / 2, 0, hub.x + hubW / 2, 0);
  g.addColorStop(0, '#6f6a8e');
  g.addColorStop(0.3, '#f4f1ff');
  g.addColorStop(0.55, '#b9b3d6');
  g.addColorStop(1, '#3a3656');
  ctx.fillStyle = g;
  roundRect(ctx, hub.x - hubW / 2, hub.y - hubH, hubW, hubH, 3.5 * s);
  ctx.fill();
  // A pink band and a little status light.
  ctx.fillStyle = '#ff4fd8';
  ctx.fillRect(hub.x - hubW / 2, hub.y - hubH * 0.45, hubW, 2.2 * s);
  ctx.fillStyle = sim.phase === 'close' || sim.held ? '#2de38f' : '#ffd23f';
  ctx.fillRect(hub.x - 1.5 * s, hub.y - hubH * 0.82, 3 * s, 3 * s);
  prong(1);
  prong(2);
}

function drawToy(ctx: CanvasRenderingContext2D, t: ClawToy, fx: RenderFx, sim: ClawSim): void {
  const k = KINDS[t.kind];
  const life = fx.life.get(t.id);
  const blinkCycle = (fx.time + t.id * 0.77) % (3.2 + (t.id % 5) * 0.6);
  const face: Face = life && life.happy > 0 ? 'happy' : blinkCycle < 0.12 ? 'blink' : 'open';
  const img = sprite(t.kind, t.color, face, t.mode === 'pile' ? shadeFor(t.y) : 2);
  if (!img) return;
  const p = project(t.x, t.y, t.z);
  const px = (2 * k.r * KX * p.s * SPRITE_SCALE) / img.width;
  const w = img.width * px;
  const h = img.height * px;
  const motion = fx.motion;
  const squash = (life?.squash ?? 0) * motion;
  const wob = (life?.wobble ?? 0) * motion;
  const tilt = t.tilt + wob * Math.sin(life?.wobblePhase ?? 0) * 0.35;
  ctx.save();
  if (t.mode === 'chute') {
    // Going down the hole: clip to the hole and everything above its back lip.
    const a = project(CHUTE.x0, 0, CHUTE.z1);
    const b = project(CHUTE.x1, 0, CHUTE.z1);
    const c = project(CHUTE.x1, 0, CHUTE.z0);
    const d = project(CHUTE.x0, 0, CHUTE.z0);
    ctx.beginPath();
    ctx.moveTo(a.x, 0);
    ctx.lineTo(b.x, 0);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.lineTo(a.x, a.y);
    ctx.closePath();
    ctx.clip();
  }
  ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.rotate(tilt);
  ctx.scale(1 + squash * 0.35, 1 - squash * 0.3);
  ctx.drawImage(img, Math.round(-w / 2), Math.round(-h), Math.round(w), Math.round(h));
  // Sweat drop: it's slipping.
  if (life && life.sweat > 0) {
    ctx.fillStyle = `rgba(150,220,255,${Math.min(1, life.sweat * 2).toFixed(2)})`;
    const dx = w * 0.5 + px * 0.2;
    const dy = -h * 0.8 + (1 - Math.min(1, life.sweat)) * px * 3;
    ctx.fillRect(Math.round(dx), Math.round(dy), Math.round(px), Math.round(px * 1.6));
    ctx.fillRect(Math.round(dx - px * 0.5), Math.round(dy + px), Math.round(px * 2), Math.round(px));
  }
  ctx.restore();
  void sim;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
