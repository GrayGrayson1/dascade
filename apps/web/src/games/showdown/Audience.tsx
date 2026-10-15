/**
 * The audience view (phones first): your team, the live board, your private "survey says" guesses,
 * and the cheer pad that fills your team's hype meter on the big screen. Wide screens get the full
 * stage next to the controls.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import {
  SHOWDOWN_LIMITS,
  SHOWDOWN_MSG,
  SHOWDOWN_TEAMS,
  teamName,
  type ShowdownBoardView,
  type ShowdownLook,
  type ShowdownSettings,
  type TeamIndex,
} from '@dascade/shared/games/showdown';
import { Button, PixelIcon, TextInput, Toggle, cx } from '@dascade/ui';
import { session } from '../../net/hooks.ts';
import { Board, Rolling, StrikeLamps } from './Board.tsx';
import { Stage, useRecent } from './Stage.tsx';
import { LOOK_COPY } from './look.ts';
import { showFeed, useShowFeed } from './fx.ts';
import { setScreenMode } from './access.ts';
import { playShowSound } from './sounds.ts';
import { useBoard, useHype, useMe, useMotion, useShowSounds, type RoleInfo } from './state.ts';

export function AudienceView({ look, settings, code, role }: { look: ShowdownLook; settings: ShowdownSettings | null; code: string; role: RoleInfo }) {
  const board = useBoard();
  const wide = useMedia('(min-width: 960px) and (min-height: 560px)');
  const names: [string, string] = [teamName(settings, 0), teamName(settings, 1)];
  if (!board) return null;
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
  return useSyncExternalStore(
    (fn) => {
      if (typeof matchMedia === 'undefined') return () => undefined;
      const mq = matchMedia(query);
      mq.addEventListener('change', fn);
      return () => mq.removeEventListener('change', fn);
    },
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
        <span>{board.round < 0 ? copy.tagline : `Round ${board.round + 1}/${board.totalRounds}${board.multiplier > 1 ? ` · ×${board.multiplier}` : ''}`}</span>
        <StrikeLamps strikes={board.strikes} stealFailed={board.stealFailed} />
        <span className="sd-mini__bank">
          {copy.bank} <Rolling value={board.bank} motion={motion.motion} />
        </span>
      </div>
      <p className="sd-mini__prompt">{board.prompt || (board.stage === 'intro' ? 'The show is about to begin…' : board.stage === 'title' ? `Round ${board.round + 1} — get ready!` : copy.waiting)}</p>
      {stealer !== -1 ? <p className="sd-mini__steal">Steal! {names[stealer]} get one guess.</p> : null}
      {board.slots.length ? <Board board={board} compact /> : null}
      {strike && ev?.e.type === 'strike' ? (
        <div key={ev.e.rev} className="sd-mini__x" aria-hidden>
          {'✕'.repeat(ev.e.stealFailed ? 1 : Math.max(1, ev.e.strikes))}
        </div>
      ) : null}
    </section>
  );
}

function TeamCard({ team, names, canPick, spectator }: { team: TeamIndex | null; names: [string, string]; canPick: boolean; spectator: boolean }) {
  if (spectator) {
    return (
      <div className="sd-panel sd-teamcard">
        <PixelIcon name="eye" /> You’re watching as a spectator.
      </div>
    );
  }
  return (
    <div className="sd-panel sd-teamcard" data-team={team === null ? 'none' : SHOWDOWN_TEAMS[team].id} style={team === null ? undefined : ({ '--team': SHOWDOWN_TEAMS[team].color } as CSSProperties)}>
      {team === null ? <span className="sd-teamcard__label">Pick a team to cheer for</span> : <span className="sd-teamcard__label">You’re on</span>}
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || !open || left <= 0) return;
    session.send(SHOWDOWN_MSG.guess, { round: board.round, text: clean });
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
        <button type="button" className="sd-hypebtn" data-team={SHOWDOWN_TEAMS[team].id} style={{ '--team': SHOWDOWN_TEAMS[team].color } as CSSProperties} onClick={() => react(1)}>
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
