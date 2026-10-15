import { describe, expect, it } from 'vitest';
import type { ShowdownBoardView, ShowdownEvent } from '@dascade/shared/games/showdown';
import { LOOK_COPY, idleLine, lineForCue, lineForEvent, lineForFinale } from './look.ts';

const board: ShowdownBoardView = {
  rev: 9,
  stage: 'live',
  round: 1,
  totalRounds: 4,
  multiplier: 2,
  prompt: 'Name a pizza topping.',
  slots: [{ revealed: true, text: 'Pepperoni', points: 39, by: 0, seq: 1, callers: 2 }, { revealed: false, by: -1, seq: 0, callers: 0 }],
  control: 0,
  strikes: 1,
  stealFailed: false,
  bank: 78,
  scores: [10, 20],
  roundWinner: -1,
  roundHow: '',
  results: [],
};

const EVENTS: ShowdownEvent[] = [
  { type: 'intro', rev: 1 },
  { type: 'round', rev: 2, round: 1, multiplier: 2 },
  { type: 'question', rev: 3 },
  { type: 'control', rev: 4, team: 1 },
  { type: 'reveal', rev: 5, slot: 0, text: 'Pepperoni', points: 39, top: true, late: false, callers: 2, cleared: false },
  { type: 'reveal', rev: 6, slot: 1, text: 'Olives', points: 5, top: false, late: false, callers: 0, cleared: false },
  { type: 'reveal', rev: 7, slot: 1, text: 'Olives', points: 5, top: false, late: true, callers: 0, cleared: true },
  { type: 'strike', rev: 8, strikes: 2, steal: false, stealFailed: false },
  { type: 'strike', rev: 9, strikes: 3, steal: true, stealFailed: false },
  ...(['sweep', 'steal', 'defend', 'manual', 'none'] as const).map((how, i): ShowdownEvent => ({ type: 'award', rev: 10 + i, team: 1, points: 78, how })),
  { type: 'undo', rev: 20 },
];

describe('host lines', () => {
  it('every event resolves to a finished line in both looks (no leftover {placeholders})', () => {
    for (const look of ['showtime', 'halloween'] as const) {
      for (const e of EVENTS) {
        const line = lineForEvent(e, { look, board, teamNames: ['Team Delta', 'Ghouls'] });
        expect(line, `${look} ${e.type}`).not.toBeNull();
        expect(line!.text, `${look} ${e.type}`).not.toMatch(/[{}]/);
        expect(line!.text.length).toBeGreaterThan(3);
      }
      expect(lineForEvent({ type: 'adjust', rev: 1, team: 0, delta: 5 }, { look, board, teamNames: ['A', 'B'] })).toBeNull();
      expect(lineForCue('drumroll', 3, look).text).not.toMatch(/[{}]/);
      expect(lineForFinale(look, 1, ['A', 'Ghouls']).text).toContain('Ghouls');
      expect(lineForFinale(look, -1, ['A', 'B']).text).toMatch(/tie/i);
      for (const stage of ['intro', 'title', 'live', 'steal', 'done'] as const) expect(idleLine(look, { ...board, stage }, ['A', 'B']).text).not.toMatch(/[{}]/);
    }
  });

  it('lines are the same on every screen (picked from the revision, not at random)', () => {
    const e: ShowdownEvent = { type: 'question', rev: 42 };
    const ctx = { look: 'showtime' as const, board, teamNames: ['A', 'B'] as [string, string] };
    expect(lineForEvent(e, ctx)).toEqual(lineForEvent(e, ctx));
  });

  it('the steal line names the other team', () => {
    const line = lineForEvent({ type: 'strike', rev: 9, strikes: 3, steal: true, stealFailed: false }, { look: 'showtime', board, teamNames: ['Delta', 'Sierra'] });
    expect(line!.text).toContain('Sierra');
  });

  it('both looks have six reactions', () => {
    expect(LOOK_COPY.showtime.reactions).toHaveLength(6);
    expect(LOOK_COPY.halloween.reactions).toHaveLength(6);
  });
});
