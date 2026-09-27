/**
 * DASwords client module — Letter Grid, Anagram Sprint, Word Chain, Forbidden Letter.
 * The dictionary lives on the server only; this chunk never contains a word list.
 */
import type { ComponentType } from 'react';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { WordsView } from './WordsView.tsx';
import { WordsSettingsPanel } from './SettingsPanel.tsx';
import './words.css';

const module: GameClientModule = {
  GameView: WordsView,
  SettingsPanel: WordsSettingsPanel as unknown as ComponentType<SettingsPanelProps<never>>,
  // The round intro card is the countdown.
  ownCountdown: true,
  musicMood: 'chill',
};
export default module;
