/**
 * Cyber Café 2001 backdrop renderer (Canvas 2D, decorative only).
 *
 *   - a perspective "early-3D" grid floor that glides toward the viewer,
 *   - a café network diagram: CRT stations and hubs joined by cables, data packets running along them,
 *   - slowly drifting translucent Y2K bubbles and a wireframe "broadband" globe.
 *
 * Everything is clipped to the canvas (which is exactly the viewport), so nothing can overflow.
 * Deterministic layout (seeded), no allocations per frame beyond the canvas API itself.
 */

export interface CafeOptions {
  /** 0–1 overall intensity (lower in lobbies / games). */
  intensity: number;
  /** Animate at all (false = one still frame). */
  motion: boolean;
  /** Packet count multiplier (fx low → fewer). */
  packets: number;
  /** Draw the drifting bubbles + globe. */
  flourishes: boolean;
}

interface Node {
  x: number;
  y: number;
  kind: 'station' | 'hub' | 'server';
  phase: number;
}
interface Edge {
  a: number;
  b: number;
  len: number;
}
interface Packet {
  edge: number;
  t: number;
  speed: number;
  dir: 1 | -1;
  lime: boolean;
}

const AQUA = '62, 224, 255';
const LIME = '125, 255, 74';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CafeScene {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private horizon = 0.66;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private packets: Packet[] = [];
  private lastT = 0;
  private statics: HTMLCanvasElement | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
  }

  layout(w: number, h: number, horizon: number, dprCap: number): void {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.horizon = horizon;
    this.dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.buildNetwork();
    this.renderStatics();
  }

  private buildNetwork(): void {
    const rnd = mulberry32(2001);
    const { w, h } = this;
    const top = h * 0.12;
    const bottom = h * this.horizon - Math.min(60, h * 0.06);
    const cols = Math.max(3, Math.min(7, Math.round(w / 260)));
    const rows = h > 620 ? 3 : 2;
    const nodes: Node[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = ((c + 0.5 + (r % 2 ? 0.35 : -0.1)) / cols) * w;
        const cy = top + ((r + 0.5) / rows) * (bottom - top);
        const x = cx + (rnd() - 0.5) * (w / cols) * 0.5;
        const y = cy + (rnd() - 0.5) * ((bottom - top) / rows) * 0.5;
        if (x < 20 || x > w - 20) continue;
        const roll = rnd();
        nodes.push({ x, y, kind: roll < 0.18 ? 'server' : roll < 0.4 ? 'hub' : 'station', phase: rnd() * 6 });
      }
    }
    // Edges: each node to its two nearest neighbours (deduped).
    const edges: Edge[] = [];
    const seen = new Set<string>();
    nodes.forEach((n, i) => {
      const near = nodes
        .map((m, j) => ({ j, d: (m.x - n.x) * (m.x - n.x) + (m.y - n.y) * (m.y - n.y) }))
        .filter((o) => o.j !== i)
        .sort((p, q) => p.d - q.d)
        .slice(0, 2);
      for (const { j, d } of near) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a: i, b: j, len: Math.sqrt(d) });
      }
    });
    this.nodes = nodes;
    this.edges = edges;
    const count = Math.min(28, Math.round(edges.length * 0.9));
    this.packets = Array.from({ length: count }, (_, k) => ({
      edge: k % Math.max(1, edges.length),
      t: rnd(),
      speed: 90 + rnd() * 90,
      dir: rnd() < 0.5 ? 1 : -1,
      lime: rnd() < 0.3,
    }));
  }

  /** Cables and node housings: drawn once per layout. */
  private renderStatics(): void {
    const c = this.statics ?? (this.statics = document.createElement('canvas'));
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineCap = 'round';
    for (const e of this.edges) {
      const a = this.nodes[e.a]!;
      const b = this.nodes[e.b]!;
      // Slightly drooping cable (quadratic curve).
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 + Math.min(26, e.len * 0.08);
      g.strokeStyle = `rgba(${AQUA}, 0.16)`;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo(mx, my, b.x, b.y);
      g.stroke();
      g.strokeStyle = `rgba(190, 235, 255, 0.28)`;
      g.lineWidth = 1;
      g.stroke();
    }
    for (const n of this.nodes) this.drawNodeBody(g, n);
  }

  private drawNodeBody(g: CanvasRenderingContext2D, n: Node): void {
    const { x, y } = n;
    if (n.kind === 'station') {
      // A tiny translucent CRT: chrome bezel, glowing blue glass, a foot.
      g.fillStyle = 'rgba(170, 200, 225, 0.28)';
      roundRect(g, x - 17, y - 14, 34, 26, 6);
      g.fill();
      g.strokeStyle = 'rgba(220, 240, 255, 0.5)';
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = 'rgba(20, 110, 200, 0.55)';
      roundRect(g, x - 12, y - 10, 24, 17, 3);
      g.fill();
      g.fillStyle = `rgba(${AQUA}, 0.35)`;
      g.fillRect(x - 9, y - 7, 12, 2);
      g.fillRect(x - 9, y - 3, 16, 2);
      g.fillStyle = 'rgba(170, 200, 225, 0.3)';
      g.fillRect(x - 6, y + 12, 12, 3);
    } else if (n.kind === 'hub') {
      g.fillStyle = 'rgba(160, 190, 220, 0.3)';
      roundRect(g, x - 20, y - 6, 40, 12, 6);
      g.fill();
      g.strokeStyle = 'rgba(220, 240, 255, 0.45)';
      g.stroke();
    } else {
      // Server tower with a lit stripe.
      g.fillStyle = 'rgba(160, 190, 220, 0.3)';
      roundRect(g, x - 10, y - 20, 20, 40, 5);
      g.fill();
      g.strokeStyle = 'rgba(220, 240, 255, 0.45)';
      g.stroke();
      g.fillStyle = `rgba(${AQUA}, 0.3)`;
      g.fillRect(x - 6, y - 14, 12, 2);
      g.fillRect(x - 6, y - 9, 12, 2);
    }
  }

  frame(tSec: number, o: CafeOptions): void {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    const dt = this.lastT ? Math.min(0.1, Math.max(0, tSec - this.lastT)) : 0;
    this.lastT = tSec;
    const t = o.motion ? tSec : 12.5;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = o.intensity;

    if (o.flourishes && w >= 640) this.drawGlobe(t);
    this.drawGrid(t, o);
    if (this.statics) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.statics, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.drawLeds(t);
    this.drawPackets(o.motion ? dt : 0, o);
    if (o.flourishes) this.drawBubbles(t);
    ctx.globalAlpha = 1;
  }

  private drawGrid(t: number, o: CafeOptions): void {
    const { ctx, w, h } = this;
    const hy = Math.round(h * this.horizon);
    const depth = h - hy;
    if (depth < 20) return;
    // Horizon glow.
    const glow = ctx.createLinearGradient(0, hy - 60, 0, hy + 30);
    glow.addColorStop(0, `rgba(${AQUA}, 0)`);
    glow.addColorStop(0.7, `rgba(${AQUA}, 0.16)`);
    glow.addColorStop(1, `rgba(${AQUA}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, hy - 60, w, 90);
    // Floor wash.
    const floor = ctx.createLinearGradient(0, hy, 0, h);
    floor.addColorStop(0, 'rgba(10, 70, 150, 0.35)');
    floor.addColorStop(1, 'rgba(2, 16, 40, 0.1)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, hy, w, depth);

    ctx.lineWidth = 1;
    const vx = w / 2;
    const spread = w * 1.8;
    ctx.strokeStyle = `rgba(${AQUA}, 0.22)`;
    ctx.beginPath();
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const bx = vx - spread / 2 + (spread * i) / n;
      ctx.moveTo(vx + (bx - vx) * 0.04, hy);
      ctx.lineTo(bx, h);
    }
    ctx.stroke();
    // Horizontal rows: perspective spacing, gliding toward the viewer.
    const scroll = o.motion ? (t * 0.35) % 1 : 0.4;
    ctx.beginPath();
    for (let k = 0; k < 14; k++) {
      const z = (k + scroll) / 14; // 0 at horizon, 1 at bottom
      const y = hy + depth * z * z;
      const a = 0.05 + 0.3 * z;
      ctx.strokeStyle = `rgba(${AQUA}, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(190, 240, 255, 0.55)`;
    ctx.beginPath();
    ctx.moveTo(0, hy + 0.5);
    ctx.lineTo(w, hy + 0.5);
    ctx.stroke();
  }

  private drawLeds(t: number): void {
    const { ctx } = this;
    for (const n of this.nodes) {
      const on = Math.sin(t * 2.3 + n.phase * 3) > -0.2;
      const lx = n.kind === 'hub' ? n.x - 12 : n.kind === 'server' ? n.x : n.x + 11;
      const ly = n.kind === 'hub' ? n.y : n.kind === 'server' ? n.y + 12 : n.y + 13;
      ctx.fillStyle = on ? `rgba(${LIME}, 0.95)` : 'rgba(40, 90, 50, 0.6)';
      ctx.beginPath();
      ctx.arc(lx, ly, 2, 0, Math.PI * 2);
      ctx.fill();
      if (on) {
        ctx.fillStyle = `rgba(${LIME}, 0.18)`;
        ctx.beginPath();
        ctx.arc(lx, ly, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (n.kind === 'hub') {
        for (let k = 0; k < 4; k++) {
          const blink = Math.sin(t * (5 + k) + n.phase + k * 1.7) > 0.3;
          ctx.fillStyle = blink ? `rgba(${AQUA}, 0.95)` : 'rgba(40, 80, 110, 0.6)';
          ctx.fillRect(n.x - 4 + k * 5, n.y - 1.5, 3, 3);
        }
      }
    }
  }

  private drawPackets(dt: number, o: CafeOptions): void {
    const { ctx } = this;
    const count = Math.round(this.packets.length * o.packets);
    for (let i = 0; i < count; i++) {
      const p = this.packets[i]!;
      const e = this.edges[p.edge];
      if (!e) continue;
      p.t += (p.dir * p.speed * dt) / Math.max(40, e.len);
      if (p.t > 1 || p.t < 0) {
        // Hop to another cable that touches the node we arrived at.
        const at = p.t > 1 ? e.b : e.a;
        const next = this.edges.findIndex((x, j) => j !== p.edge && (x.a === at || x.b === at));
        p.edge = next >= 0 ? next : p.edge;
        const ne = this.edges[p.edge]!;
        p.dir = ne.a === at ? 1 : -1;
        p.t = p.dir === 1 ? 0 : 1;
      }
      const a = this.nodes[e.a]!;
      const b = this.nodes[e.b]!;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 + Math.min(26, e.len * 0.08);
      const u = p.t;
      const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x;
      const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y;
      const col = p.lime ? LIME : AQUA;
      ctx.fillStyle = `rgba(${col}, 0.22)`;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${col}, 1)`;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBubbles(t: number): void {
    const { ctx, w, h } = this;
    const specs = [
      { x: 0.1, y: 0.32, r: 0.07, sp: 0.05, ph: 0 },
      { x: 0.86, y: 0.52, r: 0.05, sp: 0.07, ph: 2 },
      { x: 0.32, y: 0.78, r: 0.035, sp: 0.09, ph: 4 },
      { x: 0.66, y: 0.18, r: 0.03, sp: 0.06, ph: 1 },
    ];
    const base = Math.min(w, h);
    for (const s of specs) {
      const r = Math.max(14, s.r * base);
      const x = s.x * w + Math.sin(t * s.sp + s.ph) * 24;
      const y = s.y * h + Math.cos(t * s.sp * 1.3 + s.ph) * 18;
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
      g.addColorStop(0.35, 'rgba(120, 220, 255, 0.1)');
      g.addColorStop(0.85, 'rgba(62, 180, 255, 0.07)');
      g.addColorStop(1, 'rgba(160, 230, 255, 0.24)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGlobe(t: number): void {
    const { ctx, w, h } = this;
    const r = Math.max(50, Math.min(w, h) * 0.16);
    const cx = w - r * 0.9;
    const cy = r * 1.1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const fill = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    fill.addColorStop(0, 'rgba(62, 224, 255, 0.1)');
    fill.addColorStop(1, 'rgba(62, 224, 255, 0.02)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = `rgba(${AQUA}, 0.24)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();
    // Latitudes.
    for (let k = -2; k <= 2; k++) {
      const yy = cy + (k / 3) * r;
      const rr = Math.sqrt(Math.max(0, r * r - (yy - cy) * (yy - cy)));
      ctx.beginPath();
      ctx.ellipse(cx, yy, rr, rr * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Longitudes rotate.
    const spin = (t * 0.12) % (Math.PI / 3);
    for (let k = 0; k < 6; k++) {
      const a = spin + (k * Math.PI) / 6;
      const rx = Math.abs(Math.cos(a)) * r;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(0.5, rx), r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
