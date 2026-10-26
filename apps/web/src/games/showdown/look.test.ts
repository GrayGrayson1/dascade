import { describe, expect, it } from 'vitest';
import { SHOWDOWN_CARDS, type ShowdownBoardView, type ShowdownEvent } from '@dascade/shared/games/showdown';
import {
  HOST_MOODS,
  LOOK_COPY,
  cardLine,
  categoryLine,
  farewellLine,
  fill,
  idleLine,
  lineForCue,
  lineForEvent,
  lineForFinale,
  openingLine,
  clockWarnLine,
  landLine,
  pickEndLine,
  pickLine,
  showcaseBookKeys,
  showcaseBookLines,
} from './look.ts';

const board: ShowdownBoardView = {
  rev: 9,
  mode: 'classic',
  title: '',
  source: '',
  special: -1,
  stage: 'live',
  round: 1,
  totalRounds: 4,
  multiplier: 2,
  prompt: 'Name a pizza topping.',
  slots: [
    { revealed: true, text: 'Pepperoni', points: 39, by: 0, seq: 1, callers: 2, late: false },
    { revealed: false, by: -1, seq: 0, callers: 0, late: false },
  ],
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
  { type: 'round', rev: 2, round: 1, multiplier: 2, answers: 7 },
  { type: 'question', rev: 3 },
  { type: 'control', rev: 4, team: 1 },
  {
    type: 'reveal',
    rev: 5,
    slot: 0,
    text: 'Pepperoni',
    points: 39,
    top: true,
    late: false,
    callers: 2,
    cleared: false,
    special: false,
    sweep: false,
  },
  {
    type: 'reveal',
    rev: 6,
    slot: 1,
    text: 'Olives',
    points: 5,
    top: false,
    late: false,
    callers: 0,
    cleared: false,
    special: false,
    sweep: false,
  },
  {
    type: 'reveal',
    rev: 7,
    slot: 1,
    text: 'Olives',
    points: 5,
    top: false,
    late: true,
    callers: 0,
    cleared: true,
    special: false,
    sweep: false,
  },
  {
    type: 'reveal',
    rev: 8,
    slot: 4,
    text: 'The Time Warp',
    points: 0,
    top: false,
    late: true,
    callers: 0,
    cleared: false,
    special: true,
    sweep: true,
    note: 'Rocky Horror',
  },
  { type: 'strike', rev: 8, strikes: 2, steal: false, stealFailed: false },
  { type: 'strike', rev: 9, strikes: 3, steal: true, stealFailed: false },
  ...(['sweep', 'steal', 'defend', 'manual', 'none'] as const).map((how, i): ShowdownEvent => ({
    type: 'award',
    rev: 10 + i,
    team: 1,
    points: 78,
    how,
  })),
  { type: 'undo', rev: 20 },
  { type: 'miss', rev: 21, round: 0, n: 3 },
  { type: 'sweep', rev: 22, on: true },
  { type: 'suspense', rev: 23, slot: 4 },
  { type: 'timeup', rev: 24, round: 1 },
  { type: 'restart', rev: 25, round: 1 },
  { type: 'reset', rev: 26 },
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
      for (const stage of ['intro', 'title', 'live', 'steal', 'done'] as const)
        expect(idleLine(look, { ...board, stage }, ['A', 'B']).text).not.toMatch(/[{}]/);
    }
  });

  it('lines are the same on every screen (picked from the revision, not at random)', () => {
    const e: ShowdownEvent = { type: 'question', rev: 42 };
    const ctx = { look: 'showtime' as const, board, teamNames: ['A', 'B'] as [string, string] };
    expect(lineForEvent(e, ctx)).toEqual(lineForEvent(e, ctx));
  });

  it('a round line counts the new board from the event (the old board may still be showing)', () => {
    for (let rev = 0; rev < 6; rev++) {
      const line = lineForEvent(
        { type: 'round', rev, round: 2, multiplier: 1, answers: 7 },
        { look: 'showtime', board, teamNames: ['A', 'B'] },
      );
      expect(line!.text).not.toContain(`${board.slots.length} answers`);
      if (/answers/.test(line!.text)) expect(line!.text).toContain('7 answers');
    }
  });

  it('the steal line names the other team', () => {
    const line = lineForEvent(
      { type: 'strike', rev: 9, strikes: 3, steal: true, stealFailed: false },
      { look: 'showtime', board, teamNames: ['Delta', 'Sierra'] },
    );
    expect(line!.text).toContain('Sierra');
  });

  it('both looks have six reactions', () => {
    expect(LOOK_COPY.showtime.reactions).toHaveLength(6);
    expect(LOOK_COPY.halloween.reactions).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Presenter Showcase
// ---------------------------------------------------------------------------

const showcase: ShowdownBoardView = {
  ...board,
  mode: 'showcase',
  title: 'Halloween Songs',
  source: 'DAS-O-Ween Host Picks',
  special: 4,
  round: 0,
  totalRounds: 2,
  multiplier: 1,
  control: -1,
  strikes: 0,
  bank: 0,
  scores: [0, 0],
  slots: [
    { revealed: true, text: 'Sample Song', by: -1, seq: 1, callers: 0, late: false, note: 'Sample Artist' },
    { revealed: false, by: -1, seq: 0, callers: 0, late: false },
  ],
};
const looks = ['showtime', 'halloween'] as const;
const VARS = { show: 'DAS-O-Ween Trivia', event: 'Remoties Happy Hour', found: 7, total: 10, n: 10 };

describe('Presenter Showcase host lines', () => {
  it('every showcase event has a finished line in both looks', () => {
    for (const look of looks) {
      for (const e of EVENTS) {
        if (e.type === 'adjust' || e.type === 'control' || e.type === 'strike' || e.type === 'award') continue;
        const line = lineForEvent(e, { look, board: showcase, teamNames: ['A', 'B'], show: 'DAS-O-Ween Trivia' });
        expect(line, `${look} ${e.type}`).not.toBeNull();
        expect(line!.text, `${look} ${e.type}`).not.toMatch(/[{}]/);
        expect(HOST_MOODS).toContain(line!.mood);
      }
    }
  });

  it('the character moments: celebrate, shiver, peek, startled', () => {
    for (const look of looks) {
      const ctx = { look, board: showcase, teamNames: ['A', 'B'] as [string, string] };
      const special: ShowdownEvent = {
        type: 'reveal',
        rev: 3,
        slot: 4,
        text: 'The Time Warp',
        points: 0,
        top: false,
        late: false,
        callers: 0,
        cleared: false,
        special: true,
        sweep: false,
      };
      expect(lineForEvent(special, ctx)!.mood).toBe('celebrate');
      expect(lineForEvent(special, ctx)!.text).not.toMatch(/[{}]/);
      expect(lineForEvent({ type: 'miss', rev: 3, round: 0, n: 1 }, ctx)!.mood).toBe('shiver');
      expect(lineForEvent({ type: 'suspense', rev: 3, slot: 4 }, ctx)!.mood).toBe('peek');
      expect(lineForEvent({ type: 'timeup', rev: 3, round: 0 }, ctx)!.mood).toBe('startled');
      expect(lineForCue('celebrate', 2, look).mood).toBe('celebrate');
    }
  });

  it('wrong answers never repeat a line back-to-back, and each miss is its own moment', () => {
    for (const look of looks) {
      const ctx = { look, board: showcase, teamNames: ['A', 'B'] as [string, string] };
      for (const round of [0, 1]) {
        let prev = '';
        const keys = new Set<string>();
        for (let n = 1; n <= 25; n++) {
          const line = lineForEvent({ type: 'miss', rev: 9, round, n }, ctx)!;
          expect(line.text, `${look} miss ${n}`).not.toBe(prev);
          prev = line.text;
          keys.add(line.key);
        }
        expect(keys.size).toBe(25);
      }
    }
  });

  it('a round line names the category only when the board in hand is that round', () => {
    const round: ShowdownEvent = { type: 'round', rev: 5, round: 1, multiplier: 1, answers: 10 };
    for (const look of looks) {
      // The event arrives before the new board: round 1's title must not be announced for round 2.
      const stale = lineForEvent(round, { look, board: showcase, teamNames: ['A', 'B'] })!;
      expect(stale.text).not.toContain('Halloween Songs');
      const fresh = lineForEvent(round, { look, board: { ...showcase, round: 1, title: 'Halloween Movies' }, teamNames: ['A', 'B'] })!;
      expect(fresh.text).toContain('Halloween Movies');
      expect(categoryLine(look, { ...showcase, round: 1, title: 'Halloween Movies' }).text).toContain('Halloween Movies');
      expect(categoryLine(look, { ...showcase, title: '' }).text).not.toMatch(/[{}]/);
    }
  });

  it('the opening, cards and farewell lines are finished in both looks', () => {
    for (const look of looks) {
      expect(openingLine(look, 'DAS-O-Ween Trivia').text).toContain('DAS-O-Ween Trivia');
      expect(
        lineForEvent({ type: 'intro', rev: 1 }, { look, board: null, teamNames: ['A', 'B'], mode: 'showcase', show: 'Spooky Quiz' })!.text,
      ).toContain('Spooky Quiz');
      for (const card of SHOWDOWN_CARDS) {
        const line = cardLine(look, card);
        expect(line.text.length, `${look} ${card}`).toBeGreaterThan(3);
        expect(line.text).not.toMatch(/[{}]/);
      }
      expect(cardLine(look, 'thanks').mood).toBe('bye');
      const bye = farewellLine(look, { results: [{ index: 0, winner: -1, points: 0, how: 'none', found: 7, total: 10 }] });
      expect(bye.mood).toBe('bye');
      expect(bye.text).not.toMatch(/[{}]/);
      for (const stage of ['intro', 'title', 'live', 'done'] as const)
        expect(idleLine(look, { ...showcase, stage }, ['A', 'B'], 'Show').text).not.toMatch(/[{}]/);
    }
  });

  it('every showcase line and stage copy fills without leftover placeholders', () => {
    const lineVars = { ...VARS, title: 'Halloween Songs', k: 10, answer: 'Sample Song', rank: 1, name: 'Priya S.' };
    for (const look of looks) {
      for (const text of showcaseBookLines(look)) expect(fill(text, lineVars), `${look}: ${text}`).not.toMatch(/[{}]/);
      for (const text of Object.values(LOOK_COPY[look].showcase)) expect(fill(text, VARS), `${look}: ${text}`).not.toMatch(/[{}]/);
      for (const card of SHOWDOWN_CARDS) {
        const c = LOOK_COPY[look].cards[card];
        for (const text of [c.kicker, c.title, c.sub]) expect(fill(text, VARS), `${look} ${card}`).not.toMatch(/[{}]/);
        expect(c.kicker || c.title || c.sub).toBeTruthy();
      }
    }
  });

  it('both looks carry the same showcase copy keys', () => {
    expect(Object.keys(LOOK_COPY.halloween.showcase).sort()).toEqual(Object.keys(LOOK_COPY.showtime.showcase).sort());
    expect(showcaseBookKeys('halloween')).toEqual(showcaseBookKeys('showtime'));
    for (const key of ['pick', 'reroll', 'land', 'done', 'doneAnon', 'noAnswer', 'oneMinute'])
      expect(showcaseBookKeys('halloween')).toContain(key);
    expect(Object.keys(LOOK_COPY.halloween.cards).sort()).toEqual([...SHOWDOWN_CARDS].sort());
    expect(Object.keys(LOOK_COPY.showtime.cards).sort()).toEqual([...SHOWDOWN_CARDS].sort());
  });
});

// ---------------------------------------------------------------------------
// The pick (Spotlight picker, hot seat) and the clock cues
// ---------------------------------------------------------------------------

const PICK_EVENTS: ShowdownEvent[] = [
  { type: 'pick', rev: 30, drawNo: 3, winnerId: 'p1', name: 'Priya S.', poolSize: 12, landAt: 1, reroll: false },
  { type: 'pick', rev: 31, drawNo: 4, winnerId: 'p2', name: 'Sam 2', poolSize: 11, landAt: 1, reroll: true },
  { type: 'pickEnd', rev: 32, drawNo: 3, playerId: 'p1', how: 'done' },
  { type: 'pickEnd', rev: 33, drawNo: 4, playerId: 'p2', how: 'noAnswer' },
  { type: 'clockWarn', rev: 34, round: 0 },
];
const NAMES: Record<string, string> = { p1: 'Priya S.', p2: 'Sam 2' };
const nameOf = (id: string) => NAMES[id] ?? '';

describe('Boo’s lines for picks (both looks, both formats)', () => {
  it('every pick event and the 1:00 warning has a finished line in both looks', () => {
    for (const look of looks) {
      for (const b of [showcase, board]) {
        for (const e of PICK_EVENTS) {
          const line = lineForEvent(e, { look, board: b, teamNames: ['A', 'B'], nameOf });
          expect(line, `${look} ${b.mode} ${e.type}`).not.toBeNull();
          expect(line!.text, `${look} ${e.type}`).not.toMatch(/[{}]/);
          expect(line!.text.length).toBeGreaterThan(3);
          expect(HOST_MOODS).toContain(line!.mood);
        }
      }
    }
  });

  it('the search never says who was picked (the stage hasn’t landed yet)', () => {
    for (const look of looks) {
      for (let drawNo = 0; drawNo < 12; drawNo++) {
        for (const reroll of [false, true]) {
          const e: ShowdownEvent = { type: 'pick', rev: 1, drawNo, winnerId: 'p1', name: 'Priya S.', poolSize: 5, landAt: 1, reroll };
          const line = lineForEvent(e, { look, board: showcase, teamNames: ['A', 'B'], nameOf })!;
          expect(line.text).not.toContain('Priya');
          expect(line.key).toBe(`pick:${drawNo}`);
          expect(line.mood).toBe('peek');
          expect(pickLine(look, { drawNo, reroll })).toEqual(line);
        }
      }
    }
  });

  it('the landing calls them up by name; done thanks them by name', () => {
    for (const look of looks) {
      for (let drawNo = 0; drawNo < 6; drawNo++) {
        expect(landLine(look, drawNo, 'Priya S.').text).toContain('Priya S.');
        expect(landLine(look, drawNo, 'Priya S.').key).toBe(`land:${drawNo}`);
        const done = lineForEvent(
          { type: 'pickEnd', rev: 1, drawNo, playerId: 'p1', how: 'done' },
          { look, board: showcase, teamNames: ['A', 'B'], nameOf },
        )!;
        expect(done.text).toContain('Priya S.');
      }
    }
  });

  it('without a name (a feed that doesn’t know players) the lines still read well', () => {
    for (const look of looks) {
      for (let drawNo = 0; drawNo < 6; drawNo++) {
        const done = lineForEvent(
          { type: 'pickEnd', rev: 1, drawNo, playerId: 'p9', how: 'done' },
          { look, board: showcase, teamNames: ['A', 'B'] },
        )!;
        expect(done.text).not.toMatch(/[{}]|,\s*!|^\s/);
        expect(landLine(look, drawNo, '').text).not.toMatch(/[{}]/);
      }
    }
  });

  it('a reroll’s end and a hidden guest leave quietly; ticks and the sound station are silent', () => {
    for (const look of looks) {
      const ctx = { look, board: showcase, teamNames: ['A', 'B'] as [string, string], nameOf };
      expect(lineForEvent({ type: 'pickEnd', rev: 1, drawNo: 2, playerId: 'p1', how: 'reroll' }, ctx)).toBeNull();
      expect(lineForEvent({ type: 'pickEnd', rev: 1, drawNo: 2, playerId: 'p1', how: 'cleared' }, ctx)).toBeNull();
      expect(pickEndLine(look, { drawNo: 2, how: 'cleared' }, 'Priya S.')).toBeNull();
      for (let n = 10; n >= 1; n--) expect(lineForEvent({ type: 'tick', rev: 1, round: 0, n }, ctx)).toBeNull();
      expect(lineForEvent({ type: 'station', rev: 1, playerId: '', lost: true }, ctx)).toBeNull();
    }
  });

  it('the 1:00 warning is keyed per round and the same on every screen', () => {
    for (const look of looks) {
      expect(clockWarnLine(look, 0).key).toBe('clockWarn:0');
      expect(clockWarnLine(look, 1).key).toBe('clockWarn:1');
      expect(clockWarnLine(look, 1)).toEqual(clockWarnLine(look, 1));
    }
  });

  it('spooky-cute, never scary: no gore words in the pick lines', () => {
    for (const look of looks) {
      for (const text of showcaseBookLines(look)) expect(text).not.toMatch(/\b(blood|kill|dead|die|death|gore|murder)\b/i);
    }
  });
});
