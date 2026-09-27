/**
 * Minimap drawing (2D canvas): a cached base layer of the built track (road ribbon, branches,
 * start line) plus a projection for racer dots. Shared by the HUD map and the lobby thumbnails.
 * Track-space x/y (y up) → canvas (y down).
 */

export interface Polyline {
  xs: ArrayLike<number>;
  ys: ArrayLike<number>;
  /** Number of points to use (defaults to xs.length). */
  count?: number;
  closed: boolean;
}

export interface MapColors {
  road: string;
  edge: string;
  branch: string;
  start: string;
}

export const DEFAULT_MAP_COLORS: MapColors = {
  road: '#e8e4ff',
  edge: 'rgba(8,6,20,0.85)',
  branch: 'rgba(232,228,255,0.55)',
  start: '#ffd23f',
};

export interface MapBase {
  canvas: HTMLCanvasElement;
  project: (x: number, y: number) => [number, number];
  scale: number;
}

function bounds(lines: Polyline[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of lines) {
    const n = l.count ?? l.xs.length;
    for (let i = 0; i < n; i++) {
      const x = l.xs[i]!;
      const y = l.ys[i]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/** Fit transform for the main loop into a w×h box with padding. */
export function fitProjection(
  lines: Polyline[],
  w: number,
  h: number,
  pad: number,
): { project: (x: number, y: number) => [number, number]; scale: number } {
  const b = bounds(lines);
  const sw = Math.max(1e-6, b.maxX - b.minX);
  const sh = Math.max(1e-6, b.maxY - b.minY);
  const scale = Math.min((w - pad * 2) / sw, (h - pad * 2) / sh);
  const ox = (w - sw * scale) / 2;
  const oy = (h - sh * scale) / 2;
  return { scale, project: (x, y) => [ox + (x - b.minX) * scale, h - (oy + (y - b.minY) * scale)] };
}

function strokeLine(g: CanvasRenderingContext2D, l: Polyline, project: MapBase['project']): void {
  const n = l.count ?? l.xs.length;
  if (n < 2) return;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const [x, y] = project(l.xs[i]!, l.ys[i]!);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  if (l.closed) g.closePath();
  g.stroke();
}

/** Build the static layer. `main` is the lap centreline, `branches` are alternates. */
export function buildMapBase(
  main: Polyline,
  branches: Polyline[],
  w: number,
  h: number,
  pad: number,
  colors: MapColors = DEFAULT_MAP_COLORS,
): MapBase {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const { project, scale } = fitProjection([main, ...branches], w, h, pad);
  const g = canvas.getContext('2d');
  if (!g) return { canvas, project, scale };
  const lw = Math.max(2.5, Math.min(w, h) / 26);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const b of branches) {
    g.strokeStyle = colors.edge;
    g.lineWidth = lw * 0.9 + 3;
    strokeLine(g, b, project);
    g.setLineDash([lw * 0.9, lw * 0.9]);
    g.strokeStyle = colors.branch;
    g.lineWidth = lw * 0.7;
    strokeLine(g, b, project);
    g.setLineDash([]);
  }
  g.strokeStyle = colors.edge;
  g.lineWidth = lw + 3;
  strokeLine(g, main, project);
  g.strokeStyle = colors.road;
  g.lineWidth = lw;
  strokeLine(g, main, project);
  // Start/finish tick: perpendicular to the first segment.
  const n = main.count ?? main.xs.length;
  if (n > 2) {
    const [x0, y0] = project(main.xs[0]!, main.ys[0]!);
    const [x1, y1] = project(main.xs[1]!, main.ys[1]!);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    g.strokeStyle = colors.start;
    g.lineWidth = Math.max(2, lw * 0.45);
    g.beginPath();
    g.moveTo(x0 - nx * lw, y0 - ny * lw);
    g.lineTo(x0 + nx * lw, y0 + ny * lw);
    g.stroke();
  }
  return { canvas, project, scale };
}

export interface MapDot {
  x: number;
  y: number;
  color: string;
  /** The followed / local kart: bigger with a light ring, drawn last. */
  me: boolean;
  /** Label drawn inside big dots (position number). */
  label?: string;
}

export interface MapMark {
  x: number;
  y: number;
  kind: 'hazard' | 'trap' | 'item' | 'ghost';
}

export function drawMap(
  g: CanvasRenderingContext2D,
  base: MapBase,
  dots: readonly MapDot[],
  marks: readonly MapMark[],
  size: { w: number; h: number },
  ring = '#f8f6ff',
  font = '600 10px sans-serif',
): void {
  g.clearRect(0, 0, size.w, size.h);
  g.drawImage(base.canvas, 0, 0);
  const dot = Math.max(3, Math.min(size.w, size.h) / 40);
  for (const m of marks) {
    const [x, y] = base.project(m.x, m.y);
    g.beginPath();
    if (m.kind === 'ghost') {
      g.arc(x, y, dot * 1.1, 0, Math.PI * 2);
      g.fillStyle = 'rgba(200,220,255,0.55)';
      g.fill();
      continue;
    }
    // Static hazards stay faint; live traps (mines, puddles) and seekers read clearly.
    g.arc(x, y, dot * (m.kind === 'hazard' ? 0.42 : 0.6), 0, Math.PI * 2);
    g.fillStyle = m.kind === 'hazard' ? 'rgba(255,120,120,0.38)' : m.kind === 'trap' ? 'rgba(255,70,90,0.85)' : 'rgba(255,210,63,0.85)';
    g.fill();
  }
  let mine: MapDot | null = null;
  for (const d of dots) {
    if (d.me) {
      mine = d;
      continue;
    }
    const [x, y] = base.project(d.x, d.y);
    g.beginPath();
    g.arc(x, y, dot, 0, Math.PI * 2);
    g.fillStyle = d.color;
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(7,5,15,0.9)';
    g.stroke();
  }
  if (mine) {
    const [x, y] = base.project(mine.x, mine.y);
    const r = dot * 1.75;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = mine.color;
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = ring;
    g.stroke();
    if (mine.label) {
      g.fillStyle = '#07050f';
      g.font = font;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(mine.label, x, y + 0.5);
    }
  }
}
