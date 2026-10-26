/**
 * The picker strip's model (pure, unit-tested): what the console says about the draw at a moment.
 *
 * The server has already decided who answers when the `pick` event arrives, so the console names
 * them at once — "Priya S. — on stage in 2 s", counting down to the moment the stage starts its
 * 1.5 s converge (landAt − 1500) — then "Priya S. is answering · 0:12" from the landing on. After
 * SHOWDOWN_NO_SHOW_MS without an answer the presenter may reroll (with a reason the server logs).
 */
import { SHOWDOWN_NO_SHOW_MS, type ShowdownMode, type ShowdownStage } from '@dascade/shared/games/showdown';

/** The stage spends the last 1.5 s before landAt converging on the winner. */
export const PICK_CONVERGE_MS = 1500;

export type PickerPhase =
  /** The picker can't run now: before round 1, or not a Presenter Showcase. */
  | { kind: 'off'; why: 'intro' | 'mode' }
  /** Nobody left to draw this round. */
  | { kind: 'empty' }
  /** Ready to draw from `pool` people. */
  | { kind: 'ready'; pool: number }
  /** Just drawn: the presenter reads the name before the stage lands ("on stage in 2 s"). */
  | { kind: 'heads'; name: string; seconds: number }
  /** On stage: `elapsedMs` since the landing (null = unknown), `rerollInMs` ≤ 0 = Reroll is open. */
  | { kind: 'answering'; name: string; elapsedMs: number | null; rerollInMs: number };

export interface PickerPhaseInput {
  mode: ShowdownMode;
  stage: ShowdownStage;
  hotSeat: string;
  hotName: string;
  landAt: number;
  poolSize: number;
}

export function pickerPhase(p: PickerPhaseInput, now: number): PickerPhase {
  if (p.mode !== 'showcase') return { kind: 'off', why: 'mode' };
  if (p.hotSeat) {
    const name = p.hotName || 'Someone';
    // A restored show can carry a hot seat without its landing time: treat it as on stage.
    if (!p.landAt) return { kind: 'answering', name, elapsedMs: null, rerollInMs: 0 };
    const headsEnd = p.landAt - PICK_CONVERGE_MS;
    if (now < headsEnd) return { kind: 'heads', name, seconds: Math.max(1, Math.ceil((headsEnd - now) / 1000)) };
    return { kind: 'answering', name, elapsedMs: Math.max(0, now - p.landAt), rerollInMs: p.landAt + SHOWDOWN_NO_SHOW_MS - now };
  }
  if (p.stage === 'intro') return { kind: 'off', why: 'intro' };
  if (p.poolSize <= 0) return { kind: 'empty' };
  return { kind: 'ready', pool: p.poolSize };
}

/** "0:07", "1:30" (never negative). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "37 in the pool" / "1 in the pool". */
export function poolWords(n: number): string {
  return `${n} in the pool`;
}

/** One line of the draw history the console keeps from the room's pick / pickEnd events. */
export interface DrawLine {
  drawNo: number;
  name: string;
  /** What happened to the draw so far. */
  how: 'drawn' | 'done' | 'noAnswer' | 'reroll' | 'cleared';
  /** This draw was a reroll's redraw. */
  reroll: boolean;
  at: number;
}

const HOW_WORDS: Record<DrawLine['how'], string> = {
  drawn: 'in the hot seat',
  done: 'turn done',
  noAnswer: 'no answer — back in the pool',
  reroll: 'rerolled — back in the pool',
  cleared: 'taken off the stage',
};

export function drawWords(line: DrawLine): string {
  return `${line.reroll ? 'Redraw' : 'Draw'} ${line.drawNo}: ${line.name}, ${HOW_WORDS[line.how]}`;
}

/**
 * Folds one room event into the history (newest first, capped). A repeated event changes nothing; a
 * pickEnd updates the draw it ends.
 */
export function foldDraw(
  list: readonly DrawLine[],
  ev:
    | { type: 'pick'; drawNo: number; name: string; reroll: boolean }
    | { type: 'pickEnd'; drawNo: number; how: 'done' | 'noAnswer' | 'reroll' | 'cleared' },
  at: number,
  cap = 30,
): DrawLine[] {
  if (ev.type === 'pick') {
    if (list.some((l) => l.drawNo === ev.drawNo)) return [...list];
    return [{ drawNo: ev.drawNo, name: ev.name, how: 'drawn' as const, reroll: ev.reroll, at }, ...list].slice(0, cap);
  }
  return list.map((l) => (l.drawNo === ev.drawNo && l.how === 'drawn' ? { ...l, how: ev.how } : l));
}
