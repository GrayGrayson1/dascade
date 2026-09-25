/**
 * Contract every game client module implements (apps/web/src/games/<gameId>/index.tsx
 * default-exports a GameClientModule). Modules are code-split and loaded on demand.
 */
import type { ComponentType } from 'react';
import type { Phase } from '@dascade/shared';

export interface SettingsPanelProps<Settings = Record<string, unknown>> {
  settings: Settings;
  /** Only the host may edit; render read-only otherwise. */
  canEdit: boolean;
  /** Send a partial settings patch (top-level keys replace). Server validates. */
  update: (patch: Partial<Settings>) => void;
}

export interface GameClientModule {
  /** Full-screen game experience, shown whenever phase is not in `lobbyPhases`. */
  GameView: ComponentType;
  /** Host-editable settings UI shown in the lobby. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each game supplies its own Settings type
  SettingsPanel?: ComponentType<SettingsPanelProps<any>> | ComponentType<SettingsPanelProps<never>>;
  /** Per-player setup shown in the lobby (e.g. car customization, hero select). */
  PlayerSetup?: ComponentType;
  /** Phases that render the shared Lobby (default ['LOBBY']). */
  lobbyPhases?: Phase[];
  /** Hide the shared top bar while playing (the game shows its own minimal HUD + ShellMenu). */
  immersive?: boolean;
  /** The game renders its own pre-start countdown (e.g. racing start lights); hides the shared 3-2-1 overlay. */
  ownCountdown?: boolean;
  /** Background music mood while in this game. */
  musicMood?: 'arcade' | 'chill' | 'casino' | 'race' | 'quest';
}
