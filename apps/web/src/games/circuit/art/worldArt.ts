/**
 * Procedural world art for DASh Circuit, drawn once into canvases at load:
 * track tiles (road, curbs, barriers, markings, light pools), the repeating city
 * street tile, parks, parking lots, roofs, grandstands, billboards and the flyover
 * deck. Neon night-city look with pixel-art details.
 */
import { levelAt, pointAt, type Bridge, type Building, type Decor, type Track, type TrackTheme } from '@dascade/game-core/circuit';
import { artRng, DISPLAY_FONT, NEON, PIXEL_FONT, rgba, shade } from './palette.ts';

export const TILE = 1024;

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

function noiseCanvas(size: number, base: string, specks: Array<[string, number]>, seed: number, pixel = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const rnd = artRng(seed);
  for (const [color, count] of specks) {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) g.fillRect(Math.floor((rnd() * size) / pixel) * pixel, Math.floor((rnd() * size) / pixel) * pixel, pixel, pixel);
  }
  return c;
}

interface Patterns {
  asphalt: CanvasPattern;
  gravel: CanvasPattern;
  plaza: CanvasPattern;
}

function makePatterns(ctx: CanvasRenderingContext2D, theme: TrackTheme): Patterns {
  const asphalt = noiseCanvas(
    96,
    theme.road,
    [
      [shade(theme.road, 0.08), 600],
      [shade(theme.road, -0.2), 600],
      [shade(theme.road, 0.22), 60],
    ],
    11,
  );
  const gravel = noiseCanvas(
    64,
    theme.runoff,
    [
      [shade(theme.runoff, 0.1), 150],
      [shade(theme.runoff, -0.18), 150],
      [rgba(theme.neonA, 0.12), 4],
    ],
    23,
    2,
  );
  const plaza = document.createElement('canvas');
  plaza.width = 64;
  plaza.height = 64;
  const pg = plaza.getContext('2d')!;
  pg.fillStyle = '#121728';
  pg.fillRect(0, 0, 64, 64);
  pg.fillStyle = '#161c30';
  pg.fillRect(0, 0, 31, 31);
  pg.fillRect(32, 32, 31, 31);
  pg.fillStyle = 'rgba(0,0,0,0.35)';
  pg.fillRect(0, 31, 64, 1);
  pg.fillRect(31, 0, 1, 64);
  pg.fillRect(0, 63, 64, 1);
  pg.fillRect(63, 0, 1, 64);
  return {
    asphalt: ctx.createPattern(asphalt, 'repeat')!,
    gravel: ctx.createPattern(gravel, 'repeat')!,
    plaza: ctx.createPattern(plaza, 'repeat')!,
  };
}

// ---------------------------------------------------------------------------
// Track geometry helpers
// ---------------------------------------------------------------------------

function tracePath(ctx: CanvasRenderingContext2D, track: Track, offset = 0): void {
  ctx.beginPath();
  for (let i = 0; i < track.n; i++) {
    const x = track.xs[i]! - track.ty[i]! * offset;
    const y = track.ys[i]! + track.tx[i]! * offset;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function edge(track: Track, i: number, d: number): [number, number] {
  const k = ((i % track.n) + track.n) % track.n;
  return [track.xs[k]! - track.ty[k]! * d, track.ys[k]! + track.tx[k]! * d];
}

function quad(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], c: [number, number], d: [number, number]): void {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.lineTo(d[0], d[1]);
  ctx.closePath();
  ctx.fill();
}

/** Smoothed curvature (for curbs / racing line). */
function smoothedCurvature(track: Track, radius: number): Float64Array {
  const out = new Float64Array(track.n);
  for (let i = 0; i < track.n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += track.curvature[(i + k + track.n) % track.n]!;
    out[i] = sum / (radius * 2 + 1);
  }
  return out;
}

const curvCache = new WeakMap<Track, { curb: Float64Array; line: Float64Array }>();
function curves(track: Track) {
  let c = curvCache.get(track);
  if (!c) {
    const curb = smoothedCurvature(track, 4);
    const k = smoothedCurvature(track, 30);
    const line = new Float64Array(track.n);
    for (let i = 0; i < track.n; i++) line[i] = Math.max(-0.55, Math.min(0.55, k[i]! * 260)) * track.halfWidth;
    c = { curb, line };
    curvCache.set(track, c);
  }
  return c;
}

/** Tiles (top-left corners) that the track corridor + trackside band touches. */
export function trackTiles(track: Track, margin: number): Array<{ x: number; y: number }> {
  const set = new Set<string>();
  const out: Array<{ x: number; y: number }> = [];
  const reach = track.wall + margin;
  for (let i = 0; i < track.n; i += 3) {
    const x0 = Math.floor((track.xs[i]! - reach) / TILE);
    const x1 = Math.floor((track.xs[i]! + reach) / TILE);
    const y0 = Math.floor((track.ys[i]! - reach) / TILE);
    const y1 = Math.floor((track.ys[i]! + reach) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const key = `${tx},${ty}`;
        if (set.has(key)) continue;
        set.add(key);
        out.push({ x: tx * TILE, y: ty * TILE });
      }
    }
  }
  return out;
}

export const TRACKSIDE_BAND = 118;

// ---------------------------------------------------------------------------
// Track tile
// ---------------------------------------------------------------------------

export function drawTrackTile(ctx: CanvasRenderingContext2D, ox: number, oy: number, scale: number, track: Track, decor: Decor, quality: 'high' | 'low'): void {
  const theme = track.def.theme;
  const pats = makePatterns(ctx, theme);
  const hw = track.halfWidth;
  const wall = track.wall;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-ox, -oy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Trackside plaza band + its kerb.
  tracePath(ctx, track);
  ctx.lineWidth = (wall + TRACKSIDE_BAND) * 2 + 6;
  ctx.strokeStyle = '#232a44';
  ctx.stroke();
  tracePath(ctx, track);
  ctx.lineWidth = (wall + TRACKSIDE_BAND) * 2;
  ctx.strokeStyle = pats.plaza;
  ctx.stroke();

  // Lamp light pools on the plaza (under the barrier).
  if (quality === 'high') drawLightPools(ctx, track, decor, 0.1);

  // Barrier body, neon tube and run-off.
  tracePath(ctx, track);
  ctx.lineWidth = wall * 2 + 16;
  ctx.strokeStyle = shade(theme.barrier, -0.35);
  ctx.stroke();
  tracePath(ctx, track);
  ctx.lineWidth = wall * 2 + 11;
  ctx.strokeStyle = theme.barrier;
  ctx.stroke();
  ctx.save();
  if (quality === 'high') {
    ctx.shadowColor = theme.neonA;
    ctx.shadowBlur = 14;
  }
  tracePath(ctx, track);
  ctx.lineWidth = wall * 2 + 3;
  ctx.strokeStyle = theme.neonA;
  ctx.stroke();
  ctx.restore();
  tracePath(ctx, track);
  ctx.lineWidth = wall * 2 - 1;
  ctx.strokeStyle = pats.gravel;
  ctx.stroke();

  // Chevrons on the outside barrier of tight corners.
  drawChevrons(ctx, track);

  // Road edge line then asphalt.
  tracePath(ctx, track);
  ctx.lineWidth = hw * 2 + 5;
  ctx.strokeStyle = '#e6ebff';
  ctx.stroke();
  tracePath(ctx, track);
  ctx.lineWidth = hw * 2;
  ctx.strokeStyle = pats.asphalt;
  ctx.stroke();

  // Rubbered-in racing line.
  const { line } = curves(track);
  ctx.beginPath();
  for (let i = 0; i <= track.n; i++) {
    const [x, y] = edge(track, i, line[i % track.n]!);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.lineWidth = 34;
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.stroke();

  // Wet sheen streaks and puddles.
  if (quality === 'high') drawWetSheen(ctx, track);

  // Curbs and edge lines.
  drawCurbs(ctx, track);

  // Light pools spilling onto the road (wet reflections).
  if (quality === 'high') drawLightPools(ctx, track, decor, 0.16);

  // Start/finish, grid boxes and painted logos.
  drawStartFinish(ctx, track);
  drawGridBoxes(ctx, track);
  drawRoadPaint(ctx, track);

  ctx.restore();
}

function drawChevrons(ctx: CanvasRenderingContext2D, track: Track): void {
  const { curb } = curves(track);
  const theme = track.def.theme;
  for (let i = 0; i < track.n; i += 5) {
    const k = curb[i]!;
    if (Math.abs(k) < 1 / 330) continue;
    const side = -Math.sign(k);
    const [x, y] = edge(track, i, side * (track.wall - 8));
    const ang = Math.atan2(track.ty[i]!, track.tx[i]!);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = '#0b0914';
    ctx.fillRect(-9, -6, 18, 12);
    ctx.fillStyle = theme.neonB;
    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.lineTo(3, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-1, 5);
    ctx.lineTo(7, 0);
    ctx.lineTo(-1, -5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawCurbs(ctx: CanvasRenderingContext2D, track: Track): void {
  const { curb } = curves(track);
  const theme = track.def.theme;
  const hw = track.halfWidth;
  const inner = hw - track.rumble;
  // Thin edge line everywhere, curbs in corners.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= track.n; i++) {
      const [x, y] = edge(track, i, side * (inner - 2));
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(230,235,255,0.55)';
    ctx.stroke();
  }
  for (let i = 0; i < track.n; i++) {
    const k = curb[i]!;
    if (Math.abs(k) < 1 / 650) continue;
    for (const side of [-1, 1]) {
      const block = Math.floor(i / 2) % 2 === 0;
      ctx.fillStyle = block ? theme.curb : theme.neonB;
      quad(ctx, edge(track, i, side * inner), edge(track, i + 1, side * inner), edge(track, i + 1, side * hw), edge(track, i, side * hw));
    }
  }
  // Curb shading on the inner lip.
  for (let i = 0; i < track.n; i++) {
    if (Math.abs(curb[i]!) < 1 / 650) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const side of [-1, 1]) quad(ctx, edge(track, i, side * inner), edge(track, i + 1, side * inner), edge(track, i + 1, side * (inner + 2.5)), edge(track, i, side * (inner + 2.5)));
  }
}

function drawLightPools(ctx: CanvasRenderingContext2D, track: Track, decor: Decor, alpha: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const colors = [track.def.theme.neonA, track.def.theme.neonB, '#ff4fd8'];
  for (const lamp of decor.lamps) {
    const col = colors[lamp.tone % colors.length]!;
    const g = ctx.createRadialGradient(lamp.x, lamp.y, 4, lamp.x, lamp.y, 190);
    g.addColorStop(0, rgba(col, alpha * 1.6));
    g.addColorStop(0.35, rgba(col, alpha * 0.6));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(lamp.x - 190, lamp.y - 190, 380, 380);
  }
  for (const b of decor.billboards) {
    const col = NEON[b.tone % NEON.length]!;
    const g = ctx.createRadialGradient(b.x, b.y, 10, b.x, b.y, 260);
    g.addColorStop(0, rgba(col, alpha * 1.3));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(b.x - 260, b.y - 260, 520, 520);
  }
  ctx.restore();
}

function drawWetSheen(ctx: CanvasRenderingContext2D, track: Track): void {
  const rnd = artRng(track.def.decorSeed + 5);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 0; k < track.n / 18; k++) {
    const i = Math.floor(rnd() * track.n);
    const len = 8 + Math.floor(rnd() * 26);
    const d = (rnd() * 2 - 1) * track.halfWidth * 0.8;
    ctx.beginPath();
    for (let j = 0; j < len; j++) {
      const [x, y] = edge(track, i + j, d + Math.sin(j * 0.3) * 3);
      if (j) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.lineWidth = 3 + rnd() * 9;
    ctx.strokeStyle = `rgba(140,190,255,${0.025 + rnd() * 0.04})`;
    ctx.stroke();
  }
  ctx.restore();
  // Puddles.
  for (let k = 0; k < track.length / 700; k++) {
    const i = Math.floor(rnd() * track.n);
    const d = (rnd() * 2 - 1) * track.halfWidth * 0.7;
    const [x, y] = edge(track, i, d);
    const ang = Math.atan2(track.ty[i]!, track.tx[i]!);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + (rnd() - 0.5) * 0.4);
    const rx = 22 + rnd() * 40;
    const ry = 7 + rnd() * 12;
    ctx.fillStyle = 'rgba(4,6,14,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,200,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(160,210,255,0.08)';
    ctx.beginPath();
    ctx.ellipse(-rx * 0.25, -ry * 0.3, rx * 0.4, ry * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawStartFinish(ctx: CanvasRenderingContext2D, track: Track): void {
  const p = pointAt(track, 0);
  const ang = Math.atan2(p.ty, p.tx);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ang);
  const hw = track.halfWidth;
  const sq = 8;
  for (let r = 0; r < 3; r++) {
    for (let c = -Math.ceil(hw / sq); c < Math.ceil(hw / sq); c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f8f6ff' : '#0b0914';
      ctx.fillRect(-12 + r * sq, c * sq, sq, sq);
    }
  }
  ctx.fillStyle = 'rgba(248,246,255,0.08)';
  ctx.fillRect(-12, -hw, 24, hw * 2);
  ctx.restore();
}

function drawGridBoxes(ctx: CanvasRenderingContext2D, track: Track): void {
  ctx.save();
  ctx.font = `10px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  track.grid.forEach((slot, i) => {
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.rotate(slot.heading);
    ctx.strokeStyle = 'rgba(248,246,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, -18);
    ctx.lineTo(30, -18);
    ctx.lineTo(30, 18);
    ctx.lineTo(4, 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-26, -18);
    ctx.lineTo(-18, -18);
    ctx.moveTo(-26, 18);
    ctx.lineTo(-18, 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(248,246,255,0.55)';
    ctx.save();
    ctx.translate(-34, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(String(i + 1), 0, 0);
    ctx.restore();
    ctx.restore();
  });
  ctx.restore();
}

function drawRoadPaint(ctx: CanvasRenderingContext2D, track: Track): void {
  const theme = track.def.theme;
  const paint = (sPos: number, text: string, color: string, size: number, alpha: number) => {
    const p = pointAt(track, sPos);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.ty, p.tx) + Math.PI / 2);
    ctx.font = `${size}px ${DISPLAY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(color, alpha);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  paint(260, 'DASH', '#f8f6ff', 64, 0.1);
  paint(track.length - 820, track.def.name.toUpperCase(), theme.neonA, 34, 0.1);
  // Painted run-off sponsor bands on long straights.
  for (let sPos = 1400; sPos < track.length - 900; sPos += 2600) {
    if (levelAt(track, sPos)) continue;
    const p = pointAt(track, sPos);
    for (const side of [-1, 1]) {
      const off = side * (track.halfWidth + track.runoff * 0.5);
      ctx.save();
      ctx.translate(p.x - p.ty * off, p.y + p.tx * off);
      ctx.rotate(p.tx < 0 ? Math.atan2(p.ty, p.tx) + Math.PI : Math.atan2(p.ty, p.tx));
      ctx.font = `18px ${PIXEL_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(side > 0 ? theme.neonA : theme.neonB, 0.28);
      ctx.fillText('DASCADE', 0, 0);
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Flyover deck (drawn above the lower pass)
// ---------------------------------------------------------------------------

export function renderDeck(track: Track, bridge: Bridge, scale: number): { canvas: HTMLCanvasElement; x: number; y: number } {
  const span = bridge.to >= bridge.from ? bridge.to - bridge.from : track.length - bridge.from + bridge.to;
  const samples = Math.ceil(span / track.spacing);
  const i0 = Math.floor(bridge.from / track.spacing);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const reach = track.wall + 40;
  for (let k = 0; k <= samples; k++) {
    const i = (i0 + k) % track.n;
    minX = Math.min(minX, track.xs[i]! - reach);
    maxX = Math.max(maxX, track.xs[i]! + reach);
    minY = Math.min(minY, track.ys[i]! - reach);
    maxY = Math.max(maxY, track.ys[i]! + reach);
  }
  const w = Math.ceil(maxX - minX);
  const h = Math.ceil(maxY - minY);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const theme = track.def.theme;
  const pats = makePatterns(ctx, theme);
  const path = (d: number, from = 0, to = samples) => {
    ctx.beginPath();
    for (let k = from; k <= to; k++) {
      const [x, y] = edge(track, i0 + k, d);
      if (k === from) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  // Fade the deck in/out at the ramps so it blends into the ground-level road.
  const fadeK = Math.floor(samples * 0.18);
  const mid = Math.floor(samples / 2);
  // Drop shadow on the lower level.
  ctx.save();
  ctx.translate(18, 26);
  ctx.filter = 'blur(10px)';
  path(0, fadeK, samples - fadeK);
  ctx.lineWidth = track.wall * 2 + 20;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
  ctx.restore();
  // Deck structure (girders visible beyond the barrier).
  path(0, fadeK - 4, samples - fadeK + 4);
  ctx.lineWidth = track.wall * 2 + 26;
  ctx.strokeStyle = '#1a1830';
  ctx.stroke();
  // Barriers + neon railings.
  path(0);
  ctx.lineWidth = track.wall * 2 + 14;
  ctx.strokeStyle = theme.barrier;
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = theme.neonB;
  ctx.shadowBlur = 12;
  path(0);
  ctx.lineWidth = track.wall * 2 + 4;
  ctx.strokeStyle = theme.neonB;
  ctx.stroke();
  ctx.restore();
  path(0);
  ctx.lineWidth = track.wall * 2 - 1;
  ctx.strokeStyle = pats.gravel;
  ctx.stroke();
  path(0);
  ctx.lineWidth = track.halfWidth * 2 + 5;
  ctx.strokeStyle = '#e6ebff';
  ctx.stroke();
  path(0);
  ctx.lineWidth = track.halfWidth * 2;
  ctx.strokeStyle = pats.asphalt;
  ctx.stroke();
  for (const side of [-1, 1]) {
    path(side * (track.halfWidth - track.rumble - 2));
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(230,235,255,0.55)';
    ctx.stroke();
  }
  // Expansion joints.
  for (let k = fadeK; k <= samples - fadeK; k += 12) {
    const a = edge(track, i0 + k, -track.halfWidth);
    const b = edge(track, i0 + k, track.halfWidth);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  // "FLYOVER" paint.
  const [cx, cy] = edge(track, i0 + mid, 0);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(track.ty[(i0 + mid) % track.n]!, track.tx[(i0 + mid) % track.n]!) + Math.PI / 2);
  ctx.font = `26px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = rgba(theme.neonB, 0.22);
  ctx.fillText('FLYOVER', 0, 0);
  ctx.restore();
  // Soft ramp fade: erase the ends gradually.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < fadeK; k++) {
    const a = 1 - k / fadeK;
    for (const kk of [k, samples - k]) {
      const p0 = edge(track, i0 + kk, -track.wall - 30);
      const p1 = edge(track, i0 + kk, track.wall + 30);
      const q0 = edge(track, i0 + kk + (kk < mid ? 1 : -1), -track.wall - 30);
      const q1 = edge(track, i0 + kk + (kk < mid ? 1 : -1), track.wall + 30);
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      quad(ctx, p0, q0, q1, p1);
    }
  }
  ctx.restore();
  return { canvas, x: minX, y: minY };
}

// ---------------------------------------------------------------------------
// City street tile (repeating)
// ---------------------------------------------------------------------------

export function cityTileCanvas(decor: Decor, scale: number): HTMLCanvasElement {
  const cell = decor.cell;
  const street = decor.street;
  const c = document.createElement('canvas');
  c.width = Math.round(cell * scale);
  c.height = Math.round(cell * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.imageSmoothingEnabled = false;
  // Street asphalt.
  g.fillStyle = '#0c0f1c';
  g.fillRect(0, 0, cell, cell);
  const rnd = artRng(99);
  g.fillStyle = '#0f1322';
  for (let i = 0; i < 500; i++) g.fillRect(Math.floor(rnd() * cell), Math.floor(rnd() * cell), 2, 2);
  // Lane dashes along the tile edges (streets are centred on tile boundaries).
  g.fillStyle = 'rgba(255,210,63,0.35)';
  for (let t = 0; t < cell; t += 24) {
    g.fillRect(t, 0, 12, 1);
    g.fillRect(t, cell - 1, 12, 1);
    g.fillRect(0, t, 1, 12);
    g.fillRect(cell - 1, t, 1, 12);
  }
  const b0 = street / 2;
  const bs = cell - street;
  // Crosswalks at the corners.
  g.fillStyle = 'rgba(230,235,255,0.22)';
  for (let k = 0; k < 5; k++) {
    g.fillRect(b0 - 20 + k * 0, b0 + 6 + k * 6, 16, 3);
    g.fillRect(b0 + 6 + k * 6, b0 - 20, 3, 16);
    g.fillRect(b0 + bs + 4, b0 + bs - 30 + k * 6, 16, 3);
    g.fillRect(b0 + bs - 30 + k * 6, b0 + bs + 4, 3, 16);
  }
  // Sidewalk ring + block base.
  g.fillStyle = '#1a2036';
  g.fillRect(b0, b0, bs, bs);
  g.fillStyle = '#232a44';
  g.fillRect(b0, b0, bs, 2);
  g.fillRect(b0, b0, 2, bs);
  g.fillStyle = '#0e1120';
  g.fillRect(b0 + 10, b0 + 10, bs - 20, bs - 20);
  g.fillStyle = '#12162a';
  for (let i = 0; i < 160; i++) g.fillRect(b0 + 10 + Math.floor(rnd() * (bs - 22)), b0 + 10 + Math.floor(rnd() * (bs - 22)), 2, 2);
  // Street lamps at block corners.
  g.fillStyle = 'rgba(255,214,140,0.9)';
  for (const [x, y] of [
    [b0 + 4, b0 + 4],
    [b0 + bs - 6, b0 + 4],
    [b0 + 4, b0 + bs - 6],
    [b0 + bs - 6, b0 + bs - 6],
  ] as const) {
    g.fillRect(x, y, 2, 2);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Parks, lots, roofs, signs
// ---------------------------------------------------------------------------

export function parkCanvas(w: number, h: number, trees: Array<{ x: number; y: number; r: number }>, ox: number, oy: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  const g = c.getContext('2d')!;
  const rnd = artRng(seed);
  g.fillStyle = '#0d2219';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#10291e';
  for (let i = 0; i < (w * h) / 60; i++) g.fillRect(Math.floor(rnd() * w / 2) * 2, Math.floor(rnd() * h / 2) * 2, 2, 2);
  // Paths.
  g.strokeStyle = '#2a2d3e';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(0, h * (0.3 + rnd() * 0.4));
  g.quadraticCurveTo(w / 2, h * rnd(), w, h * (0.3 + rnd() * 0.4));
  g.stroke();
  // Pond or fountain.
  if (w > 150 && rnd() < 0.6) {
    const px = w * (0.3 + rnd() * 0.4);
    const py = h * (0.3 + rnd() * 0.4);
    g.fillStyle = '#0b2a3c';
    g.beginPath();
    g.ellipse(px, py, 26, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba('#22d3ee', 0.35);
    g.lineWidth = 1.5;
    g.stroke();
  }
  // Pixel trees.
  for (const t of trees) {
    const x = t.x - ox;
    const y = t.y - oy;
    const r = Math.round(t.r / 2) * 2;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.arc(x + 4, y + 5, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#174d33';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1f6b44';
    g.beginPath();
    g.arc(x - r * 0.25, y - r * 0.25, r * 0.65, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2d8a57';
    g.fillRect(Math.round(x - r * 0.45), Math.round(y - r * 0.5), 3, 3);
  }
  return c;
}

export function lotCanvas(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  const g = c.getContext('2d')!;
  const rnd = artRng(seed);
  g.fillStyle = '#15182a';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(230,235,255,0.25)';
  const rows = Math.max(1, Math.floor((h - 20) / 44));
  const cars = ['#e11d48', '#f8f6ff', '#60a5fa', '#facc15', '#2de38f', '#a78bfa', '#1f2937', '#fb923c'];
  for (let r = 0; r < rows; r++) {
    const y = 10 + r * 44;
    for (let x = 8; x < w - 18; x += 16) {
      g.fillStyle = 'rgba(230,235,255,0.25)';
      g.fillRect(x, y, 1, 30);
      if (rnd() < 0.55) {
        const col = cars[Math.floor(rnd() * cars.length)]!;
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.fillRect(x + 4, y + 5, 10, 22);
        g.fillStyle = col;
        g.fillRect(x + 3, y + 3, 10, 22);
        g.fillStyle = '#0c1222';
        g.fillRect(x + 4, y + 8, 8, 5);
        g.fillStyle = shade(col, 0.3);
        g.fillRect(x + 4, y + 14, 8, 6);
      }
    }
  }
  return c;
}

const TONES = ['#2a2f47', '#342f4c', '#243a46', '#3b2d40', '#2c3a33', '#3e3833'];
export const WALL_TONES = TONES.map((t) => shade(t, -0.35));

export function roofCanvas(b: Building, scale: number): HTMLCanvasElement {
  const w = b.w;
  const h = b.h;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.imageSmoothingEnabled = false;
  const rnd = artRng(b.seed);
  const base = TONES[b.tone % TONES.length]!;
  const neon = NEON[b.neon % NEON.length]!;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  // Parapet.
  g.fillStyle = shade(base, 0.22);
  g.fillRect(0, 0, w, 3);
  g.fillRect(0, 0, 3, h);
  g.fillStyle = shade(base, -0.3);
  g.fillRect(0, h - 3, w, 3);
  g.fillRect(w - 3, 0, 3, h);
  // Texture speckle.
  g.fillStyle = shade(base, 0.08);
  for (let i = 0; i < (w * h) / 40; i++) g.fillRect(3 + Math.floor(rnd() * (w - 6)), 3 + Math.floor(rnd() * (h - 6)), 2, 2);

  const box = (x: number, y: number, bw: number, bh: number, col: string) => {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + 2, y + 2, bw, bh);
    g.fillStyle = col;
    g.fillRect(x, y, bw, bh);
    g.fillStyle = shade(col, 0.25);
    g.fillRect(x, y, bw, 2);
  };
  switch (b.kind) {
    case 'tower': {
      g.fillStyle = shade(base, -0.2);
      g.fillRect(8, 8, w - 16, h - 16);
      if (w > 100) {
        const cx = w / 2;
        const cy = h / 2;
        g.fillStyle = '#1b1d2e';
        g.beginPath();
        g.arc(cx, cy, Math.min(w, h) * 0.28, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = rgba('#ffd23f', 0.8);
        g.lineWidth = 2;
        g.stroke();
        g.fillStyle = rgba('#f8f6ff', 0.85);
        g.font = `${Math.round(Math.min(w, h) * 0.22)}px ${DISPLAY_FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('H', cx, cy + 1);
      } else {
        box(w * 0.3, h * 0.3, w * 0.4, h * 0.4, shade(base, 0.12));
        g.fillStyle = '#c9cbe0';
        g.fillRect(w / 2 - 1, h / 2 - 12, 2, 24);
      }
      g.fillStyle = rgba(neon, 0.9);
      g.fillRect(4, 4, w - 8, 1);
      g.fillRect(4, h - 5, w - 8, 1);
      break;
    }
    case 'block': {
      const n = 2 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const bw = 14 + rnd() * 18;
        const bh = 10 + rnd() * 14;
        box(6 + rnd() * (w - bw - 12), 6 + rnd() * (h - bh - 12), bw, bh, '#4a5070');
      }
      // Fans.
      for (let i = 0; i < 2 + rnd() * 3; i++) {
        const x = 10 + rnd() * (w - 30);
        const y = 10 + rnd() * (h - 30);
        g.fillStyle = '#3b4060';
        g.fillRect(x, y, 14, 14);
        g.fillStyle = '#1b1e30';
        g.beginPath();
        g.arc(x + 7, y + 7, 5, 0, Math.PI * 2);
        g.fill();
      }
      if (rnd() < 0.6) {
        const x = w * (0.2 + rnd() * 0.5);
        const y = h * (0.2 + rnd() * 0.5);
        g.fillStyle = '#5b4636';
        g.beginPath();
        g.arc(x, y, 9, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#2b2018';
        g.stroke();
      }
      break;
    }
    case 'arcade': {
      for (let x = 6; x < w - 6; x += 12) {
        g.fillStyle = Math.floor(x / 12) % 2 ? shade(neon, -0.55) : shade(base, 0.05);
        g.fillRect(x, 6, 12, h - 12);
      }
      g.fillStyle = rgba(neon, 0.9);
      g.fillRect(6, 6, w - 12, 2);
      g.fillRect(6, h - 8, w - 12, 2);
      box(w / 2 - 10, h / 2 - 8, 20, 16, '#4a5070');
      break;
    }
    case 'hotel': {
      const pw = w * 0.55;
      const ph = h * 0.35;
      const px = (w - pw) / 2;
      const py = h * 0.18;
      g.fillStyle = '#d7d2c8';
      g.fillRect(px - 5, py - 5, pw + 10, ph + 10);
      const pool = g.createLinearGradient(px, py, px + pw, py + ph);
      pool.addColorStop(0, '#0ea5c6');
      pool.addColorStop(1, '#22d3ee');
      g.fillStyle = pool;
      g.fillRect(px, py, pw, ph);
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(px + 4, py + 6 + k * (ph / 3));
        g.lineTo(px + pw - 4, py + 4 + k * (ph / 3));
        g.stroke();
      }
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? '#ff4fd8' : '#ffd23f';
        g.beginPath();
        g.arc(px + 10 + k * (pw / 4), py + ph + 18, 6, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'garage': {
      g.fillStyle = '#23263a';
      g.fillRect(4, 4, w - 8, h - 8);
      g.fillStyle = 'rgba(230,235,255,0.3)';
      for (let y = 12; y < h - 20; y += 36) for (let x = 10; x < w - 10; x += 14) g.fillRect(x, y, 1, 22);
      const cols = ['#e11d48', '#f8f6ff', '#60a5fa', '#facc15', '#2de38f'];
      for (let y = 12; y < h - 20; y += 36) {
        for (let x = 10; x < w - 22; x += 14) {
          if (rnd() < 0.4) {
            g.fillStyle = cols[Math.floor(rnd() * cols.length)]!;
            g.fillRect(x + 3, y + 1, 9, 20);
            g.fillStyle = '#0c1222';
            g.fillRect(x + 4, y + 5, 7, 4);
          }
        }
      }
      g.fillStyle = rgba('#ffd23f', 0.6);
      g.fillRect(w - 20, h - 16, 12, 8);
      break;
    }
    case 'dome': {
      const r = Math.min(w, h) * 0.42;
      const grad = g.createRadialGradient(w / 2 - r * 0.3, h / 2 - r * 0.3, r * 0.1, w / 2, h / 2, r);
      grad.addColorStop(0, shade(base, 0.45));
      grad.addColorStop(1, shade(base, -0.2));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = rgba(neon, 0.7);
      g.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) {
        g.beginPath();
        g.moveTo(w / 2, h / 2);
        g.lineTo(w / 2 + Math.cos((k * Math.PI) / 4) * r, h / 2 + Math.sin((k * Math.PI) / 4) * r);
        g.stroke();
      }
      break;
    }
  }
  // Beacon housing on tall buildings.
  if (b.height > 0.7) {
    g.fillStyle = '#ff2a4a';
    g.fillRect(4, 4, 3, 3);
    g.fillRect(w - 7, h - 7, 3, 3);
  }
  return c;
}

export function signCanvas(text: string, color: string, scale: number): HTMLCanvasElement {
  const size = 14;
  const m = document.createElement('canvas').getContext('2d')!;
  m.font = `${size}px ${DISPLAY_FONT}`;
  const w = Math.ceil(m.measureText(text).width) + 16;
  const h = size + 12;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.fillStyle = 'rgba(7,5,15,0.85)';
  g.fillRect(2, 2, w - 4, h - 4);
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.shadowColor = color;
  g.shadowBlur = 6;
  g.strokeRect(3, 3, w - 6, h - 6);
  g.font = `${size}px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = shade(color, 0.55);
  g.fillText(text, w / 2, h / 2 + 1);
  g.shadowBlur = 0;
  return c;
}

export function billboardCanvas(text: string, tone: number, scale: number): HTMLCanvasElement {
  const w = 132;
  const h = 34;
  const color = NEON[tone % NEON.length]!;
  const c = document.createElement('canvas');
  c.width = Math.ceil((w + 8) * scale);
  c.height = Math.ceil((h + 8) * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.translate(4, 4);
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0b0914');
  bg.addColorStop(1, shade(color, -0.75));
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.shadowColor = color;
  g.shadowBlur = 8;
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  g.font = `15px ${DISPLAY_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = shade(color, 0.6);
  g.fillText(text, w / 2, h / 2 + 1);
  g.shadowBlur = 0;
  // Pixel scan lines.
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  return c;
}

/** Grandstand texture (two frames for a bobbing crowd). */
export function standCanvas(length: number, depth: number, frame: number, neon: string, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(length * scale);
  c.height = Math.ceil(depth * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.imageSmoothingEnabled = false;
  const rnd = artRng(4242);
  const rows = 7;
  const rowH = (depth - 10) / rows;
  g.fillStyle = '#141828';
  g.fillRect(0, 0, length, depth);
  const shirts = ['#22d3ee', '#f97316', '#ff4fd8', '#ffd23f', '#2de38f', '#f8f6ff', '#a78bfa', '#ff5a5f'];
  for (let r = 0; r < rows; r++) {
    const y = depth - 8 - (r + 1) * rowH;
    g.fillStyle = r % 2 ? '#1d2236' : '#20263c';
    g.fillRect(0, y, length, rowH);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y + rowH - 1, length, 1);
    for (let x = 2; x < length - 3; x += 4) {
      if (rnd() < 0.18) continue;
      const bob = (frame + Math.floor(rnd() * 3)) % 3 === 0 ? -1 : 0;
      g.fillStyle = shirts[Math.floor(rnd() * shirts.length)]!;
      g.fillRect(x, y + 3 + bob, 3, 2);
      g.fillStyle = rnd() < 0.5 ? '#f5c9a0' : '#8b5a2b';
      g.fillRect(x + 0.5, y + 1 + bob, 2, 2);
      if (frame === 1 && rnd() < 0.12) {
        g.fillStyle = '#f5c9a0';
        g.fillRect(x - 1, y - 1, 1, 2);
        g.fillRect(x + 3, y - 1, 1, 2);
      }
    }
  }
  // Front wall with neon trim.
  g.fillStyle = '#2a3350';
  g.fillRect(0, depth - 8, length, 8);
  g.fillStyle = neon;
  g.fillRect(0, depth - 8, length, 2);
  // Back canopy.
  g.fillStyle = shade(neon, -0.55);
  g.fillRect(0, 0, length, 4);
  return c;
}

/** Offscreen minimap base: track ribbon fitted into w×h. */
export function minimapCanvas(track: Track, w: number, h: number, pad: number): { canvas: HTMLCanvasElement; project: (x: number, y: number) => [number, number] } {
  const b = track.bounds;
  const sx = (w - pad * 2) / (b.maxX - b.minX);
  const sy = (h - pad * 2) / (b.maxY - b.minY);
  const s = Math.min(sx, sy);
  const offX = (w - (b.maxX - b.minX) * s) / 2;
  const offY = (h - (b.maxY - b.minY) * s) / 2;
  const project = (x: number, y: number): [number, number] => [offX + (x - b.minX) * s, offY + (y - b.minY) * s];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.lineJoin = 'round';
  const path = () => {
    g.beginPath();
    for (let i = 0; i < track.n; i += 2) {
      const [x, y] = project(track.xs[i]!, track.ys[i]!);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
  };
  path();
  g.strokeStyle = 'rgba(7,5,15,0.9)';
  g.lineWidth = 9;
  g.stroke();
  path();
  g.strokeStyle = rgba(track.def.theme.neonA, 0.9);
  g.lineWidth = 4;
  g.stroke();
  path();
  g.strokeStyle = 'rgba(230,240,255,0.85)';
  g.lineWidth = 1.5;
  g.stroke();
  for (const br of track.bridges) {
    g.save();
    g.beginPath();
    const i0 = Math.floor(br.from / track.spacing);
    const i1 = Math.floor(br.to / track.spacing);
    for (let i = i0; i <= (i1 < i0 ? i1 + track.n : i1); i++) {
      const k = i % track.n;
      const [x, y] = project(track.xs[k]!, track.ys[k]!);
      if (i === i0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(7,5,15,0.95)';
    g.lineWidth = 8;
    g.stroke();
    g.strokeStyle = rgba(track.def.theme.neonB, 1);
    g.lineWidth = 4;
    g.stroke();
    g.restore();
  }
  const [fx, fy] = project(pointAt(track, 0).x, pointAt(track, 0).y);
  g.fillStyle = '#f8f6ff';
  g.fillRect(fx - 3, fy - 3, 6, 6);
  g.fillStyle = '#0b0914';
  g.fillRect(fx - 3, fy - 3, 3, 3);
  g.fillRect(fx, fy, 3, 3);
  return { canvas: c, project };
}
