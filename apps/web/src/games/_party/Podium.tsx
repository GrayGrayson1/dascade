/**
 * Party kit — results: podium (players or teams), full standings, confetti and the shared
 * results actions (host "Play again", everyone "Leave").
 */
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { ordinal, type GameId } from '@dascade/shared';
import type { PartyPodium, PartyPodiumEntry } from '@dascade/shared/party';
import { Avatar, PixelIcon, cx } from '@dascade/ui';
import { GameStage, ResultsActions } from '../../shell/common.tsx';
import { sfx } from '../../audio/audio.ts';
import { usePartyFx } from './hooks.ts';
import { TeamBadge } from './Scores.tsx';
import { ArtIcon } from './Stage.tsx';

const CONFETTI_COLORS = ['#ff4fd8', '#ffd23f', '#22d3ee', '#2de38f', '#a78bfa', '#ff8a3d'];

/** CSS confetti burst (none with reduced motion / fx off; fewer on low fx). */
export function Confetti({ count }: { count?: number }) {
  const fx = usePartyFx();
  const n = count ?? fx.particles;
  if (!fx.motion || n <= 0) return null;
  return (
    <div className="pk-confetti" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <i
          key={i}
          style={
            {
              '--x': `${(i * 37 + 11) % 100}%`,
              '--dur': `${2.8 + ((i * 7) % 10) * 0.2}s`,
              '--delay': `${((i * 3) % 14) * 0.12}s`,
              '--drift': `${((i * 13) % 9) - 4}vw`,
              '--c': CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export interface PartyResultsProps {
  gameId: GameId;
  /** Game label above the headline ("DAStravaganza Trivia · Final standings"). */
  kicker: string;
  podium: PartyPodium;
  meId?: string | null;
  /** Small per-player line under the score (e.g. "7/10 correct"). */
  statFor?: (entry: PartyPodiumEntry) => ReactNode;
  /** Unit after scores. */
  unit?: string;
  /** Game-specific sections (awards, recap…) under the standings. */
  children?: ReactNode;
  /** Extra buttons in the action row. */
  actions?: ReactNode;
}

/** Complete results screen: headline, podium, standings, extras, actions. */
export function PartyResults({ gameId, kicker, podium, meId, statFor, unit = 'pts', children, actions }: PartyResultsProps) {
  const fx = usePartyFx();
  const played = useRef(false);
  const me = podium.players.find((p) => p.id === meId);
  const iWon = Boolean(meId && podium.winnerIds.includes(meId));
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    sfx(iWon ? 'bigwin' : 'win');
  }, [iWon]);

  const headline = useMemo(() => {
    if (podium.teams) {
      const winners = podium.teams.filter((t) => podium.winningTeamIds.includes(t.id));
      if (winners.length === 1)
        return (
          <>
            <span style={{ color: winners[0]!.color }}>{winners[0]!.name}</span> wins!
          </>
        );
      if (winners.length > 1) return <>It’s a tie between {winners.map((t) => t.name).join(' & ')}!</>;
      return <>That’s a wrap!</>;
    }
    const winners = podium.players.filter((p) => p.place === 1);
    if (winners.length === 1)
      return (
        <>
          <span style={{ color: winners[0]!.color }}>{winners[0]!.name}</span> wins!
        </>
      );
    if (winners.length > 1) return <>A {winners.length}-way tie for first!</>;
    return <>That’s a wrap!</>;
  }, [podium]);

  const top = podium.players.filter((p) => p.place <= 3).slice(0, 3);
  // Display order: 2nd, 1st, 3rd (ties keep their real place numbers).
  const slots = top.length >= 2 ? ([top[1], top[0], top[2]].filter(Boolean) as PartyPodiumEntry[]) : top;

  return (
    <GameStage gameId={gameId} className="pk-stage pk-results">
      {iWon || podium.winnerIds.length > 0 ? <Confetti count={Math.round(fx.particles * (iWon ? 1.4 : 0.8))} /> : null}
      <div className="pk-results__inner">
        <header className="pk-results__head">
          <span className="dc-label">{kicker}</span>
          <h1 className="pk-results__title">{headline}</h1>
          {me ? (
            <p className="pk-results__me">
              {podium.teams ? (
                <>
                  Your team: <TeamBadge teamId={me.teamId} size="sm" /> ·{' '}
                </>
              ) : null}
              You finished <strong>{ordinal(me.place)}</strong> with <strong className="dc-num">{me.score.toLocaleString('en-US')}</strong>{' '}
              {unit}
            </p>
          ) : null}
        </header>

        {podium.teams ? (
          <section className="pk-teampodium" aria-label="Team standings">
            {podium.teams.map((t) => (
              <div
                key={t.id}
                className={cx('pk-teampodium__slot', podium.winningTeamIds.includes(t.id) && 'is-winner')}
                style={{ '--team': t.color } as CSSProperties}
              >
                <span className="pk-teampodium__place dc-num">{ordinal(t.place)}</span>
                <span className="pk-teampodium__icon" aria-hidden="true">
                  <ArtIcon name={t.icon} size={34} />
                </span>
                <span className="pk-teampodium__name">{t.name}</span>
                <span className="pk-teampodium__score dc-num">
                  {t.score.toLocaleString('en-US')} {unit}
                </span>
                <span className="pk-teampodium__size">
                  {t.size} player{t.size === 1 ? '' : 's'}
                </span>
                {podium.winningTeamIds.includes(t.id) ? (
                  <PixelIcon name="crown" className="pk-teampodium__crown" title="Winning team" />
                ) : null}
              </div>
            ))}
          </section>
        ) : (
          <section className="pk-podium" aria-label="Podium">
            {slots.map((p) => (
              <div
                key={p.id}
                className={cx('pk-podium__slot', `pk-podium__slot--${Math.min(p.place, 3)}`, p.id === meId && 'is-me')}
                style={{ '--player': p.color } as CSSProperties}
              >
                {p.place === 1 ? <PixelIcon name="crown" className="pk-podium__crown" title="Winner" /> : null}
                <Avatar avatar={p.avatar} color={p.color} size={p.place === 1 ? 72 : 56} />
                <span className="pk-podium__name">{p.name}</span>
                <span className="pk-podium__score dc-num">
                  {p.score.toLocaleString('en-US')} {unit}
                </span>
                {statFor ? <span className="pk-podium__stat">{statFor(p)}</span> : null}
                <div className="pk-podium__block">
                  <span className="pk-podium__place dc-num">{p.place}</span>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="pk-panel" aria-label="Final standings">
          <h2 className="pk-panel__title">Standings</h2>
          <ol className="pk-standings">
            {podium.players.map((p) => (
              <li key={p.id} className={cx('pk-standing', p.id === meId && 'is-me')}>
                <span className="pk-standing__place dc-num">{ordinal(p.place)}</span>
                <Avatar avatar={p.avatar} color={p.color} size={28} />
                <span className="pk-standing__name">
                  {p.name}
                  {podium.teams && p.teamId ? <TeamBadge teamId={p.teamId} size="sm" short /> : null}
                </span>
                {statFor ? <span className="pk-standing__stat">{statFor(p)}</span> : null}
                <span className="pk-standing__score dc-num">{p.score.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ol>
        </section>

        {children}

        <div className="pk-results__actions">
          <ResultsActions extra={actions} />
        </div>
      </div>
    </GameStage>
  );
}
