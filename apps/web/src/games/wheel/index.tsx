/**
 * Wheel of DAStiny client module.
 *  - SettingsPanel: the wheel editor in the lobby (read-only legend for guests).
 *  - GameView: the game-show stage (spin, reveal, history, people, chat, host editor)
 *    and the RESULTS session summary.
 */
import type { GameClientModule } from '../types.ts';
import { WheelSettingsPanel } from './Editor.tsx';
import { WheelView } from './WheelView.tsx';
import './wheel.css';

const module: GameClientModule = {
  GameView: WheelView,
  SettingsPanel: WheelSettingsPanel as unknown as GameClientModule['SettingsPanel'],
  musicMood: 'arcade',
};

export default module;
