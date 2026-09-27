/**
 * DAScade Classics — client kit. Import from '../_classics/index.ts' inside a Classics game.
 * Remember to also import '../_classics/classics.css' once from your module.
 */
export { ClassicsShell, RailPanel, BackToClassicsButton, useBackToClassics, CLASSICS_PATH, type ClassicsGameInfo, type ClassicsShellProps } from './ClassicsShell.tsx';
export { InstructionsCard, CountdownCard, PauseCard, GameOverCard, InfoCard, HowToList, type FinalResult } from './cards.tsx';
export { ClassicsResults } from './ClassicsResults.tsx';
export { HighScoreBoard, StandingsPanel } from './Boards.tsx';
export { HudStat, HudLives, HudTimer, CountUp, SpectatorHud, formatScore } from './Hud.tsx';
export { TouchButton, DPad, TouchDeck, TouchStick, useGestures, type GestureHandlers } from './TouchControls.tsx';
export { IntentInput, prefersTouch, type IntentSpec, type InputDevice, type PointerState } from './input.ts';
export { FixedLoop, useFixedLoop, type FixedLoopOptions } from './loop.ts';
export { useCanvasSurface, beginFrame, toLogical, blockSprite, drawBlock, shade, alpha, roundRect, type Surface, type BlockStyle } from './canvas.ts';
export { useLiveMaterials, screenColors, hasScreenMaterials, tint, mix, deepen, lighten, luminance, type Materials, type ScreenColors } from './palette.ts';
export { Particles, Shake, Popups, fxSettings, canvasFonts, type FxSettings } from './fx.ts';
export { classicSfx, type ClassicSound } from './sfx.ts';
export { VerifiedRunClient, type RunPhase } from './VerifiedRunClient.ts';
export { useVerifiedFlow, verifiedOverlay, type VerifiedFlow, type OverlayOptions } from './useVerifiedFlow.tsx';
export { InputPump, subscribeBytes, SnapshotBuffer, intentBits, ByteReader, ByteWriter } from './realtime.ts';
export {
  useStandings,
  useClassicsMeta,
  useMyId,
  useMyStanding,
  createHudStore,
  useHud,
  fetchBoard,
  useHighScores,
  usePersonalBest,
  readBest,
  writeBest,
  type StandingRow,
  type HudStore,
} from './useClassics.ts';
