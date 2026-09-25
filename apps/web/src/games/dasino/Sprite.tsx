import type { CSSProperties } from 'react';
import { spriteRects } from './sprites.ts';

/** Crisp SVG rendering of a DASino pixel sprite. Decorative unless `title` is given. */
export function Sprite({ rows, size = 32, title, className, style }: { rows: readonly string[]; size?: number | string; title?: string; className?: string; style?: CSSProperties }) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {spriteRects(rows).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
      ))}
    </svg>
  );
}
