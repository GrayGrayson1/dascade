/** The browser tab's title while in a room (pure, unit-tested). */
import type { Phase } from '@dascade/shared';

const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: 'Lobby',
  COUNTDOWN: 'Starting',
  PLAYING: 'In progress',
  INTERMISSION: 'In progress',
  RESULTS: 'Results',
  ENDED: 'Closed',
};

export function phaseLabel(phase: Phase | null | undefined): string {
  return (phase && PHASE_LABEL[phase]) || 'Lobby';
}

/** e.g. "ABCDE · DAS Chess · Lobby". */
export function roomTabTitle(code: string, gameTitle: string, phase: Phase | null | undefined): string {
  return `${code} · ${gameTitle} · ${phaseLabel(phase)}`;
}
