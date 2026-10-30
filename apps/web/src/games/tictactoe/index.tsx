/** DAS Tic-Tac-Toe client module: thirteen variants of noughts and crosses on the DAS Boardroom kit. */
import type { GameClientModule } from '../types.ts';
import { TicTacToeView } from './TicTacToeView.tsx';
import { TicTacToeSettingsPanel } from './Settings.tsx';
import '../_boardroom/boardroom.css';
import './tictactoe.css';

// SettingsPanelProps<never> (platform typing) can't be satisfied by a typed panel without a cast.
const SettingsPanel = TicTacToeSettingsPanel as unknown as GameClientModule['SettingsPanel'];

const module: GameClientModule = {
  GameView: TicTacToeView,
  SettingsPanel,
  musicMood: 'chill',
};

export default module;
