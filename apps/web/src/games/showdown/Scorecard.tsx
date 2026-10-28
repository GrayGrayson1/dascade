/**
 * Your Top 10 (two-tier scoring, the crowd's side): one numbered row per answer on the board. Lock a
 * guess into the spot you think it ranks; when its answer flips — however it flipped — it scores the
 * tile's value (#1 = 10 … #10 = 1), +1 in the right spot, double for a hidden gem, and +20 for a
 * perfect list. Your points, place and medals stay private to you.
 *
 * One component for every device (Brian's parity rule): a phone and a desktop tab get the same rows
 * and controls; only the layout flows. Everything comes from your private `showdown:me` and the public
 * board — a match shows only once its answer is up, so nothing here can leak an answer.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  SHOWDOWN_LIMITS,
  SHOWDOWN_MSG,
  type ShowdownBoardView,
  type ShowdownLook,
  type ShowdownMedalMode,
  type ShowdownMyGuess,
} from '@dascade/shared/games/showdown';
import { SYS, type ActionErrorPayload } from '@dascade/shared';
import { Button, PixelIcon, TextInput } from '@dascade/ui';
import { useRoomMessage } from '../../net/hooks.ts';
import { showdownApi } from './api.ts';
import { playShowSound } from './sounds.ts';
import { useRecent } from './stageFx.tsx';
import { useMe, useMotion } from './state.ts';
import { flashText, medalList, newlyPaid, scorecardRows, summaryWords, type ScorecardRow } from './scorecard.ts';
import './scorecard.css';

/** A sent guess waits this long for the server before its row opens again (a refusal comes back as an error toast). */
const PENDING_MS = 4000;
const FLASH_MS = 2600;
const NO_GUESSES: ShowdownMyGuess[] = [];

export function Scorecard({
  board,
  look,
  limit,
  medals,
}: {
  board: ShowdownBoardView;
  look: ShowdownLook;
  limit: number;
  medals: ShowdownMedalMode;
}) {
  const me = useMe();
  const motion = useMotion();
  const guesses = me && me.round === board.round ? me.guesses : NO_GUESSES;
  const live = board.stage === 'live';
  const model = useMemo(() => scorecardRows({ slots: board.slots, guesses, limit, live }), [board.slots, guesses, limit, live]);
  const score = me?.score ?? null;

  /** Typed drafts per spot, and the spots whose guess is on its way to the server. */
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<Record<number, number>>({});
  // A new round: fresh rows.
  useEffect(() => {
    setDrafts({});
    setPending({});
  }, [board.round]);
  // The server's answer: a locked spot drops its draft; a refusal hands the text back to its box.
  useEffect(() => {
    setPending((p) => {
      const left = Object.fromEntries(Object.entries(p).filter(([pos]) => model.rows[Number(pos)]?.state !== 'locked'));
      return Object.keys(left).length === Object.keys(p).length ? p : left;
    });
    setDrafts((d) => {
      const left = Object.fromEntries(Object.entries(d).filter(([pos]) => model.rows[Number(pos)]?.state !== 'locked'));
      return Object.keys(left).length === Object.keys(d).length ? d : left;
    });
  }, [model.rows]);
  useRoomMessage<ActionErrorPayload>(SYS.error, (p) => {
    if (p.type === SHOWDOWN_MSG.guess) setPending({});
  });
  useEffect(() => {
    if (!Object.keys(pending).length) return;
    const t = setTimeout(() => setPending({}), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  // "Called it! +9, +1 spot on": a guess that just started paying (never on load, never for an Undo).
  const prev = useRef<{ round: number; guesses: readonly ShowdownMyGuess[]; perfect: number } | null>(null);
  const [flash, setFlash] = useState<{ at: number; text: string } | null>(null);
  useEffect(() => {
    if (!me) return;
    const before = prev.current;
    const perfect = me.score?.perfect ?? 0;
    prev.current = { round: board.round, guesses, perfect };
    if (!before || before.round !== board.round) return;
    const text = flashText(newlyPaid(before.guesses, guesses), Math.max(0, perfect - before.perfect));
    if (text) setFlash({ at: performance.now(), text });
  }, [me, guesses, board.round]);
  const flashing = useRecent(flash?.at, FLASH_MS);

  const submit = (pos: number) => (e: FormEvent) => {
    e.preventDefault();
    const text = (drafts[pos] ?? '').trim();
    if (!text || !model.open || pending[pos] !== undefined) return;
    if (Object.keys(pending).length >= model.left) return;
    showdownApi.guess(board.round, text, pos);
    playShowSound('tap', look);
    setPending((p) => ({ ...p, [pos]: Date.now() }));
  };

  const held = medals !== 'never' ? medalList(score?.medals) : [];
  const pendingCount = Object.keys(pending).length;
  const left = Math.max(0, model.left - pendingCount);

  return (
    <section
      className="sd-panel sdk"
      data-open={model.open ? 'true' : undefined}
      data-motion={motion.motion ? undefined : 'off'}
      aria-labelledby="sdk-title"
      data-part="showdown-scorecard"
    >
      <h3 className="sd-panel__title sdk__title" id="sdk-title">
        Your Top {model.rows.length || 10}
        <span className="sdk__left" aria-live="polite">
          {model.rows.length && live ? (
            <>
              <span className="dc-num">{left}</span> of <span className="dc-num">{model.limit}</span> guesses left
            </>
          ) : null}
        </span>
      </h3>

      <p className="sdk__summary" data-part="showdown-scorecard-summary">
        <span className="sdk__points">
          <PixelIcon name="star" size={14} /> {withNumbers(summaryWords(score))}
        </span>
        {score && score.positionHits > 0 ? (
          <span className="sdk__chip">
            <span className="dc-num">{score.positionHits}</span> spot on
          </span>
        ) : null}
        {held.length ? (
          <span className="sdk__medals" aria-label={held.map((m) => `${m.n} ${m.title}`).join(', ')}>
            {held.map((m) => (
              <span key={m.kind} className="sdk__medal" title={m.title} aria-hidden>
                {m.icon}
                {m.n > 1 ? <span className="dc-num">×{m.n}</span> : null}
              </span>
            ))}
          </span>
        ) : null}
      </p>

      <p
        className="sdk__flash"
        role="status"
        aria-live="polite"
        data-part="showdown-scorecard-flash"
        data-on={flashing ? 'true' : undefined}
      >
        {flashing && flash ? withNumbers(flash.text) : ''}
      </p>

      {model.rows.length ? (
        <>
          <p className="sd-muted sdk__how">
            {live
              ? 'Put each guess in the spot you think it ranks. When its answer flips you score #1 = 10 … #10 = 1, +1 in the right spot, +20 for a perfect list.'
              : board.stage === 'title'
                ? 'Your Top 10 opens when the question is up.'
                : 'Guesses are closed for this question.'}
          </p>
          <ol className="sdk__rows" aria-label="Your Top 10, by spot">
            {model.rows.map((row) => (
              <Row
                key={row.pos}
                row={row}
                draft={drafts[row.pos] ?? ''}
                sending={pending[row.pos] !== undefined}
                canSend={model.open && pendingCount < model.left}
                onDraft={(v) => setDrafts((d) => ({ ...d, [row.pos]: v }))}
                onSubmit={submit(row.pos)}
              />
            ))}
          </ol>
          {model.loose.length ? (
            <ul className="sdk__loose" aria-label="Guesses without a spot">
              {model.loose.map((g, i) => (
                <li key={`${g.text}-${i}`}>
                  {g.text}
                  {g.points > 0 ? (
                    <span className="sdk__hit">
                      {' '}
                      +<span className="dc-num">{g.points}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="sd-muted">Your Top 10 opens when the question is up.</p>
      )}
    </section>
  );
}

function Row({
  row,
  draft,
  sending,
  canSend,
  onDraft,
  onSubmit,
}: {
  row: ScorecardRow;
  draft: string;
  sending: boolean;
  canSend: boolean;
  onDraft: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const n = row.pos + 1;
  return (
    <li
      className="sdk__row"
      data-part="showdown-scorecard-row"
      data-pos={row.pos}
      data-state={row.state}
      data-called={row.called ? 'true' : undefined}
    >
      <span className="sdk__num dc-num" aria-hidden>
        {n}
      </span>
      {row.state === 'open' || (row.state === 'closed' && draft) ? (
        <form className="sdk__form" onSubmit={onSubmit}>
          <TextInput
            value={draft}
            maxLength={SHOWDOWN_LIMITS.guessText}
            placeholder="Your guess…"
            aria-label={`Guess for spot #${n}`}
            disabled={sending || row.state !== 'open'}
            onChange={(e) => onDraft(e.currentTarget.value)}
            enterKeyHint="send"
            autoComplete="off"
            data-part="showdown-scorecard-input"
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={sending || !canSend || !draft.trim()}
            loading={sending}
            aria-label={`Lock in spot #${n}`}
          >
            Lock in
          </Button>
        </form>
      ) : row.state === 'locked' ? (
        <span className="sdk__body">
          <span className="sdk__text">{row.text}</span>
          {row.called ? (
            <span className="sdk__hit">
              <span className="visually-hidden">Called it: </span>+<span className="dc-num">{row.points}</span>
              {row.gem ? <span className="sdk__gem"> hidden gem</span> : null}
              {row.bonus ? (
                <span className="sdk__bonus">
                  {' '}
                  +<span className="dc-num">{row.bonus}</span> spot on
                </span>
              ) : null}
            </span>
          ) : row.repeat ? (
            <span className="sdk__note">already counted</span>
          ) : (
            <span className="sdk__lock">
              <PixelIcon name="lock" size={12} /> locked
            </span>
          )}
          {row.spotAnswer ? (
            <span className="sdk__spot">
              #{n} is {row.spotAnswer}
            </span>
          ) : null}
        </span>
      ) : row.state === 'board' ? (
        <span className="sdk__body">
          <span className="sdk__text sdk__text--board">{row.text}</span>
          <span className="sdk__note">on the board</span>
        </span>
      ) : (
        <span className="sdk__body">
          <span className="sdk__empty">—</span>
        </span>
      )}
    </li>
  );
}

/** Numbers in the house digit face (--font-num), the words around them as text. */
function withNumbers(text: string) {
  // An ordinal stays whole ("2nd", not "2 nd").
  return text.split(/(\d+(?:st|nd|rd|th)?)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="dc-num">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
