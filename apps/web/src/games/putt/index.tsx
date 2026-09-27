/**
 * DAS Putt — client module. Immersive neon mini golf: a canvas course with HUD chrome,
 * slingshot / keyboard / button aiming, server-simulated rolls animated in sync, hole
 * summaries and a full scorecard on results.
 */
import type { GameClientModule } from '../types.ts';
import { PuttView } from './PuttView.tsx';
import { PuttSettingsPanel } from './SettingsPanel.tsx';
import './putt.css';

const module: GameClientModule = {
  GameView: PuttView,
  SettingsPanel: PuttSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  immersive: true,
  musicMood: 'chill',
};

export default module;
