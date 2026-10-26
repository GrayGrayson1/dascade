/**
 * The showcase console's safety rules (PRS-02 D, PRS-03 D): which taps arm the special, when an armed
 * special disarms by itself, when Reveal remaining needs a hold, what End show lists, and when the
 * undo toast may still offer its Undo.
 */
import { describe, expect, it } from 'vitest';
import type { ShowdownBoardView, ShowdownSheet, ShowdownStage } from '@dascade/shared/games/showdown';
import {
  END_HOLD_MS,
  HOLD_MS,
  UNDO_TOAST_MS,
  armSpecial,
  armedStillValid,
  digitSlot,
  hiddenAnswers,
  ignoreKey,
  isSpace,
  spaceOnArmed,
  sweepNeedsHold,
  tileAction,
  undoOfferStatus,
  type UndoOffer,
} from './consoleSafety.ts';

function board(stage: ShowdownStage = 'live', revealed: number[] = [], special = 4, round = 0): ShowdownBoardView {
  return {
    rev: 7,
    mode: 'showcase',
    stage,
    round,
    totalRounds: 2,
    multiplier: 1,
    title: 'Practice',
    prompt: '',
    source: '',
    special,
    slots: Array.from({ length: 10 }, (_, i) => ({ revealed: revealed.includes(i), by: -1, seq: 0, callers: 0, late: false })),
    control: -1,
    strikes: 0,
    stealFailed: false,
    bank: 0,
    scores: [0, 0],
    roundWinner: -1,
    roundHow: '',
    results: [],
  };
}

describe('PRS-02: the special arms, every other tile reveals at once', () => {
  it('reveals a normal tile on the first click, arms the special', () => {
    const b = board('live', [0]);
    expect(tileAction(b, 1, false)).toBe('reveal');
    expect(tileAction(b, 9, false)).toBe('reveal');
    expect(tileAction(b, 4, false)).toBe('arm');
    // The title card too (the reveal shows the question first).
    expect(tileAction(board('title'), 4, false)).toBe('arm');
    expect(tileAction(board('title'), 2, false)).toBe('reveal');
  });

  it('does nothing for a revealed tile, a tile off the board or a closed sheet', () => {
    expect(tileAction(board('live', [4]), 4, false)).toBe('none');
    expect(tileAction(board('live'), 12, false)).toBe('none');
    for (const stage of ['intro', 'done'] as const) {
      expect(tileAction(board(stage), 1, false)).toBe('none');
      expect(tileAction(board(stage), 4, false)).toBe('none');
    }
  });

  it('never arms during a sweep (the sweep flips the special with its own drumroll)', () => {
    expect(tileAction(board('live'), 4, true)).toBe('none');
    expect(armSpecial(board('live'), 4, true)).toBeNull();
    // Other tiles can still be flipped by hand during a sweep, as before.
    expect(tileAction(board('live'), 2, true)).toBe('reveal');
  });

  it('a board without a special has nothing to arm', () => {
    const b = board('live', [], -1);
    for (let i = 0; i < 10; i++) expect(tileAction(b, i, false)).toBe('reveal');
  });

  it('arms with the round and the stage it was armed on', () => {
    expect(armSpecial(board('live', [], 4, 1), 4, false)).toEqual({ round: 1, stage: 'live', slot: 4 });
    expect(armSpecial(board('live'), 3, false)).toBeNull();
  });

  it('stays armed while nothing changed, and when another tile flips', () => {
    const armed = armSpecial(board('live'), 4, false);
    expect(armedStillValid(armed, board('live'), false)).toBe(true);
    expect(armedStillValid(armed, board('live', [0, 1, 2]), false)).toBe(true);
  });

  it('disarms by itself when the round or stage changes, a sweep starts or the tile flips another way', () => {
    const armed = armSpecial(board('live'), 4, false);
    expect(armedStillValid(armed, board('live', [], 4, 1), false)).toBe(false);
    expect(armedStillValid(armed, board('done'), false)).toBe(false);
    expect(armedStillValid(armed, board('title'), false)).toBe(false);
    expect(armedStillValid(armed, board('live'), true)).toBe(false);
    expect(armedStillValid(armed, board('live', [4]), false)).toBe(false);
    expect(armedStillValid(armed, null, false)).toBe(false);
    expect(armedStillValid(null, board('live'), false)).toBe(false);
    // Armed on the title card, then the question went up: disarmed (the presenter re-arms on purpose).
    expect(armedStillValid(armSpecial(board('title'), 4, false), board('live'), false)).toBe(false);
  });
});

describe('PRS-03: holds and the End show list', () => {
  it('holds for 0.8 s (reversible) and 1.2 s (End show)', () => {
    expect(HOLD_MS).toBe(800);
    expect(END_HOLD_MS).toBe(1200);
  });

  it('asks for a hold on Reveal remaining only while the clock still runs', () => {
    expect(sweepNeedsHold(true, false)).toBe(true);
    expect(sweepNeedsHold(false, false)).toBe(false);
    expect(sweepNeedsHold(true, true)).toBe(false);
    expect(sweepNeedsHold(false, true)).toBe(false);
  });

  it('lists the hidden answers with their text from the sheet', () => {
    const sheet = {
      round: 0,
      answers: Array.from({ length: 10 }, (_, i) => ({ text: `Answer ${i + 1}`, points: 0, aliases: [], revealed: false, guessed: 0 })),
    } as unknown as ShowdownSheet;
    const hidden = hiddenAnswers(board('live', [0, 1, 2, 3, 5, 6, 7, 8]), sheet);
    expect(hidden).toEqual([
      { n: 5, text: 'Answer 5', special: true },
      { n: 10, text: 'Answer 10', special: false },
    ]);
    // A sheet for another round never lends its words to this board.
    expect(hiddenAnswers(board('live', [0, 1, 2, 3, 5, 6, 7, 8], 4, 1), sheet).map((h) => h.text)).toEqual(['', '']);
    expect(hiddenAnswers(board('intro'), sheet)).toHaveLength(10);
    expect(hiddenAnswers({ ...board('intro'), round: -1 }, sheet)).toEqual([]);
    expect(hiddenAnswers(null, sheet)).toEqual([]);
  });
});

describe('PRS-03: the undo toast offers Undo only for its own step', () => {
  const offer = (atRev: number | null): UndoOffer => ({ id: 1, label: 'Round 1 restarted', detail: '', fromRev: 7, atRev });

  it('stays up at least 10 s', () => {
    expect(UNDO_TOAST_MS).toBeGreaterThanOrEqual(10_000);
  });

  it('waits for the command to land, then records the revision it produced', () => {
    expect(undoOfferStatus(offer(null), 7, 3)).toBe('pending');
    expect(undoOfferStatus(offer(null), 8, 4)).toBe('landed');
    // The board moved but there's nothing to undo: not ours.
    expect(undoOfferStatus(offer(null), 8, 0)).toBe('stale');
  });

  it('is ready while the server still holds exactly that step', () => {
    expect(undoOfferStatus(offer(8), 8, 4)).toBe('ready');
  });

  it('goes stale once anything else changed the board (another step, an Undo)', () => {
    expect(undoOfferStatus(offer(8), 9, 5)).toBe('stale');
    expect(undoOfferStatus(offer(8), 9, 3)).toBe('stale');
    expect(undoOfferStatus(offer(8), 8, 0)).toBe('stale');
  });
});

describe('keys', () => {
  const key = (code: string, k: string) => ({ code, key: k });

  it('reads number keys by position (AZERTY too), 0 = #10', () => {
    expect(digitSlot(key('Digit1', '1'))).toBe(0);
    expect(digitSlot(key('Digit5', '('))).toBe(4);
    expect(digitSlot(key('Digit0', 'à'))).toBe(9);
    expect(digitSlot(key('Numpad7', '7'))).toBe(6);
    expect(digitSlot(key('', '3'))).toBe(2);
    expect(digitSlot(key('KeyX', 'x'))).toBeNull();
  });

  it('knows Space, and ignores repeats and chords', () => {
    expect(isSpace(key('Space', ' '))).toBe(true);
    expect(isSpace(key('KeyS', 's'))).toBe(false);
    const base = { defaultPrevented: false, repeat: false, altKey: false, metaKey: false, ctrlKey: false };
    expect(ignoreKey(base)).toBe(false);
    expect(ignoreKey({ ...base, repeat: true })).toBe(true);
    expect(ignoreKey({ ...base, metaKey: true })).toBe(true);
    expect(ignoreKey({ ...base, ctrlKey: true })).toBe(true);
    expect(ignoreKey({ ...base, altKey: true })).toBe(true);
    expect(ignoreKey({ ...base, defaultPrevented: true })).toBe(true);
  });
});

describe('PRS-02: Space takes the armed special only where it can mean nothing else', () => {
  /** A focused element inside these containers (selectors it matches with closest()). */
  const el = (tagName: string, inside: string[] = []) => ({
    tagName,
    closest: (sel: string) => (sel.split(',').some((s) => inside.includes(s.trim())) ? {} : null),
  });
  const SHEET = '[data-part="showdown-sheet"]';
  const TAKE = '[data-part="showdown-take-special"]';
  const DISARM = '[data-part="showdown-disarm-special"]';

  it('takes with nothing focused, or with focus on the answer sheet', () => {
    expect(spaceOnArmed(null)).toBe('take');
    expect(spaceOnArmed(el('BODY'))).toBe('take');
    expect(spaceOnArmed(el('html'))).toBe('take');
    expect(spaceOnArmed(el('BUTTON', [SHEET]))).toBe('take');
  });

  it('leaves Space to the focused control everywhere else — Disarm and Take special included', () => {
    expect(spaceOnArmed(el('BUTTON', [DISARM]))).toBe('native');
    expect(spaceOnArmed(el('BUTTON', [TAKE]))).toBe('native');
    // Pause, a toggle, a drawer tab, the drawer's panel…
    expect(spaceOnArmed(el('BUTTON'))).toBe('native');
    expect(spaceOnArmed(el('INPUT'))).toBe('native');
    expect(spaceOnArmed(el('DIV'))).toBe('native');
  });
});
