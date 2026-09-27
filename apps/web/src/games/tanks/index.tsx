/**
 * DAS Tanks — client module. Full-screen (immersive) Phaser artillery battlefield with a
 * touch-first gunner deck, host battle settings and a lobby team picker / field manual.
 */
import type { GameClientModule } from '../types.ts';
import { TanksView } from './TanksView.tsx';
import { TanksSettingsPanel } from './SettingsPanel.tsx';
import { TeamSetup } from './TeamSetup.tsx';
import './tanks.css';

const module: GameClientModule = {
  GameView: TanksView,
  SettingsPanel: TanksSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  PlayerSetup: TeamSetup,
  immersive: true,
  musicMood: 'arcade',
};

export default module;
