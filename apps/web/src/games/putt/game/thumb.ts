/** Flat mini-map of a hole (settings picker, hole summaries). */
import { PHYS, compileHole, type HoleDef, type Pt } from '@dascade/game-core/putt';
import { ART } from './palette.ts';

export function drawHoleThumb(canvas: HTMLCanvasElement, hole: HoleDef, cssW: number, cssH: number): void {
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);
  const b = compileHole(hole).bounds;
  const pad = 8;
  const s = Math.min((cssW - pad * 2) / (b.maxX - b.minX + 20), (cssH - pad * 2) / (b.maxY - b.minY + 20));
  const ox = (cssW - (b.maxX - b.minX) * s) / 2 - b.minX * s;
  const oy = (cssH - (b.maxY - b.minY) * s) / 2 - b.minY * s;
  const path = (pts: readonly Pt[], closed = true) => {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(ox + x * s, oy + y * s) : p.moveTo(ox + x * s, oy + y * s)));
    if (closed) p.closePath();
    return p;
  };
  g.fillStyle = ART.waterMid;
  for (const w of hole.water ?? []) g.fill(path(w));
  g.fillStyle = ART.turfMid;
  for (const t of hole.turf) g.fill(path(t));
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (const sl of hole.slopes ?? []) {
    g.save();
    for (const t of hole.turf) g.clip(path(t));
    g.fill(path(sl.poly));
    g.restore();
  }
  g.fillStyle = ART.sandLight;
  for (const sd of hole.sand ?? []) g.fill(path(sd));
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const w of hole.walls) {
    g.strokeStyle = w.kind === 'kicker' ? ART.kickerGlow : w.kind === 'bank' ? ART.bankGlow : ART.wallGlow;
    g.lineWidth = Math.max(1.5, 14 * s);
    g.stroke(path(w.pts, Boolean(w.closed)));
  }
  g.fillStyle = ART.bumper;
  for (const bm of hole.bumpers ?? []) {
    g.beginPath();
    g.arc(ox + bm.at[0] * s, oy + bm.at[1] * s, Math.max(2, bm.r * s), 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = ART.post;
  for (const p of hole.posts ?? []) {
    g.beginPath();
    g.arc(ox + p.at[0] * s, oy + p.at[1] * s, Math.max(1.5, p.r * s), 0, Math.PI * 2);
    g.fill();
  }
  for (const p of hole.portals ?? []) {
    g.strokeStyle = ART.portal[p.color] ?? '#22d3ee';
    g.lineWidth = 1.5;
    for (const at of [p.from, p.to]) {
      g.beginPath();
      g.arc(ox + at[0] * s, oy + at[1] * s, Math.max(2.5, PHYS.portalR * s), 0, Math.PI * 2);
      g.stroke();
    }
  }
  for (const m of hole.movers ?? []) {
    g.strokeStyle = ART.blade;
    g.lineWidth = Math.max(1.5, m.width * s);
    g.beginPath();
    if (m.kind === 'windmill') {
      g.arc(ox + m.at[0] * s, oy + m.at[1] * s, m.length * s, 0, Math.PI * 2);
    } else {
      g.moveTo(ox + m.a[0] * s, oy + m.a[1] * s);
      g.lineTo(ox + m.b[0] * s, oy + m.b[1] * s);
    }
    g.stroke();
  }
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(ox + hole.tee[0] * s, oy + hole.tee[1] * s, Math.max(2, PHYS.ballR * s), 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#000';
  g.strokeStyle = ART.flag;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(ox + hole.cup[0] * s, oy + hole.cup[1] * s, Math.max(2.5, PHYS.cupR * s), 0, Math.PI * 2);
  g.fill();
  g.stroke();
}
