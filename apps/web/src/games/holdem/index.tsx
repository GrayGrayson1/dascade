/** DAS Hold'em client module: no-limit Texas Hold'em with virtual chips. */
import type { GameClientModule } from '../types.ts';
import { HoldemView } from './HoldemView.tsx';
import { HoldemSettingsPanel, SeatPicker } from './Settings.tsx';
import './holdem.css';

// SettingsPanelProps<never> (platform typing) can't be satisfied by a typed panel without a cast.
const SettingsPanel = HoldemSettingsPanel as unknown as GameClientModule['SettingsPanel'];

const module: GameClientModule = {
  GameView: HoldemView,
  SettingsPanel,
  PlayerSetup: SeatPicker,
  musicMood: 'casino',
};

export default module;
