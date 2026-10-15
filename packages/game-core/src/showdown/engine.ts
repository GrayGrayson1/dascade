/**
 * DAS Survey Showdown — the show as a pure, immutable state machine.
 *
 * Every command returns a NEW state (the old one is untouched, so the room keeps old states as its
 * undo stack) plus the events every screen animates. Nothing here knows about players, sockets or
 * timers: the presenter's console sends commands, the room applies them and publishes `boardView()`.
 *
 * A round (one survey question):
 *   title → (question) → live → [3 strikes → steal] → done → (next) → next round's title …
 *   - Reveals in `live` bank points (× the round's multiplier) for the team in control; revealing the
 *     whole board wins the bank ("sweep").
 *   - Three strikes hand the other team ONE guess: a reveal now steals the bank, a strike means the
 *     team in control keeps it ("defend"). With steals off, three strikes lose the bank.
 *   - The presenter may award the bank by hand at any time, adjust scores, and reveal the rest of a
 *     decided board for show (no points move).
 */
import {
  SHOWDOWN_LIMITS,
  otherTeam,
  roundMultipliers,
  type ShowdownBoardView,
  type ShowdownEvent,
  type ShowdownRoundDef,
  type ShowdownRoundResult,
  type ShowdownScoring,
  type ShowdownSheet,
  type ShowdownSheetRound,
  type ShowdownGuessCloudEntry,
  type ShowdownStage,
  type ShowdownWin,
  type TeamIndex,
  type TeamSlot,
} from '@dascade/shared/games/showdown';

export interface ShowRound extends ShowdownRoundDef {
  multiplier: number;
}

export interface SlotState {
  readonly revealed: boolean;
  readonly by: TeamSlot;
  /** Reveal order within the show (0 = hidden). */
  readonly seq: number;
}

export interface ShowState {
  readonly rounds: readonly ShowRound[];
  /** 0-based current round; -1 before round 1. */
  readonly round: number;
  readonly stage: ShowdownStage;
  readonly slots: readonly SlotState[];
  readonly control: TeamSlot;
  readonly strikes: number;
  readonly stealFailed: boolean;
  /** Points in play this round (already multiplied). */
  readonly bank: number;
  readonly scores: readonly [number, number];
  readonly roundWinner: TeamSlot;
  readonly roundHow: ShowdownWin | '';
  readonly results: readonly ShowdownRoundResult[];
  /** Revealed flags of rounds already left behind (index = round), for audience scoring. */
  readonly past: readonly (readonly boolean[])[];
  /** Reveal counter. */
  readonly seq: number;
  /** Board revision: bumps on every applied command. */
  readonly rev: number;
  /** Three strikes open a steal. */
  readonly steal: boolean;
}

export type ShowCommand =
  | { a: 'begin' }
  | { a: 'question' }
  | { a: 'control'; team: TeamIndex }
  | { a: 'reveal'; slot: number }
  | { a: 'strike' }
  | { a: 'award'; team: TeamIndex }
  | { a: 'adjust'; team: TeamIndex; delta: number }
  | { a: 'next' };

export type StepFailure = { ok: false; code: 'wrong_stage' | 'not_allowed' | 'noop'; message: string };
export type StepSuccess = {
  ok: true;
  state: ShowState;
  events: ShowdownEvent[];
  /** `next` on the last round: the show is over (the room ends the match). */
  finished?: boolean;
};
export type StepResult = StepSuccess | StepFailure;

export interface CreateShowOptions {
  scoring: ShowdownScoring;
  steal: boolean;
}

/** A fresh show at the intro marquee. */
export function createShow(rounds: readonly ShowdownRoundDef[], opts: CreateShowOptions): ShowState {
  const multipliers = roundMultipliers(rounds.length, opts.scoring);
  return {
    rounds: rounds.map((r, i) => ({ ...r, answers: r.answers.map((a) => ({ ...a, aliases: [...a.aliases] })), multiplier: multipliers[i] ?? 1 })),
    round: -1,
    stage: 'intro',
    slots: [],
    control: -1,
    strikes: 0,
    stealFailed: false,
    bank: 0,
    scores: [0, 0],
    roundWinner: -1,
    roundHow: '',
    results: [],
    past: [],
    seq: 0,
    rev: 1,
    steal: opts.steal,
  };
}

export function currentRound(state: ShowState): ShowRound | null {
  return state.rounds[state.round] ?? null;
}

const fail = (code: StepFailure['code'], message: string): StepFailure => ({ ok: false, code, message });

const clampScore = (n: number) => Math.max(-SHOWDOWN_LIMITS.scoreMax, Math.min(SHOWDOWN_LIMITS.scoreMax, n));

function addScore(scores: readonly [number, number], team: TeamIndex, points: number): [number, number] {
  const next: [number, number] = [scores[0], scores[1]];
  next[team] = clampScore(next[team] + points);
  return next;
}

function enterRound(state: ShowState, index: number): ShowState {
  const round = state.rounds[index]!;
  const past = state.round >= 0 ? withPast(state) : state.past;
  return {
    ...state,
    round: index,
    stage: 'title',
    slots: round.answers.map(() => ({ revealed: false, by: -1, seq: 0 })),
    control: -1,
    strikes: 0,
    stealFailed: false,
    bank: 0,
    roundWinner: -1,
    roundHow: '',
    past,
  };
}

/** `past` with the current round's revealed flags recorded. */
function withPast(state: ShowState): ShowState['past'] {
  const past = state.past.slice();
  past[state.round] = state.slots.map((s) => s.revealed);
  return past;
}

/** The round's bank goes to `team` (or is lost: -1). */
function decide(state: ShowState, team: TeamSlot, how: ShowdownWin): { state: ShowState; event: ShowdownEvent } {
  const points = team === -1 ? 0 : state.bank;
  const scores = team === -1 ? state.scores : addScore(state.scores, team, points);
  const result: ShowdownRoundResult = { index: state.round, winner: team, points, how };
  const rev = state.rev + 1;
  return {
    state: { ...state, scores, bank: 0, stage: 'done', roundWinner: team, roundHow: how, results: [...state.results, result], rev },
    event: { type: 'award', rev, team, points, how },
  };
}

/** The round ends with nobody winning it (skipped, or the show ended mid-round). No-op if decided. */
function closeUndecided(state: ShowState): ShowState {
  if (state.round < 0 || state.roundHow !== '') return state;
  const result: ShowdownRoundResult = { index: state.round, winner: -1, points: 0, how: 'none' };
  return { ...state, bank: 0, roundHow: 'none', results: [...state.results, result] };
}

const allRevealed = (slots: readonly SlotState[]) => slots.length > 0 && slots.every((s) => s.revealed);

function reveal(state: ShowState, slot: number): StepResult {
  if (state.stage === 'intro') return fail('wrong_stage', 'Start round 1 first.');
  const round = currentRound(state);
  if (!round || slot < 0 || slot >= state.slots.length) return fail('not_allowed', `There is no answer #${slot + 1} on this board.`);
  if (state.slots[slot]!.revealed) return fail('noop', 'That answer is already showing.');
  const events: ShowdownEvent[] = [];
  let s = state;
  if (s.stage === 'title') {
    // Revealing before the question is up shows the question first (one click for the presenter).
    s = { ...s, stage: 'live', rev: s.rev + 1 };
    events.push({ type: 'question', rev: s.rev });
  }
  const answer = round.answers[slot]!;
  const late = s.stage === 'done';
  const stealing = s.stage === 'steal' && s.control !== -1;
  const by: TeamSlot = late ? -1 : stealing ? otherTeam(s.control as TeamIndex) : s.control;
  const seq = s.seq + 1;
  const slots = s.slots.map((x, i) => (i === slot ? { revealed: true, by, seq } : x));
  const bank = late ? s.bank : s.bank + answer.points * round.multiplier;
  const rev = s.rev + 1;
  s = { ...s, slots, seq, bank, rev };
  const cleared = allRevealed(slots);
  events.push({ type: 'reveal', rev, slot, text: answer.text, points: answer.points, top: slot === 0, late, callers: 0, cleared });
  if (stealing) {
    const d = decide(s, otherTeam(s.control as TeamIndex), 'steal');
    return { ok: true, state: d.state, events: [...events, d.event] };
  }
  if (!late && cleared) {
    if (s.control !== -1) {
      const d = decide(s, s.control, 'sweep');
      return { ok: true, state: d.state, events: [...events, d.event] };
    }
    // The whole board went up during the face-off: the round is over, the presenter awards the bank.
    s = { ...s, stage: 'done' };
  }
  return { ok: true, state: s, events };
}

function strike(state: ShowState): StepResult {
  if (state.stage === 'steal') {
    // The steal guess missed: the team in control keeps the bank.
    const failed = { ...state, stealFailed: true, rev: state.rev + 1 };
    const strikeEvent: ShowdownEvent = { type: 'strike', rev: failed.rev, strikes: failed.strikes, steal: false, stealFailed: true };
    const d = decide(failed, state.control, 'defend');
    return { ok: true, state: d.state, events: [strikeEvent, d.event] };
  }
  if (state.stage !== 'live') return fail('wrong_stage', state.stage === 'title' ? 'Show the question first.' : 'Strikes only count while a team is playing.');
  if (state.control === -1) return fail('not_allowed', 'Pick the team in control first.');
  if (state.strikes >= SHOWDOWN_LIMITS.strikes) return fail('noop', 'That team is already out of strikes.');
  const strikes = state.strikes + 1;
  const out = strikes >= SHOWDOWN_LIMITS.strikes;
  const rev = state.rev + 1;
  if (!out) {
    return { ok: true, state: { ...state, strikes, rev }, events: [{ type: 'strike', rev, strikes, steal: false, stealFailed: false }] };
  }
  if (state.steal) {
    return { ok: true, state: { ...state, strikes, rev, stage: 'steal' }, events: [{ type: 'strike', rev, strikes, steal: true, stealFailed: false }] };
  }
  const struck = { ...state, strikes, rev };
  const d = decide(struck, -1, 'none');
  return { ok: true, state: d.state, events: [{ type: 'strike', rev, strikes, steal: false, stealFailed: false }, d.event] };
}

function award(state: ShowState, team: TeamIndex): StepResult {
  if (state.stage !== 'live' && state.stage !== 'steal' && state.stage !== 'done') return fail('wrong_stage', 'There is nothing to award yet.');
  if (state.roundHow !== '') return fail('not_allowed', 'This round has already been decided — use Undo to change it.');
  if (state.bank <= 0) return fail('not_allowed', 'There are no points in the bank yet.');
  const d = decide(state, team, 'manual');
  return { ok: true, state: d.state, events: [d.event] };
}

function next(state: ShowState): StepResult {
  if (state.stage === 'intro') return step(state, { a: 'begin' });
  const closed = closeUndecided(state);
  if (state.round >= state.rounds.length - 1) {
    const rev = closed.rev + 1;
    return { ok: true, state: { ...closed, stage: 'done', past: withPast(closed), rev }, events: [], finished: true };
  }
  const entered = enterRound(closed, state.round + 1);
  const rev = entered.rev + 1;
  const round = entered.rounds[entered.round]!;
  return { ok: true, state: { ...entered, rev }, events: [{ type: 'round', rev, round: entered.round, multiplier: round.multiplier, answers: round.answers.length }] };
}

/** Applies one presenter command. Pure: `state` is never modified. */
export function step(state: ShowState, cmd: ShowCommand): StepResult {
  switch (cmd.a) {
    case 'begin': {
      if (state.stage !== 'intro') return fail('noop', 'The show has already started.');
      if (state.rounds.length === 0) return fail('not_allowed', 'This show has no rounds.');
      const entered = enterRound(state, 0);
      const rev = entered.rev + 1;
      const first = entered.rounds[0]!;
      return { ok: true, state: { ...entered, rev }, events: [{ type: 'round', rev, round: 0, multiplier: first.multiplier, answers: first.answers.length }] };
    }
    case 'question': {
      if (state.stage !== 'title') return fail(state.stage === 'intro' ? 'wrong_stage' : 'noop', state.stage === 'intro' ? 'Start round 1 first.' : 'The question is already up.');
      const rev = state.rev + 1;
      return { ok: true, state: { ...state, stage: 'live', rev }, events: [{ type: 'question', rev }] };
    }
    case 'control': {
      if (state.stage === 'title') return fail('wrong_stage', 'Show the question first.');
      if (state.stage !== 'live') return fail('wrong_stage', 'Control can only change while the round is live.');
      if (state.control === cmd.team) return fail('noop', 'That team is already in control.');
      const rev = state.rev + 1;
      return { ok: true, state: { ...state, control: cmd.team, strikes: 0, rev }, events: [{ type: 'control', rev, team: cmd.team }] };
    }
    case 'reveal':
      return reveal(state, cmd.slot);
    case 'strike':
      return strike(state);
    case 'award':
      return award(state, cmd.team);
    case 'adjust': {
      const delta = Math.trunc(cmd.delta);
      if (!delta || Math.abs(delta) > SHOWDOWN_LIMITS.adjustMax) return fail('noop', 'Nothing to adjust.');
      const rev = state.rev + 1;
      return { ok: true, state: { ...state, scores: addScore(state.scores, cmd.team, delta), rev }, events: [{ type: 'adjust', rev, team: cmd.team, delta }] };
    }
    case 'next':
      return next(state);
  }
}

/** Closes the current round if it is still open (the show ends early) and returns the final state. */
export function finalizeShow(state: ShowState): ShowState {
  const closed = closeUndecided(state);
  return closed.round >= 0 ? { ...closed, past: withPast(closed) } : closed;
}

/** Leading team, or -1 for a tie. */
export function showWinner(state: Pick<ShowState, 'scores'>): TeamSlot {
  const [a, b] = state.scores;
  return a === b ? -1 : a > b ? 0 : 1;
}

/** Revealed flags of any round of the show (the current one live, earlier ones as they were left). */
export function revealedIn(state: ShowState, round: number): readonly boolean[] {
  if (round === state.round) return state.slots.map((s) => s.revealed);
  return state.past[round] ?? [];
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * The public board. Hidden answers contribute NOTHING but their slot position: no text, no points.
 * `callers[i]` (audience members who called slot i) is only published for revealed slots.
 */
export function boardView(state: ShowState, callers: readonly number[] = []): ShowdownBoardView {
  const round = currentRound(state);
  const promptVisible = state.stage !== 'intro' && state.stage !== 'title';
  return {
    rev: state.rev,
    stage: state.stage,
    round: state.round,
    totalRounds: state.rounds.length,
    multiplier: round?.multiplier ?? 1,
    prompt: promptVisible && round ? round.prompt : '',
    slots: state.slots.map((slot, i) => {
      if (!slot.revealed || !round) return { revealed: false, by: -1, seq: 0, callers: 0 };
      const answer = round.answers[i]!;
      return { revealed: true, text: answer.text, points: answer.points, by: slot.by, seq: slot.seq, callers: callers[i] ?? 0 };
    }),
    control: state.control,
    strikes: state.strikes,
    stealFailed: state.stealFailed,
    bank: state.bank,
    scores: [state.scores[0], state.scores[1]],
    roundWinner: state.roundWinner,
    roundHow: state.roundHow,
    results: state.results.map((r) => ({ ...r })),
  };
}

/** The presenter's answer sheet: every answer of the current round, plus the whole rundown. */
export function sheetView(
  state: ShowState,
  extra: { guessed?: readonly number[]; cloud?: ShowdownGuessCloudEntry[]; undo?: number } = {},
): ShowdownSheet {
  const round = currentRound(state);
  const rundown: ShowdownSheetRound[] = state.rounds.map((r, index) => ({
    index,
    prompt: r.prompt,
    multiplier: r.multiplier,
    answers: r.answers.map((a) => ({ text: a.text, points: a.points, aliases: [...a.aliases] })),
  }));
  return {
    rev: state.rev,
    round: state.round,
    prompt: round?.prompt ?? '',
    multiplier: round?.multiplier ?? 1,
    answers: round
      ? round.answers.map((a, i) => ({
          text: a.text,
          points: a.points,
          aliases: [...a.aliases],
          revealed: state.slots[i]?.revealed ?? false,
          guessed: extra.guessed?.[i] ?? 0,
        }))
      : [],
    rundown,
    cloud: extra.cloud ?? [],
    undo: extra.undo ?? 0,
  };
}
