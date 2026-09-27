/** Hold / Next piece previews and rival stack mini boards (small canvases, redrawn on change). */
import { useEffect, useRef } from 'react';
import { cx } from '@dascade/ui';
import type { PieceId } from '@dascade/game-core/blocks';
import { formatScore } from '../_classics/index.ts';
import { drawMiniBoard, drawPiecePreview } from './art.ts';

function useSizedCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, scale: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const ctx = c.getContext('2d');
      if (ctx) draw(ctx, r.width, r.height, dpr);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw when the caller's data changes
  }, deps);
  return ref;
}

export function PiecePreview({ piece, dim, small, label, className }: { piece: PieceId | null; dim?: boolean; small?: boolean; label: string; className?: string }) {
  const ref = useSizedCanvas((ctx, w, h, scale) => drawPiecePreview(ctx, piece, w, h, scale, dim), [piece, dim]);
  return <canvas ref={ref} className={cx('bd-piece', small && 'bd-piece--small', className)} role="img" aria-label={piece ? `${label}` : label} />;
}

export function MiniBoard({ board, name, score, out, color, large }: { board: string; name: string; score: number; out?: boolean; color?: string; large?: boolean }) {
  const ref = useSizedCanvas((ctx, w, h, scale) => drawMiniBoard(ctx, board, w, h, scale), [board]);
  return (
    <figure className={cx('bd-mini', out && 'is-out', large && 'bd-mini--large')} style={color ? ({ '--pc': color } as React.CSSProperties) : undefined}>
      <canvas ref={ref} className="bd-mini__board" role="img" aria-label={`${name}'s stack`} />
      <figcaption className="bd-mini__cap">
        <span className="bd-mini__name">{name}</span>
        <span className="bd-mini__score">{formatScore(score)}</span>
      </figcaption>
    </figure>
  );
}
