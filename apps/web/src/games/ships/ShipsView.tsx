/** DAS Ships game screen: routes between deployment, battle and results. */
import { useMemo, type CSSProperties } from 'react';
import type { TournamentMatchInfo } from '@dascade/shared';
import {
  SHIPS_FLEETS,
  SHIPS_MSG,
  VESSELS,
  type ShipsFleetId,
  type ShipsPrivatePayload,
  type ShipsPublicState,
  type ShipsSettings,
} from '@dascade/shared/games/ships';
import { Badge, Spinner, TimerRing } from '@dascade/ui';
import { useCountdown, useGame, useLatestMessage } from '../../net/hooks.ts';
import { GameStage } from '../../shell/common.tsx';
import { Battle } from './Battle.tsx';
import { Deploy } from './Deploy.tsx';
import { Results } from './Results.tsx';
import { VesselIcon } from './art.tsx';
import { useGlow } from './hooks.ts';

export function ShipsView() {
  const game = useGame<ShipsPublicState, ShipsSettings>();
  const priv = useLatestMessage<ShipsPrivatePayload>(SHIPS_MSG.private);
  const glow = useGlow();
  const tournament = useMemo<TournamentMatchInfo | null>(() => {
    if (!game?.state.tournamentJson) return null;
    try {
      return JSON.parse(game.state.tournamentJson) as TournamentMatchInfo;
    } catch {
      return null;
    }
  }, [game?.state.tournamentJson]);
  if (!game) return null;
  const { state, playerId, phase } = game;
  const isCaptain = Boolean(playerId && state.sides.some((s) => s.playerId === playerId));
  const style = { '--sh-glow': glow } as CSSProperties;

  const strip = tournament ? (
    <div className="sh-tourney" role="note">
      <Badge color="var(--yellow)" icon="trophy">
        {tournament.tournamentName}
      </Badge>
      <span>
        {tournament.roundLabel} · Game {tournament.gameNumber} of {tournament.bestOf}
      </span>
    </div>
  ) : null;

  if (phase === 'RESULTS') {
    return (
      <GameStage gameId="ships" className="sh sh--results" style={style}>
        {strip}
        <Results state={state} playerId={playerId} />
      </GameStage>
    );
  }

  const deploying = state.stage === 'placement' || state.stage === '';
  if (deploying) {
    return (
      <GameStage gameId="ships" className="sh sh--deploy" style={style}>
        {strip}
        {isCaptain && playerId ? (
          <Deploy
            key={state.matchNo}
            state={state}
            playerId={playerId}
            priv={priv}
            locked={phase !== 'PLAYING' || state.stage !== 'placement'}
          />
        ) : (
          <DeployWatch state={state} />
        )}
      </GameStage>
    );
  }

  return (
    <GameStage gameId="ships" className="sh sh--battle" style={style}>
      {strip}
      <Battle key={state.matchNo} state={state} playerId={playerId} priv={priv} isCaptain={isCaptain} />
    </GameStage>
  );
}

/** Spectators (and late joiners) while the captains deploy. */
function DeployWatch({ state }: { state: ShipsPublicState }) {
  const remaining = useCountdown(state.deadline);
  const fleet = SHIPS_FLEETS[state.fleet as ShipsFleetId] ?? SHIPS_FLEETS.standard;
  return (
    <div className="sh-watch">
      <div className="sh-watch__card dc-panel dc-panel--brackets">
        <h2 className="sh-h2">Fleets deploying</h2>
        <p className="sh-sub">
          Both captains are hiding their vessels on a {state.gridSize}×{state.gridSize} sea. You’ll see every shot — and both fleets once
          the battle is over.
        </p>
        <ul className="sh-watch__captains">
          {state.sides.map((s) => (
            <li key={s.playerId}>
              <span className="sh-watch__name">{s.name}</span>
              {s.ready ? (
                <Badge color="var(--green)" icon="check">
                  Ready
                </Badge>
              ) : (
                <span className="sh-watch__wait">
                  <Spinner label={`${s.name} is deploying`} /> Deploying
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="sh-watch__fleet" aria-label={`${fleet.name}: ${fleet.vessels.map((v) => VESSELS[v].name).join(', ')}`}>
          {fleet.vessels.map((v) => (
            <span
              key={v}
              className="sh-watch__vessel"
              style={{ '--len': VESSELS[v].length } as CSSProperties}
              title={`${VESSELS[v].name} · ${VESSELS[v].length}`}
            >
              <VesselIcon id={v} />
            </span>
          ))}
        </div>
        {state.deadline > 0 && remaining > 0 ? (
          <div className="sh-watch__timer">
            <TimerRing
              seconds={Math.ceil(remaining / 1000)}
              progress={state.clockMs ? remaining / state.clockMs : 0}
              size={44}
              label="Deployment time"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
