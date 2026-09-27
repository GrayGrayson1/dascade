/**
 * Top-down 2D fallback view, used only when the 3D renderer can't start (no WebGL, or the
 * renderer chunk failed to load). It keeps the race fully playable: the road ribbon around the
 * followed kart, rotated so "up" is the kart's heading, every kart as a coloured arrow, items and
 * cubes as dots. Implements the same surface the stage feeds the 3D renderer with.
 */
import type { KartTrack } from '@dascade/game-core/kart';
import type { ThemeTokens } from '@dascade/ui';
import type { KartFxAt, KartFxKind, KartRenderStats, KartRendererOptions, KartRosterEntry, KartView } from '../render/types.ts';

export interface FlatView {
  setRoster(entries: KartRosterEntry[]): void;
  frame(view: KartView): void;
  triggerFx(kind: KartFxKind, at: KartFxAt): void;
  setOptions(o: Partial<KartRendererOptions>): void;
  setThemeTokens(t: ThemeTokens): void;
  resize(w: number, h: number, dpr: number): void;
  stats(): KartRenderStats;
  dispose(): void;
}

export function createFlatView(canvas: HTMLCanvasElement, track: KartTrack): FlatView {
  const g = canvas.getContext('2d');
  let w = 1;
  let h = 1;
  let dpr = 1;
  const paint = new Map<number, string>();
  let ground = '#1b1530';
  let road = '#3a3456';
  let edge = '#8f88b3';
  let frames = 0;
  let fps = 60;
  let lastT = performance.now();
  const { xs, ys, n } = track;

  const frame = (view: KartView) => {
    if (!g) return;
    frames++;
    const now = performance.now();
    if (now - lastT > 1000) {
      fps = (frames * 1000) / (now - lastT);
      frames = 0;
      lastT = now;
    }
    const me = view.karts[view.targetSlot];
    const cx = me?.active ? me.x : xs[0]!;
    const cy = me?.active ? me.y : ys[0]!;
    const heading = me?.active ? me.heading : 0;
    const scale = (Math.min(w, h) / 90) * dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = ground;
    g.fillRect(0, 0, canvas.width, canvas.height);
    // Kart heading points up the screen; the kart sits in the lower third.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(w / 2, h * 0.64);
    g.scale(scale / dpr, -scale / dpr);
    g.rotate(Math.PI / 2 - heading);
    g.translate(-cx, -cy);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const hw = (track.hwL[0] ?? 8) + (track.hwR[0] ?? 8);
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const j = i % n;
      if (i === 0) g.moveTo(xs[j]!, ys[j]!);
      else g.lineTo(xs[j]!, ys[j]!);
    }
    g.strokeStyle = edge;
    g.lineWidth = hw + 1.2;
    g.stroke();
    g.strokeStyle = road;
    g.lineWidth = hw;
    g.stroke();
    for (const b of track.branches) {
      g.beginPath();
      for (let i = 0; i < b.n; i++) {
        if (i === 0) g.moveTo(b.xs[i]!, b.ys[i]!);
        else g.lineTo(b.xs[i]!, b.ys[i]!);
      }
      g.strokeStyle = road;
      g.lineWidth = (b.hwL[0] ?? 5) + (b.hwR[0] ?? 5);
      g.stroke();
    }
    // Start line.
    const tx = track.tx[0]!;
    const ty = track.ty[0]!;
    g.beginPath();
    g.moveTo(xs[0]! - ty * hw * 0.5, ys[0]! + tx * hw * 0.5);
    g.lineTo(xs[0]! + ty * hw * 0.5, ys[0]! - tx * hw * 0.5);
    g.strokeStyle = '#f8f6ff';
    g.lineWidth = 1;
    g.stroke();
    // Item cubes.
    track.itemBoxes.forEach((b, i) => {
      if (view.boxes && view.boxes[i] && !view.boxes[i]!.visible) return;
      g.fillStyle = '#ffd23f';
      g.fillRect(b.x - 0.6, b.y - 0.6, 1.2, 1.2);
    });
    for (const e of view.entities) {
      g.beginPath();
      g.arc(e.x, e.y, 0.8, 0, Math.PI * 2);
      g.fillStyle = e.kind === 'mine' ? '#ff2e5b' : e.kind === 'fizz' ? '#ff8a1f' : '#ff4fd8';
      g.fill();
    }
    const drawKart = (x: number, y: number, hd: number, color: string, alpha: number) => {
      g.save();
      g.globalAlpha = alpha;
      g.translate(x, y);
      g.rotate(hd);
      g.beginPath();
      g.moveTo(1.4, 0);
      g.lineTo(-1, 0.8);
      g.lineTo(-0.6, 0);
      g.lineTo(-1, -0.8);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 0.2;
      g.strokeStyle = '#07050f';
      g.stroke();
      g.restore();
    };
    if (view.ghost) drawKart(view.ghost.x, view.ghost.y, view.ghost.heading, '#c8dcff', 0.45);
    for (const k of view.karts) if (k?.active) drawKart(k.x, k.y, k.heading, paint.get(k.slot) ?? '#22d3ee', 1);
  };

  return {
    setRoster(entries) {
      paint.clear();
      for (const e of entries) paint.set(e.slot, e.paint);
    },
    frame,
    triggerFx() {},
    setOptions() {},
    setThemeTokens(t) {
      ground = t.materials.grass ?? '#1b1530';
      road = t.materials.asphalt ?? '#3a3456';
      edge = t.line ?? '#8f88b3';
    },
    resize(cw, ch, ratio) {
      w = Math.max(1, cw);
      h = Math.max(1, ch);
      dpr = Math.min(2, ratio);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    },
    stats: () => ({ fps, frameMs: 1000 / Math.max(1, fps), drawCalls: 0, triangles: 0, quality: 'low', pixelRatio: dpr }),
    dispose() {},
  };
}
