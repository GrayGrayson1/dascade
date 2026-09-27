/**
 * DAS Survey client module — anonymous answers, predictions about your own group.
 */
import type { ComponentType } from 'react';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { SurveyGameView } from './GameView.tsx';
import { SurveySettingsPanel } from './SettingsPanel.tsx';
import './survey.css';

const module: GameClientModule = {
  GameView: SurveyGameView,
  SettingsPanel: SurveySettingsPanel as unknown as ComponentType<SettingsPanelProps<never>>,
  musicMood: 'chill',
};
export default module;
