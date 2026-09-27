/**
 * DASphalt GP — client module. A full-screen (immersive) 3D kart racer with its own start
 * sequence, a racer/kart picker in the lobby and host race settings. three.js and the renderer
 * load with this chunk only (and the renderer itself is a further lazy chunk).
 */
import type { GameClientModule } from '../types.ts';
import { GameStage } from '../../shell/common.tsx';
import { RaceStage } from './RaceStage.tsx';
import { PlayerSetup } from './lobby/PlayerSetup.tsx';
import { KartSettingsPanel } from './lobby/SettingsPanel.tsx';
import './kart.css';

function KartView() {
  return (
    <GameStage gameId="kart" className="kr-stage">
      <RaceStage />
    </GameStage>
  );
}

const module: GameClientModule = {
  GameView: KartView,
  SettingsPanel: KartSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  PlayerSetup,
  immersive: true,
  ownCountdown: true,
  musicMood: 'race',
};

export default module;
