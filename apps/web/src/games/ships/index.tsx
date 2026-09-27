/** DAS Ships client module: an original hidden-fleet duel on DASCADE's neon sea. */
import type { GameClientModule } from '../types.ts';
import { ShipsSettingsPanel } from './Settings.tsx';
import { ShipsView } from './ShipsView.tsx';
import './ships.css';

// SettingsPanelProps<never> (platform typing) can't be satisfied by a typed panel without a cast.
const SettingsPanel = ShipsSettingsPanel as unknown as GameClientModule['SettingsPanel'];

const module: GameClientModule = {
  GameView: ShipsView,
  SettingsPanel,
  musicMood: 'chill',
};

export default module;
