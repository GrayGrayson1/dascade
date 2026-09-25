/**
 * DASh Circuit — client module. Full-screen (immersive) Phaser racer with its own
 * start lights, a lobby car customizer and host track settings.
 */
import type { GameClientModule } from '../types.ts';
import { GameStage } from '../../shell/common.tsx';
import { useRoomSelector } from '../../net/hooks.ts';
import { RaceStage } from './RaceStage.tsx';
import { Results } from './Results.tsx';
import { Customizer } from './Customizer.tsx';
import { CircuitSettingsPanel } from './SettingsPanel.tsx';
import './circuit.css';

function CircuitView() {
  const phase = useRoomSelector((s) => s.phase);
  const results = phase === 'RESULTS';
  return (
    <GameStage gameId="circuit" className="ci-stage">
      <RaceStage dimmed={results} />
      {results ? <Results /> : null}
    </GameStage>
  );
}

const module: GameClientModule = {
  GameView: CircuitView,
  SettingsPanel: CircuitSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  PlayerSetup: Customizer,
  immersive: true,
  ownCountdown: true,
  musicMood: 'race',
};

export default module;
