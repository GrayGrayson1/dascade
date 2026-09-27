/** DAS Checkers client module: American checkers on the DAS Boardroom kit. */
import type { GameClientModule } from '../types.ts';
import { CheckersView } from './CheckersView.tsx';
import { CheckersSettingsPanel } from './Settings.tsx';
import '../_boardroom/boardroom.css';
import './checkers.css';

// SettingsPanelProps<never> (platform typing) can't be satisfied by a typed panel without a cast.
const SettingsPanel = CheckersSettingsPanel as unknown as GameClientModule['SettingsPanel'];

const module: GameClientModule = {
  GameView: CheckersView,
  SettingsPanel,
  musicMood: 'chill',
};

export default module;
