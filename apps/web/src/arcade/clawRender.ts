/**
 * Draws the inside of the claw machine's glass for the close-up (ClawCloseup.tsx): a fixed 3/4 view
 * looking slightly down into the case, so the pile has depth. Plushies live at (x, z) with heights;
 * everything is depth-sorted, the claw casts a shadow on whatever is under it (that shadow, the
 * gantry's bridge and the perspective are how you judge depth), and the plushies have a bit of
 * life: they blink, squash when they land, wobble when bumped and sweat when they're slipping.
 *
 * Canvas drawing only — the machine's state comes from clawPhysics.ts and is never changed here.
 * Colours are the machine's own printed/lit materials (fixed, like the floor machine's glass and plush
 * art) unless the active skin dresses the machine up (ThemeSkin.claw, resolved in clawArt.ts); the
 * chrome around the canvas takes the theme's cabinet tokens in CSS.
 */
import { interiorOf, plushArt, spriteColor, type ClawCostume, type ClawInterior, type PlushArt } from './clawArt.ts';
import {
  BOX,
  CHUTE,
  CLAW,
  GANTRY,
  KINDS,
  contactHeight,
  headPos,
  prongTips,
  surfaceAt,
  type ClawSim,
  type ClawToy,
  type ToyKind,
} from './clawPhysics.ts';

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

const SPARKLES = ['#ffd23f', '#ffffff', '#ff4fd8', '#22d3ee'] as const;

/** Throws a few bits from a point (world units). `kind` picks dust or sparkles (in `palette`, if given). */
export function burstBits(
  fx: RenderFx,
  x: number,
  y: number,
  z: number,
  kind: 'dust' | 'sparkle',
  n: number,
  palette?: readonly string[],
): void {
  if (fx.motion <= 0) return;
  const sparkles = palette?.length ? palette : SPARKLES;
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
      color: kind === 'dust' ? 'rgba(230,220,255,0.55)' : sparkles[i % sparkles.length]!,
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

function faceRows(rows: readonly string[], face: Face): readonly string[] {
  if (face === 'open') return rows;
  return rows.map((row) => {
    if (!row.includes('w')) return row;
    // Blink: the eyes shut to a soft line. Happy: squeezed shut (a dark line).
    return face === 'blink' ? row.replace(/[wk]/g, 'd') : row.replace(/w/g, 'k');
  });
}

function sprite(kind: ToyKind, color: number, face: Face, shade: number, art: PlushArt): HTMLCanvasElement | null {
  const key = `${art.key}${kind}:${color}:${face}:${shade}`;
  let c = spriteCache.get(key);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  const rows = faceRows(art.rows, face);
  c = document.createElement('canvas');
  c.width = rows[0]!.length;
  c.height = rows.length;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = spriteColor(row[x]!, color, art);
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
// Static backdrop (cached per canvas size and interior): walls, floor, the chute hole, the rails.

let backdrop: { key: string; canvas: HTMLCanvasElement } | null = null;

/** Redraws the cached backdrop next frame (e.g. once the pixel font has loaded for the wall sign). */
export function invalidateBackdrop(): void {
  backdrop = null;
}

function drawBackdrop(ctx: CanvasRenderingContext2D, I: ClawInterior): void {
  const fl = (x: number, z: number) => project(x, 0, z);
  const tp = (x: number, z: number) => project(x, TOP, z);
  const quad = (pts: { x: number; y: number }[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  };
  // The case: deep blue, lit from the top.
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  bg.addColorStop(0, I.bg[0]);
  bg.addColorStop(0.55, I.bg[1]);
  bg.addColorStop(1, I.bg[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  // Back wall, with the machine's star print.
  quad([tp(0, BOX.d), tp(BOX.w, BOX.d), fl(BOX.w, BOX.d), fl(0, BOX.d)]);
  const wall = ctx.createLinearGradient(0, tp(0, BOX.d).y, 0, fl(0, BOX.d).y);
  wall.addColorStop(0, I.wall[0]);
  wall.addColorStop(1, I.wall[1]);
  ctx.fillStyle = wall;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = `rgba(${I.neonRgb},0.16)`;
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
  if (I.webs) {
    drawWeb(ctx, tp(0, BOX.d), 1);
    drawWeb(ctx, tp(BOX.w, BOX.d), -1);
  }
  ctx.restore();

  // A neon sign on the back wall.
  {
    const c = project(BOX.w / 2, 44, BOX.d);
    ctx.save();
    let size = Math.round(30 * c.s);
    ctx.font = `${size}px Silkscreen, monospace`;
    if (I.signFit) {
      // A costume's sign shrinks to fit the wall (the machine's own sign is drawn as it always was).
      const room = (project(BOX.w, 44, BOX.d).x - project(0, 44, BOX.d).x) * 0.88;
      const width = ctx.measureText(I.sign).width;
      if (width > room) {
        size = Math.max(10, Math.floor((size * room) / width));
        ctx.font = `${size}px Silkscreen, monospace`;
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = I.neon;
    ctx.shadowBlur = 16;
    ctx.fillStyle = I.signGlow;
    ctx.fillText(I.sign, c.x, c.y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = I.signCore;
    ctx.fillText(I.sign, c.x, c.y);
    ctx.restore();
  }

  // Side walls (mirror panels, darker).
  for (const x of [0, BOX.w]) {
    quad([tp(x, BOX.d), tp(x, 0), fl(x, 0), fl(x, BOX.d)]);
    const side = ctx.createLinearGradient(tp(x, 0).x, 0, tp(x, BOX.d).x, 0);
    side.addColorStop(0, I.side[0]);
    side.addColorStop(1, I.side[1]);
    ctx.fillStyle = side;
    ctx.fill();
  }

  // Floor: plum felt with a faint weave.
  quad([fl(0, BOX.d), fl(BOX.w, BOX.d), fl(BOX.w, 0), fl(0, 0)]);
  const floor = ctx.createLinearGradient(0, fl(0, BOX.d).y, 0, fl(0, 0).y);
  floor.addColorStop(0, I.floor[0]);
  floor.addColorStop(1, I.floor[1]);
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
    ctx.strokeStyle = `rgba(${I.neonRgb},${(0.18 - i * 0.04).toFixed(2)})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  quad([fl(CHUTE.x0, CHUTE.z1), fl(CHUTE.x1, CHUTE.z1), fl(CHUTE.x1, CHUTE.z0), fl(CHUTE.x0, CHUTE.z0)]);
  ctx.save();
  ctx.shadowColor = I.neon;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = I.rim;
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

/** A cobweb in a top corner of the back wall (`dir` 1: the left corner, spreading right; -1: the right one). */
function drawWeb(ctx: CanvasRenderingContext2D, corner: { x: number; y: number }, dir: 1 | -1): void {
  const R = 46;
  const spokes = 5;
  const at = (i: number, r: number) => {
    const a = (i / (spokes - 1)) * (Math.PI / 2);
    return { x: corner.x + dir * Math.cos(a) * r, y: corner.y + Math.sin(a) * r };
  };
  ctx.save();
  ctx.strokeStyle = 'rgba(232,224,255,0.2)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < spokes; i++) {
    const p = at(i, R);
    ctx.moveTo(corner.x, corner.y);
    ctx.lineTo(p.x, p.y);
  }
  // The rings sag a little between spokes.
  for (const r of [R * 0.36, R * 0.62, R * 0.9]) {
    for (let i = 0; i < spokes - 1; i++) {
      const a = at(i, r);
      const b = at(i + 1, r);
      const m = at(i + 0.5, r * 0.86);
      if (i === 0) ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(m.x, m.y, b.x, b.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------
// The frame

type Drawable = { z: number; y: number; draw: () => void };

/** One frame of the glass's inside. `costume`: the active skin's (ThemeSkin.claw), if any. */
export function drawClawScene(
  ctx: CanvasRenderingContext2D,
  sim: ClawSim,
  fx: RenderFx,
  scale: number,
  costume?: ClawCostume | null,
): void {
  const I = interiorOf(costume);
  const key = `${I.key}${ctx.canvas.width}x${ctx.canvas.height}`;
  if (!backdrop || backdrop.key !== key) {
    const c = document.createElement('canvas');
    c.width = ctx.canvas.width;
    c.height = ctx.canvas.height;
    const b = c.getContext('2d');
    if (b) {
      b.setTransform(scale, 0, 0, scale, 0, 0);
      drawBackdrop(b, I);
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
    items.push({ z: t.z, y: t.y, draw: () => drawToy(ctx, t, fx, costume) });
    if (t.mode === 'fall') {
      const ground = surfaceAt(sim.toys, t.x, t.z, t.id);
      items.push({ z: t.z + 3, y: ground, draw: () => drawDropShadow(ctx, t.x, ground, t.z, KINDS[t.kind].r, t.y - ground) });
    }
  }
  // The chute's clear walls stand between the pile and the glass.
  items.push({ z: CHUTE.z1 - 0.5, y: 0, draw: () => drawChuteWalls(ctx, I) });
  items.sort((a, b) => b.z - a.z || a.y - b.y);

  // The bridge rides over everything at the top.
  drawBridge(ctx, sim, I);
  // Everything behind the claw (and the toys it's over), then its shadow on them — the depth cue —
  // then the claw with whatever it holds, then everything nearer the glass.
  const split = head.z - 6;
  for (const it of items) if (it.z >= split) it.draw();
  // The claw's shadow on the top of whatever is right under it, and — while you aim — its footprint
  // draped over the pile: where each prong tip will come down (amber: on a plush that will stop it high).
  const surf = surfaceAt(sim.toys, head.x, head.z);
  const marks = aimMarks(sim);
  drawClawShadow(ctx, head.x, surf, head.z, sim.hubY - CLAW.prong - surf);
  if (marks) drawAimMarks(ctx, marks, 1);
  drawClaw(ctx, sim, fx, costume);
  let infront = false;
  for (const it of items) {
    if (it.z >= split) continue;
    it.draw();
    infront = true;
  }
  // X-ray: wherever the plushies nearer the glass hide the claw or its footprint, a ghost still shows.
  if (infront) {
    if (marks) drawAimMarks(ctx, marks, 0.45);
    if (sim.hubY < 40) {
      ctx.globalAlpha = 0.28;
      drawClaw(ctx, sim, fx, costume, true);
      ctx.globalAlpha = 1;
    }
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
  // Crisp enough to find from the top of the case; sharper and darker as the claw comes down.
  const k = Math.max(0, Math.min(1, 1 - h / 55));
  const rx = (4.5 + h * 0.03) * KX * p.s;
  const ry = rx * 0.5;
  ctx.fillStyle = `rgba(8,2,20,${(0.42 + 0.3 * k).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(8,2,20,${(0.2 + 0.2 * k).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx * 1.5, ry * 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

interface AimMarks {
  ring: { x: number; y: number }[];
  /** The aiming laser: from under the hub down to the spot. */
  laser: { x0: number; y0: number; x1: number; y1: number };
  tips: { x: number; y: number; high: boolean }[];
  centre: { x: number; y: number };
  alpha: number;
}

/** The claw's open footprint draped over the pile (null when there's nothing to aim). */
function aimMarks(sim: ClawSim): AimMarks | null {
  const aiming = sim.phase === 'aim';
  const dropping = sim.phase === 'drop';
  if (!aiming && !dropping) return null;
  const head = headPos(sim);
  // Fade out as the real prongs come down onto the spot.
  const alpha = aiming ? Math.min(1, sim.t * 3) : Math.max(0, Math.min(1, (sim.hubY - contactHeight(sim, head.x, head.z)) / 20));
  if (alpha <= 0.02) return null;
  // The footprint, level at the height the claw comes down to (clean to read, unlike a ring draped
  // over every bump of the pile); the prong marks below sit on their own spots.
  const ground = Math.max(0, surfaceAt(sim.toys, head.x, head.z) - 1);
  const ring: { x: number; y: number }[] = [];
  for (const [cx, cz] of CIRCLE) ring.push(project(head.x + cx * CLAW.openR, ground, head.z + cz * CLAW.openR));
  const hubStop = surfaceAt(sim.toys, head.x, head.z) - CLAW.sink;
  const tips = prongTips(head.x, head.z).map(([x, z]) => {
    const y = surfaceAt(sim.toys, x, z);
    const stopAt = y - CLAW.tipSink + CLAW.prong;
    const p = project(x, y, z);
    return { x: p.x, y: p.y, high: stopAt > hubStop + 0.5 && y > 0.5 };
  });
  const c = project(head.x, surfaceAt(sim.toys, head.x, head.z), head.z);
  const top = project(head.x, sim.hubY - CLAW.prong * 0.4, head.z);
  return { ring, tips, centre: { x: c.x, y: c.y }, laser: { x0: top.x, y0: top.y, x1: c.x, y1: c.y }, alpha };
}

const CIRCLE: [number, number][] = (() => {
  const out: [number, number][] = [];
  let x = 1;
  let z = 0;
  const n = 36;
  // rotate a unit vector by 10° each step (cos/sin of 10° as constants)
  const c = 0.984807753;
  const sn = 0.173648178;
  for (let i = 0; i < n; i++) {
    out.push([x, z]);
    [x, z] = [x * c - z * sn, x * sn + z * c];
  }
  return out;
})();

function drawAimMarks(ctx: CanvasRenderingContext2D, m: AimMarks, alpha: number): void {
  ctx.globalAlpha = alpha * m.alpha;
  // The aiming laser (a faint pink line, like a real machine's pointer).
  ctx.strokeStyle = 'rgba(255,90,200,0.45)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(m.laser.x0, m.laser.y0);
  ctx.lineTo(m.laser.x1, m.laser.y1);
  ctx.stroke();
  ctx.setLineDash([]);
  // The footprint: a ring (a dark casing under a light dashed line, so it reads on any plush).
  const ring = () => {
    ctx.beginPath();
    m.ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ring();
  ctx.strokeStyle = 'rgba(12,4,26,0.85)';
  ctx.lineWidth = 5;
  ctx.setLineDash([]);
  ctx.stroke();
  ring();
  ctx.strokeStyle = '#ffd9f6';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Where each prong tip lands (amber: on another plush — it will stop high and pinch).
  for (const t of m.tips) {
    blk(ctx, t.x - 6, t.y - 6, 12, 12, '#140a24');
    blk(ctx, t.x - 4, t.y - 4, 8, 8, t.high ? '#ffb43f' : '#f4f1ff');
  }
  // The claw's axis.
  const c = m.centre;
  blk(ctx, c.x - 8, c.y - 2.5, 16, 5, '#140a24');
  blk(ctx, c.x - 2.5, c.y - 8, 5, 16, '#140a24');
  blk(ctx, c.x - 6.5, c.y - 1, 13, 2, '#ffffff');
  blk(ctx, c.x - 1, c.y - 6.5, 2, 13, '#ffffff');
  ctx.globalAlpha = 1;
}

function drawChuteWalls(ctx: CanvasRenderingContext2D, I: ClawInterior): void {
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
    g.addColorStop(0, I.chutePanel);
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
  ctx.fillStyle = `rgba(${I.neonRgb},0.7)`;
  ctx.font = `${Math.round(9 * lab.s)}px Silkscreen, monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('PRIZE', lab.x, lab.y + 3);
}

function drawBridge(ctx: CanvasRenderingContext2D, sim: ClawSim, I: ClawInterior): void {
  const a = project(0, TOP, sim.gz);
  const b = project(BOX.w, TOP, sim.gz);
  // The bridge's carriages on the side rails (where along the depth it is).
  for (const p of [project(1.2, TOP, sim.gz), project(BOX.w - 1.2, TOP, sim.gz)]) {
    ctx.fillStyle = '#1a1830';
    ctx.fillRect(p.x - 7 * p.s, p.y - 5 * p.s, 14 * p.s, 10 * p.s);
    ctx.fillStyle = I.neon;
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

/** Snapped pixel block (logical units; the canvas scale makes them crisp device pixels). */
function blk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** A chunky pixel line: square blocks stepped along a–b (the claw's parts, in the plushies' language). */
function pixelLine(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  size: number,
  color: string,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, size * 0.5)));
  for (let i = 0; i <= n; i++) {
    const x = a.x + (dx * i) / n;
    const y = a.y + (dy * i) / n;
    blk(ctx, x - size / 2, y - size / 2, size, size, color);
  }
}

const CHROME = { outline: '#141225', dark: '#6f6a8e', mid: '#c9c3e6', light: '#f4f1ff', back: '#8f88b3' } as const;

function drawClaw(ctx: CanvasRenderingContext2D, sim: ClawSim, fx: RenderFx, costume: ClawCostume | null | undefined, ghost = false): void {
  const head = headPos(sim);
  // Trolley on the bridge.
  const tr = project(sim.gx, TOP, sim.gz);
  const hub = project(head.x, sim.hubY, head.z);
  const s = hub.s;
  const P = Math.max(2, KX * s * 1.05); // one art pixel, like the plushies'
  const tp = Math.max(2, KX * tr.s * 1.05);
  blk(ctx, tr.x - tp * 2.6, tr.y - tp * 1.6, tp * 5.2, tp * 2.8, CHROME.outline);
  blk(ctx, tr.x - tp * 2.2, tr.y - tp * 1.3, tp * 4.4, tp * 1.2, CHROME.mid);
  blk(ctx, tr.x - tp * 2.2, tr.y - tp * 0.1, tp * 4.4, tp * 0.9, CHROME.dark);
  // A little motor light: on while the gantry's moving.
  const moving = Math.abs(sim.vx) + Math.abs(sim.vz) > 1 || sim.phase === 'drop' || sim.phase === 'lift';
  blk(ctx, tr.x + tp * 1.1, tr.y - tp * 1.1, tp * 0.8, tp * 0.8, moving ? '#ff3d6e' : '#5a1a30');

  // Cable.
  const hubW = 8.5 * KX * s;
  const hubH = 6.5 * KY * s;
  const cableTop = { x: tr.x, y: tr.y + tp * 1.2 };
  const cableBot = { x: hub.x, y: hub.y - hubH };
  pixelLine(ctx, cableTop, cableBot, Math.max(2, P * 0.55), CHROME.outline);
  pixelLine(ctx, cableTop, cableBot, Math.max(1, P * 0.3), CHROME.back);

  const r = CLAW.closedR + (CLAW.openR - CLAW.closedR) * sim.open;
  // Prong tips that got purchase light up green while it closes and lifts (amber: only a little).
  const showGrip = !ghost && sim.grip && sim.grip.toy !== null && (sim.phase === 'close' || sim.phase === 'lift' || sim.phase === 'top');
  const prong = (i: number) => {
    const [ux, uz] = PRONGS[i]!;
    const at = (rad: number, dy: number) => project(head.x + ux * rad, sim.hubY + dy, head.z + uz * rad);
    const base = at(3.2, -0.6);
    const knee = at(r * 1.08 + 1.2, -CLAW.prong * 0.45);
    const tip = at(r * 0.92, -CLAW.prong);
    const hook = at(Math.max(0, r * 0.92 - 2.4), -CLAW.prong + 1);
    const body = i === 0 ? CHROME.back : CHROME.mid;
    // outline, fill, then a highlight down the upper arm
    pixelLine(ctx, base, knee, P * 1.9, CHROME.outline);
    pixelLine(ctx, knee, tip, P * 1.9, CHROME.outline);
    pixelLine(ctx, tip, hook, P * 1.9, CHROME.outline);
    pixelLine(ctx, base, knee, P, body);
    pixelLine(ctx, knee, tip, P, body);
    pixelLine(ctx, tip, hook, P, body);
    if (i !== 0)
      pixelLine(ctx, { x: base.x - P * 0.3, y: base.y - P * 0.3 }, { x: knee.x - P * 0.3, y: knee.y - P * 0.3 }, P * 0.45, CHROME.light);
    const q = sim.grip?.prongs[i] ?? 0;
    const tipColor = showGrip ? (q > 0.3 ? '#2de38f' : q > 0 ? '#ffb43f' : CHROME.dark) : CHROME.dark;
    blk(ctx, hook.x - P * 0.8, hook.y - P * 0.8, P * 1.6, P * 1.6, CHROME.outline);
    blk(ctx, hook.x - P * 0.5, hook.y - P * 0.5, P, P, tipColor);
  };

  // Back prong, the prize (tucked up under the hub), the hub, then the front prongs.
  prong(0);
  const held = !ghost && sim.held ? sim.toys.find((t) => t.id === sim.held!.id) : undefined;
  if (held) drawToy(ctx, held, fx, costume);
  const x0 = hub.x - hubW / 2;
  const y0 = hub.y - hubH;
  blk(ctx, x0 - P * 0.5, y0 - P * 0.5, hubW + P, hubH + P, CHROME.outline);
  blk(ctx, x0, y0, hubW, hubH, CHROME.mid);
  blk(ctx, x0, y0, P, hubH, CHROME.light);
  blk(ctx, x0 + hubW - P, y0, P, hubH, CHROME.dark);
  blk(ctx, x0, y0 + hubH - P * 0.8, hubW, P * 0.8, CHROME.dark);
  // A band in the machine's neon and a little status light.
  blk(ctx, x0, y0 + hubH * 0.45, hubW, P * 0.7, interiorOf(costume).neon);
  blk(ctx, hub.x - P * 0.5, y0 + P * 0.5, P, P, sim.phase === 'close' || sim.held ? '#2de38f' : '#ffd23f');
  prong(1);
  prong(2);
}

function drawToy(ctx: CanvasRenderingContext2D, t: ClawToy, fx: RenderFx, costume: ClawCostume | null | undefined): void {
  const k = KINDS[t.kind];
  const life = fx.life.get(t.id);
  const blinkCycle = (fx.time + t.id * 0.77) % (3.2 + (t.id % 5) * 0.6);
  const face: Face = life && life.happy > 0 ? 'happy' : blinkCycle < 0.12 ? 'blink' : 'open';
  const img = sprite(t.kind, t.color, face, t.mode === 'pile' ? shadeFor(t.y) : 2, plushArt(t.kind, costume));
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
}
