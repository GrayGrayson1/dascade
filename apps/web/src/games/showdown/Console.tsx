/**
 * The presenter console — show control for the one person who sees the answers.
 *
 * Only rendered for the presenter, and it only has answers because the server sent this connection
 * the answer sheet (`showdown:sheet`); nobody else ever receives one. Every command carries the board
 * revision the console was showing, so a double click or a stale view never applies twice.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  SHOWDOWN_CUES,
  SHOWDOWN_CUE_INFO,
  SHOWDOWN_LIMITS,
  SHOWDOWN_MSG,
  SHOWDOWN_TEAMS,
  showTitle,
  teamName,
  type ShowdownActPayload,
  type ShowdownBoardView,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownSettings,
  type ShowdownSheet,
  type TeamIndex,
} from '@dascade/shared/games/showdown';
import { Badge, Button, IconButton, Kbd, Modal, PixelIcon, Select } from '@dascade/ui';
import { session, useRoomSelector } from '../../net/hooks.ts';
import { useApp } from '../../app/store.ts';
import { sfx } from '../../audio/audio.ts';
import { Stage } from './Stage.tsx';
import { StrikeLamps } from './Board.tsx';
import { copyText, presenterLink, screenLink } from './access.ts';
import { openStageWindow, useStageWindow } from './stageWindow.ts';
import { useBoard, useMotion, usePass, useRosters, useSheet, useShowSounds } from './state.ts';

type ActBody = { [K in ShowdownActPayload['a']]: Omit<Extract<ShowdownActPayload, { a: K }>, 'a' | 'rev'> };

export function PresenterConsole({ look, settings, code }: { look: ShowdownLook; settings: ShowdownSettings | null; code: string }) {
  const board = useBoard();
  const sheet = useSheet();
  const pass = usePass();
  const motion = useMotion();
  const [sounds, setSounds] = useShowSounds('presenter');
  const stageWin = useStageWindow();
  const [confirm, setConfirm] = useState<null | 'finish' | 'skip'>(null);
  const [revealing, setRevealing] = useState(false);
  const boardRef = useRef(board);
  boardRef.current = board;
  const names: [string, string] = [teamName(settings, 0), teamName(settings, 1)];
  const title = settings ? showTitle(settings) : 'DAS Survey Showdown';

  const act = useCallback(<K extends ShowdownActPayload['a']>(a: K, body?: ActBody[K]) => {
    const b = boardRef.current;
    if (!b) return;
    const payload = a === 'reveal' ? { a, ...body } : { a, rev: b.rev, ...body };
    session.send(SHOWDOWN_MSG.act, payload);
  }, []);

  const cue = (c: (typeof SHOWDOWN_CUES)[number]) => session.send(SHOWDOWN_MSG.cue, { cue: c });

  const stage = board?.stage ?? 'intro';
  const decided = board ? board.roundHow !== '' : false;
  const lastRound = board ? board.round >= board.totalRounds - 1 : false;
  const hidden = useMemo(() => (board ? board.slots.map((s, i) => (s.revealed ? -1 : i)).filter((i) => i >= 0) : []), [board]);

  const next = () => {
    if (!board) return;
    if (board.stage === 'intro') return act('begin');
    if (!decided && board.bank > 0) return setConfirm('skip');
    act('next');
  };

  // Reveal the rest of a decided board one tile at a time (for the show).
  useEffect(() => {
    if (!revealing) return;
    const b = boardRef.current;
    const first = b?.slots.findIndex((s) => !s.revealed) ?? -1;
    if (!b || b.stage !== 'done' || first < 0) {
      setRevealing(false);
      return;
    }
    const t = setTimeout(() => act('reveal', { slot: first }), 650);
    return () => clearTimeout(t);
  }, [revealing, board, act]);

  // Keyboard shortcuts (ignored while typing or with modifiers other than Shift).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('dialog[open]'))) return;
      const b = boardRef.current;
      if (!b) return;
      const k = e.key.toLowerCase();
      if (/^[0-9]$/.test(k)) {
        const slot = k === '0' ? 9 : Number(k) - 1;
        if (slot < b.slots.length) act('reveal', { slot });
      } else if (k === 'x') act('strike');
      else if (k === 'q') b.stage === 'intro' ? act('begin') : act('question');
      else if (k === 'arrowleft' || k === '[') act('control', { team: 0 });
      else if (k === 'arrowright' || k === ']') act('control', { team: 1 });
      else if (k === 'n') next();
      else if (k === 'u') act('undo');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!board) return null;

  return (
    <div className="sd-console" data-look={look} data-stage={stage}>
      <header className="sd-console__bar">
        <span className="sd-live" aria-label="Live show">
          <i aria-hidden /> Live
        </span>
        <div className="sd-console__title">
          <span className="sd-console__show">{title}</span>
          <span className="sd-console__where">
            {board.round < 0 ? 'Intro' : `Round ${board.round + 1} of ${board.totalRounds}`}
            {board.multiplier > 1 ? ` · ×${board.multiplier}` : ''} · {STAGE_LABEL[stage]}
          </span>
        </div>
        <span className="dc-spacer" />
        <Button
          size="sm"
          variant={stageWin.open ? 'success' : 'primary'}
          icon="maximize"
          onClick={() => {
            if (!openStageWindow(code, title)) useApp.getState().toast('warning', 'Your browser blocked the stage window — allow pop-ups for this site, or open the big-screen link on the projector.');
          }}
        >
          {stageWin.open ? 'Stage window open' : 'Stage window'}
        </Button>
        <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyLink(screenLink(code), 'Big-screen link copied')}>
          Big-screen link
        </Button>
        <IconButton
          size="sm"
          icon={sounds ? 'sound-on' : 'sound-off'}
          label={sounds ? 'Mute show sounds on this device' : 'Play show sounds on this device'}
          variant={sounds ? 'ghost' : 'secondary'}
          onClick={() => setSounds(!sounds)}
        />
        <Button size="sm" variant="danger" icon="flag" onClick={() => setConfirm('finish')}>
          End show
        </Button>
      </header>

      <div className="sd-console__grid">
        <section className="sd-console__col sd-console__col--stage">
          <div className="sd-preview" aria-hidden inert>
            <Stage look={look} settings={settings} variant="preview" />
          </div>
          <p className="sd-preview__caption">
            <PixelIcon name="eye" /> What the audience sees{stageWin.open ? ' (live in the stage window)' : ''}
          </p>
          <NextStep board={board} names={names} lastRound={lastRound} onAct={act} onNext={next} />
        </section>

        <section className="sd-console__col sd-console__col--sheet" aria-label="Answer sheet">
          <AnswerSheet
            board={board}
            sheet={sheet}
            onReveal={(slot) => act('reveal', { slot })}
            onQuestion={() => (board.stage === 'intro' ? act('begin') : act('question'))}
            onRevealRest={() => setRevealing(true)}
            revealing={revealing}
            hiddenCount={hidden.length}
          />
        </section>

        <section className="sd-console__col sd-console__col--controls" aria-label="Show controls">
          <ControlPanel board={board} names={names} lastRound={lastRound} onAct={act} onNext={next} undo={sheet?.undo ?? 0} motion={motion.motion} />
          <div className="sd-panel">
            <h3 className="sd-panel__title">Sound cues</h3>
            <div className="sd-cues">
              {SHOWDOWN_CUES.map((c) => (
                <button key={c} type="button" className="sd-cue" onClick={() => cue(c)}>
                  <span aria-hidden>{SHOWDOWN_CUE_INFO[c].icon}</span>
                  {SHOWDOWN_CUE_INFO[c].title}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="sd-console__col sd-console__col--side">
          <AudiencePanel sheet={sheet} />
          <TeamsPanel names={names} />
          <Rundown sheet={sheet} current={board.round} />
          <PresenterTools code={code} pass={pass} />
        </section>
      </div>

      <footer className="sd-console__keys" aria-label="Keyboard shortcuts">
        <span>
          <Kbd>1</Kbd>–<Kbd>0</Kbd> reveal
        </span>
        <span>
          <Kbd>Q</Kbd> question
        </span>
        <span>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> team in control
        </span>
        <span>
          <Kbd>X</Kbd> strike
        </span>
        <span>
          <Kbd>N</Kbd> next
        </span>
        <span>
          <Kbd>U</Kbd> undo
        </span>
      </footer>

      <Modal
        open={confirm === 'finish'}
        onClose={() => setConfirm(null)}
        title="End the show?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep going
            </Button>
            <Button
              variant="danger"
              icon="flag"
              onClick={() => {
                setConfirm(null);
                act('finish');
              }}
            >
              End show
            </Button>
          </>
        }
      >
        <p>The scores stand as they are{decided || board.bank === 0 ? '' : ` — the bank of ${board.bank} isn’t awarded`}. Everyone sees the winner and the final results.</p>
      </Modal>
      <Modal
        open={confirm === 'skip'}
        onClose={() => setConfirm(null)}
        title={lastRound ? 'Finish without awarding the bank?' : 'Skip ahead without awarding the bank?'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Go back
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirm(null);
                act('next');
              }}
            >
              {lastRound ? 'Finish show' : 'Next round'}
            </Button>
          </>
        }
      >
        <p>
          There are <span className="dc-num">{board.bank}</span> points in the bank that nobody has won yet. Award them first from the controls, or move on and they’re lost.
        </p>
      </Modal>
    </div>
  );
}

async function copyLink(text: string, done: string): Promise<void> {
  const ok = await copyText(text);
  sfx('pop');
  useApp.getState().toast(ok ? 'success' : 'info', ok ? done : text);
}

const STAGE_LABEL: Record<string, string> = {
  intro: 'Opening',
  title: 'Round title',
  live: 'Live',
  steal: 'Steal!',
  done: 'Round over',
};

function NextStep({
  board,
  names,
  lastRound,
  onAct,
  onNext,
}: {
  board: ShowdownBoardView;
  names: [string, string];
  lastRound: boolean;
  onAct: <K extends ShowdownActPayload['a']>(a: K, body?: ActBody[K]) => void;
  onNext: () => void;
}) {
  const stealer: TeamIndex = board.control === 1 ? 0 : 1;
  let text: string;
  let actions: ReactNode = null;
  switch (board.stage) {
    case 'intro':
      text = 'Welcome the room, introduce both teams, then start round 1.';
      actions = (
        <Button variant="primary" size="lg" icon="play" onClick={() => onAct('begin')}>
          Start round 1
        </Button>
      );
      break;
    case 'title':
      text = `Round ${board.round + 1} is on the big screen. Bring up the question when the face-off players are ready.`;
      actions = (
        <Button variant="primary" size="lg" icon="eye" onClick={() => onAct('question')}>
          Show the question
        </Button>
      );
      break;
    case 'live':
      if (board.control === -1) {
        text = 'Face-off! Reveal what the two players name, then hand control to the team that won it.';
        actions = (
          <div className="sd-row">
            {([0, 1] as const).map((t) => (
              <Button key={t} variant="secondary" className="sd-teambtn" data-team={SHOWDOWN_TEAMS[t].id} onClick={() => onAct('control', { team: t })}>
                {names[t]} play
              </Button>
            ))}
          </div>
        );
      } else {
        text = `${names[board.control]} is guessing. Reveal every answer they name; press ✕ for a miss (three misses open a steal).`;
      }
      break;
    case 'steal':
      text = `${names[stealer]} gets ONE guess. On the board? Reveal it — they steal the bank. Not there? Press “Steal missed”.`;
      break;
    case 'done':
      text = board.roundWinner === -1 && board.roundHow === '' ? 'The whole board is up. Award the bank to the team that earned it.' : 'Round over. Reveal the rest of the board for fun, then move on.';
      actions = (
        <Button variant="primary" size="lg" icon={lastRound ? 'flag' : 'arrow-right'} onClick={onNext}>
          {lastRound ? 'Finish the show' : 'Next round'}
        </Button>
      );
      break;
  }
  return (
    <div className="sd-nextstep" role="status">
      <span className="sd-nextstep__label">Next step</span>
      <p className="sd-nextstep__text">{text}</p>
      {actions}
    </div>
  );
}

function AnswerSheet({
  board,
  sheet,
  onReveal,
  onQuestion,
  onRevealRest,
  revealing,
  hiddenCount,
}: {
  board: ShowdownBoardView;
  sheet: ShowdownSheet | null;
  onReveal: (slot: number) => void;
  onQuestion: () => void;
  onRevealRest: () => void;
  revealing: boolean;
  hiddenCount: number;
}) {
  if (!sheet || board.stage === 'intro') {
    return (
      <div className="sd-panel sd-sheet sd-sheet--empty">
        <h3 className="sd-panel__title">
          <PixelIcon name="lock" /> Answer sheet
        </h3>
        <p className="sd-muted">The answers appear here — and only here — once round 1 starts.</p>
        {board.stage === 'intro' ? (
          <Button variant="primary" icon="play" onClick={onQuestion}>
            Start round 1
          </Button>
        ) : null}
      </div>
    );
  }
  const titleCard = board.stage === 'title';
  return (
    <div className="sd-panel sd-sheet" data-stage={board.stage}>
      <h3 className="sd-panel__title">
        <PixelIcon name="lock" /> Answer sheet <Badge color="var(--warning)">Only you can see this</Badge>
      </h3>
      <p className="sd-sheet__prompt" data-hidden={titleCard ? 'true' : undefined}>
        <span className="sd-sheet__q">Q{sheet.round + 1}</span> {sheet.prompt}
      </p>
      {titleCard ? (
        <Button variant="primary" block icon="eye" onClick={onQuestion}>
          Show the question <Kbd>Q</Kbd>
        </Button>
      ) : null}
      <ol className="sd-sheet__list">
        {sheet.answers.map((a, i) => {
          const revealed = board.slots[i]?.revealed ?? a.revealed;
          return (
            <li key={i}>
              <button
                type="button"
                className="sd-answer"
                data-revealed={revealed ? 'true' : undefined}
                data-top={i === 0 ? 'true' : undefined}
                disabled={revealed}
                onClick={() => onReveal(i)}
                aria-label={revealed ? `${a.text}, revealed` : `Reveal answer ${i + 1}: ${a.text}, ${a.points} points`}
              >
                <span className="sd-answer__num">{i + 1}</span>
                <span className="sd-answer__body">
                  <span className="sd-answer__text">{a.text}</span>
                  {a.aliases.length ? <span className="sd-answer__aliases">also: {a.aliases.join(', ')}</span> : null}
                </span>
                {a.guessed > 0 ? (
                  <span className="sd-answer__guessed" title={`${a.guessed} in the audience guessed this`}>
                    <PixelIcon name="users" size={12} />
                    {a.guessed}
                  </span>
                ) : null}
                <span className="sd-answer__pts">
                  {a.points}
                  {sheet.multiplier > 1 && !revealed ? <small>×{sheet.multiplier}</small> : null}
                </span>
                <span className="sd-answer__action">{revealed ? <PixelIcon name="check" /> : 'Reveal'}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {board.stage === 'done' && hiddenCount > 0 ? (
        <Button variant="secondary" block icon="sparkle" loading={revealing} onClick={onRevealRest}>
          Reveal the rest ({hiddenCount})
        </Button>
      ) : null}
    </div>
  );
}

function ControlPanel({
  board,
  names,
  lastRound,
  onAct,
  onNext,
  undo,
  motion,
}: {
  board: ShowdownBoardView;
  names: [string, string];
  lastRound: boolean;
  onAct: <K extends ShowdownActPayload['a']>(a: K, body?: ActBody[K]) => void;
  onNext: () => void;
  undo: number;
  motion: boolean;
}) {
  const live = board.stage === 'live';
  const steal = board.stage === 'steal';
  const undecided = board.roundHow === '';
  const canAward = undecided && board.bank > 0 && (live || steal || board.stage === 'done');
  return (
    <div className="sd-panel sd-controls" data-motion={motion ? 'on' : 'off'}>
      <h3 className="sd-panel__title">Who’s playing?</h3>
      <div className="sd-row sd-row--stretch">
        {([0, 1] as const).map((t) => (
          <button
            key={t}
            type="button"
            className="sd-teamctl"
            data-team={SHOWDOWN_TEAMS[t].id}
            style={{ '--team': SHOWDOWN_TEAMS[t].color } as CSSProperties}
            aria-pressed={board.control === t}
            disabled={!live}
            onClick={() => onAct('control', { team: t })}
          >
            <span className="sd-teamctl__name">{names[t]}</span>
            <span className="sd-num sd-teamctl__score">{board.scores[t]}</span>
            <span className="sd-teamctl__state">{live ? (board.control === t ? 'In control' : 'Give control') : steal ? (board.control === t ? 'Defending' : 'Stealing') : ' '}</span>
          </button>
        ))}
      </div>

      <div className="sd-strikebox">
        <StrikeLamps strikes={board.strikes} stealFailed={board.stealFailed} />
        <button
          type="button"
          className="sd-strikebtn"
          disabled={!(steal || (live && board.control !== -1 && board.strikes < SHOWDOWN_LIMITS.strikes))}
          onClick={() => onAct('strike')}
        >
          <span aria-hidden>✕</span> {steal ? 'Steal missed' : 'Strike'} <Kbd>X</Kbd>
        </button>
      </div>

      <div className="sd-bankbox">
        <span className="sd-bankbox__label">Bank</span>
        <span className="sd-num sd-bankbox__value">{board.bank}</span>
        {canAward ? (
          <span className="sd-bankbox__award">
            Award to
            {([0, 1] as const).map((t) => (
              <Button key={t} size="sm" variant="secondary" className="sd-teambtn" data-team={SHOWDOWN_TEAMS[t].id} onClick={() => onAct('award', { team: t })}>
                {names[t]}
              </Button>
            ))}
          </span>
        ) : board.roundWinner !== -1 ? (
          <span className="sd-bankbox__won">
            {names[board.roundWinner]} won {board.results.at(-1)?.points ?? 0}
          </span>
        ) : null}
      </div>

      <div className="sd-row sd-row--stretch">
        <Button variant="primary" icon={board.stage === 'intro' ? 'play' : lastRound ? 'flag' : 'arrow-right'} onClick={onNext}>
          {board.stage === 'intro' ? 'Start round 1' : lastRound ? 'Finish show' : 'Next round'} <Kbd>N</Kbd>
        </Button>
        <Button variant="ghost" icon="refresh" disabled={undo === 0} onClick={() => onAct('undo')} title={`${undo} step${undo === 1 ? '' : 's'} to undo`}>
          Undo <Kbd>U</Kbd>
        </Button>
      </div>

      <details className="sd-adjust">
        <summary>Adjust scores</summary>
        {([0, 1] as const).map((t) => (
          <div key={t} className="sd-adjust__row" data-team={SHOWDOWN_TEAMS[t].id}>
            <span className="sd-adjust__name">{names[t]}</span>
            {[-10, -5, 5, 10].map((d) => (
              <button key={d} type="button" className="sd-adjust__btn" onClick={() => onAct('adjust', { team: t, delta: d })} aria-label={`${d > 0 ? 'Add' : 'Remove'} ${Math.abs(d)} points ${d > 0 ? 'to' : 'from'} ${names[t]}`}>
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
        ))}
      </details>
    </div>
  );
}

function AudiencePanel({ sheet }: { sheet: ShowdownSheet | null }) {
  const guessesIn = useRoomSelector<ShowdownPublicState, number>((s) => s.guessesIn) ?? 0;
  const cloud = sheet?.cloud ?? [];
  return (
    <div className="sd-panel">
      <h3 className="sd-panel__title">
        Audience guesses <Badge>{guessesIn}</Badge>
      </h3>
      {cloud.length === 0 ? (
        <p className="sd-muted">When the question is up, the audience locks in guesses on their phones. The most popular ones show up here.</p>
      ) : (
        <ol className="sd-cloud">
          {cloud.map((c, i) => (
            <li key={i} data-hit={c.slot >= 0 ? 'true' : undefined}>
              <span className="sd-cloud__text">{c.text}</span>
              {c.slot >= 0 ? <span className="sd-cloud__slot">#{c.slot + 1}</span> : <span className="sd-cloud__miss">not on the board</span>}
              <span className="sd-num sd-cloud__count">{c.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TeamsPanel({ names }: { names: [string, string] }) {
  const teams = useRoomSelector<ShowdownPublicState, Record<string, number>>((s) => s.teams);
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players);
  const screens = useRoomSelector<ShowdownPublicState, number>((s) => Object.keys(s.screens ?? {}).length) ?? 0;
  const rosters = useRosters();
  const members = Object.entries(teams ?? {})
    .map(([id, team]) => ({ id, team: team as TeamIndex, name: players?.[id]?.name ?? '?', connected: players?.[id]?.connected ?? false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <details className="sd-panel sd-teams">
      <summary className="sd-panel__title">
        Teams{' '}
        <span className="sd-muted">
          {rosters[0].length} vs {rosters[1].length}
          {screens ? ` · ${screens} big screen${screens === 1 ? '' : 's'}` : ''}
        </span>
      </summary>
      <ul className="sd-teams__list">
        {members.map((m) => (
          <li key={m.id} data-team={SHOWDOWN_TEAMS[m.team].id} data-away={m.connected ? undefined : 'true'}>
            <span className="sd-teams__dot" style={{ '--team': SHOWDOWN_TEAMS[m.team].color } as CSSProperties} aria-hidden />
            <span className="sd-teams__name">{m.name}</span>
            <button type="button" className="sd-teams__move" onClick={() => session.send(SHOWDOWN_MSG.move, { playerId: m.id, team: m.team === 0 ? 1 : 0 })}>
              → {names[m.team === 0 ? 1 : 0]}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Rundown({ sheet, current }: { sheet: ShowdownSheet | null; current: number }) {
  if (!sheet?.rundown.length) return null;
  return (
    <details className="sd-panel sd-rundown">
      <summary className="sd-panel__title">Rundown</summary>
      <ol>
        {sheet.rundown.map((r) => (
          <li key={r.index} data-state={r.index < current ? 'done' : r.index === current ? 'now' : 'next'}>
            <span className="sd-rundown__q">
              R{r.index + 1}
              {r.multiplier > 1 ? ` ×${r.multiplier}` : ''}
            </span>
            <span className="sd-rundown__prompt">{r.prompt}</span>
            <span className="sd-rundown__answers">{r.answers.map((a) => `${a.text} ${a.points}`).join(' · ')}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Stage window, big-screen link, presenter pass and hand-over — shared by the console and the lobby. */
export function PresenterTools({ code, pass }: { code: string; pass: string | null }) {
  const players = useRoomSelector<ShowdownPublicState, ShowdownPublicState['players']>((s) => s.players);
  const me = useRoomSelector<ShowdownPublicState, string>((s) => s.presenterId);
  const [target, setTarget] = useState('');
  const candidates = Object.values(players ?? {}).filter((p) => p.id !== me && p.connected);
  return (
    <details className="sd-panel sd-tools">
      <summary className="sd-panel__title">
        <PixelIcon name="crown" /> Presenter tools
      </summary>
      <p className="sd-muted">Your presenter pass reclaims the controls from any device. Keep it private — whoever has it sees the answers.</p>
      <div className="sd-row sd-row--wrap">
        <Button size="sm" icon="copy" disabled={!pass} onClick={() => pass && void copyLink(presenterLink(code, pass), 'Presenter link copied — open it on your other device')}>
          Copy presenter link
        </Button>
        <Button size="sm" variant="ghost" icon="copy" onClick={() => void copyLink(screenLink(code), 'Big-screen link copied')}>
          Copy big-screen link
        </Button>
      </div>
      {candidates.length ? (
        <div className="sd-row sd-row--wrap sd-handover">
          <Select aria-label="Hand the show to" value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
            <option value="">Hand the show to…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" disabled={!target} onClick={() => target && session.send(SHOWDOWN_MSG.handover, { playerId: target })}>
            Hand over
          </Button>
        </div>
      ) : null}
    </details>
  );
}
