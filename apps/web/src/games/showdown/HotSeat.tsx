/**
 * VIS-02 C — the hot-seat podium: a lit podium in the host's column with the picked person's name,
 * up for the whole turn (from the landing until the hot seat empties — Mark done, No answer, a reroll,
 * a new round). It lives in its own column, so it never covers an answer; Boo steps aside while it's
 * up. The turn timer is written in words ("answering · 0:12"), and when their answer flips the podium
 * says so ("Called it! ✓ #4 found") while the tile carries the credit (Board.tsx).
 *
 * The name is the public display name only. Under reduced motion the podium appears without moving.
 * Narrow stages (below a 1.45 aspect, where the status column wraps under the board) get a compact
 * podium at the start of the status row (stageShowcase.css / picker.css).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { ShowdownBoardView } from '@dascade/shared/games/showdown';
import { serverNow } from '../../net/hooks.ts';
import { fill, type ShowcaseCopy } from './look.ts';
import type { PickMoment } from './PickerSpotlight.tsx';

/** The podium is up: someone is in the hot seat, the stage has landed, and the landing card has gone. */
export function hotSeatUp(moment: PickMoment): boolean {
  return moment.landed && Boolean(moment.name) && moment.phase !== 'sweep' && moment.phase !== 'card';
}

export function HotSeat({ moment, board, copy }: { moment: PickMoment; board: ShowdownBoardView; copy: ShowcaseCopy }) {
  if (!hotSeatUp(moment)) return null;
  return <Podium key={moment.drawNo} name={moment.name} landAt={moment.landAt} board={board} copy={copy} />;
}

/** "0:12" — time spent answering (floored: it counts up). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The answer this person called on this board (the latest, if more than one), as its rank. */
export function calledRank(board: Pick<ShowdownBoardView, 'slots'>, name: string): number {
  let best = -1;
  let bestSeq = -1;
  board.slots.forEach((slot, i) => {
    if (slot.revealed && slot.calledBy && slot.calledBy === name && slot.seq >= bestSeq) {
      best = i;
      bestSeq = slot.seq;
    }
  });
  return best >= 0 ? best + 1 : 0;
}

function Podium({ name, landAt, board, copy }: { name: string; landAt: number; board: ShowdownBoardView; copy: ShowcaseCopy }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  const rank = calledRank(board, name);
  const elapsed = formatElapsed(landAt ? now - landAt : 0);
  const chars = Array.from(name);
  const wlen = Math.max(4, ...name.split(/\s+/).map((w) => Array.from(w).length));
  return (
    <div
      className="sd-hotseat"
      data-part="showdown-hotseat"
      data-credit={rank ? 'true' : undefined}
      role="status"
      aria-label={`${rank ? copy.calledIt : copy.hotSeat}: ${name}`}
    >
      <i className="sd-hotseat__light" aria-hidden />
      <div className="sd-hotseat__box">
        <span className="sd-hotseat__kicker">{rank ? copy.calledIt : copy.hotSeat}</span>
        <b className="sd-hotseat__name" style={{ '--len': Math.max(4, chars.length), '--wlen': wlen } as CSSProperties}>
          {name}
        </b>
        <span className="sd-hotseat__meter">
          {rank ? (
            <>
              <span aria-hidden>✓</span> <Numbered text={fill(copy.foundRank, { n: rank })} />
            </>
          ) : (
            <>
              {copy.answering} · <span className="sd-num">{elapsed}</span>
            </>
          )}
        </span>
      </div>
      <i className="sd-hotseat__base" aria-hidden />
    </div>
  );
}

/** Text with its numbers in the number face (`--font-num`). */
export function Numbered({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((part, i) =>
        /^\d+$/.test(part) ? (
          <span key={i} className="sd-num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
