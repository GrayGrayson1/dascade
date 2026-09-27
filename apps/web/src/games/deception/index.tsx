/**
 * DASception client module (DAStravaganza party cabinet).
 */
import type { GameClientModule } from '../types.ts';
import { DeceptionView } from './DeceptionView.tsx';
import { DeceptionSettingsPanel } from './SettingsPanel.tsx';
import './deception.css';

const module: GameClientModule = {
  GameView: DeceptionView,
  SettingsPanel: DeceptionSettingsPanel,
  musicMood: 'chill',
};

export default module;
