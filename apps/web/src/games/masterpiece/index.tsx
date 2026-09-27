/**
 * DASterpiece client module — the DAStravaganza comedy-writing contest (built on the party kit).
 */
import type { ComponentType } from 'react';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { MasterpieceGameView } from './GameView.tsx';
import { MasterpieceSettingsPanel } from './SettingsPanel.tsx';
import './masterpiece.css';

const module: GameClientModule = {
  GameView: MasterpieceGameView,
  SettingsPanel: MasterpieceSettingsPanel as unknown as ComponentType<SettingsPanelProps<never>>,
  musicMood: 'chill',
};
export default module;
