/**
 * DASketch client module — multiplayer drawing + guessing.
 */
import type { ComponentType } from 'react';
import type { GameClientModule, SettingsPanelProps } from '../types.ts';
import { SketchGameView } from './GameView.tsx';
import { SketchSettingsPanel } from './SettingsPanel.tsx';
import { canvasStore } from './canvas/canvasStore.ts';
import './dasketch.css';

declare global {
  interface Window {
    /** Read-only drawing introspection for automated tests. */
    __DASKETCH__?: { ops: () => number; turn: () => number };
  }
}
if (typeof window !== 'undefined') {
  window.__DASKETCH__ = { ops: () => canvasStore.board.ops.length, turn: () => canvasStore.turn };
}

const module: GameClientModule = {
  GameView: SketchGameView,
  SettingsPanel: SketchSettingsPanel as unknown as ComponentType<SettingsPanelProps<never>>,
  musicMood: 'chill',
};
export default module;
