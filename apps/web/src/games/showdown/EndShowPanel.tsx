/**
 * End show / Finish show (PRS-03 D): the console's one action Undo can't take back (the room clears
 * its undo stack when the show ends). So it takes two deliberate steps, inline — never a modal over
 * the show: the button opens this panel, which names every answer still hidden on the board, and a
 * 1.2 s press-and-hold confirms. Keyboard: the panel takes focus; Tab to the hold button, hold Enter.
 * Esc or "Keep playing" closes it.
 */
import { useEffect, useRef } from 'react';
import type { ShowdownBoardView, ShowdownLook, ShowdownSheet } from '@dascade/shared/games/showdown';
import { Button, PixelIcon } from '@dascade/ui';
import { HoldButton } from './HoldButton.tsx';
import { END_HOLD_MS, HOLD_MS, hiddenAnswers } from './consoleSafety.ts';

export type EndKind = 'end' | 'finish';

export function EndShowPanel({
  kind,
  board,
  sheet,
  look,
  sweeping,
  revealNeedsHold,
  onConfirm,
  onRevealFirst,
  onClose,
}: {
  kind: EndKind;
  board: ShowdownBoardView;
  sheet: ShowdownSheet | null;
  look: ShowdownLook;
  sweeping: boolean;
  /** Reveal remaining needs its hold right now (the clock is still running). */
  revealNeedsHold: boolean;
  onConfirm: () => void;
  /** Close and run Reveal remaining instead (offered while the question is up). */
  onRevealFirst: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [kind]);

  const hidden = hiddenAnswers(board, sheet);
  const mark = look === 'halloween' ? '🎃' : '⭐';
  const finish = kind === 'finish';
  const title = finish ? 'Finish the show?' : 'End the show for everyone?';
  const live = board.stage === 'live' || board.stage === 'steal';
  let state: string;
  if (board.stage === 'intro') state = 'The show hasn’t started yet: round 1 hasn’t been played.';
  else if (board.stage === 'title') state = `Round ${board.round + 1} hasn’t been played yet — its answers stay hidden.`;
  else if (hidden.length === 0) state = finish ? 'That was the last board, and every answer is up.' : 'Every answer on this board is up.';
  else state = `${hidden.length} answer${hidden.length === 1 ? ' is' : 's are'} still hidden on this board:`;

  return (
    <div
      ref={ref}
      className="sdc-endpanel"
      role="region"
      aria-labelledby="sdc-endpanel-title"
      aria-describedby="sdc-endpanel-what"
      tabIndex={-1}
      data-kind={kind}
      data-part="showdown-end-panel"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        // Esc here closes the panel (it doesn't also disarm the special or stop a sweep).
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <h3 className="sdc-endpanel__title" id="sdc-endpanel-title">
        <PixelIcon name="flag" /> {title}
      </h3>
      <p className="sdc-endpanel__state">{state}</p>
      {live && hidden.length > 0 ? (
        <ol className="sdc-endpanel__hidden" aria-label="Answers still hidden">
          {hidden.map((h) => (
            <li key={h.n} data-special={h.special ? 'true' : undefined}>
              <span className="sdc-endpanel__n dc-num">{h.n}</span>
              <span className="sdc-endpanel__t">{h.text || 'Hidden answer'}</span>
              {h.special ? (
                <span className="sdc-endpanel__sp">
                  Special <span aria-hidden>{mark}</span>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="sdc-endpanel__what" id="sdc-endpanel-what">
        Every screen goes to the closing screen. <b>This can’t be undone</b> — Undo won’t bring the show back.
      </p>
      <div className="sdc-endpanel__actions">
        <Button variant="secondary" onClick={onClose} data-part="showdown-end-keep">
          Keep playing
        </Button>
        {live && hidden.length > 0 && !sweeping ? (
          revealNeedsHold ? (
            // The clock still runs: the same hold as Reveal remaining in the rail.
            <HoldButton
              ms={HOLD_MS}
              variant="ghost"
              icon="sparkle"
              label="Reveal remaining first — hold, the clock is still running"
              onFire={onRevealFirst}
              data-part="showdown-end-reveal-first"
            >
              Reveal remaining first
            </HoldButton>
          ) : (
            <Button variant="ghost" icon="sparkle" onClick={onRevealFirst} data-part="showdown-end-reveal-first">
              Reveal remaining first
            </Button>
          )
        ) : null}
        <HoldButton
          ms={END_HOLD_MS}
          variant="danger"
          icon="flag"
          label={finish ? 'Hold to finish the show' : 'Hold to end the show'}
          onFire={onConfirm}
          data-part="showdown-end-confirm"
        >
          {finish ? 'Hold to finish the show' : 'Hold to end the show'}
        </HoldButton>
      </div>
    </div>
  );
}
