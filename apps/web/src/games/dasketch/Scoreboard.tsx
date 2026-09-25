/**
 * Live scoreboard: ranked players with who is drawing, who guessed (and when) and the
 * points gained this turn. A horizontal strip variant is used on phones.
 */
import { useMemo, type CSSProperties } from 'react';
import { Avatar, PixelArt, PixelIcon, cx } from '@dascade/ui';
import type { PlayerView } from '@dascade/shared';
import type { DasketchPublicState } from '@dascade/shared/games/dasketch';
import { SKETCH_ICONS } from './icons.ts';

export interface ScoreRow {
  player: PlayerView;
  rank: number;
  isArtist: boolean;
  guessed: boolean;
  guessRank: number;
  turnPoints: number;
}

export function useScoreRows(state: DasketchPublicState | null, players: PlayerView[]): ScoreRow[] {
  const sketch = state?.sketch;
  const stage = state?.stage;
  const artistId = state?.artistId;
  return useMemo(() => {
    const seated = players.filter((p) => !p.spectator);
    const sorted = [...seated].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
    let rank = 0;
    let prev: number | null = null;
    return sorted.map((p, i) => {
      if (prev === null || p.score !== prev) rank = i + 1;
      prev = p.score;
      const sk = sketch?.[p.id];
      const live = stage === 'drawing' || stage === 'reveal' || stage === 'choosing';
      return {
        player: p,
        rank,
        isArtist: live && p.id === artistId,
        guessed: Boolean(sk?.guessed),
        guessRank: sk?.rank ?? 0,
        turnPoints: live ? (sk?.turnPoints ?? 0) : 0,
      };
    });
  }, [sketch, stage, artistId, players]);
}

function Status({ row }: { row: ScoreRow }) {
  if (row.isArtist) {
    return (
      <span className="sk-status sk-status--artist" title="Drawing">
        <PixelArt rows={SKETCH_ICONS.brush} className="sk-status__icon" />
        <span className="visually-hidden">Drawing</span>
      </span>
    );
  }
  if (row.guessed) {
    return (
      <span className="sk-status sk-status--guessed" title={`Guessed it (#${row.guessRank})`}>
        <PixelIcon name="check" />
        <span className="visually-hidden">Guessed it</span>
      </span>
    );
  }
  return null;
}

export function Scoreboard({ rows, meId, spectators }: { rows: ScoreRow[]; meId: string | null; spectators: number }) {
  return (
    <section className="sk-board" aria-label="Scoreboard">
      <header className="sk-board__head">
        <span className="dc-label">Scoreboard</span>
        <span className="sk-board__count">
          <PixelIcon name="users" /> {rows.length}
          {spectators > 0 ? (
            <>
              <PixelIcon name="eye" /> {spectators}
            </>
          ) : null}
        </span>
      </header>
      <ol className="sk-board__list">
        {rows.map((row) => (
          <li
            key={row.player.id}
            className={cx('sk-row', row.isArtist && 'is-artist', row.guessed && 'is-guessed', row.player.id === meId && 'is-me', !row.player.connected && 'is-offline')}
            style={{ '--player': row.player.color } as CSSProperties}
          >
            <span className="sk-row__rank" aria-label={`Rank ${row.rank}`}>
              {row.rank}
            </span>
            <Avatar avatar={row.player.avatar} color={row.player.color} size={30} offline={!row.player.connected} />
            <span className="sk-row__who">
              <span className="sk-row__name">{row.player.name}</span>
              <span className="sk-row__score dc-num">
                {row.player.score.toLocaleString('en-US')}
                {row.player.id === meId ? <span className="sk-row__you">you</span> : null}
              </span>
            </span>
            {row.turnPoints > 0 ? <span className="sk-row__gain dc-num">+{row.turnPoints}</span> : null}
            <Status row={row} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ScoreStrip({ rows, meId }: { rows: ScoreRow[]; meId: string | null }) {
  return (
    <ol className="sk-strip" aria-label="Scoreboard">
      {rows.map((row) => (
        <li
          key={row.player.id}
          className={cx('sk-chip', row.isArtist && 'is-artist', row.guessed && 'is-guessed', row.player.id === meId && 'is-me', !row.player.connected && 'is-offline')}
          style={{ '--player': row.player.color } as CSSProperties}
        >
          <Avatar avatar={row.player.avatar} color={row.player.color} size={24} offline={!row.player.connected} />
          <span className="sk-chip__text">
            <span className="sk-chip__name">{row.player.name}</span>
            <span className="sk-chip__score dc-num">{row.player.score.toLocaleString('en-US')}</span>
          </span>
          <Status row={row} />
        </li>
      ))}
    </ol>
  );
}
