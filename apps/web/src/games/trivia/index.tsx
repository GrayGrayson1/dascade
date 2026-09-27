/**
 * DAStravaganza Trivia client module.
 */
import type { ComponentType } from 'react';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { TriviaView } from './TriviaView.tsx';
import { TriviaSettingsPanel } from './SettingsPanel.tsx';
import './trivia.css';

const module: GameClientModule = {
  GameView: TriviaView,
  SettingsPanel: TriviaSettingsPanel as unknown as ComponentType<SettingsPanelProps<never>>,
  musicMood: 'arcade',
};
export default module;
