/**
 * Multiplayer RESULTS for every Classics game: podium, full standings, the verified high-score
 * board, and actions — host: Rematch (same settings) / Change settings (lobby); everyone:
 * Back to Classics / Leave. Tournament Center matches: no rematch (the series runs itself) and
 * "Back to tournament" once the match is over.
 */
import { useEffect } from 'react';
import { GAME_CATALOG } from '@dascade/shared';
import { CLASSICS_MSG } from '@dascade/shared/games/classics';
import { Button, PixelIcon, Spinner, cx } from '@dascade/ui';
import { GameStage, LeaveButton } from '../../shell/common.tsx';
import { useBaseRoom } from '../../net/hooks.ts';
import { session } from '../../net/session.ts';
import { sfx } from '../../audio/audio.ts';
import { useTournamentExit } from '../../tournament/exit.ts';
import { BackToClassicsButton, type ClassicsGameInfo } from './ClassicsShell.tsx';
import { HighScoreBoard, StandingsPanel } from './Boards.tsx';
import { formatScore } from './Hud.tsx';
import { useClassicsMeta, useHighScores, useMyId, useStandings } from './useClassics.ts';

export function ClassicsResults({ info }: { info: ClassicsGameInfo }) {
  const rows = useStandings();
  const meta = useClassicsMeta();
  const me = useMyId();
  const base = useBaseRoom();
  const isHost = Boolean(me && base?.hostId === me);
  // Tournament Center match: the series runs itself; the way out leads back to the kiosk.
  const exit = useTournamentExit();
  const board = useHighScores(info.gameId, meta?.board ?? '', meta?.matchNo ?? 0);
  const game = GAME_CATALOG[info.gameId];
  const podium = rows.filter((r) => r.status !== 'out').slice(0, 3);
  const mine = rows.find((r) => r.id === me);
  // Ranks are the server's final placements (shared place = shared rank; games may rank by more than score).
  const tied = podium.length > 1 && (podium[0]!.rank > 0 ? podium[0]!.rank === podium[1]!.rank : podium[0]!.score === podium[1]!.score);

  useEffect(() => {
    if (mine?.rank === 1) sfx('win');
  }, [mine?.rank]);

  return (
    <GameStage gameId={info.gameId} className="cl-stage cl-results">
      <div className="cl-results__inner">
        <header className="cl-results__head">
          <p className="cl-card__kicker">
            {game.title} · Match {meta?.matchNo ?? 1}
          </p>
          <h1 className="cl-results__title">
            {tied ? 'It’s a tie!' : podium[0] ? `${podium[0].id === me ? 'You win' : `${podium[0].name} wins`}!` : 'Results'}
          </h1>
          {mine ? (
            <p className="cl-results__you">
              You placed <strong>#{mine.rank || rows.indexOf(mine) + 1}</strong> with <strong>{formatScore(mine.score)}</strong>
            </p>
          ) : null}
        </header>

        <ol className="cl-podium" aria-label="Podium">
          {podium.map((r, i) => {
            // Height/medal follow the (possibly shared) final rank; position: winner centre, then left, then right.
            const place = Math.min(3, r.rank || i + 1);
            return (
              <li
                key={r.id}
                className={cx('cl-podium__step', `is-p${place}`, r.id === me && 'is-you')}
                style={{ ['--pc' as string]: r.color, order: [2, 1, 3][i] }}
              >
                <span className="cl-podium__medal" aria-hidden>
                  <PixelIcon name={place === 1 ? 'crown' : 'star'} size={18} />
                </span>
                <span className="cl-podium__name">{r.name}</span>
                <span className="cl-podium__score">{formatScore(r.score)}</span>
                <span className="cl-podium__block">{r.rank || i + 1}</span>
              </li>
            );
          })}
        </ol>

        <div className="cl-results__grid">
          <StandingsPanel rows={rows} me={me} statLabel={info.statLabel} variant="table" title="Final standings" />
          {meta?.board ? (
            <HighScoreBoard
              data={board.data}
              loading={board.loading}
              error={board.error}
              statLabel={info.statLabel}
              title="All-time high scores"
            />
          ) : null}
        </div>

        <footer className="cl-results__actions">
          {exit ? (
            <span className="dc-muted">
              {exit.over ? `This match is over — the bracket continues in ${exit.name}.` : 'The next game of the series starts automatically.'}
            </span>
          ) : isHost ? (
            <>
              <Button variant="primary" size="lg" icon="refresh" onClick={() => session.send(CLASSICS_MSG.rematch, {})}>
                Rematch
              </Button>
              <Button variant="secondary" size="lg" icon="gear" onClick={() => session.lobby.toLobby()}>
                Change settings
              </Button>
            </>
          ) : (
            <span className="dc-muted cl-results__wait">
              <Spinner label="Waiting for host" /> Waiting for the host to start a rematch…
            </span>
          )}
          {exit ? (
            // Participants stay between games; once it's over (and for spectators) head back to the kiosk.
            exit.over || !exit.participant ? <BackToClassicsButton size="lg" variant="secondary" /> : null
          ) : (
            <>
              <BackToClassicsButton size="lg" variant="secondary" />
              <LeaveButton size="lg" />
            </>
          )}
        </footer>
      </div>
    </GameStage>
  );
}
