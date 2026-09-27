/**
 * Tournament Center kiosk client module. The kiosk room never leaves the LOBBY phase, so the
 * module renders its own view for every phase (`lobbyPhases: []`).
 */
import type { GameClientModule } from '../types.ts';
import { KioskView } from './KioskView.tsx';
import '../../tournament/bracket/bracket.css';
import './kiosk.css';

const module: GameClientModule = {
  GameView: KioskView,
  lobbyPhases: [],
  musicMood: 'arcade',
};

export default module;
