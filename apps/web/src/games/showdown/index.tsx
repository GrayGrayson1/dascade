/**
 * DAS Survey Showdown client module — a presenter-run survey game show for the big screen.
 *
 * Self-contained: everything lives in this folder (plus the shared contract, the engine and the room).
 * The view renders in every phase (lobbyPhases: []) so a big-screen device can show the waiting
 * marquee while everyone else sees the shared lobby. See docs/SHOWDOWN.md.
 */
import type { ComponentType } from 'react';
import '@fontsource/creepster/latin-400.css';
import '@fontsource/audiowide/latin-400.css';
import '@fontsource-variable/orbitron/wght.css';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { ShowdownView } from './ShowdownView.tsx';
import { ShowdownPlayerSetup, ShowdownSettingsPanel } from './Lobby.tsx';
import './showdown.css';

const module: GameClientModule = {
  GameView: ShowdownView,
  SettingsPanel: ShowdownSettingsPanel as unknown as ComponentType<SettingsPanelProps<never>>,
  PlayerSetup: ShowdownPlayerSetup,
  lobbyPhases: [],
  lobbyStartTab: 'setup',
  ownCountdown: true,
  musicMood: 'arcade',
};
export default module;
