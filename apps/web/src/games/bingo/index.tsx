/**
 * DAS Bingo client module.
 */
import type { GameClientModule } from '../types.ts';
import { BingoGameView } from './Play.tsx';
import { BingoSettingsPanel } from './Settings.tsx';
import './bingo.css';

const module: GameClientModule = {
  GameView: BingoGameView,
  SettingsPanel: BingoSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  musicMood: 'chill',
};

export default module;
