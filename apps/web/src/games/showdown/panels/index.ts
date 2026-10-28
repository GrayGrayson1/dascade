/**
 * The console's event panels (PRS-01 drawer tabs) and the picker strip in the rail. The crew screen
 * (CrewView) and the lobby's "Crew & checks" section use the same panels.
 *
 * - PickerStrip({look, board}) — the rail's always-visible picker controls (K / D / A).
 * - PickerPanel({look, board}) — drawer tab "Picker".
 * - SoundPanel({look}) — drawer tab "Sound" (the sound station; the console adds its cue buttons below).
 * - NamesPanel() — drawer tab "Names" (rename / hide).
 * - CrewPanel({code}) — drawer tab "Crew & log" (crew links, Make … presenter, the log and its export).
 * - PreflightPanel({look, code, title}) — drawer tab "Preflight" (GO / NO-GO).
 * - ScoresPanel({look, code}) — drawer tab "Scores" (two-tier scoring: the full list, medals, CSV / JSON, credits);
 *   ScoresDownloads({code}) — its download buttons, also on the results screen.
 */
export { PickerStrip } from './PickerStrip.tsx';
export { PickerPanel } from './PickerPanel.tsx';
export { SoundPanel } from './SoundPanel.tsx';
export { NamesPanel } from './NamesPanel.tsx';
export { CrewPanel } from './CrewPanel.tsx';
export { PreflightPanel } from './PreflightPanel.tsx';
export { ScoresDownloads, ScoresPanel } from './ScoresPanel.tsx';
export { crewTabs, CREW_TAB_LABEL, type CrewTab } from './tabs.ts';
// The crew-link and draw-history feed must run whenever the panels are loaded.
import './feed.ts';
