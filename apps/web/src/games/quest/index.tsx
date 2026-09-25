/**
 * DASQuest — cooperative branching adventure (client module).
 */
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import type { ComponentType } from 'react';
import { QuestView } from './QuestView.tsx';
import { QuestPlayerSetup, QuestSettingsPanel } from './Lobby.tsx';
import './quest.css';

const module: GameClientModule = {
  GameView: QuestView,
  SettingsPanel: QuestSettingsPanel as unknown as ComponentType<SettingsPanelProps<never>>,
  PlayerSetup: QuestPlayerSetup,
  musicMood: 'quest',
};

export default module;
