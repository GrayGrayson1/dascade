/**
 * Party kit — scores: animated leaderboard (count-up + rank changes), team board, team badges,
 * delta chips.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { PlayerView } from '@dascade/shared';
import { partyTeam, type PartySeatView, type PartyTeamView } from '@dascade/shared/party';
import { Avatar, PixelIcon, cx } from '@dascade/ui';
import { useCountUp, usePartyFx } from './hooks.ts';
import { ArtIcon } from './Stage.tsx';

// ---------------------------------------------------------------------------
// Team badge
// ---------------------------------------------------------------------------

/** Team pill: icon + name in the team colour (never colour alone). */
export function TeamBadge({ teamId, size = 'md', short }: { teamId: string; size?: 'sm' | 'md'; short?: boolean }) {
  const team = partyTeam(teamId);
  if (!team) return null;
  return (
    <span className={cx('pk-team', size === 'sm' && 'pk-team--sm')} style={{ '--team': team.color } as CSSProperties} title={team.name}>
      <ArtIcon name={team.icon} size={size === 'sm' ? 10 : 12} />
      <span>{short ? team.name.replace(/^Team /, '') : team.name}</span>
    </span>
  );
}

/** "+350" / "−200" chip (hidden for 0 unless `showZero`). */
export function DeltaChip({ delta, showZero }: { delta: number; showZero?: boolean }) {
  if (!delta && !showZero) return null;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return (
    <span className="pk-delta dc-num" data-sign={delta > 0 ? 'up' : delta < 0 ? 'down' : 'zero'}>
      {sign}
      {Math.abs(delta).toLocaleString('en-US')}
    </span>
  );
}

function RankArrow({ from, to }: { from: number; to: number }) {
  if (!from || !to || from === to) return <span className="pk-rankmove" aria-hidden="true" />;
  const up = to < from;
  return (
    <span className="pk-rankmove" data-dir={up ? 'up' : 'down'} title={up ? `Up ${from - to}` : `Down ${to - from}`}>
      <PixelIcon name={up ? 'chevron-up' : 'chevron-down'} size={10} />
      <span className="dc-num">{Math.abs(from - to)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard with animated reveal
// ---------------------------------------------------------------------------

export interface LeaderboardProps {
  players: PlayerView[];
  seats: Record<string, PartySeatView> | undefined;
  /** Bumps on each score reveal (state.scoreSeq) — the board animates when it changes. */
  scoreSeq: number;
  meId?: string | null;
  /** Show this many rows (plus your own row if you're further down). */
  limit?: number;
  teamMode?: boolean;
  /** Animate the last reveal (from previous scores / order). Default true. */
  animate?: boolean;
  title?: string;
  className?: string;
  /** Compact rows (side panels). */
  dense?: boolean;
}

interface Row {
  p: PlayerView;
  seat: PartySeatView | undefined;
  rank: number;
  prevRank: number;
  delta: number;
}

/**
 * Leaderboard that plays a game-show reveal whenever `scoreSeq` changes: rows start in their
 * previous order with previous scores, then deltas pop, scores count up and rows slide to their
 * new places. Reduced motion / fx off → final state immediately.
 */
export function Leaderboard({
  players,
  seats,
  scoreSeq,
  meId,
  limit = 10,
  teamMode,
  animate = true,
  title = 'Leaderboard',
  className,
  dense,
}: LeaderboardProps) {
  const { motion } = usePartyFx();
  const [phase, setPhase] = useState<'before' | 'after'>(animate && motion ? 'before' : 'after');
  useEffect(() => {
    if (!animate || !motion) {
      setPhase('after');
      return;
    }
    setPhase('before');
    const t = setTimeout(() => setPhase('after'), 650);
    return () => clearTimeout(t);
  }, [scoreSeq, animate, motion]);

  const rows = useMemo<Row[]>(() => {
    const seated = players.filter((p) => !p.spectator);
    const all = seated.map((p) => {
      const seat = seats?.[p.id];
      return {
        p,
        seat,
        rank: seat?.rank || seated.length,
        prevRank: seat?.prevRank || seat?.rank || seated.length,
        delta: seat?.delta ?? 0,
      };
    });
    all.sort((a, b) => a.rank - b.rank || b.p.score - a.p.score || a.p.joinOrder - b.p.joinOrder);
    const shown = all.slice(0, limit);
    const me = all.find((r) => r.p.id === meId);
    if (me && !shown.includes(me)) shown.push(me);
    return shown;
  }, [players, seats, limit, meId]);

  const beforeOrder = useMemo(() => {
    const sorted = [...rows].sort(
      (a, b) => a.prevRank - b.prevRank || b.p.score - b.delta - (a.p.score - a.delta) || a.p.joinOrder - b.p.joinOrder,
    );
    return new Map(sorted.map((r, i) => [r.p.id, i]));
  }, [rows]);

  return (
    <section className={cx('pk-board', dense && 'pk-board--dense', className)} aria-label={title}>
      <h3 className="pk-board__title">
        <PixelIcon name="trophy" size={14} /> {title}
      </h3>
      <ol className="pk-board__list" style={{ '--rows': rows.length } as CSSProperties}>
        {rows.map((r, i) => {
          const pos = phase === 'before' ? (beforeOrder.get(r.p.id) ?? i) : i;
          return <LeaderRow key={r.p.id} row={r} pos={pos} phase={phase} me={r.p.id === meId} teamMode={teamMode} seq={scoreSeq} />;
        })}
      </ol>
    </section>
  );
}

function LeaderRow({
  row,
  pos,
  phase,
  me,
  teamMode,
  seq,
}: {
  row: Row;
  pos: number;
  phase: 'before' | 'after';
  me: boolean;
  teamMode?: boolean;
  seq: number;
}) {
  const { p, seat, delta } = row;
  const from = p.score - delta;
  const shownScore = useCountUp(phase === 'after' ? p.score : from, from, 900, `${seq}:${phase}`);
  const place = phase === 'after' ? row.rank : row.prevRank;
  return (
    <li
      className={cx('pk-row', me && 'is-me', !p.connected && 'is-offline')}
      style={{ '--pos': pos, '--player': p.color } as CSSProperties}
      data-phase={phase}
      aria-label={`${place}. ${p.name}${me ? ' (you)' : ''}, ${p.score.toLocaleString('en-US')} points${delta ? `, ${delta > 0 ? 'plus' : 'minus'} ${Math.abs(delta)} this round` : ''}`}
    >
      <span className="pk-row__place dc-num" aria-hidden="true">
        {place}
      </span>
      <Avatar avatar={p.avatar} color={p.color} size={30} offline={!p.connected} />
      <span className="pk-row__name" aria-hidden="true">
        <span className="pk-row__nametext">{p.name}</span>
        {me ? <span className="pk-row__you">You</span> : null}
        {teamMode && seat?.teamId ? <TeamBadge teamId={seat.teamId} size="sm" short /> : null}
      </span>
      <span className="pk-row__delta" aria-hidden="true">
        {phase === 'after' ? <DeltaChip delta={delta} /> : null}
        {phase === 'after' ? <RankArrow from={row.prevRank} to={row.rank} /> : null}
      </span>
      {seat && seat.streak >= 2 ? (
        <span className="pk-row__streak" title={`${seat.streak} in a row`} aria-hidden="true">
          <PixelIcon name="bolt" size={10} />
          <span className="dc-num">{seat.streak}</span>
        </span>
      ) : null}
      <span className="pk-row__score dc-num" aria-hidden="true">
        {shownScore.toLocaleString('en-US')}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Team board
// ---------------------------------------------------------------------------

export function TeamBoard({
  teams,
  scoring,
  scoreSeq,
  title = 'Teams',
}: {
  teams: Record<string, PartyTeamView> | undefined;
  scoring?: string;
  scoreSeq: number;
  title?: string;
}) {
  const list = useMemo(() => Object.values(teams ?? {}).sort((a, b) => a.rank - b.rank || b.score - a.score), [teams]);
  const max = Math.max(1, ...list.map((t) => Math.abs(t.score)));
  if (list.length === 0) return null;
  return (
    <section className="pk-teamboard" aria-label={title}>
      <h3 className="pk-board__title">
        <PixelIcon name="users" size={14} /> {title}
        {scoring ? <span className="pk-teamboard__mode">{scoring === 'average' ? 'average per player' : 'total points'}</span> : null}
      </h3>
      <ol className="pk-teamboard__list">
        {list.map((t) => (
          <TeamRow key={t.id} team={t} max={max} seq={scoreSeq} />
        ))}
      </ol>
    </section>
  );
}

function TeamRow({ team, max, seq }: { team: PartyTeamView; max: number; seq: number }) {
  const score = useCountUp(team.score, team.score - team.delta, 900, seq);
  return (
    <li
      className="pk-teamrow"
      style={{ '--team': team.color, '--share': Math.max(0.04, Math.abs(team.score) / max) } as CSSProperties}
      aria-label={`${team.rank}. ${team.name}: ${team.score} points, ${team.size} players`}
    >
      <span className="pk-teamrow__place dc-num" aria-hidden="true">
        {team.rank}
      </span>
      <span className="pk-teamrow__name" aria-hidden="true">
        <ArtIcon name={team.icon} size={12} /> {team.name}
        <span className="pk-teamrow__size dc-num">{team.size}p</span>
      </span>
      <span className="pk-teamrow__bar" aria-hidden="true" />
      <span className="pk-teamrow__delta" aria-hidden="true">
        <DeltaChip delta={team.delta} />
      </span>
      <span className="pk-teamrow__score dc-num" aria-hidden="true">
        {score.toLocaleString('en-US')}
      </span>
    </li>
  );
}
