/**
 * The Presenter Showcase console — one person runs a Top-10 board for a crowd in a meeting, alone,
 * while reading the meeting chat. Built for one glance and one click:
 *
 *   - the answer sheet (the ten answers, the special one marked) and a huge WRONG button,
 *   - the round clock and "Reveal remaining" (#10 → #1, run by the server),
 *   - one "Next step" line that always says what to do now,
 *   - stage cards, sound cues, undo / restart, the live stage preview.
 *
 * This is the presenter's private screen: it is never shared (the stage window is). Only the
 * presenter's connection ever receives the answer sheet. Every command carries the board revision
 * (or the round) it was made against, so a double click or a stale view never applies twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  SHOWDOWN_CUES,
  SHOWDOWN_CUE_INFO,
  SHOWDOWN_CARD_INFO,
  SHOWDOWN_MSG,
  showTitle,
  type ShowdownActPayload,
  type ShowdownBoardView,
  type ShowdownClockOp,
  type ShowdownCue,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownSettings,
  type ShowdownSheet,
  type ShowdownSheetRound,
} from '@dascade/shared/games/showdown';
import { Badge, Button, Kbd, Modal, PixelIcon, Toggle, cx } from '@dascade/ui';
import { serverNow, session, useRoomSelector } from '../../net/hooks.ts';
import { Stage } from './Stage.tsx';
import { useShowFeed } from './fx.ts';
import { useStageWindow } from './stageWindow.ts';
import {
  AudioStatus,
  BigScreenLinkButton,
  PresenterTools,
  ShowSoundToggle,
  StageCards,
  StageWindowButton,
  ThemeMusicToggle,
} from './consoleParts.tsx';
import { formatClock, useBoard, useCard, useClock, usePass, useRehearsal, useSheet, useSweep } from './state.ts';
import './chrome-showcase.css';

type BoardAct = 'begin' | 'question' | 'next' | 'undo' | 'finish' | 'restart' | 'reset';
type Confirm = null | 'end' | 'next' | 'finish' | 'restart' | 'reset' | 'sweep';

const STAGE_LABEL: Record<string, string> = {
  intro: 'Opening',
  title: 'Title card',
  live: 'Live',
  steal: 'Live',
  done: 'Board complete',
};

/** The special answer's marker (the pumpkin is the DAS-O-Ween one). */
export const specialMark = (look: ShowdownLook) => (look === 'halloween' ? '🎃' : '⭐');

/**
 * Time's up on the round clock — re-renders its host only when that flips (not 4× a second like the
 * clock's own display).
 */
function useTimeUp(): boolean {
  const endsAt = useRoomSelector<ShowdownPublicState, number>((s) => s.clockEndsAt) ?? 0;
  const paused = useRoomSelector<ShowdownPublicState, number>((s) => s.clockLeft) ?? 0;
  const max = useRoomSelector<ShowdownPublicState, number>((s) => s.clockMax) ?? 0;
  const [, force] = useState(0);
  const left = endsAt > 0 ? endsAt - serverNow() : paused;
  const pending = endsAt > 0 && left > 0;
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => force((n) => n + 1), Math.max(0, endsAt - serverNow()) + 40);
    return () => clearTimeout(t);
  }, [pending, endsAt]);
  return max > 0 && left <= 0;
}

export function ShowcaseConsole({ look, settings, code }: { look: ShowdownLook; settings: ShowdownSettings | null; code: string }) {
  const board = useBoard();
  const sheet = useSheet();
  const pass = usePass();
  const sweeping = useSweep();
  const rehearsal = useRehearsal();
  const card = useCard();
  const timeUp = useTimeUp();
  const running = useRoomSelector<ShowdownPublicState, boolean>((s) => (s.clockEndsAt ?? 0) > 0) ?? false;
  const clockMax = useRoomSelector<ShowdownPublicState, number>((s) => s.clockMax) ?? 0;
  const stageWin = useStageWindow();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const title = settings ? showTitle(settings) : 'DAS Survey Showdown';

  const live = useRef({ board, sheet, sweeping, confirm, running, timeUp, clockMax });
  live.current = { board, sheet, sweeping, confirm, running, timeUp, clockMax };

  const send = useCallback((payload: ShowdownActPayload) => session.send(SHOWDOWN_MSG.act, payload), []);
  const act = useCallback(
    (a: BoardAct) => {
      const b = live.current.board;
      if (b) send({ a, rev: b.rev });
    },
    [send],
  );
  const reveal = useCallback(
    (slot: number) => {
      const b = live.current.board;
      // Reveals name the round on screen (not the revision): a late one never flips the next board.
      if (b) send({ a: 'reveal', slot, round: b.round });
    },
    [send],
  );
  const miss = useCallback(() => {
    const b = live.current.board;
    if (b) send({ a: 'miss', round: b.round });
  }, [send]);
  const clockOp = useCallback((op: ShowdownClockOp) => send({ a: 'clock', op }), [send]);
  const cue = useCallback((c: ShowdownCue) => session.send(SHOWDOWN_MSG.cue, { cue: c }), []);

  const hiddenCount = (b: ShowdownBoardView | null) => (b ? b.slots.filter((s) => !s.revealed).length : 0);
  const isLast = (b: ShowdownBoardView) => b.round >= b.totalRounds - 1;

  /** Reveal remaining: asks first while the clock still has time on it (a stray R would end the round). */
  const requestSweep = useCallback(() => {
    const { board: b, sweeping: on, running: r, timeUp: up } = live.current;
    if (!b || on || hiddenCount(b) === 0 || b.stage !== 'live') return;
    if (r && !up) return setConfirm('sweep');
    send({ a: 'sweep', round: b.round });
  }, [send]);
  const halt = useCallback(() => send({ a: 'halt' }), [send]);

  /** Next: start round 1, or the next round — asking first when answers would stay hidden or the show would end. */
  const requestNext = useCallback(() => {
    const b = live.current.board;
    if (!b) return;
    if (b.stage === 'intro') return act('begin');
    if (isLast(b)) return setConfirm('finish');
    if (hiddenCount(b) > 0) return setConfirm('next');
    act('next');
  }, [act]);

  // Keyboard shortcuts: no auto-repeat, ignored while typing or with a dialog open, and a key only
  // sends what its button would allow (a refused command would just beep).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable]') || t.isContentEditable || t.closest('dialog[open]'))) return;
      const cur = live.current;
      if (cur.confirm || document.querySelector('dialog[open]')) return;
      const b = cur.board;
      if (!b) return;
      const k = e.key.toLowerCase();
      // Digits by key position too, so AZERTY's unshifted top row (&, é, "…) reveals as well.
      const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1] ?? (/^\d$/.test(k) ? k : null);
      if (digit !== null) {
        const slot = digit === '0' ? 9 : Number(digit) - 1;
        const tile = b.slots[slot];
        if ((b.stage === 'title' || b.stage === 'live') && tile && !tile.revealed) reveal(slot);
      } else if (k === 'x') {
        if (b.stage === 'live' && !cur.sweeping) miss();
      } else if (k === 'r') {
        if (cur.sweeping) halt();
        else requestSweep();
      } else if (k === 'escape') {
        if (!cur.sweeping) return;
        halt();
      } else if (k === 'c') cue('celebrate');
      else if (k === 'p') {
        if (b.stage === 'intro') return;
        clockOp(cur.running ? 'pause' : 'start');
      } else if (k === 'q') {
        if (b.stage === 'intro') act('begin');
        else if (b.stage === 'title') act('question');
        else return;
      } else if (k === 'n') requestNext();
      else if (k === 'u') {
        if ((cur.sheet?.undo ?? 0) > 0) act('undo');
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, reveal, miss, halt, requestSweep, requestNext, cue, clockOp]);

  // The stage preview re-renders on its own feed; keep it out of the console's re-renders.
  const preview = useMemo(() => <Stage look={look} settings={settings} variant="preview" />, [look, settings]);

  if (!board) return null;
  const stage = board.stage;
  const hidden = hiddenCount(board);
  const found = board.slots.filter((s) => s.revealed && !s.late).length;
  const last = isLast(board);
  const roundTitle = board.title || sheet?.title || '';
  const where = board.round < 0 ? 'Before round 1' : `Round ${board.round + 1} of ${board.totalRounds}`;
  const confirmDone = (fn: () => void) => () => {
    setConfirm(null);
    fn();
  };

  return (
    <div className="sd-console sdc" data-look={look} data-stage={stage} data-part="showdown-console" data-mode="showcase">
      <header className="sdc-bar">
        <span className="sd-live" aria-label="Live show">
          <i aria-hidden /> Live
        </span>
        <div className="sdc-bar__title">
          <span className="sdc-bar__show">{title}</span>
          <span className="sdc-bar__where">
            <b>{where}</b>
            {roundTitle && board.round >= 0 ? ` · ${roundTitle}` : ''} · {STAGE_LABEL[stage] ?? stage}
          </span>
        </div>
        {rehearsal ? (
          <Badge className="sdc-rehearsal" color="var(--warning)" solid title="Demo answers — the real show’s answers are not loaded">
            Rehearsal
          </Badge>
        ) : null}
        <span className="dc-spacer" />
        <AudioStatus look={look} />
        <span className="sdc-bar__group">
          <StageWindowButton code={code} title={title} size="sm" openLabel="Stage window" />
          <BigScreenLinkButton code={code} size="sm" />
          <ShowSoundToggle />
          <ThemeMusicToggle />
        </span>
        <Button size="sm" variant="danger" icon="flag" onClick={() => setConfirm('end')}>
          End show
        </Button>
      </header>

      {card ? (
        <div className="sdc-cardup" role="status">
          <span aria-hidden>{SHOWDOWN_CARD_INFO[card].icon}</span>
          <span>
            <b>{SHOWDOWN_CARD_INFO[card].title}</b> is on the stage — the audience can’t see the board right now.
          </span>
          <Button size="sm" variant="secondary" onClick={() => session.send(SHOWDOWN_MSG.card, { card: '' })}>
            Take it down
          </Button>
        </div>
      ) : null}

      <NextStep
        board={board}
        hidden={hidden}
        found={found}
        last={last}
        timeUp={timeUp}
        sweeping={sweeping}
        minutes={Math.round(clockMax / 60_000)}
        onAct={act}
        onNext={requestNext}
        onSweep={requestSweep}
        onHalt={halt}
      />

      <div className="sdc-main">
        <section className="sdc-sheet" aria-label="Answer sheet" data-part="showdown-sheet">
          <AnswerSheet board={board} sheet={sheet} look={look} found={found} onReveal={reveal} />
        </section>

        <section className="sdc-rail" aria-label="Show controls">
          <WrongButton board={board} sweeping={sweeping} onMiss={miss} />
          <ClockPanel stage={stage} timeUp={timeUp} sweeping={sweeping} onOp={clockOp} />
          <SweepButton board={board} hidden={hidden} sweeping={sweeping} timeUp={timeUp} onSweep={requestSweep} onHalt={halt} />
          <div className="sdc-rail__row">
            <Button
              variant="secondary"
              icon="refresh"
              disabled={(sheet?.undo ?? 0) === 0}
              onClick={() => act('undo')}
              title={`${sheet?.undo ?? 0} step${sheet?.undo === 1 ? '' : 's'} to undo`}
            >
              Undo <Kbd>U</Kbd>
            </Button>
            <Button
              variant={stage === 'done' ? 'primary' : 'ghost'}
              icon={stage === 'intro' ? 'play' : last ? 'flag' : 'arrow-right'}
              onClick={requestNext}
            >
              {stage === 'intro' ? 'Start round 1' : last ? 'Finish show' : 'Next round'} <Kbd>N</Kbd>
            </Button>
          </div>
        </section>

        <section className="sdc-side" aria-label="Stage and extras">
          <div className="sdc-side__preview">
            <div className="sd-preview" aria-hidden inert>
              {preview}
            </div>
            <p className="sd-preview__caption">
              <PixelIcon name="eye" /> What the audience sees
              {stageWin.open ? ' (live in the stage window)' : ' — open the stage window to share it'}
            </p>
          </div>
          <div className="sd-panel sdc-panel">
            <h3 className="sd-panel__title">Stage cards</h3>
            <StageCards compact />
          </div>
          <CuePanel onCue={cue} />
          <div className="sd-panel sdc-panel sdc-fix">
            <h3 className="sd-panel__title">Fix a mistake</h3>
            <div className="sd-row sd-row--wrap">
              <Button size="sm" variant="ghost" icon="refresh" disabled={board.round < 0} onClick={() => setConfirm('restart')}>
                Restart this round
              </Button>
              <Button size="sm" variant="ghost" icon="refresh" disabled={stage === 'intro'} onClick={() => setConfirm('reset')}>
                Restart the whole show
              </Button>
            </div>
            <p className="sd-muted">Both can be undone. Undo steps back one action at a time.</p>
          </div>
          {settings?.audience ? <AudienceGuesses sheet={sheet} /> : null}
          <Rundown sheet={sheet} current={board.round} look={look} />
          <PresenterTools code={code} pass={pass} />
        </section>
      </div>

      <Dock board={board} hidden={hidden} sweeping={sweeping} onMiss={miss} onSweep={requestSweep} onHalt={halt} />

      <footer className="sd-console__keys sdc-keys" aria-label="Keyboard shortcuts">
        <span>
          <Kbd>1</Kbd>–<Kbd>0</Kbd> reveal
        </span>
        <span>
          <Kbd>X</Kbd> wrong
        </span>
        <span>
          <Kbd>R</Kbd> reveal remaining (<Kbd>R</Kbd>/<Kbd>Esc</Kbd> stops)
        </span>
        <span>
          <Kbd>C</Kbd> celebrate
        </span>
        <span>
          <Kbd>P</Kbd> clock start/pause
        </span>
        <span>
          <Kbd>Q</Kbd> start round / show question
        </span>
        <span>
          <Kbd>N</Kbd> next
        </span>
        <span>
          <Kbd>U</Kbd> undo
        </span>
      </footer>

      <Modal
        open={confirm === 'end'}
        onClose={() => setConfirm(null)}
        title="End the show now?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep going
            </Button>
            <Button variant="danger" icon="flag" onClick={confirmDone(() => act('finish'))}>
              End show
            </Button>
          </>
        }
      >
        <p>Every screen goes to the closing screen. This ends the show for good — it can’t be undone.</p>
        {stage !== 'intro' && hidden > 0 ? (
          <p>
            <strong>
              <span className="dc-num">{hidden}</span> answer{hidden === 1 ? ' is' : 's are'} still hidden on this board.
            </strong>{' '}
            To show them first, choose Keep going and press Reveal remaining.
          </p>
        ) : null}
      </Modal>
      <Modal
        open={confirm === 'finish'}
        onClose={() => setConfirm(null)}
        title="Finish the show?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep going
            </Button>
            <Button variant="primary" icon="flag" onClick={confirmDone(() => act('next'))}>
              Finish show
            </Button>
          </>
        }
      >
        <p>That was the last board. Everyone sees the closing screen — this ends the show for good.</p>
        {hidden > 0 && stage !== 'title' ? (
          <p>
            <strong>
              <span className="dc-num">{hidden}</span> answer{hidden === 1 ? ' is' : 's are'} still hidden.
            </strong>{' '}
            Press Reveal remaining first if the audience should see them.
          </p>
        ) : null}
        {stage === 'title' ? <p>This round hasn’t been played yet.</p> : null}
      </Modal>
      <Modal
        open={confirm === 'next'}
        onClose={() => setConfirm(null)}
        title={stage === 'title' ? `Skip round ${board.round + 1}?` : `Move on to round ${board.round + 2}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Stay here
            </Button>
            {stage === 'live' ? (
              <Button
                variant="secondary"
                icon="sparkle"
                onClick={confirmDone(() => {
                  const b = live.current.board;
                  if (b) send({ a: 'sweep', round: b.round });
                })}
              >
                Reveal remaining first
              </Button>
            ) : null}
            <Button variant="primary" icon="arrow-right" onClick={confirmDone(() => act('next'))}>
              Go to round {board.round + 2}
            </Button>
          </>
        }
      >
        {stage === 'title' ? (
          <p>Round {board.round + 1} hasn’t been played. Its answers stay hidden. (You can Undo this.)</p>
        ) : (
          <p>
            <span className="dc-num">{hidden}</span> answer{hidden === 1 ? ' is' : 's are'} still hidden on this board and will stay hidden.
            (You can Undo this.)
          </p>
        )}
      </Modal>
      <Modal
        open={confirm === 'sweep'}
        onClose={() => setConfirm(null)}
        title={`Reveal the remaining ${hidden}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Not yet
            </Button>
            <Button
              variant="primary"
              icon="sparkle"
              onClick={confirmDone(() => {
                const b = live.current.board;
                if (b) send({ a: 'sweep', round: b.round });
              })}
            >
              Reveal remaining
            </Button>
          </>
        }
      >
        <p>
          The clock is still running. Reveal remaining stops it and flips every hidden answer from the bottom of the board up, with a
          drumroll before the special one.
        </p>
      </Modal>
      <Modal
        open={confirm === 'restart'}
        onClose={() => setConfirm(null)}
        title={`Restart round ${board.round + 1}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" icon="refresh" onClick={confirmDone(() => act('restart'))}>
              Restart round
            </Button>
          </>
        }
      >
        <p>Every answer goes back under its tile, the round returns to its title card and the clock resets. You can Undo this.</p>
      </Modal>
      <Modal
        open={confirm === 'reset'}
        onClose={() => setConfirm(null)}
        title="Restart the whole show?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" icon="refresh" onClick={confirmDone(() => act('reset'))}>
              Back to the opening
            </Button>
          </>
        }
      >
        <p>The show goes back to its opening marquee, with every board hidden again. You can Undo this.</p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NextStep({
  board,
  hidden,
  found,
  last,
  timeUp,
  sweeping,
  minutes,
  onAct,
  onNext,
  onSweep,
  onHalt,
}: {
  board: ShowdownBoardView;
  hidden: number;
  found: number;
  last: boolean;
  timeUp: boolean;
  sweeping: boolean;
  minutes: number;
  onAct: (a: BoardAct) => void;
  onNext: () => void;
  onSweep: () => void;
  onHalt: () => void;
}) {
  const total = board.slots.length;
  let text: ReactNode;
  let action: ReactNode = null;
  let tone: 'go' | 'live' | 'alert' | 'done' = 'go';
  switch (board.stage) {
    case 'intro':
      text = 'The opening is on the stage. Welcome everyone, then start round 1.';
      action = (
        <Button variant="primary" size="lg" icon="play" onClick={() => onAct('begin')}>
          Start round 1 <Kbd>Q</Kbd>
        </Button>
      );
      break;
    case 'title':
      text = (
        <>
          Round {board.round + 1}’s title card is up
          {board.title ? (
            <>
              {' '}
              — <b>{board.title}</b>
            </>
          ) : null}
          . Show the question when you’re ready
          {minutes > 0 ? ` — the ${minutes}-minute clock starts with it.` : '.'}
        </>
      );
      action = (
        <Button variant="primary" size="lg" icon="eye" onClick={() => onAct('question')}>
          Show the question <Kbd>Q</Kbd>
        </Button>
      );
      break;
    case 'live':
    case 'steal':
      if (sweeping) {
        tone = 'live';
        text = (
          <>
            Revealing the rest, #{total} up to #1 — <span className="dc-num">{hidden}</span> to go. Enjoy the drumroll.
          </>
        );
        action = (
          <Button variant="secondary" size="lg" icon="pause" onClick={onHalt}>
            Stop <Kbd>Esc</Kbd>
          </Button>
        );
      } else if (timeUp) {
        tone = 'alert';
        text = (
          <>
            <b>Time’s up</b> — wrap up the last guesses, then Reveal remaining.
          </>
        );
        action = (
          <Button variant="primary" size="lg" icon="sparkle" onClick={onSweep}>
            Reveal remaining (<span className="dc-num">{hidden}</span>) <Kbd>R</Kbd>
          </Button>
        );
      } else {
        tone = 'live';
        text = (
          <>
            Read the chat: click the answer someone names, or press <b>Wrong</b>.{' '}
            <span className="sdc-next__count">
              <span className="dc-num">{found}</span> of <span className="dc-num">{total}</span> found
            </span>
          </>
        );
      }
      break;
    case 'done':
      tone = 'done';
      text = last ? (
        <>
          The whole board is up — that was the last one. Finish the show, then put up <b>Prize time</b> or <b>Thanks</b>.
        </>
      ) : (
        <>
          The whole board is up (<span className="dc-num">{found}</span> found). Take a breath — or put up <b>Be right back</b> — then go to
          round {board.round + 2}.
        </>
      );
      action = (
        <Button variant="primary" size="lg" icon={last ? 'flag' : 'arrow-right'} onClick={onNext}>
          {last ? 'Finish the show' : 'Next round'} <Kbd>N</Kbd>
        </Button>
      );
      break;
  }
  return (
    <div className="sdc-next" data-tone={tone} role="status" data-part="showdown-next-step">
      <span className="sdc-next__label">Next step</span>
      <p className="sdc-next__text">{text}</p>
      {action ? <span className="sdc-next__action">{action}</span> : null}
    </div>
  );
}

function AnswerSheet({
  board,
  sheet,
  look,
  found,
  onReveal,
}: {
  board: ShowdownBoardView;
  sheet: ShowdownSheet | null;
  look: ShowdownLook;
  found: number;
  onReveal: (slot: number) => void;
}) {
  const intro = board.stage === 'intro';
  // Before round 1, the first round's answers as a read-only preview (to get ready).
  const upNext: ShowdownSheetRound | null = intro ? (sheet?.rundown[0] ?? null) : null;
  if (!sheet || (intro && !upNext)) {
    return (
      <div className="sd-panel sdc-sheetpanel">
        <h3 className="sd-panel__title">
          <PixelIcon name="lock" /> Answer sheet
        </h3>
        <p className="sd-muted">The answers appear here — and only here — once round 1 starts.</p>
      </div>
    );
  }
  const answers = intro ? upNext!.answers.map((a) => ({ ...a, revealed: false, guessed: 0 })) : sheet.answers;
  const special = intro ? upNext!.special : sheet.special;
  const prompt = intro ? upNext!.prompt : sheet.prompt;
  const title = intro ? upNext!.title : sheet.title;
  const source = intro ? upNext!.source : sheet.source;
  const roundNo = intro ? 1 : sheet.round + 1;
  const open = board.stage === 'title' || board.stage === 'live';
  const rows = Math.ceil(answers.length / 2);
  const mark = specialMark(look);
  return (
    <div className="sd-panel sdc-sheetpanel" data-stage={board.stage}>
      <header className="sdc-sheet__head">
        <h3 className="sd-panel__title">
          <PixelIcon name="lock" /> {intro ? 'Up first' : 'Answer sheet'} <span className="sdc-private">Only you see this</span>
        </h3>
        {!intro ? (
          <span className="sdc-found" aria-label={`${found} of ${answers.length} found`}>
            <span className="dc-num">{found}</span>/<span className="dc-num">{answers.length}</span> found
          </span>
        ) : null}
      </header>
      <p className="sdc-sheet__prompt" data-hidden={board.stage === 'title' || intro ? 'true' : undefined}>
        <span className="sdc-sheet__q">
          R{roundNo}
          {title ? ` · ${title}` : ''}
        </span>
        <span className="sdc-sheet__qtext">{prompt}</span>
        {source ? <span className="sdc-sheet__source">According to {source}</span> : null}
      </p>
      {board.stage === 'title' ? (
        <p className="sdc-sheet__hint">The question isn’t on the stage yet — clicking an answer shows it first.</p>
      ) : null}
      {intro ? <p className="sdc-sheet__hint">A preview to get ready — the answers unlock when round 1 starts.</p> : null}
      <ol className="sdc-answers" style={{ '--rows': rows } as CSSProperties}>
        {answers.map((a, i) => {
          const slot = board.slots[i];
          const revealed = !intro && (slot?.revealed ?? a.revealed);
          const late = revealed && Boolean(slot?.late);
          const isSpecial = i === special;
          const n = i + 1;
          return (
            <li key={i}>
              <button
                type="button"
                className="sdc-answer"
                data-part="showdown-answer"
                data-revealed={revealed ? 'true' : undefined}
                data-late={late ? 'true' : undefined}
                data-special={isSpecial ? 'true' : undefined}
                disabled={revealed || !open}
                onClick={() => onReveal(i)}
                aria-label={
                  revealed ? `Answer ${n}: ${a.text}, revealed` : `Reveal answer ${n}: ${a.text}${isSpecial ? ' (special answer)' : ''}`
                }
              >
                <span className="sdc-answer__num">{n}</span>
                <span className="sdc-answer__body">
                  {isSpecial ? (
                    <span className="sdc-answer__special">
                      Special <span aria-hidden>{mark}</span>
                    </span>
                  ) : null}
                  <span className="sdc-answer__text">{a.text}</span>
                  {a.note || a.aliases.length ? (
                    <span className="sdc-answer__meta">
                      {a.note ? <span className="sdc-answer__note">{a.note}</span> : null}
                      {a.aliases.length ? <span className="sdc-answer__aliases">also: {a.aliases.join(', ')}</span> : null}
                    </span>
                  ) : null}
                </span>
                {a.guessed > 0 ? (
                  <span className="sdc-answer__guessed" title={`${a.guessed} in the audience guessed this`}>
                    <PixelIcon name="users" size={12} />
                    <span className="dc-num">{a.guessed}</span>
                  </span>
                ) : null}
                <span className="sdc-answer__action" aria-hidden>
                  {revealed ? (
                    <>
                      <PixelIcon name="check" /> {late ? 'Shown' : 'Found'}
                    </>
                  ) : intro ? (
                    <PixelIcon name="lock" />
                  ) : (
                    'Reveal'
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The wrong-answer buzzer: the ✕ and the buzzer on every screen. As often as people miss. */
function WrongButton({ board, sweeping, onMiss }: { board: ShowdownBoardView; sweeping: boolean; onMiss: () => void }) {
  const feed = useShowFeed();
  const last = feed.last.miss;
  const misses = last && last.e.round === board.round ? last.e.n : 0;
  const enabled = board.stage === 'live' && !sweeping;
  /** Re-keys the press pulse on every wrong answer that landed (the button itself keeps its focus). */
  const flash = last && last.e.round === board.round ? last.at : 0;
  return (
    <div className="sdc-wrongbox">
      <button
        type="button"
        className="sdc-wrong"
        data-part="showdown-wrong"
        disabled={!enabled}
        onClick={onMiss}
        aria-label="Wrong answer (buzzer and ✕ on the stage)"
      >
        {flash ? <span key={flash} className="sdc-wrong__pulse" aria-hidden /> : null}
        <span className="sdc-wrong__x" aria-hidden>
          ✕
        </span>
        <span className="sdc-wrong__label">Wrong</span>
        <Kbd>X</Kbd>
      </button>
      <span className="sdc-wrongbox__note" aria-live="polite">
        {board.stage === 'title'
          ? 'Show the question first'
          : board.stage === 'done'
            ? 'Every answer is up'
            : sweeping
              ? 'Revealing the rest…'
              : misses
                ? `${misses} wrong this round`
                : 'Buzz any guess that isn’t on the board'}
      </span>
    </div>
  );
}

function ClockPanel({
  stage,
  timeUp,
  sweeping,
  onOp,
}: {
  stage: ShowdownBoardView['stage'];
  timeUp: boolean;
  sweeping: boolean;
  onOp: (op: ShowdownClockOp) => void;
}) {
  const clock = useClock();
  const ready = stage !== 'intro';
  /** Starting the clock is the thing to do only while guessing is on (it starts with the question anyway). */
  const startMatters = stage === 'live' && !sweeping && !clock.running && clock.left > 0;
  const over = clock.on && clock.left < 0;
  const pct = clock.on && clock.max > 0 ? Math.max(0, Math.min(1, clock.left / clock.max)) : 0;
  return (
    <div
      className="sd-panel sdc-clock"
      data-state={!clock.on ? 'off' : timeUp ? 'up' : clock.running ? 'running' : 'paused'}
      data-part="showdown-clock"
    >
      <div className="sdc-clock__head">
        <h3 className="sd-panel__title">
          <PixelIcon name="clock" /> Round clock
        </h3>
        <span className="sdc-clock__state">{!clock.on ? 'Off' : timeUp ? 'Time’s up' : clock.running ? 'Running' : 'Paused'}</span>
      </div>
      {clock.on ? (
        <>
          <span
            className="sdc-clock__time"
            role="timer"
            aria-label={over ? `Overtime ${formatClock(clock.left)}` : `${formatClock(clock.left)} left`}
          >
            {formatClock(clock.left)}
          </span>
          <span className="sdc-clock__bar" aria-hidden>
            <i style={{ transform: `scaleX(${pct})` }} />
          </span>
          {timeUp ? (
            <p className="sdc-clock__up">Time’s up — wrap up, then Reveal remaining. Nothing is revealed until you say so.</p>
          ) : null}
          <Button
            className="sdc-clock__go"
            variant={startMatters ? 'primary' : 'secondary'}
            icon={clock.running ? 'pause' : 'play'}
            disabled={!ready}
            onClick={() => onOp(clock.running ? 'pause' : 'start')}
          >
            {clock.running ? 'Pause clock' : 'Start clock'} <Kbd>P</Kbd>
          </Button>
          <div className="sdc-clock__btns">
            <button type="button" className="sdc-mini" disabled={!ready} onClick={() => onOp('plus')} aria-label="Add one minute">
              +1 min
            </button>
            <button type="button" className="sdc-mini" disabled={!ready} onClick={() => onOp('minus')} aria-label="Take one minute off">
              −1 min
            </button>
            <button
              type="button"
              className="sdc-mini"
              disabled={!ready}
              onClick={() => onOp('reset')}
              aria-label="Reset the clock to full time (paused)"
            >
              Reset
            </button>
          </div>
          <Toggle label="Show the clock on the stage" checked={clock.stage} onChange={(on) => onOp(on ? 'show' : 'hide')} />
        </>
      ) : (
        <>
          <p className="sd-muted">This show has no round clock.</p>
          <Button size="sm" variant="secondary" icon="clock" disabled={!ready} onClick={() => onOp('start')}>
            Start a clock now
          </Button>
        </>
      )}
    </div>
  );
}

function SweepButton({
  board,
  hidden,
  sweeping,
  timeUp,
  onSweep,
  onHalt,
}: {
  board: ShowdownBoardView;
  hidden: number;
  sweeping: boolean;
  timeUp: boolean;
  onSweep: () => void;
  onHalt: () => void;
}) {
  if (sweeping) {
    return (
      <div className="sdc-sweep" data-on="true">
        <span className="sdc-sweep__status" role="status">
          <PixelIcon name="sparkle" /> Revealing… <span className="dc-num">{hidden}</span> to go
        </span>
        <Button variant="secondary" icon="pause" block onClick={onHalt}>
          Stop revealing <Kbd>Esc</Kbd>
        </Button>
      </div>
    );
  }
  const can = board.stage === 'live' && hidden > 0;
  return (
    <div className="sdc-sweep">
      <Button
        variant={timeUp && can ? 'primary' : 'secondary'}
        size="lg"
        block
        icon="sparkle"
        disabled={!can}
        onClick={onSweep}
        className="sdc-sweep__btn"
        data-urgent={timeUp && can ? 'true' : undefined}
      >
        Reveal remaining{' '}
        {can ? (
          <span className="sdc-sweep__count">
            (<span className="dc-num">{hidden}</span>)
          </span>
        ) : null}{' '}
        <Kbd>R</Kbd>
      </Button>
      <span className="sdc-sweep__hint">
        {can
          ? `#${board.slots.length} → #1, a drumroll before the special one`
          : board.stage === 'done'
            ? 'Every answer is up'
            : 'Once the question is up'}
      </span>
    </div>
  );
}

function CuePanel({ onCue }: { onCue: (c: ShowdownCue) => void }) {
  return (
    <div className="sd-panel sdc-panel">
      <h3 className="sd-panel__title">Sound cues</h3>
      <div className="sdc-cues">
        <button type="button" className="sdc-cue sdc-cue--big" onClick={() => onCue('celebrate')}>
          <span aria-hidden>{SHOWDOWN_CUE_INFO.celebrate.icon}</span> Celebrate! <Kbd>C</Kbd>
        </button>
        {SHOWDOWN_CUES.filter((c) => c !== 'celebrate').map((c) => (
          <button key={c} type="button" className="sdc-cue" onClick={() => onCue(c)}>
            <span aria-hidden>{SHOWDOWN_CUE_INFO[c].icon}</span>
            {SHOWDOWN_CUE_INFO[c].title}
          </button>
        ))}
      </div>
    </div>
  );
}

function AudienceGuesses({ sheet }: { sheet: ShowdownSheet | null }) {
  const guessesIn = useRoomSelector<ShowdownPublicState, number>((s) => s.guessesIn) ?? 0;
  const cloud = sheet?.cloud ?? [];
  return (
    <div className="sd-panel sdc-panel">
      <h3 className="sd-panel__title">
        Phone guesses <Badge>{guessesIn}</Badge>
      </h3>
      {cloud.length === 0 ? (
        <p className="sd-muted">While the question is up, phones can lock in private guesses. The most popular show here.</p>
      ) : (
        <ol className="sd-cloud">
          {cloud.map((c, i) => (
            <li key={i} data-hit={c.slot >= 0 ? 'true' : undefined}>
              <span className="sd-cloud__text">{c.text}</span>
              {c.slot >= 0 ? (
                <span className="sd-cloud__slot">#{c.slot + 1}</span>
              ) : (
                <span className="sd-cloud__miss">not on the board</span>
              )}
              <span className="sd-num sd-cloud__count">{c.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Rundown({ sheet, current, look }: { sheet: ShowdownSheet | null; current: number; look: ShowdownLook }) {
  if (!sheet?.rundown.length) return null;
  const mark = specialMark(look);
  return (
    <details className="sd-panel sd-rundown sdc-rundown">
      <summary className="sd-panel__title">
        Rundown <span className="sd-muted sdc-rundown__count">{sheet.rundown.length} rounds</span>
      </summary>
      <ol>
        {sheet.rundown.map((r) => (
          <li key={r.index} data-state={r.index < current ? 'done' : r.index === current ? 'now' : 'next'}>
            <span className="sd-rundown__q">
              R{r.index + 1}
              {r.title ? ` · ${r.title}` : ''}
              {r.index === current ? ' · now' : ''}
            </span>
            <span className="sd-rundown__prompt">{r.prompt}</span>
            <span className="sd-rundown__answers">
              {r.answers.map((a, i) => `${i + 1}. ${a.text}${i === r.special ? ` ${mark}` : ''}`).join(' · ')}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Narrow screens: the buzzer and Reveal remaining stay at the bottom of the screen while you scroll the sheet. */
function Dock({
  board,
  hidden,
  sweeping,
  onMiss,
  onSweep,
  onHalt,
}: {
  board: ShowdownBoardView;
  hidden: number;
  sweeping: boolean;
  onMiss: () => void;
  onSweep: () => void;
  onHalt: () => void;
}) {
  const clock = useClock();
  const live = board.stage === 'live';
  return (
    <div className={cx('sdc-dock')} aria-label="Quick controls">
      <button type="button" className="sdc-wrong sdc-wrong--dock" disabled={!live || sweeping} onClick={onMiss} aria-label="Wrong answer">
        <span className="sdc-wrong__x" aria-hidden>
          ✕
        </span>
        <span className="sdc-wrong__label">Wrong</span>
      </button>
      {clock.on ? (
        <span className="sdc-dock__clock dc-num" data-over={clock.left <= 0 ? 'true' : undefined}>
          {formatClock(clock.left)}
        </span>
      ) : null}
      {sweeping ? (
        <Button variant="secondary" icon="pause" onClick={onHalt}>
          Stop
        </Button>
      ) : (
        <Button variant="secondary" icon="sparkle" disabled={!live || hidden === 0} onClick={onSweep}>
          Reveal rest
        </Button>
      )}
    </div>
  );
}
