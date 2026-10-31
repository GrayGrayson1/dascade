/** DAS Reversi client module: ten variants of the disc-flipping game on the DAS Boardroom kit. */
import type { GameClientModule } from '../types.ts';
import { ReversiView } from './ReversiView.tsx';
import { ReversiSettingsPanel } from './Settings.tsx';
import '../_boardroom/boardroom.css';
import './reversi.css';

// SettingsPanelProps<never> (platform typing) can't be satisfied by a typed panel without a cast.
const SettingsPanel = ReversiSettingsPanel as unknown as GameClientModule['SettingsPanel'];

const module: GameClientModule = {
  GameView: ReversiView,
  SettingsPanel,
  musicMood: 'chill',
};

export default module;
