/**
 * The audience view (phones first): your team, the live board, your private "survey says" guesses,
 * and the cheer pad that fills your team's hype meter on the big screen. Wide screens get the full
 * stage next to the controls.
 *
 * Presenter Showcase has no teams: a mini board with the round, the question and the clock, how many
 * answers the crowd has found, the cheer pad (reactions float up on the stage), and — only when the
 * presenter allows it — private guesses that say "you called it" when they flip. It is also the phone
 * companion of the picker (DSP-03 B): the pool card with Skip me, "<name> is answering", and the
 * full-screen "You're up!" on the phone that was picked.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import {
  SHOWDOWN_CARD_INFO,
  SHOWDOWN_LIMITS,
  SHOWDOWN_MSG,
  SHOWDOWN_TEAMS,
  showTitle,
  teamName,
  type ShowdownBoardView,
  type ShowdownLook,
  type ShowdownSettings,
  type TeamIndex,
} from '@dascade/shared/games/showdown';
import { SYS, type ActionErrorPayload } from '@dascade/shared';
import { Button, PixelIcon, TextInput, Toggle, cx } from '@dascade/ui';
import { session, useRoomMessage } from '../../net/hooks.ts';
import { Board, Rolling, StrikeLamps } from './Board.tsx';
import { Stage, useRecent } from './Stage.tsx';
import { LOOK_COPY } from './look.ts';
import { showFeed, useShowFeed } from './fx.ts';
import { setScreenMode } from './access.ts';
import { playShowSound } from './sounds.ts';
import { PoolCard } from './PoolCard.tsx';
import { PickMoment } from './YoureUp.tsx';
import { formatClock, useBoard, useCard, useClock, useHype, useMe, useMotion, useShowSounds, useSweep, type RoleInfo } from './state.ts';
import './chrome-showcase.css';

export function AudienceView({
  look,
  settings,
  code,
  role,
}: {
  look: ShowdownLook;
  settings: ShowdownSettings | null;
  code: string;
  role: RoleInfo;
}) {
  const board = useBoard();
  const wide = useMedia('(min-width: 960px) and (min-height: 560px)');
  const names: [string, string] = [teamName(settings, 0), teamName(settings, 1)];
  if (!board) return null;
  if (board.mode === 'showcase')
    return <ShowcaseAudience board={board} look={look} settings={settings} code={code} role={role} wide={wide} />;
  const canPickTeam = board.stage === 'intro' || role.team === null;
  return (
    <div className="sd-aud" data-look={look} data-wide={wide ? 'true' : undefined}>
      <div className="sd-aud__main">
        {wide ? (
          <div className="sd-aud__stagebox">
            <Stage look={look} settings={settings} variant="preview" />
          </div>
        ) : (
          <MiniBoard board={board} names={names} look={look} />
        )}
      </div>
      <aside className="sd-aud__side">
        <TeamCard team={role.team} names={names} canPick={canPickTeam && role.role === 'audience'} spectator={role.role === 'spectator'} />
        {settings?.audience !== false && role.role === 'audience' ? <GuessBox board={board} look={look} /> : null}
        <CheerPad look={look} team={role.team} names={names} />
        <DeviceOptions code={code} role={role} />
      </aside>
    </div>
  );
}

/** matchMedia as a hook (false on the server / in tests). */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (fn: () => void) => {
      if (typeof matchMedia === 'undefined') return () => undefined;
      const mq = matchMedia(query);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof matchMedia === 'undefined' ? false : matchMedia(query).matches),
    () => false,
  );
}

function MiniBoard({ board, names, look }: { board: ShowdownBoardView; names: [string, string]; look: ShowdownLook }) {
  const motion = useMotion();
  const [h0, h1] = useHype();
  const feed = useShowFeed();
  const ev = feed.event;
  const strike = useRecent(ev?.e.type === 'strike' ? ev.at : undefined, 1300);
  const copy = LOOK_COPY[look];
  const stealer = board.stage === 'steal' && board.control !== -1 ? (board.control === 0 ? 1 : 0) : -1;
  return (
    <section className="sd-mini" data-look={look} data-stage={board.stage} aria-label="Live board">
      <div className="sd-mini__scores">
        {([0, 1] as const).map((t) => (
          <div
            key={t}
            className="sd-mini__team"
            data-team={SHOWDOWN_TEAMS[t].id}
            data-control={board.control === t && board.stage === 'live' ? 'true' : undefined}
            data-stealing={stealer === t ? 'true' : undefined}
            style={{ '--team': SHOWDOWN_TEAMS[t].color, '--hype': (t === 0 ? h0 : h1) / 100 } as CSSProperties}
          >
            <span className="sd-mini__name">{names[t]}</span>
            <Rolling value={board.scores[t]} motion={motion.motion} className="sd-mini__score" />
            <span className="sd-mini__hype" aria-hidden>
              <i />
            </span>
          </div>
        ))}
      </div>
      <div className="sd-mini__meta">
        <span>
          {board.round < 0
            ? copy.tagline
            : `Round ${board.round + 1}/${board.totalRounds}${board.multiplier > 1 ? ` · ×${board.multiplier}` : ''}`}
        </span>
        <StrikeLamps strikes={board.strikes} stealFailed={board.stealFailed} />
        <span className="sd-mini__bank">
          {copy.bank} <Rolling value={board.bank} motion={motion.motion} />
        </span>
      </div>
      <p className="sd-mini__prompt">
        {board.prompt ||
          (board.stage === 'intro'
            ? 'The show is about to begin…'
            : board.stage === 'title'
              ? `Round ${board.round + 1} — get ready!`
              : copy.waiting)}
      </p>
      {stealer !== -1 ? <p className="sd-mini__steal">Steal! {names[stealer]} get one guess.</p> : null}
      {board.slots.length ? <Board board={board} compact /> : null}
      {/* Phones have no stage (and so no host): screen readers hear the host's line for each event. */}
      <p className="visually-hidden" aria-live="polite">
        {feed.line?.text ?? ''}
      </p>
      {strike && ev?.e.type === 'strike' ? (
        <div key={ev.e.rev} className="sd-mini__x" aria-hidden>
          {'✕'.repeat(ev.e.stealFailed ? 1 : Math.max(1, ev.e.strikes))}
        </div>
      ) : null}
    </section>
  );
}

function TeamCard({
  team,
  names,
  canPick,
  spectator,
}: {
  team: TeamIndex | null;
  names: [string, string];
  canPick: boolean;
  spectator: boolean;
}) {
  if (spectator) {
    return (
      <div className="sd-panel sd-teamcard">
        <PixelIcon name="eye" /> You’re watching as a spectator.
      </div>
    );
  }
  return (
    <div
      className="sd-panel sd-teamcard"
      data-team={team === null ? 'none' : SHOWDOWN_TEAMS[team].id}
      style={team === null ? undefined : ({ '--team': SHOWDOWN_TEAMS[team].color } as CSSProperties)}
    >
      {team === null ? (
        <span className="sd-teamcard__label">Pick a team to cheer for</span>
      ) : (
        <span className="sd-teamcard__label">You’re on</span>
      )}
      {team !== null ? <span className="sd-teamcard__name">{names[team]}</span> : null}
      {canPick ? (
        <div className="sd-row sd-row--stretch">
          {([0, 1] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={team === t ? 'primary' : 'secondary'}
              className="sd-teambtn"
              data-team={SHOWDOWN_TEAMS[t].id}
              aria-pressed={team === t}
              onClick={() => session.send(SHOWDOWN_MSG.team, { team: t })}
            >
              {names[t]}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GuessBox({ board, look }: { board: ShowdownBoardView; look: ShowdownLook }) {
  const me = useMe();
  const feed = useShowFeed();
  const [text, setText] = useState('');
  const open = board.stage === 'live' || board.stage === 'steal';
  const mine = me && me.round === board.round ? me.guesses : [];
  const left = SHOWDOWN_LIMITS.guessesPerRound - mine.length;
  const flash = useRecent(feed.calledAt || undefined, 2600);
  /** The guess on its way to the server: a refused one (rate limit, the round just moved on) comes back to the box. */
  const sent = useRef<string | null>(null);
  useEffect(() => {
    sent.current = null;
  }, [mine.length]);
  useRoomMessage<ActionErrorPayload>(SYS.error, (p) => {
    if (p.type !== SHOWDOWN_MSG.guess || sent.current === null) return;
    const back = sent.current;
    sent.current = null;
    setText((t) => t || back);
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || !open || left <= 0) return;
    session.send(SHOWDOWN_MSG.guess, { round: board.round, text: clean });
    sent.current = clean;
    playShowSound('tap', look);
    setText('');
  };
  return (
    <div className="sd-panel sd-guess" data-open={open ? 'true' : undefined}>
      <h3 className="sd-panel__title">
        Survey says…?
        <span className="sd-guess__score" aria-label={`${me?.points ?? 0} Survey Sayer points`}>
          <PixelIcon name="star" size={14} /> <span className="sd-num">{me?.points ?? 0}</span>
        </span>
      </h3>
      {flash ? (
        <p className="sd-guess__flash" role="status">
          You called it! +<span className="sd-num">{feed.calledPoints}</span>
        </p>
      ) : null}
      <p className="sd-muted">
        {open
          ? left > 0
            ? `Lock in up to ${SHOWDOWN_LIMITS.guessesPerRound} secret guesses. Called answers score their survey points when they flip.`
            : 'All guesses locked in — watch the board!'
          : 'Guesses open when the question is on the board.'}
      </p>
      <form className="sd-guess__form" onSubmit={submit}>
        <TextInput
          value={text}
          maxLength={SHOWDOWN_LIMITS.guessText}
          placeholder={open ? 'Your guess…' : 'Waiting for the question…'}
          aria-label="Your guess"
          disabled={!open || left <= 0}
          onChange={(e) => setText(e.currentTarget.value)}
          enterKeyHint="send"
          autoComplete="off"
        />
        <Button type="submit" variant="primary" disabled={!open || left <= 0 || !text.trim()}>
          Lock in
        </Button>
      </form>
      {mine.length ? (
        <ul className="sd-guess__list">
          {mine.map((g, i) => (
            <li key={i} data-called={g.slot >= 0 ? 'true' : undefined}>
              <span className="sd-guess__text">{g.text}</span>
              {g.slot >= 0 ? (
                <span className="sd-guess__hit">
                  #{g.slot + 1} · +<span className="sd-num">{g.points}</span>
                </span>
              ) : (
                <span className="sd-guess__lock">
                  <PixelIcon name="lock" size={12} /> locked
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sd-guess__left" aria-live="polite">
        {open ? `${Math.max(0, left)} of ${SHOWDOWN_LIMITS.guessesPerRound} guesses left` : ' '}
      </p>
    </div>
  );
}

function CheerPad({ look, team, names }: { look: ShowdownLook; team: TeamIndex | null; names: [string, string] }) {
  const copy = LOOK_COPY[look];
  const [burst, setBurst] = useState<{ id: number; kind: number } | null>(null);
  const seq = useRef(0);
  const react = (r: number) => {
    session.send(SHOWDOWN_MSG.react, { r });
    playShowSound('tap', look);
    seq.current++;
    setBurst({ id: seq.current, kind: r });
  };
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(null), 900);
    return () => clearTimeout(t);
  }, [burst]);
  return (
    <div className="sd-panel sd-cheer">
      <h3 className="sd-panel__title">Cheer!</h3>
      <div className="sd-cheer__pad">
        {copy.reactions.map((emoji, i) => (
          <button key={i} type="button" className="sd-cheer__btn" onClick={() => react(i)} aria-label={copy.reactionNames[i]}>
            <span aria-hidden>{emoji}</span>
            {burst?.kind === i ? (
              <span key={burst.id} className="sd-cheer__pop" aria-hidden>
                {emoji}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {team !== null ? (
        <button
          type="button"
          className="sd-hypebtn"
          data-team={SHOWDOWN_TEAMS[team].id}
          style={{ '--team': SHOWDOWN_TEAMS[team].color } as CSSProperties}
          onClick={() => react(1)}
        >
          {copy.hype} for {names[team]}!
        </button>
      ) : null}
    </div>
  );
}

function DeviceOptions({ code, role }: { code: string; role: RoleInfo }) {
  const [sounds, setSounds] = useShowSounds(role.role);
  return (
    <div className={cx('sd-panel', 'sd-device')}>
      <Toggle label="Show sounds on this device" checked={sounds} onChange={setSounds} />
      <Button size="sm" variant="ghost" icon="maximize" onClick={() => switchToScreen(code, true)}>
        Use this device as a big screen
      </Button>
    </div>
  );
}

export function switchToScreen(code: string, on: boolean): void {
  setScreenMode(code, on);
  session.send(SHOWDOWN_MSG.screen, { on });
  if (!on) showFeed.say(null);
}

// ---------------------------------------------------------------------------
// Presenter Showcase: the crowd (no teams, no scores)
// ---------------------------------------------------------------------------

function ShowcaseAudience({
  board,
  look,
  settings,
  code,
  role,
  wide,
}: {
  board: ShowdownBoardView;
  look: ShowdownLook;
  settings: ShowdownSettings | null;
  code: string;
  role: RoleInfo;
  wide: boolean;
}) {
  // The picker on this phone: who's answering, and (participants only) the pool card with Skip me.
  const picker = (
    <div className="sdg-bar">
      <PickMoment look={look} />
      <PoolCard />
    </div>
  );
  return (
    <div className="sd-aud sdc-aud" data-look={look} data-wide={wide ? 'true' : undefined} data-mode="showcase">
      <div className="sd-aud__main">
        {wide ? (
          <div className="sd-aud__stagebox">
            <Stage look={look} settings={settings} variant="preview" />
          </div>
        ) : (
          <>
            {picker}
            <ShowcaseMini board={board} look={look} show={settings ? showTitle(settings) : ''} />
          </>
        )}
      </div>
      <aside className="sd-aud__side">
        {wide ? picker : null}
        <div className="sd-panel sdc-crowdcard">
          <span className="sdc-crowdcard__icon" aria-hidden>
            {look === 'halloween' ? '🎃' : '🎉'}
          </span>
          <span>
            {role.role === 'spectator' ? (
              <>You’re watching as a spectator — cheer along!</>
            ) : (
              <>
                <b>You’re in the audience.</b> Guess out loud or in the chat — the host flips what you name.
                {look === 'halloween' ? ' Tap 👻 Boo! to make the host jump.' : ''}
              </>
            )}
          </span>
        </div>
        {settings?.audience && role.role === 'audience' ? <ShowcaseGuessBox board={board} look={look} /> : null}
        {wide ? <ShowcaseCheerPad look={look} /> : null}
        <DeviceOptions code={code} role={role} />
      </aside>
      {/* Phones: the cheer pad is the last child of the page grid, so it can stay at the bottom of the screen. */}
      {wide ? null : <ShowcaseCheerPad look={look} />}
    </div>
  );
}

function ShowcaseMini({ board, look, show }: { board: ShowdownBoardView; look: ShowdownLook; show: string }) {
  const clock = useClock();
  const feed = useShowFeed();
  const card = useCard();
  const sweeping = useSweep();
  const copy = LOOK_COPY[look];
  const miss = feed.last.miss;
  const missFlash = useRecent(miss && miss.e.round === board.round ? miss.at : undefined, 1300);
  const party = useRecent(feed.celebrate?.at, 3200);
  const found = board.slots.filter((s) => s.revealed && !s.late).length;
  const total = board.slots.length;
  const stage = board.stage;
  const mark = look === 'halloween' ? '🎃' : '⭐';
  const showClock = clock.on && clock.stage && stage === 'live' && !sweeping;
  const waiting = stage === 'intro' ? 'The show is about to begin…' : stage === 'title' ? 'Get ready — here comes the question!' : '';
  return (
    <section className="sd-mini sdc-mini" data-look={look} data-stage={stage} aria-label="Live board">
      <header className="sdc-mini__head">
        <span className="sdc-mini__round">
          {board.round < 0 ? copy.showcase.tagline : `Round ${board.round + 1} of ${board.totalRounds}`}
        </span>
        {showClock ? (
          <span className="sdc-mini__clock" role="timer" data-over={clock.left <= 0 ? 'true' : undefined}>
            <PixelIcon name="clock" size={14} />{' '}
            {clock.left <= 0 ? copy.showcase.finalGuesses : <span className="sd-num">{formatClock(clock.left)}</span>}
          </span>
        ) : null}
      </header>
      {board.round < 0 && show ? <p className="sdc-mini__title">{show}</p> : null}
      {board.title && board.round >= 0 ? <p className="sdc-mini__title">{board.title}</p> : null}
      {board.prompt || waiting ? <p className="sd-mini__prompt">{board.prompt || waiting}</p> : null}
      {board.source && board.prompt ? (
        <p className="sdc-mini__source">
          {copy.showcase.according} {board.source}
        </p>
      ) : null}
      {card ? (
        <p className="sdc-mini__card" role="status">
          <span aria-hidden>{SHOWDOWN_CARD_INFO[card].icon}</span> On the stage: {SHOWDOWN_CARD_INFO[card].title}
        </p>
      ) : null}
      {board.round >= 0 && total ? (
        <div className="sdc-mini__status">
          <span className="sdc-mini__found">
            <span className="sd-num">{found}</span> of <span className="sd-num">{total}</span> found
          </span>
          {sweeping ? <span className="sdc-mini__sweep">{copy.showcase.sweeping}</span> : null}
          {board.special >= 0 && !sweeping ? (
            <span className="sdc-mini__special">
              <span aria-hidden>{mark}</span> #{board.special + 1} is the special one
            </span>
          ) : null}
        </div>
      ) : null}
      {total && board.round >= 0 ? <Board board={board} compact specialLabel={copy.showcase.special} /> : null}
      {/* Phones have no stage (and so no host): screen readers hear the host's line for each event. */}
      <p className="visually-hidden" aria-live="polite">
        {feed.line?.text ?? ''}
      </p>
      {missFlash && miss ? (
        <div key={miss.at} className="sd-mini__x sdc-mini__x" aria-hidden>
          ✕
        </div>
      ) : null}
      {party && feed.celebrate ? (
        <div key={feed.celebrate.key} className="sdc-mini__party" aria-hidden>
          <span>{mark}</span> {feed.celebrate.slot >= 0 ? copy.showcase.specialBanner : copy.showcase.cueBanner}
        </div>
      ) : null}
    </section>
  );
}

/** Private guesses in a showcase: no points — "you called it" when one of yours flips. */
function ShowcaseGuessBox({ board, look }: { board: ShowdownBoardView; look: ShowdownLook }) {
  const me = useMe();
  const [text, setText] = useState('');
  const open = board.stage === 'live';
  const mine = me && me.round === board.round ? me.guesses : [];
  const left = SHOWDOWN_LIMITS.guessesPerRound - mine.length;
  // Ranked boards have no points, so "called it" follows the calls count (not the points).
  const [calledAt, setCalledAt] = useState(0);
  const prevCalls = useRef<number | null>(null);
  useEffect(() => {
    if (!me) return;
    const prev = prevCalls.current;
    prevCalls.current = me.calls;
    if (prev !== null && me.calls > prev) setCalledAt(performance.now());
  }, [me]);
  const flash = useRecent(calledAt || undefined, 2600);
  const sent = useRef<string | null>(null);
  useEffect(() => {
    sent.current = null;
  }, [mine.length]);
  useRoomMessage<ActionErrorPayload>(SYS.error, (p) => {
    if (p.type !== SHOWDOWN_MSG.guess || sent.current === null) return;
    const back = sent.current;
    sent.current = null;
    setText((t) => t || back);
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || !open || left <= 0) return;
    session.send(SHOWDOWN_MSG.guess, { round: board.round, text: clean });
    sent.current = clean;
    playShowSound('tap', look);
    setText('');
  };
  return (
    <div className="sd-panel sd-guess" data-open={open ? 'true' : undefined}>
      <h3 className="sd-panel__title">
        Your secret guesses
        {me && me.calls > 0 ? (
          <span className="sd-guess__score" aria-label={`You called ${me.calls} so far`}>
            <PixelIcon name="star" size={14} /> <span className="sd-num">{me.calls}</span>
          </span>
        ) : null}
      </h3>
      {flash ? (
        <p className="sd-guess__flash" role="status">
          You called it!
        </p>
      ) : null}
      <p className="sd-muted">
        {open
          ? left > 0
            ? `Lock in up to ${SHOWDOWN_LIMITS.guessesPerRound} guesses. Nobody sees them — you find out when your answer flips.`
            : 'All guesses locked in — watch the board!'
          : 'Guesses open when the question is on the board.'}
      </p>
      <form className="sd-guess__form" onSubmit={submit}>
        <TextInput
          value={text}
          maxLength={SHOWDOWN_LIMITS.guessText}
          placeholder={open ? 'Your guess…' : 'Waiting for the question…'}
          aria-label="Your guess"
          disabled={!open || left <= 0}
          onChange={(e) => setText(e.currentTarget.value)}
          enterKeyHint="send"
          autoComplete="off"
        />
        <Button type="submit" variant="primary" disabled={!open || left <= 0 || !text.trim()}>
          Lock in
        </Button>
      </form>
      {mine.length ? (
        <ul className="sd-guess__list">
          {mine.map((g, i) => (
            <li key={i} data-called={g.slot >= 0 ? 'true' : undefined}>
              <span className="sd-guess__text">{g.text}</span>
              {g.slot >= 0 ? (
                <span className="sd-guess__hit">Called it · #{g.slot + 1}</span>
              ) : (
                <span className="sd-guess__lock">
                  <PixelIcon name="lock" size={12} /> locked
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sd-guess__left" aria-live="polite">
        {open ? `${Math.max(0, left)} of ${SHOWDOWN_LIMITS.guessesPerRound} guesses left` : ' '}
      </p>
    </div>
  );
}

/** The cheer pad (reactions float up on every stage). The ghost makes the host jump. */
function ShowcaseCheerPad({ look }: { look: ShowdownLook }) {
  const copy = LOOK_COPY[look];
  const [burst, setBurst] = useState<{ id: number; kind: number } | null>(null);
  const seq = useRef(0);
  const react = (r: number) => {
    session.send(SHOWDOWN_MSG.react, { r });
    playShowSound('tap', look);
    seq.current++;
    setBurst({ id: seq.current, kind: r });
  };
  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setBurst(null), 900);
    return () => clearTimeout(t);
  }, [burst]);
  const boo = look === 'halloween' ? copy.reactions.indexOf('👻') : -1;
  return (
    <div className="sd-panel sd-cheer sdc-cheer" role="group" aria-label="Cheer on the show">
      <h3 className="sd-panel__title">Cheer on the show</h3>
      <div className="sdc-cheer__pad">
        {copy.reactions.map((emoji, i) => (
          <button
            key={i}
            type="button"
            className="sd-cheer__btn sdc-cheer__btn"
            data-boo={i === boo ? 'true' : undefined}
            onClick={() => react(i)}
            aria-label={i === boo ? `${copy.reactionNames[i]} — make the host jump` : copy.reactionNames[i]}
          >
            <span aria-hidden className="sdc-cheer__emoji">
              {emoji}
            </span>
            <span className="sdc-cheer__name" aria-hidden>
              {copy.reactionNames[i]}
            </span>
            {burst?.kind === i ? (
              <span key={burst.id} className="sd-cheer__pop" aria-hidden>
                {emoji}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <p className="sd-muted sdc-cheer__hint">
        Your taps float up on the big screen{boo >= 0 ? ' — and a 👻 Boo! makes the host jump.' : '.'}
      </p>
    </div>
  );
}
