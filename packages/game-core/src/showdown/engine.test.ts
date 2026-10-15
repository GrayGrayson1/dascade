import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { roundMultipliers, type ShowdownRoundDef } from '@dascade/shared/games/showdown';
import { boardView, createShow, finalizeShow, revealedIn, sheetView, showWinner, step, type ShowCommand, type ShowState } from './engine.ts';

const round = (id: string, points: number[]): ShowdownRoundDef => ({
  id,
  prompt: `Question ${id}?`,
  answers: points.map((p, i) => ({ text: `${id}-answer-${i + 1}`, points: p, aliases: [`${id}-alias-${i + 1}`] })),
});

const R1 = round('r1', [40, 30, 20, 10]);
const R2 = round('r2', [50, 25, 15]);
const R3 = round('r3', [35, 25, 20, 10, 5]);

function show(rounds = [R1, R2, R3], opts: { scoring?: 'flat' | 'final-double' | 'rising'; steal?: boolean } = {}): ShowState {
  return createShow(rounds, { scoring: opts.scoring ?? 'flat', steal: opts.steal ?? true });
}

/** Applies commands that must all succeed. */
function run(state: ShowState, ...cmds: ShowCommand[]): ShowState {
  let s = state;
  for (const cmd of cmds) {
    const r = step(s, cmd);
    if (!r.ok) throw new Error(`${cmd.a} failed: ${r.message}`);
    s = r.state;
  }
  return s;
}

const live = (s: ShowState, team: 0 | 1 = 0) => run(s, { a: 'begin' }, { a: 'question' }, { a: 'control', team });

describe('createShow', () => {
  it('starts at the intro with multipliers from the scoring rule', () => {
    const s = show([R1, R2, R3], { scoring: 'rising' });
    expect(s.stage).toBe('intro');
    expect(s.round).toBe(-1);
    expect(s.rounds.map((r) => r.multiplier)).toEqual([1, 2, 3]);
    expect(s.scores).toEqual([0, 0]);
  });

  it('copies the rounds (later edits to the input cannot change the show)', () => {
    const input = [round('x', [10, 9, 8])];
    const s = createShow(input, { scoring: 'flat', steal: true });
    input[0]!.answers[0]!.text = 'changed';
    input[0]!.answers[0]!.aliases.push('changed');
    expect(s.rounds[0]!.answers[0]!.text).toBe('x-answer-1');
    expect(s.rounds[0]!.answers[0]!.aliases).toEqual(['x-alias-1']);
  });
});

describe('roundMultipliers', () => {
  it('covers every scoring rule and size', () => {
    expect(roundMultipliers(0, 'rising')).toEqual([]);
    expect(roundMultipliers(1, 'final-double')).toEqual([1]);
    expect(roundMultipliers(2, 'final-double')).toEqual([1, 2]);
    expect(roundMultipliers(4, 'final-double')).toEqual([1, 1, 1, 2]);
    expect(roundMultipliers(1, 'rising')).toEqual([1]);
    expect(roundMultipliers(2, 'rising')).toEqual([1, 2]);
    expect(roundMultipliers(5, 'rising')).toEqual([1, 1, 1, 2, 3]);
    expect(roundMultipliers(3, 'flat')).toEqual([1, 1, 1]);
  });
});

describe('round flow', () => {
  it('begin → title (question hidden) → question → live', () => {
    let s = run(show(), { a: 'begin' });
    expect(s.stage).toBe('title');
    expect(s.round).toBe(0);
    expect(s.slots).toHaveLength(4);
    expect(boardView(s).prompt).toBe('');
    s = run(s, { a: 'question' });
    expect(s.stage).toBe('live');
    expect(boardView(s).prompt).toBe('Question r1?');
  });

  it('refuses commands that do not fit the stage', () => {
    const intro = show();
    expect(step(intro, { a: 'question' })).toMatchObject({ ok: false, code: 'wrong_stage' });
    expect(step(intro, { a: 'reveal', slot: 0 })).toMatchObject({ ok: false, code: 'wrong_stage' });
    expect(step(intro, { a: 'strike' })).toMatchObject({ ok: false, code: 'wrong_stage' });
    expect(step(intro, { a: 'award', team: 0 })).toMatchObject({ ok: false, code: 'wrong_stage' });
    const title = run(intro, { a: 'begin' });
    expect(step(title, { a: 'begin' })).toMatchObject({ ok: false, code: 'noop' });
    expect(step(title, { a: 'control', team: 0 })).toMatchObject({ ok: false, code: 'wrong_stage' });
    expect(step(title, { a: 'strike' })).toMatchObject({ ok: false, code: 'wrong_stage' });
    const l = run(title, { a: 'question' });
    expect(step(l, { a: 'question' })).toMatchObject({ ok: false, code: 'noop' });
    expect(step(l, { a: 'strike' })).toMatchObject({ ok: false, code: 'not_allowed' }); // no team in control yet
    expect(step(l, { a: 'reveal', slot: 9 })).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(step(l, { a: 'reveal', slot: -1 })).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('a failed command never changes the state', () => {
    const s = run(show(), { a: 'begin' });
    const before = JSON.stringify(s);
    step(s, { a: 'strike' });
    step(s, { a: 'award', team: 1 });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('every applied command bumps the revision', () => {
    let s = show();
    let rev = s.rev;
    for (const cmd of [{ a: 'begin' }, { a: 'question' }, { a: 'control', team: 1 }, { a: 'reveal', slot: 2 }, { a: 'strike' }] as ShowCommand[]) {
      const r = step(s, cmd);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.state.rev).toBeGreaterThan(rev);
      for (const e of r.events) expect(e.rev).toBeLessThanOrEqual(r.state.rev);
      rev = r.state.rev;
      s = r.state;
    }
  });

  it('revealing during the title card shows the question first (one click)', () => {
    const s = run(show(), { a: 'begin' });
    const r = step(s, { a: 'reveal', slot: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.stage).toBe('live');
    expect(r.events.map((e) => e.type)).toEqual(['question', 'reveal']);
  });
});

describe('reveals and the bank', () => {
  it('banks points × multiplier for the team in control', () => {
    const s = run(live(show([R1, R2], { scoring: 'final-double' })), { a: 'reveal', slot: 1 }, { a: 'next' }, { a: 'question' }, { a: 'control', team: 1 });
    expect(s.round).toBe(1);
    const r = step(s, { a: 'reveal', slot: 0 });
    expect(r.ok && r.state.bank).toBe(100); // 50 × 2
    expect(r.ok && r.state.slots[0]).toMatchObject({ revealed: true, by: 1 });
  });

  it('is idempotent: revealing a showing answer is a no-op', () => {
    const s = run(live(show()), { a: 'reveal', slot: 0 });
    expect(step(s, { a: 'reveal', slot: 0 })).toMatchObject({ ok: false, code: 'noop' });
    expect(s.bank).toBe(40);
  });

  it('face-off reveals before control bank points for whoever wins the round', () => {
    let s = run(show(), { a: 'begin' }, { a: 'question' }, { a: 'reveal', slot: 0 });
    expect(s.slots[0]!.by).toBe(-1);
    expect(s.bank).toBe(40);
    s = run(s, { a: 'control', team: 1 }, { a: 'reveal', slot: 1 }, { a: 'reveal', slot: 2 }, { a: 'reveal', slot: 3 });
    expect(s.stage).toBe('done');
    expect(s.scores).toEqual([0, 100]);
    expect(s.roundHow).toBe('sweep');
  });

  it('a clean sweep wins the bank and reports cleared', () => {
    let s = live(show());
    s = run(s, { a: 'reveal', slot: 0 }, { a: 'reveal', slot: 1 }, { a: 'reveal', slot: 2 });
    const r = step(s, { a: 'reveal', slot: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.map((e) => e.type)).toEqual(['reveal', 'award']);
    expect(r.events[0]).toMatchObject({ cleared: true, late: false });
    expect(r.events[1]).toMatchObject({ team: 0, points: 100, how: 'sweep' });
    expect(r.state).toMatchObject({ stage: 'done', bank: 0, roundWinner: 0, roundHow: 'sweep', scores: [100, 0] });
    expect(r.state.results).toEqual([{ index: 0, winner: 0, points: 100, how: 'sweep' }]);
  });

  it('a board cleared before anyone had control waits for a manual award', () => {
    let s = run(show(), { a: 'begin' }, { a: 'question' });
    s = run(s, { a: 'reveal', slot: 0 }, { a: 'reveal', slot: 1 }, { a: 'reveal', slot: 2 }, { a: 'reveal', slot: 3 });
    expect(s).toMatchObject({ stage: 'done', roundHow: '', bank: 100 });
    s = run(s, { a: 'award', team: 0 });
    expect(s).toMatchObject({ scores: [100, 0], roundHow: 'manual', bank: 0 });
  });

  it('late reveals after the round is decided move no points', () => {
    let s = run(live(show()), { a: 'reveal', slot: 0 }, { a: 'award', team: 0 });
    expect(s.scores).toEqual([40, 0]);
    const r = step(s, { a: 'reveal', slot: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toEqual([expect.objectContaining({ type: 'reveal', late: true, cleared: false })]);
    expect(r.state.slots[3]).toMatchObject({ revealed: true, by: -1 });
    s = run(r.state, { a: 'reveal', slot: 1 });
    const last = step(s, { a: 'reveal', slot: 2 });
    expect(last.ok && last.events[0]).toMatchObject({ late: true, cleared: true });
    expect(last.ok && last.state.scores).toEqual([40, 0]);
  });

  it('reveal order is recorded so screens can stagger a sweep', () => {
    const s = run(live(show()), { a: 'reveal', slot: 2 }, { a: 'reveal', slot: 0 });
    expect(s.slots[2]!.seq).toBe(1);
    expect(s.slots[0]!.seq).toBe(2);
    expect(s.slots[1]!.seq).toBe(0);
  });
});

describe('strikes and steals', () => {
  it('three strikes open a steal for the other team', () => {
    let s = run(live(show(), 0), { a: 'reveal', slot: 1 }, { a: 'strike' }, { a: 'strike' });
    expect(s).toMatchObject({ strikes: 2, stage: 'live' });
    const r = step(s, { a: 'strike' });
    expect(r.ok && r.events).toEqual([expect.objectContaining({ type: 'strike', strikes: 3, steal: true })]);
    s = r.ok ? r.state : s;
    expect(s.stage).toBe('steal');
    expect(step(s, { a: 'control', team: 1 })).toMatchObject({ ok: false, code: 'wrong_stage' });
  });

  it('a reveal during the steal steals the whole bank', () => {
    let s = run(live(show(), 0), { a: 'reveal', slot: 1 }, { a: 'strike' }, { a: 'strike' }, { a: 'strike' });
    const r = step(s, { a: 'reveal', slot: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.slots[3]).toMatchObject({ revealed: true, by: 1 });
    expect(s).toMatchObject({ stage: 'done', scores: [0, 40], roundWinner: 1, roundHow: 'steal' });
    expect(r.events.at(-1)).toMatchObject({ type: 'award', team: 1, points: 40, how: 'steal' });
  });

  it('a missed steal keeps the bank with the team in control', () => {
    const s = run(live(show(), 1), { a: 'reveal', slot: 0 }, { a: 'strike' }, { a: 'strike' }, { a: 'strike' });
    const r = step(s, { a: 'strike' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.map((e) => e.type)).toEqual(['strike', 'award']);
    expect(r.events[0]).toMatchObject({ stealFailed: true });
    expect(r.state).toMatchObject({ stage: 'done', scores: [0, 40], roundHow: 'defend', stealFailed: true });
  });

  it('with steals off, three strikes lose the bank', () => {
    const s = run(live(show([R1], { steal: false }), 0), { a: 'reveal', slot: 0 }, { a: 'strike' }, { a: 'strike' });
    const r = step(s, { a: 'strike' });
    expect(r.ok && r.state).toMatchObject({ stage: 'done', scores: [0, 0], roundHow: 'none', bank: 0 });
  });

  it('changing control resets strikes', () => {
    const s = run(live(show(), 0), { a: 'strike' }, { a: 'strike' }, { a: 'control', team: 1 });
    expect(s).toMatchObject({ control: 1, strikes: 0 });
    expect(step(s, { a: 'control', team: 1 })).toMatchObject({ ok: false, code: 'noop' });
  });

  it('no strikes after the round is decided', () => {
    const s = run(live(show()), { a: 'reveal', slot: 0 }, { a: 'award', team: 0 });
    expect(step(s, { a: 'strike' })).toMatchObject({ ok: false, code: 'wrong_stage' });
  });
});

describe('awards, adjustments and rounds', () => {
  it('manual award moves the bank once', () => {
    const s = run(live(show()), { a: 'reveal', slot: 0 }, { a: 'reveal', slot: 2 }, { a: 'award', team: 1 });
    expect(s).toMatchObject({ scores: [0, 60], roundHow: 'manual', stage: 'done' });
    expect(step(s, { a: 'award', team: 0 })).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('refuses to award an empty bank', () => {
    expect(step(live(show()), { a: 'award', team: 0 })).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('adjusts scores within bounds', () => {
    let s = run(show(), { a: 'adjust', team: 0, delta: 25 }, { a: 'adjust', team: 1, delta: -10 });
    expect(s.scores).toEqual([25, -10]);
    expect(step(s, { a: 'adjust', team: 0, delta: 0 })).toMatchObject({ ok: false, code: 'noop' });
    expect(step(s, { a: 'adjust', team: 0, delta: 501 })).toMatchObject({ ok: false });
    for (let i = 0; i < 300; i++) s = run(s, { a: 'adjust', team: 0, delta: 500 });
    expect(s.scores[0]).toBe(99_999);
  });

  it('next skips an undecided round (its bank is lost) and records it', () => {
    const s = run(live(show()), { a: 'reveal', slot: 0 }, { a: 'next' });
    expect(s).toMatchObject({ round: 1, stage: 'title', bank: 0, control: -1, strikes: 0, scores: [0, 0] });
    expect(s.results).toEqual([{ index: 0, winner: -1, points: 0, how: 'none' }]);
    expect(revealedIn(s, 0)).toEqual([true, false, false, false]);
  });

  it('next in the intro starts round 1', () => {
    expect(run(show(), { a: 'next' })).toMatchObject({ round: 0, stage: 'title' });
  });

  it('next on the last round finishes the show', () => {
    let s = run(live(show([R1, R2])), { a: 'reveal', slot: 0 }, { a: 'award', team: 0 }, { a: 'next' }, { a: 'question' });
    const r = step(s, { a: 'next' });
    expect(r.ok && r.finished).toBe(true);
    s = r.ok ? r.state : s;
    expect(s.results.map((x) => x.how)).toEqual(['manual', 'none']);
  });

  it('finalizeShow closes an open round once and the winner follows the scores', () => {
    const s = run(live(show()), { a: 'reveal', slot: 1 });
    const f = finalizeShow(s);
    expect(f.results).toEqual([{ index: 0, winner: -1, points: 0, how: 'none' }]);
    expect(finalizeShow(f).results).toHaveLength(1);
    expect(showWinner({ scores: [10, 5] })).toBe(0);
    expect(showWinner({ scores: [10, 50] })).toBe(1);
    expect(showWinner({ scores: [7, 7] })).toBe(-1);
    expect(finalizeShow(show()).results).toEqual([]);
  });
});

describe('views never leak hidden answers', () => {
  it('the public board carries no text or points for hidden slots', () => {
    const s = run(live(show()), { a: 'reveal', slot: 1 });
    const view = boardView(s, [3, 2, 1, 0]);
    const json = JSON.stringify(view);
    for (const hidden of ['r1-answer-1', 'r1-answer-3', 'r1-answer-4', 'r1-alias', 'r2-', 'r3-']) expect(json).not.toContain(hidden);
    expect(view.slots[0]).toEqual({ revealed: false, by: -1, seq: 0, callers: 0 });
    expect(view.slots[1]).toEqual({ revealed: true, text: 'r1-answer-2', points: 30, by: 0, seq: 1, callers: 2 });
    // Aliases are never public, even for revealed answers.
    expect(json).not.toContain('alias');
  });

  it('a random playout never puts a hidden answer on the board', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createSeededRng(seed);
      let s = show([R1, R2, R3], { scoring: 'rising', steal: seed % 2 === 0 });
      for (let i = 0; i < 80; i++) {
        const cmds: ShowCommand[] = [
          { a: 'begin' },
          { a: 'question' },
          { a: 'control', team: rng.int(2) as 0 | 1 },
          { a: 'reveal', slot: rng.int(6) },
          { a: 'strike' },
          { a: 'award', team: rng.int(2) as 0 | 1 },
          { a: 'next' },
        ];
        const r = step(s, cmds[rng.int(cmds.length)]!);
        if (r.ok && !r.finished) s = r.state;
        const view = boardView(s);
        const round = s.rounds[s.round];
        if (!round) continue;
        round.answers.forEach((a, idx) => {
          const shown = JSON.stringify(view).includes(`"${a.text}"`);
          expect(shown).toBe(s.slots[idx]!.revealed);
        });
        // Invariants: exactly one result per decided round, bank never negative, strikes bounded.
        expect(s.bank).toBeGreaterThanOrEqual(0);
        expect(s.strikes).toBeLessThanOrEqual(3);
        expect(new Set(s.results.map((x) => x.index)).size).toBe(s.results.length);
        const awarded = s.results.reduce((sum, x) => sum + x.points, 0);
        expect(awarded).toBe(s.scores[0] + s.scores[1]);
      }
    }
  });

  it('the sheet lists every answer for the presenter, with the rundown', () => {
    const s = run(live(show()), { a: 'reveal', slot: 1 });
    const sheet = sheetView(s, { guessed: [4, 0, 1, 0], undo: 3, cloud: [{ text: 'x', count: 2, slot: -1 }] });
    expect(sheet.answers.map((a) => a.text)).toEqual(['r1-answer-1', 'r1-answer-2', 'r1-answer-3', 'r1-answer-4']);
    expect(sheet.answers.map((a) => a.revealed)).toEqual([false, true, false, false]);
    expect(sheet.answers[0]!.guessed).toBe(4);
    expect(sheet.rundown).toHaveLength(3);
    expect(sheet.undo).toBe(3);
    expect(sheetView(show()).answers).toEqual([]);
  });
});
