/**
 * Presenter Showcase (mode 'showcase'): one board for a crowd, no teams and no scores — reveals just
 * flip, the special answer is flagged, a sweep's reveals are "late", restart/reset are undoable steps
 * (pure states), team commands are refused, and the public board still never carries a hidden answer.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import type { ShowdownRoundDef } from '@dascade/shared/games/showdown';
import {
  boardView,
  createShow,
  finalizeShow,
  nextSweepSlot,
  sheetView,
  showWinner,
  specialSlot,
  step,
  type ShowCommand,
  type ShowState,
} from './engine.ts';

const top = (id: string, n: number, special?: number): ShowdownRoundDef => ({
  id,
  prompt: `Name the top ${n} ${id}.`,
  title: `${id} title`,
  source: 'Host Picks',
  ranked: true,
  ...(special === undefined ? {} : { special }),
  answers: Array.from({ length: n }, (_, i) => ({ text: `${id}-answer-${i + 1}`, points: 0, aliases: [], note: `${id}-note-${i + 1}` })),
});

const SONGS = top('songs', 10, 4);
const MOVIES = top('movies', 10, 4);

function show(rounds = [SONGS, MOVIES]): ShowState {
  return createShow(rounds, { scoring: 'rising', steal: true, mode: 'showcase' });
}

function run(state: ShowState, ...cmds: ShowCommand[]): ShowState {
  let s = state;
  for (const cmd of cmds) {
    const r = step(s, cmd);
    if (!r.ok) throw new Error(`${cmd.a} failed: ${r.message}`);
    s = r.state;
  }
  return s;
}

const live = (s = show()) => run(s, { a: 'begin' }, { a: 'question' });

describe('Presenter Showcase', () => {
  it('has no steals, no multipliers and no winner', () => {
    const s = show();
    expect(s.mode).toBe('showcase');
    expect(s.steal).toBe(false);
    expect(s.rounds.map((r) => r.multiplier)).toEqual([1, 1]);
    expect(showWinner(s)).toBe(-1);
  });

  it('refuses team and score commands', () => {
    const s = live();
    for (const cmd of [
      { a: 'control', team: 0 },
      { a: 'strike' },
      { a: 'award', team: 1 },
      { a: 'adjust', team: 0, delta: 5 },
    ] as ShowCommand[]) {
      expect(step(s, cmd)).toMatchObject({ ok: false, code: 'not_allowed' });
    }
  });

  it('a reveal flips a tile, banks nothing and flags the special answer', () => {
    let s = live();
    let r = step(s, { a: 'reveal', slot: 2 });
    expect(r.ok && r.events).toEqual([
      expect.objectContaining({ type: 'reveal', slot: 2, special: false, late: false, sweep: false, note: 'songs-note-3' }),
    ]);
    s = r.ok ? r.state : s;
    expect(s.bank).toBe(0);
    expect(s.scores).toEqual([0, 0]);
    expect(s.slots[2]).toEqual({ revealed: true, by: -1, seq: 1, late: false });
    r = step(s, { a: 'reveal', slot: 4 });
    expect(r.ok && r.events[0]).toMatchObject({ type: 'reveal', slot: 4, special: true });
  });

  it('the public board shows the special position and attribution, never a hidden answer or note', () => {
    const s = run(live(), { a: 'reveal', slot: 0 });
    const view = boardView(s);
    expect(view).toMatchObject({
      mode: 'showcase',
      special: 4,
      title: 'songs title',
      source: 'Host Picks',
      prompt: 'Name the top 10 songs.',
    });
    expect(view.slots[0]).toMatchObject({ revealed: true, text: 'songs-answer-1', note: 'songs-note-1' });
    const json = JSON.stringify(view);
    for (let i = 2; i <= 10; i++) {
      expect(json).not.toContain(`songs-answer-${i}"`);
      expect(json).not.toContain(`songs-note-${i}"`);
    }
    expect(json).not.toContain('movies-');
    // The title card already names the round but keeps the question (and the attribution) back.
    const title = boardView(run(show(), { a: 'begin' }));
    expect(title).toMatchObject({ stage: 'title', title: 'songs title', prompt: '', source: '' });
  });

  it('the whole board up ends the round, counting what the crowd found', () => {
    let s = live();
    for (let i = 0; i < 7; i++) s = run(s, { a: 'reveal', slot: i });
    for (let i = 7; i < 10; i++) s = run(s, { a: 'reveal', slot: i, late: true, sweep: true });
    expect(s.stage).toBe('done');
    expect(s.results).toEqual([{ index: 0, winner: -1, points: 0, how: 'none', found: 7, total: 10 }]);
    expect(boardView(s).slots.filter((x) => x.late)).toHaveLength(3);
    // A clean board (everything found) is a sweep.
    let clean = live();
    for (let i = 0; i < 10; i++) clean = run(clean, { a: 'reveal', slot: i });
    expect(clean.results[0]).toMatchObject({ how: 'sweep', found: 10, total: 10 });
  });

  it('moving on from a round records how many were found', () => {
    const s = run(live(), { a: 'reveal', slot: 1 }, { a: 'reveal', slot: 4 }, { a: 'next' });
    expect(s.round).toBe(1);
    expect(s.stage).toBe('title');
    expect(s.results).toEqual([{ index: 0, winner: -1, points: 0, how: 'none', found: 2, total: 10 }]);
    const done = step(run(s, { a: 'question' }), { a: 'next' });
    expect(done.ok && done.finished).toBe(true);
    const final = finalizeShow(run(live(), { a: 'reveal', slot: 3 }));
    expect(final.results).toEqual([{ index: 0, winner: -1, points: 0, how: 'none', found: 1, total: 10 }]);
  });

  it('the sweep order runs from the bottom of the board up and skips what is showing', () => {
    let s = run(live(), { a: 'reveal', slot: 9 }, { a: 'reveal', slot: 7 });
    const order: number[] = [];
    for (let slot = nextSweepSlot(s); slot >= 0; slot = nextSweepSlot(s)) {
      order.push(slot);
      s = run(s, { a: 'reveal', slot, late: true, sweep: true });
    }
    expect(order).toEqual([8, 6, 5, 4, 3, 2, 1, 0]);
    expect(nextSweepSlot(s)).toBe(-1);
  });

  it('restart puts the round back on its title card, and undo (the previous state) still holds', () => {
    const before = run(live(), { a: 'reveal', slot: 0 }, { a: 'reveal', slot: 1 });
    const r = step(before, { a: 'restart' });
    expect(r.ok && r.events).toEqual([{ type: 'restart', rev: before.rev + 1, round: 0 }]);
    const s = r.ok ? r.state : before;
    expect(s.stage).toBe('title');
    expect(s.slots.every((x) => !x.revealed)).toBe(true);
    expect(s.rev).toBeGreaterThan(before.rev);
    expect(before.slots[0]!.revealed).toBe(true);
    // A round restarted after it was complete forgets its result.
    let full = live();
    for (let i = 0; i < 10; i++) full = run(full, { a: 'reveal', slot: i });
    expect(run(full, { a: 'restart' }).results).toEqual([]);
  });

  it('reset goes back to the opening with the revision still rising', () => {
    const before = run(live(), { a: 'reveal', slot: 0 }, { a: 'next' }, { a: 'question' });
    const s = run(before, { a: 'reset' });
    expect(s).toMatchObject({ stage: 'intro', round: -1, results: [], past: [] });
    expect(s.rev).toBe(before.rev + 1);
    expect(s.rounds).toEqual(before.rounds);
    expect(step(s, { a: 'reset' })).toMatchObject({ ok: false, code: 'noop' });
  });

  it('restart and reset belong to the showcase only', () => {
    const classic = run(createShow([SONGS], { scoring: 'flat', steal: true }), { a: 'begin' });
    expect(step(classic, { a: 'restart' })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(step(classic, { a: 'reset' })).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('the sheet carries the special slot, the ranking and every note', () => {
    const sheet = sheetView(live());
    expect(sheet).toMatchObject({ special: 4, ranked: true, title: 'songs title', source: 'Host Picks' });
    expect(sheet.answers[4]).toMatchObject({ text: 'songs-answer-5', note: 'songs-note-5', revealed: false });
    expect(sheet.rundown.map((r) => [r.special, r.ranked])).toEqual([
      [4, true],
      [4, true],
    ]);
  });

  it('specialSlot ignores a position that is not on the board', () => {
    expect(specialSlot({ special: 4, answers: SONGS.answers })).toBe(4);
    expect(specialSlot({ special: 10, answers: SONGS.answers })).toBe(-1);
    expect(specialSlot({ answers: SONGS.answers })).toBe(-1);
    expect(specialSlot(null)).toBe(-1);
  });

  it('a random playout never puts a hidden answer or note on the public board', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createSeededRng(seed);
      let s = show();
      for (let i = 0; i < 90; i++) {
        const cmds: ShowCommand[] = [
          { a: 'begin' },
          { a: 'question' },
          { a: 'reveal', slot: rng.int(11) },
          { a: 'reveal', slot: nextSweepSlot(s), late: true, sweep: true },
          { a: 'restart' },
          { a: 'next' },
          ...(rng.int(20) === 0 ? ([{ a: 'reset' }] as ShowCommand[]) : []),
        ];
        const r = step(s, cmds[rng.int(cmds.length)]!);
        if (r.ok && !r.finished) s = r.state;
        const json = JSON.stringify(boardView(s));
        const round = s.rounds[s.round];
        if (!round) continue;
        round.answers.forEach((a, idx) => {
          expect(json.includes(`"${a.text}"`)).toBe(s.slots[idx]!.revealed);
          expect(json.includes(`"${a.note}"`)).toBe(s.slots[idx]!.revealed);
        });
        expect(s.scores).toEqual([0, 0]);
        expect(new Set(s.results.map((x) => x.index)).size).toBe(s.results.length);
      }
    }
  });
});
