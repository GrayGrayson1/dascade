/**
 * The show stage — what the audience watches on the big screen (stage window, big-screen devices)
 * and what the presenter sees in the console preview. Everything here is public: it renders the
 * synchronized board, the rosters and the shared show feed (events, cues, host lines, reactions).
 *
 * Sizes use container units (the stage is a size container), so the same stage fills a projector,
 * a laptop window or a 16:9 preview card.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  SHOWDOWN_TEAMS,
  showTitle,
  teamName,
  type ShowdownBoardView,
  type ShowdownFinale,
  type ShowdownLook,
  type ShowdownPublicState,
  type ShowdownSettings,
  type TeamIndex,
} from '@dascade/shared/games/showdown';
import { PixelIcon, cx } from '@dascade/ui';
import { useRoomSelector } from '../../net/hooks.ts';
import { Board, Rolling, StrikeLamps } from './Board.tsx';
import { Backdrop, Bulbs, Pumpkin } from './Decor.tsx';
import { HostFigure } from './Host.tsx';
import { LOOK_COPY, idleLine, joinAddress, lineForFinale, type HostLine } from './look.ts';
import { REACTION_LIFE, useShowFeed, type ShowFeed } from './fx.ts';
import { useBoard, useFinale, useHype, useMotion, useRosters, type MotionPrefs } from './state.ts';

export type StageVariant = 'screen' | 'preview';

export interface StageProps {
  look: ShowdownLook;
  settings: ShowdownSettings | null;
  variant: StageVariant;
  /** Extra controls in the corner (fullscreen button on big screens). */
  corner?: ReactNode;
}

/** True for `ms` after `at` (performance.now() time), then false — re-renders itself when it expires. */
export function useRecent(at: number | undefined, ms: number): boolean {
  const [, force] = useState(0);
  const live = at !== undefined && at > 0 && performance.now() - at < ms;
  useEffect(() => {
    if (!live || at === undefined) return;
    const t = setTimeout(() => force((n) => n + 1), Math.max(0, ms - (performance.now() - at)) + 16);
    return () => clearTimeout(t);
  }, [live, at, ms]);
  return live;
}

export function Stage({ look, settings, variant, corner }: StageProps) {
  const board = useBoard();
  const finale = useFinale();
  const phase = useRoomSelector<ShowdownPublicState, string>((s) => s.phase) ?? 'LOBBY';
  const code = useRoomSelector<ShowdownPublicState, string>((s) => s.code) ?? '';
  const feed = useShowFeed();
  const motion = useMotion();
  const names: [string, string] = [teamName(settings, 0), teamName(settings, 1)];
  const copy = LOOK_COPY[look];

  const ev = feed.event;
  const strike = useRecent(ev?.e.type === 'strike' ? ev.at : undefined, 1500);
  const roundSplash = useRecent(ev?.e.type === 'round' ? ev.at : undefined, 2700);
  const award = useRecent(ev?.e.type === 'award' ? ev.at : undefined, 1900);
  const top = useRecent(ev?.e.type === 'reveal' && ev.e.top && !ev.e.late ? ev.at : undefined, 1700);
  const stealSplash = useRecent(ev?.e.type === 'strike' && ev.e.steal ? ev.at : undefined, 2900);
  const cleared = ev?.e.type === 'reveal' && ev.e.cleared;
  const bigAward = ev?.e.type === 'award' && (ev.e.how === 'sweep' || ev.e.how === 'steal');
  const party = useRecent(cleared || bigAward ? ev?.at : feed.cue?.cue === 'applause' ? feed.cue.at : undefined, 3600);
  const cueFx = useRecent(feed.cue && (feed.cue.cue === 'drumroll' || feed.cue.cue === 'suspense') ? feed.cue.at : undefined, feed.cue?.cue === 'drumroll' ? 3200 : 2800);

  const inShow = phase === 'PLAYING' && board !== null;
  const stage = inShow ? board.stage : phase === 'RESULTS' ? 'finale' : 'lobby';
  const shake = strike && motion.motion && variant === 'screen';

  return (
    <div
      className={cx('sd-stage', `sd-stage--${variant}`)}
      data-look={look}
      data-stage={stage}
      data-motion={motion.motion ? 'on' : 'off'}
      data-fx={motion.fx}
      data-cue={cueFx ? feed.cue?.cue : undefined}
      data-shake={shake ? String(ev?.e.rev) : undefined}
    >
      <Backdrop look={look} fx={motion.fx} />
      <Bulbs />
      <div className="sd-stage__inner">
        {inShow ? (
          <>
            <TopRow board={board} settings={settings} code={code} look={look} />
            <Arena board={board} names={names} look={look} motion={motion} copy={copy.bank} hype={copy.hype} topFlash={top} />
            {board.stage === 'intro' ? <IntroCard settings={settings} code={code} look={look} names={names} /> : null}
            {roundSplash && ev?.e.type === 'round' ? <RoundSplash key={ev.e.rev} round={ev.e.round} total={board.totalRounds} multiplier={ev.e.multiplier} answers={board.slots.length} /> : null}
            {board.stage === 'steal' && stealSplash ? <StealBanner board={board} names={names} /> : null}
            {strike && ev?.e.type === 'strike' ? <StrikeX key={ev.e.rev} count={ev.e.stealFailed ? 1 : ev.e.strikes} /> : null}
            {award && ev?.e.type === 'award' && ev.e.team !== -1 && ev.e.points > 0 ? (
              <AwardFlight key={ev.e.rev} team={ev.e.team} points={ev.e.points} name={names[ev.e.team]} />
            ) : null}
          </>
        ) : phase === 'RESULTS' && finale ? (
          <FinaleCard finale={finale} look={look} motion={motion} />
        ) : (
          <IntroCard settings={settings} code={code} look={look} names={names} waiting />
        )}
      </div>
      <HostCorner look={look} feed={feed} board={board} names={names} finale={phase === 'RESULTS' ? finale : null} />
      <Reactions feed={feed} look={look} motion={motion} />
      {party && motion.particles > 0 ? <Confetti key={`${ev?.at ?? 0}-${feed.cue?.id ?? 0}`} count={Math.round(motion.particles * 1.2)} look={look} /> : null}
      {corner ? <div className="sd-stage__corner">{corner}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TopRow({ board, settings, code, look }: { board: ShowdownBoardView; settings: ShowdownSettings | null; code: string; look: ShowdownLook }) {
  const join = joinAddress(code);
  const mult = board.multiplier > 1;
  return (
    <header className="sd-top">
      <div className="sd-top__round">
        {board.round >= 0 ? (
          <>
            <span className="sd-top__label">Round</span>
            <span className="sd-num sd-top__value">
              {board.round + 1}
              <span className="sd-top__of">/{board.totalRounds}</span>
            </span>
            {mult ? <span className="sd-chip sd-chip--mult">×{board.multiplier} points</span> : null}
          </>
        ) : (
          <span className="sd-top__label">{LOOK_COPY[look].tagline}</span>
        )}
      </div>
      <div className="sd-top__logo" aria-hidden>
        <span className="sd-logo-badge">DAS</span>
        <span className="sd-top__title">{settings ? showTitle(settings).replace(/^DAS\s+/i, '') : 'Survey Showdown'}</span>
      </div>
      <div className="sd-top__join">
        <span className="sd-top__label">Play along</span>
        <span className="sd-top__addr">{join.short}</span>
      </div>
    </header>
  );
}

function Arena({
  board,
  names,
  look,
  motion,
  copy,
  hype,
  topFlash,
}: {
  board: ShowdownBoardView;
  names: [string, string];
  look: ShowdownLook;
  motion: MotionPrefs;
  copy: string;
  hype: string;
  topFlash: boolean;
}) {
  const [h0, h1] = useHype();
  const rosters = useRosters();
  const stealer: TeamIndex | null = board.stage === 'steal' && board.control !== -1 ? (board.control === 0 ? 1 : 0) : null;
  const promptShown = board.prompt !== '';
  return (
    <main className="sd-arena">
      {([0, 1] as const).map((team) => (
        <Podium
          key={team}
          team={team}
          name={names[team]}
          score={board.scores[team]}
          members={rosters[team].length}
          hype={team === 0 ? h0 : h1}
          hypeLabel={hype}
          control={board.control === team && (board.stage === 'live' || board.stage === 'steal')}
          stealing={stealer === team}
          winner={board.stage === 'done' && board.roundWinner === team}
          motion={motion}
        />
      ))}
      <section className="sd-center">
        <div className="sd-question" data-shown={promptShown ? 'true' : undefined}>
          <span className="sd-question__text">{promptShown ? board.prompt : board.stage === 'title' ? `Round ${board.round + 1} — get ready!` : LOOK_COPY[look].waiting}</span>
        </div>
        <div className="sd-boardframe" data-top={topFlash ? 'true' : undefined}>
          <Board board={board} highlight={topFlash ? 0 : -1} />
          {topFlash ? <div className="sd-ribbon">Top answer!</div> : null}
        </div>
        <footer className="sd-footer">
          <StrikeLamps strikes={board.strikes} stealFailed={board.stealFailed} />
          <div className="sd-bank" aria-label={`${copy}: ${board.bank} points`}>
            {look === 'halloween' ? <Pumpkin face={0} /> : null}
            <span className="sd-bank__label">{copy}</span>
            <Rolling value={board.bank} motion={motion.motion} className="sd-bank__value" />
            {look === 'halloween' ? <Pumpkin face={1} /> : null}
          </div>
          <div className="sd-footer__status">
            {board.stage === 'done' && board.roundWinner !== -1 ? (
              <span className="sd-chip" data-team={board.roundWinner === 0 ? 'delta' : 'sierra'}>
                {names[board.roundWinner]} +{board.results.at(-1)?.points ?? 0}
              </span>
            ) : board.stage === 'steal' && board.control !== -1 ? (
              <span className="sd-chip sd-chip--steal" data-team={board.control === 0 ? 'sierra' : 'delta'}>
                {names[board.control === 0 ? 1 : 0]} stealing!
              </span>
            ) : board.control !== -1 && board.stage === 'live' ? (
              <span className="sd-chip" data-team={board.control === 0 ? 'delta' : 'sierra'}>
                {names[board.control]} playing
              </span>
            ) : board.stage === 'live' ? (
              <span className="sd-chip">Face-off!</span>
            ) : null}
          </div>
        </footer>
      </section>
    </main>
  );
}

function Podium({
  team,
  name,
  score,
  members,
  hype,
  hypeLabel,
  control,
  stealing,
  winner,
  motion,
}: {
  team: TeamIndex;
  name: string;
  score: number;
  members: number;
  hype: number;
  hypeLabel: string;
  control: boolean;
  stealing: boolean;
  winner: boolean;
  motion: MotionPrefs;
}) {
  const def = SHOWDOWN_TEAMS[team];
  return (
    <aside
      className="sd-podium"
      data-side={team === 0 ? 'left' : 'right'}
      data-team={def.id}
      data-control={control ? 'true' : undefined}
      data-stealing={stealing ? 'true' : undefined}
      data-winner={winner ? 'true' : undefined}
      data-hot={hype >= 75 ? 'true' : undefined}
      style={{ '--team': def.color, '--hype': hype / 100 } as CSSProperties}
      aria-label={`${name}: ${score} points${control ? ', in control' : ''}${stealing ? ', stealing' : ''}`}
    >
      <div className="sd-podium__plate">
        <PixelIcon name={def.icon} />
        <span className="sd-podium__name">{name}</span>
      </div>
      <div className="sd-podium__score">
        <Rolling value={score} motion={motion.motion} />
      </div>
      <div className="sd-podium__lamp">{stealing ? 'Steal!' : control ? 'In control' : ' '}</div>
      <div className="sd-podium__hype" aria-hidden>
        <span className="sd-podium__hype-label">{hypeLabel}</span>
        <span className="sd-podium__meter">
          <i />
        </span>
      </div>
      <div className="sd-podium__members">
        <span className="sd-num">{members}</span> {members === 1 ? 'player' : 'players'}
      </div>
    </aside>
  );
}

function IntroCard({
  settings,
  code,
  look,
  names,
  waiting = false,
}: {
  settings: ShowdownSettings | null;
  code: string;
  look: ShowdownLook;
  names: [string, string];
  waiting?: boolean;
}) {
  const rosters = useRosters();
  const join = joinAddress(code);
  const title = settings ? showTitle(settings) : 'DAS Survey Showdown';
  const words = title.replace(/^DAS\s+/i, '').split(/\s+/).filter(Boolean);
  return (
    <section className="sd-intro" data-waiting={waiting ? 'true' : undefined}>
      <div className="sd-intro__rays" aria-hidden />
      <h1 className="sd-marquee" aria-label={title}>
        <span className="sd-logo-badge sd-logo-badge--big" aria-hidden>
          DAS
        </span>
        {words.map((w, i) => (
          <span key={i} className="sd-marquee__word" style={{ '--w': i } as CSSProperties} aria-hidden>
            {w}
          </span>
        ))}
      </h1>
      <p className="sd-intro__tagline">{LOOK_COPY[look].tagline}</p>
      <div className="sd-versus">
        {([0, 1] as const).map((team) => (
          <div key={team} className="sd-versus__team" data-team={SHOWDOWN_TEAMS[team].id} style={{ '--team': SHOWDOWN_TEAMS[team].color } as CSSProperties}>
            <span className="sd-versus__name">{names[team]}</span>
            <span className="sd-versus__count">
              <span className="sd-num">{rosters[team].length}</span> {rosters[team].length === 1 ? 'player' : 'players'}
            </span>
            <span className="sd-versus__roster">{rosters[team].slice(0, 8).join(' · ')}</span>
          </div>
        ))}
        <span className="sd-versus__vs" aria-hidden>
          VS
        </span>
      </div>
      <div className="sd-joincard">
        <span className="sd-joincard__label">{waiting ? 'The show starts soon — join on your phone' : 'Play along on your phone'}</span>
        <span className="sd-joincard__addr">{join.short}</span>
        <span className="sd-joincard__code" aria-label={`Room code ${code}`}>
          {code.split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </span>
      </div>
    </section>
  );
}

function RoundSplash({ round, total, multiplier, answers }: { round: number; total: number; multiplier: number; answers: number }) {
  return (
    <div className="sd-splash" role="status">
      <span className="sd-splash__kicker">{round + 1 === total && total > 1 ? 'Final round' : `Round ${round + 1} of ${total}`}</span>
      <span className="sd-splash__big">Round {round + 1}</span>
      {multiplier > 1 ? <span className="sd-splash__mult">{multiplier === 2 ? 'Double' : 'Triple'} points!</span> : null}
      <span className="sd-splash__sub">
        <span className="sd-num">{answers}</span> answers on the board
      </span>
    </div>
  );
}

function StealBanner({ board, names }: { board: ShowdownBoardView; names: [string, string] }) {
  const stealer = board.control === 0 ? 1 : 0;
  return (
    <div className="sd-steal" data-team={SHOWDOWN_TEAMS[stealer].id} style={{ '--team': SHOWDOWN_TEAMS[stealer].color } as CSSProperties} role="status">
      <span className="sd-steal__word">Steal!</span>
      <span className="sd-steal__who">{names[stealer]} — one guess to take the bank</span>
    </div>
  );
}

function StrikeX({ count }: { count: number }) {
  return (
    <div className="sd-strike" role="img" aria-label={`Strike ${count}`}>
      {Array.from({ length: Math.max(1, Math.min(3, count)) }, (_, i) => (
        <svg key={i} className="sd-strike__x" viewBox="0 0 100 100" style={{ '--i': i } as CSSProperties} aria-hidden focusable="false">
          <path d="M18 18 L82 82 M82 18 L18 82" />
        </svg>
      ))}
    </div>
  );
}

function AwardFlight({ team, points, name }: { team: TeamIndex; points: number; name: string }) {
  return (
    <div className="sd-flight" data-side={team === 0 ? 'left' : 'right'} style={{ '--team': SHOWDOWN_TEAMS[team].color } as CSSProperties} aria-hidden>
      <span className="sd-flight__chip">
        +<span className="sd-num">{points}</span>
      </span>
      <span className="sd-flight__name">{name}</span>
    </div>
  );
}

function FinaleCard({ finale, look, motion }: { finale: ShowdownFinale; look: ShowdownLook; motion: MotionPrefs }) {
  const winner = finale.winner;
  return (
    <section className="sd-finale" data-winner={winner === -1 ? 'tie' : SHOWDOWN_TEAMS[winner].id}>
      <div className="sd-intro__rays" aria-hidden />
      <p className="sd-finale__kicker">{LOOK_COPY[look].winner}</p>
      <h1
        className="sd-finale__winner"
        style={winner === -1 ? undefined : ({ '--team': SHOWDOWN_TEAMS[winner].color } as CSSProperties)}
        data-motion={motion.motion ? 'on' : 'off'}
      >
        {winner === -1 ? 'It’s a tie!' : finale.names[winner]}
      </h1>
      <div className="sd-finale__scores">
        {([0, 1] as const).map((team) => (
          <div key={team} className="sd-finale__team" data-team={SHOWDOWN_TEAMS[team].id} data-won={winner === team ? 'true' : undefined} style={{ '--team': SHOWDOWN_TEAMS[team].color } as CSSProperties}>
            <span className="sd-finale__name">{finale.names[team]}</span>
            <span className="sd-num sd-finale__score">{finale.scores[team]}</span>
            <span className="sd-finale__members">{finale.members[team].slice(0, 10).join(' · ')}</span>
          </div>
        ))}
      </div>
      {finale.results.length ? (
        <ol className="sd-finale__rounds" aria-label="Rounds">
          {finale.results.map((r) => (
            <li key={r.index} data-team={r.winner === 0 ? 'delta' : r.winner === 1 ? 'sierra' : 'none'}>
              <span>R{r.index + 1}</span>
              <span>{r.winner === -1 ? '—' : finale.names[r.winner]}</span>
              <span className="sd-num">{r.points}</span>
              <span className="sd-finale__how">{HOW_TEXT[r.how]}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {finale.callers.length ? (
        <div className="sd-finale__callers">
          <span className="sd-finale__callers-title">Top Survey Sayers</span>
          <ol>
            {finale.callers.map((c) => (
              <li key={c.playerId} data-team={c.team === 0 ? 'delta' : c.team === 1 ? 'sierra' : 'none'}>
                <span>{c.name}</span>
                <span className="sd-num">{c.points}</span>
                <span className="sd-finale__how">
                  {c.calls} {c.calls === 1 ? 'call' : 'calls'}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

const HOW_TEXT: Record<string, string> = { sweep: 'Clean sweep', steal: 'Stolen', defend: 'Held on', manual: 'Awarded', none: 'No points' };

function HostCorner({
  look,
  feed,
  board,
  names,
  finale,
}: {
  look: ShowdownLook;
  feed: ShowFeed;
  board: ShowdownBoardView | null;
  names: [string, string];
  finale: ShowdownFinale | null;
}) {
  const fresh = useRecent(feed.line ? feed.lineAt : undefined, 5600);
  let line: HostLine | null = fresh ? feed.line : null;
  if (finale) line = lineForFinale(look, finale.winner, finale.names);
  else if (!feed.line) line = idleLine(look, board, names);
  const copy = LOOK_COPY[look];
  return (
    <div className="sd-hostcorner" aria-live="polite">
      <div className="sd-host" data-mood={line?.mood ?? 'idle'}>
        <HostFigure look={look} mood={line?.mood ?? 'idle'} talking={Boolean(line && fresh)} />
        <span className="sd-host__plate">
          {copy.hostTitle}: <b>{copy.hostName}</b>
        </span>
      </div>
      {line ? (
        <p key={line.key} className="sd-bubble">
          {line.text}
        </p>
      ) : null}
    </div>
  );
}

function Reactions({ feed, look, motion }: { feed: ShowFeed; look: ShowdownLook; motion: MotionPrefs }) {
  const [, force] = useState(0);
  const now = performance.now();
  const alive = motion.motion ? feed.reactions.filter((r) => now - r.at < REACTION_LIFE) : [];
  // Expire floating emoji even when nothing new arrives.
  const next = alive.length ? Math.min(...alive.map((r) => r.at + REACTION_LIFE - now)) : 0;
  useEffect(() => {
    if (next <= 0) return;
    const t = setTimeout(() => force((n) => n + 1), next + 20);
    return () => clearTimeout(t);
  }, [next, feed.reactions]);
  if (!alive.length) return null;
  const emoji = LOOK_COPY[look].reactions;
  return (
    <div className="sd-reactions" aria-hidden>
      {alive.map((r) => (
        <span
          key={r.id}
          className="sd-float"
          data-side={r.side === 0 ? 'left' : r.side === 1 ? 'right' : 'mid'}
          style={{ '--x': r.x, '--delay': `${Math.max(0, r.at - now)}ms` } as CSSProperties}
        >
          {emoji[r.kind] ?? '👏'}
        </span>
      ))}
    </div>
  );
}

export function Confetti({ count, look }: { count: number; look: ShowdownLook }) {
  const colors = look === 'halloween' ? ['#ff8a1f', '#b26bff', '#a8ff3c', '#fff1d6', '#ffd36b'] : ['#ffd36b', '#ff4fd8', '#22d3ee', '#2de38f', '#ffffff'];
  return (
    <div className="sd-confetti" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          data-shape={i % 3}
          style={
            {
              '--x': `${(i * 37 + 11) % 100}%`,
              '--dur': `${2.6 + ((i * 7) % 10) * 0.18}s`,
              '--delay': `${((i * 3) % 14) * 0.08}s`,
              '--drift': `${((i * 13) % 9) - 4}cqw`,
              '--spin': `${((i * 29) % 7) - 3}`,
              '--c': colors[i % colors.length],
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
