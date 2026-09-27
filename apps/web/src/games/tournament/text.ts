import type { ParticipantStatus, TournamentStatus } from '@dascade/shared';

export const PARTICIPANT_STATUS_TEXT: Record<ParticipantStatus, string> = {
  registered: 'Registered',
  checked_in: 'Checked in',
  active: 'Playing',
  eliminated: 'Out',
  champion: 'Champion',
  withdrawn: 'Withdrawn',
  disqualified: 'Disqualified',
  no_show: 'No-show',
};

export const PARTICIPANT_STATUS_TONE: Record<ParticipantStatus, string> = {
  registered: 'var(--text-2)',
  checked_in: 'var(--green)',
  active: 'var(--cyan)',
  eliminated: 'var(--text-3)',
  champion: 'var(--yellow)',
  withdrawn: 'var(--text-3)',
  disqualified: 'var(--red)',
  no_show: 'var(--text-3)',
};

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function clockTime(ms: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "4:05" for a countdown in ms. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Lifecycle steps shown in the organizer stepper (check-in only when enabled). */
export function lifecycle(checkIn: boolean): TournamentStatus[] {
  return checkIn
    ? ['DRAFT', 'REGISTRATION', 'CHECK_IN', 'READY', 'IN_PROGRESS', 'COMPLETE']
    : ['DRAFT', 'REGISTRATION', 'READY', 'IN_PROGRESS', 'COMPLETE'];
}

export const STEP_SHORT: Record<TournamentStatus, string> = {
  DRAFT: 'Draft',
  REGISTRATION: 'Registration',
  CHECK_IN: 'Check-in',
  READY: 'Ready',
  IN_PROGRESS: 'Live',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
};
