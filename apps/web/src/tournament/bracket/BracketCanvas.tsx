/**
 * Desktop bracket: the traditional spatial tree (winners + losers bands, finals to the right)
 * with connector lines. Scrolls inside its own viewport (never the page) and can be dragged to pan.
 */
import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_DIMS, layoutBracket } from './layout.ts';
import { MatchCard } from './MatchCard.tsx';
import type { BracketVM } from './types.ts';

export function BracketCanvas({ vm, onSelect, label }: { vm: BracketVM; onSelect: (matchId: string) => void; label: string }) {
  const layout = useMemo(() => layoutBracket(vm, DEFAULT_DIMS), [vm]);
  const matches = useMemo(() => vm.sections.flatMap((s) => s.rounds.flatMap((r) => r.matches)), [vm]);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  // Drag-to-pan with a mouse (touch devices scroll natively). Clicks on cards still work: a pan only
  // starts on the background, and a real drag swallows the click that follows it.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const el = viewport.current;
    if (!el) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = viewport.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    viewport.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  return (
    <div
      className="tc-canvas"
      ref={viewport}
      role="region"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="tc-canvas__inner" style={{ width: layout.width, height: layout.height }}>
        {layout.bands
          .filter((b) => b.id === 'losers')
          .map((b) => (
            <div key={b.id} className="tc-canvas__band" style={{ top: b.y - DEFAULT_DIMS.sectionGap / 2 }} aria-hidden />
          ))}
        {layout.headers.map((h) => (
          <div
            key={h.key}
            className="tc-canvas__header"
            data-state={h.state}
            data-section={h.section}
            style={{ left: h.x, top: h.y, width: h.w }}
          >
            <span className="tc-canvas__round">{h.label}</span>
          </div>
        ))}
        <svg className="tc-canvas__lines" width={layout.width} height={layout.height} aria-hidden>
          {layout.connectors.map((c) => (
            <path key={c.key} d={c.d} data-decided={c.decided || undefined} data-mine={c.mine || undefined} />
          ))}
        </svg>
        {matches.map((m) => {
          const box = layout.boxes[m.id];
          if (!box) return null;
          return (
            <MatchCard
              key={m.id}
              match={m}
              onSelect={onSelect}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              className="tc-match--abs"
            />
          );
        })}
      </div>
    </div>
  );
}
