/**
 * The showcase console's safety rules, as pure functions (unit-tested in consoleSafety.test.ts):
 *
 *   - PRS-02 D: every tile reveals on the first click or key, except the round's special answer,
 *     which ARMS first and is only sent by TAKE SPECIAL (Space). An armed special disarms itself
 *     when the round or the stage changes, a sweep starts, or the tile flips another way.
 *   - PRS-03 D: Reveal remaining is a press-and-hold while the clock still runs; End show / Finish
 *     show list the answers still hidden; an undo toast offers the `undo` act only while the server
 *     still has that very step (the board revision hasn't moved since the action landed).
 *
 * Nothing here touches React, the DOM or the network.
 */
import type { ShowdownBoardView, ShowdownSheet, ShowdownStage } from '@dascade/shared/games/showdown';

// ---------------------------------------------------------------------------
// PRS-02: the armed special
// ---------------------------------------------------------------------------

/** The special answer, armed on this round and stage (nothing has been sent yet). */
export interface ArmedSpecial {
  round: number;
  stage: ShowdownStage;
  slot: number;
}

/** Tiles can be revealed from the sheet (the title card's reveal shows the question first). */
export const sheetOpen = (board: Pick<ShowdownBoardView, 'stage'>): boolean => board.stage === 'title' || board.stage === 'live';

/**
 * What a click or a number key on `slot` does right now: reveal it at once, arm it (the special
 * answer), or nothing (revealed, not on the board, or the sheet isn't open). The special can't be
 * armed during a sweep: the sweep flips it with its own drumroll.
 */
export function tileAction(board: ShowdownBoardView, slot: number, sweeping: boolean): 'reveal' | 'arm' | 'none' {
  const tile = board.slots[slot];
  if (!tile || tile.revealed || !sheetOpen(board)) return 'none';
  if (slot === board.special && board.special >= 0) return sweeping ? 'none' : 'arm';
  return 'reveal';
}

/** The armed special still stands on this board (otherwise it disarms by itself). */
export function armedStillValid(armed: ArmedSpecial | null, board: ShowdownBoardView | null, sweeping: boolean): boolean {
  if (!armed || !board) return false;
  if (sweeping) return false;
  if (armed.round !== board.round || armed.stage !== board.stage) return false;
  if (armed.slot !== board.special || !sheetOpen(board)) return false;
  const tile = board.slots[armed.slot];
  return Boolean(tile && !tile.revealed);
}

/** Arms the special shown on this board (null if it can't be armed). */
export function armSpecial(board: ShowdownBoardView, slot: number, sweeping: boolean): ArmedSpecial | null {
  return tileAction(board, slot, sweeping) === 'arm' ? { round: board.round, stage: board.stage, slot } : null;
}

// ---------------------------------------------------------------------------
// PRS-03: holds, the End show panel and the undo toast
// ---------------------------------------------------------------------------

/** How long a press must be held: reversible actions, and the irreversible End show / Finish show. */
export const HOLD_MS = 800;
export const END_HOLD_MS = 1200;

/** Reveal remaining needs a hold while the clock still has time on it (a stray R would end the round). */
export function sweepNeedsHold(running: boolean, timeUp: boolean): boolean {
  return running && !timeUp;
}

export interface HiddenAnswer {
  /** 1-based position on the board. */
  n: number;
  /** The answer, from the presenter's sheet ('' if the sheet isn't for this round). */
  text: string;
  special: boolean;
}

/** The answers still hidden on this board, with their text from the presenter's sheet. */
export function hiddenAnswers(board: ShowdownBoardView | null, sheet: ShowdownSheet | null): HiddenAnswer[] {
  if (!board || board.round < 0) return [];
  const answers = sheet && sheet.round === board.round ? sheet.answers : [];
  const out: HiddenAnswer[] = [];
  board.slots.forEach((slot, i) => {
    if (!slot.revealed) out.push({ n: i + 1, text: answers[i]?.text ?? '', special: i === board.special });
  });
  return out;
}

/** The undo toast stays at least this long (PRS-03's acceptance criterion is 10 s). */
export const UNDO_TOAST_MS = 12_000;
/** An offer whose action never landed (refused, or the connection dropped) is dropped after this. */
export const UNDO_PENDING_MS = 4_000;

/** An undo offer for one reversible action: made when the command is sent, ready once it lands. */
export interface UndoOffer {
  id: number;
  /** What happened ("Round 2 restarted"). */
  label: string;
  /** One more line ("4 answers stayed hidden."). */
  detail: string;
  /** The board revision the command was sent against. */
  fromRev: number;
  /** The revision the action produced (null: hasn't landed yet). */
  atRev: number | null;
}

/**
 * Where an offer stands against the board right now:
 *   pending — the command hasn't landed yet;
 *   landed  — it just landed at `rev` (record it, start the clock);
 *   ready   — the server still holds exactly that undo step;
 *   stale   — something else changed the board since (another step, an Undo, a refusal): the
 *             toast's Undo would undo something else, so the offer goes.
 */
export function undoOfferStatus(offer: UndoOffer, rev: number, undoSteps: number): 'pending' | 'landed' | 'ready' | 'stale' {
  if (offer.atRev === null) return rev === offer.fromRev ? 'pending' : undoSteps > 0 ? 'landed' : 'stale';
  return rev === offer.atRev && undoSteps > 0 ? 'ready' : 'stale';
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** The console ignores keys aimed at a text field or another dialog, auto-repeats and chords. */
export function ignoreKey(e: Pick<KeyboardEvent, 'defaultPrevented' | 'repeat' | 'altKey' | 'metaKey' | 'ctrlKey'>): boolean {
  return e.defaultPrevented || e.repeat || e.altKey || e.metaKey || e.ctrlKey;
}

/** A number key by its position on the keyboard (AZERTY's unshifted top row too): its slot, or null. */
export function digitSlot(e: Pick<KeyboardEvent, 'code' | 'key'>): number | null {
  const k = e.key.toLowerCase();
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1] ?? (/^\d$/.test(k) ? k : null);
  if (digit === null) return null;
  return digit === '0' ? 9 : Number(digit) - 1;
}

export const isSpace = (e: Pick<KeyboardEvent, 'code' | 'key'>): boolean => e.code === 'Space' || e.key === ' ';

/** The bits of a focused element the Space rule looks at (an Element in the browser). */
export interface SpaceTarget {
  tagName: string;
  closest(selector: string): unknown;
}

/**
 * With the special armed, what Space does where focus is: `take` the special (nothing focused, or
 * focus on the answer sheet), or `native` — the focused control's own Space (Disarm, Pause, a toggle,
 * a drawer tab, Take special itself…). Space only ever takes the special where it can't mean anything else.
 */
export function spaceOnArmed(target: SpaceTarget | null): 'take' | 'native' {
  if (!target) return 'take';
  const tag = target.tagName.toUpperCase();
  if (tag === 'BODY' || tag === 'HTML') return 'take';
  if (target.closest('[data-part="showdown-take-special"], [data-part="showdown-disarm-special"]')) return 'native';
  return target.closest('[data-part="showdown-sheet"]') ? 'take' : 'native';
}

/** A dialog of any kind (native, ARIA, the jukebox player…) owns the keyboard: the console's shortcuts rest. */
export const DIALOG_SELECTOR = 'dialog[open], [role="dialog"], [role="alertdialog"]';
