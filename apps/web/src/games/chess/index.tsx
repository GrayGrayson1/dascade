/** DAS Chess client module: real-time chess on the DAS Boardroom kit. */
import type { GameClientModule } from '../types.ts';
import { ChessView } from './ChessView.tsx';
import { ChessSettingsPanel } from './Settings.tsx';
import '../_boardroom/boardroom.css';
import './chess.css';

// SettingsPanelProps<never> (platform typing) can't be satisfied by a typed panel without a cast.
const SettingsPanel = ChessSettingsPanel as unknown as GameClientModule['SettingsPanel'];

const module: GameClientModule = {
  GameView: ChessView,
  SettingsPanel,
  musicMood: 'chill',
};

export default module;
