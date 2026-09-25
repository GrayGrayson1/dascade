/**
 * DASjack 21 — multiplayer blackjack against the house (virtual chips only).
 */
import type { GameClientModule } from '../types.ts';
import { BlackjackView } from './view.tsx';
import { BlackjackSettingsPanel } from './settings.tsx';
import './blackjack.css';

const module: GameClientModule = {
  GameView: BlackjackView,
  // The platform slot is typed SettingsPanelProps<never>; the lobby passes our parsed settings.
  SettingsPanel: BlackjackSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  musicMood: 'casino',
};

export default module;
