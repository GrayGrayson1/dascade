/**
 * The survey board: numbered tiles that flip over (3D, with a light burst and a metallic glint) to
 * show the answer. A hidden tile renders its number only — the client never has a hidden answer.
 *
 * Team Showdown tiles show the survey points. Presenter Showcase tiles show the answer's rank, its
 * small note (artist, year…) and no points; a tile nobody found (revealed by Reveal remaining) is
 * muted, and the special answer's slot (a public position, never its text) carries a marker the
 * crowd can hunt for, then a permanent frame once it's up. A tile flipped while someone was in the
 * hot seat credits them ("called by Priya S."): the server sends `calledBy` only once it's revealed.
 * With Score the crowd and Called-it pops on, a flipped tile also pops its crowd value and how many
 * called it ("+9 · 6 called it" — counts only, never names; standings.ts).
 *
 * Fresh reveals only: a tile animates when it turns while mounted, so a late joiner (or a refreshed
 * screen) sees tiles already turned. Every tile animates on its own, so overlapping reveals (a fast
 * presenter, the sweep) never wait for each other.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { SHOWDOWN_LIMITS, type ShowdownBoardView, type ShowdownSlotView } from '@dascade/shared/games/showdown';
import { cx } from '@dascade/ui';
import { teamClass } from './state.ts';
import { fill } from './look.ts';
import { popFor } from './standings.ts';

/** Called-it pops (Presenter Showcase with Score the crowd): hidden gems double; the words from the look. */
export interface BoardPops {
  gems: boolean;
  /** "{n} called it". */
  called: string;
}

/** How long a fresh reveal's anticipation + flip + burst + glint runs. */
export const REVEAL_MS = 1500;

export interface BoardProps {
  board: ShowdownBoardView;
  /** Phones: one column, small tiles. */
  compact?: boolean;
  /** A slot to flash (the top answer, classic). */
  highlight?: number;
  /** A hidden slot in the drumroll spotlight (Reveal remaining's suspense beat). */
  spotlight?: number;
  /** The special label (look copy). */
  specialLabel?: string;
  /** The hot-seat credit's words (look copy): "called by". */
  creditLabel?: string;
  /** Called-it pops on flipped tiles (null = off). */
  pops?: BoardPops | null;
}

export function Board({
  board,
  compact = false,
  highlight = -1,
  spotlight = -1,
  specialLabel = 'Special',
  creditLabel = 'called by',
  pops = null,
}: BoardProps) {
  const n = board.slots.length;
  const cols = compact || n < 4 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const showcase = board.mode === 'showcase';
  const revealed = board.slots.filter((s) => s.revealed).length;
  return (
    <ol
      className="sd-board"
      data-cols={cols}
      data-mode={showcase ? 'showcase' : 'classic'}
      data-compact={compact ? 'true' : undefined}
      data-spotlight={spotlight >= 0 ? 'true' : undefined}
      style={{ '--rows': rows, '--cols': cols } as CSSProperties}
      aria-label={`${showcase ? 'Top' : 'Survey'} board: ${n} answers, ${revealed} revealed`}
    >
      {board.slots.map((slot, i) => (
        <Tile
          key={i}
          index={i}
          slot={slot}
          showcase={showcase}
          special={board.special === i}
          highlight={highlight === i}
          spotlight={spotlight === i && !slot.revealed}
          specialLabel={specialLabel}
          creditLabel={creditLabel}
          pops={showcase ? pops : null}
        />
      ))}
    </ol>
  );
}

function Tile({
  index,
  slot,
  showcase,
  special,
  highlight,
  spotlight,
  specialLabel,
  creditLabel,
  pops,
}: {
  index: number;
  slot: ShowdownSlotView;
  showcase: boolean;
  special: boolean;
  highlight: boolean;
  spotlight: boolean;
  specialLabel: string;
  creditLabel: string;
  pops: BoardPops | null;
}) {
  // The flip is a transition (or, fresh, an animation), so it only plays on a change seen while
  // mounted: a late joiner's revealed tiles are simply already turned.
  const fresh = useFresh(slot.revealed);
  const text = slot.text ?? '';
  const len = Array.from(text).length;
  const wlen = Math.max(4, ...text.split(/\s+/).map((w) => Array.from(w).length));
  const rank = index + 1;
  // Only ever on a revealed tile (the server adds it with the answer); never on a classic board.
  const credit = showcase && slot.revealed && slot.calledBy ? slot.calledBy : '';
  const pop = pops ? popFor(slot, index, pops.gems) : null;
  const popCalled = pop && pop.callers > 0 && pops ? fill(pops.called, { n: pop.callers }) : '';
  const label = slot.revealed
    ? showcase
      ? `Answer ${rank}: ${text}${slot.note ? ` (${slot.note})` : ''}${special ? ', the special answer' : ''}${slot.late ? ', not found' : ''}${credit ? `, ${creditLabel} ${credit}` : ''}${pop ? `, worth ${pop.value}${popCalled ? `, ${popCalled}` : ''}` : ''}`
      : `Answer ${rank}: ${text}, ${slot.points} points`
    : `Answer ${rank}: hidden${showcase && special ? ' (the special answer)' : ''}`;
  return (
    <li
      className={cx('sd-tile', highlight && 'sd-tile--highlight')}
      data-revealed={slot.revealed ? 'true' : undefined}
      data-by={teamClass(slot.by)}
      data-top={index === 0 ? 'true' : undefined}
      data-special={showcase && special ? 'true' : undefined}
      data-late={showcase && slot.revealed && slot.late ? 'true' : undefined}
      data-fresh={fresh ? 'true' : undefined}
      data-spot={spotlight ? 'true' : undefined}
      data-credit={credit ? 'true' : undefined}
      data-pop={pop ? 'true' : undefined}
      style={{ '--i': index, '--len': Math.max(8, len), '--wlen': wlen } as CSSProperties}
      aria-label={label}
    >
      <div className="sd-tile__card">
        <div className="sd-tile__face sd-tile__face--front" aria-hidden>
          <span className="sd-tile__oval">
            <span className="sd-tile__num">{rank}</span>
          </span>
          {showcase && special ? (
            <span className="sd-tile__mark">
              <SpecialGlyph />
              <span className="sd-tile__mark-label">{specialLabel}</span>
            </span>
          ) : null}
        </div>
        <div className="sd-tile__face sd-tile__face--back" aria-hidden>
          {showcase ? (
            <>
              <span className="sd-tile__rank">
                <span className="sd-num">{rank}</span>
              </span>
              <span className="sd-tile__body">
                <span className="sd-tile__text">{text}</span>
                {slot.note ? <span className="sd-tile__note">{slot.note}</span> : null}
              </span>
              {special ? (
                <span className="sd-tile__star">
                  <SpecialGlyph />
                </span>
              ) : null}
            </>
          ) : (
            <>
              <span className="sd-tile__text">{text}</span>
              <span className="sd-tile__pts">{slot.points ?? ''}</span>
              {slot.callers > 0 ? (
                <span className="sd-tile__callers" title={`${slot.callers} in the audience called it`}>
                  ★{slot.callers}
                </span>
              ) : null}
            </>
          )}
          {fresh ? <i key={fresh} className="sd-tile__glint" /> : null}
        </div>
      </div>
      {fresh ? <i key={fresh} className="sd-tile__burst" aria-hidden /> : null}
      {credit ? (
        <span className="sd-tile__credit" data-fresh={fresh ? 'true' : undefined} aria-hidden>
          {creditLabel} <b>{credit}</b>
        </span>
      ) : null}
      {pop ? (
        <span
          className="sd-tile__pop"
          data-part="showdown-pop"
          data-slot={index}
          data-gem={pop.gem ? 'true' : undefined}
          data-fresh={fresh ? 'true' : undefined}
          aria-hidden
        >
          <b className="sd-num">+{pop.value}</b>
          {popCalled ? (
            <span className="sd-tile__pop-called">
              {' · '}
              {popCalled.split(/(\d+)/).map((part, i) =>
                /^\d+$/.test(part) ? (
                  <span key={i} className="sd-num">
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </span>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

/**
 * A counter that ticks when `revealed` turns true while mounted, and goes back to 0 once the
 * reveal animation is over (0 = nothing fresh: the tile rests in its final state).
 */
function useFresh(revealed: boolean): number {
  const [fresh, setFresh] = useState(0);
  const was = useRef(revealed);
  const seq = useRef(0);
  // Before paint: the first frame of a fresh reveal already carries the animation (no transition blip).
  useLayoutEffect(() => {
    if (revealed && !was.current) {
      seq.current++;
      setFresh(seq.current);
    }
    if (!revealed) setFresh(0);
    was.current = revealed;
  }, [revealed]);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(0), REVEAL_MS);
    return () => clearTimeout(t);
  }, [fresh]);
  return fresh;
}

/**
 * The special answer's glyph: a little jack-o'-lantern in Halloween Night, a star in DAS Showtime
 * (both drawn; the stylesheet shows the look's own).
 */
export function SpecialGlyph() {
  return (
    <svg className="sd-glyph" viewBox="0 0 40 40" aria-hidden focusable="false">
      <g className="sd-glyph__pumpkin">
        <path d="M20 7 C19 3 21 1 24 2 C22.5 4 22.5 5.5 22 8" fill="#3f7a2a" />
        <ellipse cx="12.5" cy="22" rx="9" ry="12" fill="#e8650f" />
        <ellipse cx="27.5" cy="22" rx="9" ry="12" fill="#e8650f" />
        <ellipse cx="20" cy="22" rx="9.5" ry="13" fill="#ff8a24" />
        <path
          d="M12 19 l4 -4 l1.6 5.4 z M28 19 l-4 -4 l-1.6 5.4 z M11 26 Q20 33 29 26 L26 27.5 L23.5 26 L21 28.5 L19 26 L16.5 28.5 L14 26 Z"
          fill="#ffe08a"
        />
      </g>
      <path
        className="sd-glyph__star"
        d="M20 3 l4.9 10.6 11.6 1.3 -8.6 7.9 2.4 11.4 -10.3 -5.9 -10.3 5.9 2.4 -11.4 -8.6 -7.9 11.6 -1.3 z"
        fill="#ffd36b"
        stroke="#b07a1a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
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
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!motion) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    if (start === value) return;
    // Animate on the window this number is drawn in: in the stage window, the console's frames stop
    // whenever the console is hidden (another tab, minimised, covered by the fullscreen stage).
    const win = ref.current?.ownerDocument.defaultView ?? window;
    const t0 = win.performance.now();
    const ms = Math.min(1200, 380 + Math.abs(value - start) * 6);
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - k) * (1 - k) * (1 - k);
      const v = Math.round(start + (value - start) * eased);
      setShown(v);
      from.current = v;
      if (k < 1) raf = win.requestAnimationFrame(tick);
    };
    raf = win.requestAnimationFrame(tick);
    return () => win.cancelAnimationFrame(raf);
  }, [value, motion]);
  return (
    <span ref={ref} className={cx('sd-num', className)} aria-label={String(value)}>
      {shown}
    </span>
  );
}
