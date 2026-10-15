/**
 * The survey board: numbered tiles that flip over (3D, with a metallic glint) to show the answer and
 * its survey points. A hidden tile renders its number only — the client never has a hidden answer.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SHOWDOWN_LIMITS, type ShowdownBoardView, type ShowdownSlotView } from '@dascade/shared/games/showdown';
import { cx } from '@dascade/ui';
import { teamClass } from './state.ts';

export function Board({ board, compact = false, highlight = -1 }: { board: ShowdownBoardView; compact?: boolean; highlight?: number }) {
  const n = board.slots.length;
  const cols = compact || n < 4 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  return (
    <ol
      className="sd-board"
      data-cols={cols}
      style={{ '--rows': rows, '--cols': cols } as CSSProperties}
      aria-label={`Survey board: ${n} answers, ${board.slots.filter((s) => s.revealed).length} revealed`}
    >
      {board.slots.map((slot, i) => (
        <Tile key={i} index={i} slot={slot} highlight={highlight === i} />
      ))}
    </ol>
  );
}

function Tile({ index, slot, highlight }: { index: number; slot: ShowdownSlotView; highlight: boolean }) {
  // The flip is a CSS transition, so it only plays on a change seen while mounted (a late joiner's
  // revealed tiles are simply already turned); the glint follows a fresh reveal.
  const flipped = slot.revealed;
  const [glint, setGlint] = useState(0);
  const was = useRef(slot.revealed);
  useEffect(() => {
    if (slot.revealed && !was.current) setGlint((g) => g + 1);
    was.current = slot.revealed;
  }, [slot.revealed]);
  const label = slot.revealed ? `Answer ${index + 1}: ${slot.text}, ${slot.points} points` : `Answer ${index + 1}: hidden`;
  return (
    <li
      className={cx('sd-tile', highlight && 'sd-tile--highlight')}
      data-revealed={flipped ? 'true' : undefined}
      data-by={teamClass(slot.by)}
      data-top={index === 0 ? 'true' : undefined}
      style={{ '--i': index } as CSSProperties}
      aria-label={label}
    >
      <div className="sd-tile__card">
        <div className="sd-tile__face sd-tile__face--front" aria-hidden>
          <span className="sd-tile__oval">
            <span className="sd-tile__num">{index + 1}</span>
          </span>
        </div>
        <div className="sd-tile__face sd-tile__face--back" aria-hidden>
          <span className="sd-tile__text">{slot.text ?? ''}</span>
          <span className="sd-tile__pts">{slot.points ?? ''}</span>
          {slot.callers > 0 ? (
            <span className="sd-tile__callers" title={`${slot.callers} in the audience called it`}>
              ★{slot.callers}
            </span>
          ) : null}
          {glint > 0 ? <i key={glint} className="sd-tile__glint" /> : null}
        </div>
      </div>
    </li>
  );
}

/** The three strike lamps under the board. */
export function StrikeLamps({ strikes, stealFailed }: { strikes: number; stealFailed: boolean }) {
  return (
    <div className="sd-lamps" role="img" aria-label={`${strikes} of ${SHOWDOWN_LIMITS.strikes} strikes`}>
      {Array.from({ length: SHOWDOWN_LIMITS.strikes }, (_, i) => (
        <span key={i} className="sd-lamp" data-on={i < strikes ? 'true' : undefined}>
          ✕
        </span>
      ))}
      {stealFailed ? (
        <span className="sd-lamp sd-lamp--steal" data-on="true">
          ✕
        </span>
      ) : null}
    </div>
  );
}

/** A number that rolls to its new value (instantly under reduced motion). */
export function Rolling({ value, motion, className }: { value: number; motion: boolean; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!motion) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    if (start === value) return;
    const t0 = performance.now();
    const ms = Math.min(1200, 380 + Math.abs(value - start) * 6);
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - k) * (1 - k) * (1 - k);
      const v = Math.round(start + (value - start) * eased);
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, motion]);
  return (
    <span className={cx('sd-num', className)} aria-label={String(value)}>
      {shown}
    </span>
  );
}
