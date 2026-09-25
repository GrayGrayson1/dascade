/**
 * Text drawn with the DASCADE pixel typeface as crisp SVG cells.
 * The cell size fits the measured box and snaps to whole device pixels when it
 * is at least 2.5px, so letterforms (notably C vs O) survive at every size. Decorative: pair it with
 * real text for assistive tech (it is aria-hidden).
 *
 *  - 'logo': 1-cell outline, drop shadow and a two-tone fill (marquees).
 *  - 'title': two-tone fill with an offset shadow (plaque / title screen).
 * Colours come from CSS: --pw-ink, --pw-ink-2, --pw-ol, --pw-shadow.
 * Max height can be set with the `maxH` prop or the --pw-max-h CSS variable.
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { layoutPixelText } from './pixelType.ts';

type Variant = 'logo' | 'title';

interface Geometry {
  w: number;
  h: number;
  shadow: string;
  outline: string;
  fill: string;
  fill2: string;
}

function toPath(cells: Iterable<string>): string {
  const rows = new Map<number, number[]>();
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const list = rows.get(y);
    if (list) list.push(x);
    else rows.set(y, [x]);
  }
  let d = '';
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let i = 0;
    while (i < xs.length) {
      let run = 1;
      while (i + run < xs.length && xs[i + run] === xs[i]! + run) run++;
      d += `M${xs[i]} ${y}h${run}v1h-${run}z`;
      i += run;
    }
  }
  return d;
}

function build(text: string, variant: Variant): Geometry {
  const { cells, width, rows } = layoutPixelText(text);
  const pad = variant === 'logo' ? 1 : 0;
  const sx = variant === 'title' ? 1 : 0;
  const sy = 1;
  const letter = new Set(cells.map(([x, y]) => `${x + pad},${y + pad}`));
  const outline = new Set<string>();
  if (variant === 'logo')
    for (const [x, y] of cells)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) outline.add(`${x + pad + dx},${y + pad + dy}`);
  const base = variant === 'logo' ? outline : letter;
  const shadow = new Set<string>();
  for (const key of base) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    shadow.add(`${x + sx},${y + sy}`);
  }
  const split = pad + 4;
  const top: string[] = [];
  const bottom: string[] = [];
  for (const key of letter) (Number(key.split(',')[1]) < split ? top : bottom).push(key);
  return {
    w: width + pad * 2 + sx,
    h: rows + pad * 2 + sy,
    shadow: toPath(shadow),
    outline: toPath(outline),
    fill: toPath(top),
    fill2: toPath(bottom),
  };
}

export interface PixelWordProps {
  text: string;
  variant?: Variant;
  className?: string;
  /** Fraction of the measured box's width available. */
  fitW?: number;
  /** Fraction of the measured box's height available. */
  fitH?: number;
  /** Maximum height in CSS px (else --pw-max-h, else unlimited). */
  maxH?: number;
  /** Ancestor selector to measure (default: the parent element). */
  box?: string;
}

export function PixelWord({ text, variant = 'logo', className, fitW = 1, fitH, maxH, box }: PixelWordProps) {
  const geo = useMemo(() => build(text, variant), [text, variant]);
  const ref = useRef<SVGSVGElement>(null);
  const [cell, setCell] = useState<number | null>(null);

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const host = (box ? svg.closest(box) : svg.parentElement) as HTMLElement | null;
    if (!host) return;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssMax = parseFloat(getComputedStyle(svg).getPropertyValue('--pw-max-h'));
      const maxPx = maxH ?? (Number.isFinite(cssMax) ? cssMax : Infinity);
      let limit = (host.clientWidth * fitW * dpr) / geo.w;
      if (fitH) limit = Math.min(limit, (host.clientHeight * fitH * dpr) / geo.h);
      limit = Math.min(limit, (maxPx * dpr) / geo.h);
      // Whole device pixels per cell when there's room; below that, fractional cells beat shrinking to 1px.
      const next = (limit >= 2.5 ? Math.floor(limit) : Math.max(1, limit)) / dpr;
      setCell((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [geo, fitW, fitH, maxH, box]);

  const style: CSSProperties = cell ? { width: geo.w * cell, height: geo.h * cell } : { width: 0, height: 0, visibility: 'hidden' };
  return (
    <svg
      ref={ref}
      className={className ? `af-pw af-pw--${variant} ${className}` : `af-pw af-pw--${variant}`}
      viewBox={`0 0 ${geo.w} ${geo.h}`}
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
      style={style}
    >
      <path className="af-pw__shadow" d={geo.shadow} />
      {geo.outline ? <path className="af-pw__outline" d={geo.outline} /> : null}
      <path className="af-pw__fill" d={geo.fill} />
      <path className="af-pw__fill2" d={geo.fill2} />
    </svg>
  );
}
