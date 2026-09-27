/**
 * DAS Boardroom kit (client). Import from '../_boardroom/index.ts' and add
 * `import '../_boardroom/boardroom.css';` once in your module. See docs/GAME_GUIDE.md §6 (Boardroom kit).
 */
export { SquareBoard, type SquareBoardProps, type BoardAnimation, type TargetKind } from './SquareBoard.tsx';
export { BoardClock, formatClock, lowTimeMs, useClockMs, type BoardClockProps } from './clock.tsx';
export { PlayerCard, type PlayerCardProps } from './PlayerCard.tsx';
export { MoveList, type MoveListProps } from './MoveList.tsx';
export { BoardActionBar, type BoardActionBarProps } from './ActionBar.tsx';
export { ResultBanner, type ResultBannerProps } from './ResultBanner.tsx';
export { BoardSettingsFields, TimeControlPicker, type BoardSettingsFieldsProps, type TimeControlPickerProps } from './Settings.tsx';
export { useBoardroom, parseTournament, type Boardroom } from './useBoardroom.ts';
export { boardSounds, useBoardEventSounds, type BoardEventHandlers } from './sounds.ts';
