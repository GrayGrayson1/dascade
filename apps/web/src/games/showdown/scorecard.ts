/**
 * The phone's Top 10 scorecard (two-tier scoring, the crowd's side), pure so it's tested on its own.
 *
 * One numbered row per answer on the board (#1 … #N). Each row takes one guess, up to the show's
 * `guesses` limit; once locked, its text and spot stay put. A spot whose answer has already flipped
 * (and holds no guess of yours) shows that answer, filled in by the board, and can't be used. A match
 * only shows once its answer is on the board — the server sends nothing earlier — so nothing here can
 * leak an answer.
 *
 * Built only from this player's private `showdown:me` (guesses, score) and the public board.
 */
import {
  SHOWDOWN_MEDAL_INFO,
  type ShowdownMedals,
  type ShowdownMyGuess,
  type ShowdownMyScore,
  type ShowdownSlotView,
} from '@dascade/shared/games/showdown';

export type ScorecardRowState =
  /** Your guess is in this spot (text and spot fixed). */
  | 'locked'
  /** Free: type a guess and lock it in. */
  | 'open'
  /** The answer in this spot already flipped (and you had no guess here): filled in by the board. */
  | 'board'
  /** Free, but not now: the question isn't up, or all your guesses are locked in. */
  | 'closed';

export interface ScorecardRow {
  pos: number;
  state: ScorecardRowState;
  /** Your guess (locked) or the board's answer (board); '' otherwise. */
  text: string;
  /** Your guess scored: its answer is on the board (a repeat spelling never scores). */
  called: boolean;
  /** The board position it called (-1 = not on the board, or not flipped yet). */
  slot: number;
  points: number;
  /** +1: it landed in this very spot. */
  bonus: number;
  /** Found only by Reveal remaining: double points. */
  gem: boolean;
  /** Another spelling of an answer you already locked: it's on the board, but it never scores. */
  repeat: boolean;
  /** The answer that belongs in this spot is showing ('' = not yet), for a locked row that didn't call it. */
  spotAnswer: string;
}

export interface ScorecardModel {
  rows: ScorecardRow[];
  /** Guesses locked in this round, the round's limit, and what's left. */
  used: number;
  limit: number;
  left: number;
  /** Guesses can be locked in right now (the question is up and there are guesses left). */
  open: boolean;
  /** Guesses without a spot (an older phone): shown under the rows, never lost. */
  loose: ShowdownMyGuess[];
}

export interface ScorecardInput {
  slots: readonly Pick<ShowdownSlotView, 'revealed' | 'text'>[];
  /** Your guesses this round (me.guesses when me.round is the board's round). */
  guesses: readonly ShowdownMyGuess[];
  /** The show's guesses-per-board setting. */
  limit: number;
  /** The question is up (guesses are open). */
  live: boolean;
}

export function scorecardRows({ slots, guesses, limit, live }: ScorecardInput): ScorecardModel {
  const used = guesses.length;
  const left = Math.max(0, limit - used);
  const open = live && left > 0;
  const byPos = new Map<number, ShowdownMyGuess>();
  const loose: ShowdownMyGuess[] = [];
  for (const g of guesses) {
    const pos = g.pos ?? -1;
    if (pos >= 0 && pos < slots.length && !byPos.has(pos)) byPos.set(pos, g);
    else loose.push(g);
  }
  const rows: ScorecardRow[] = slots.map((slot, pos) => {
    const g = byPos.get(pos);
    if (g) {
      const called = g.slot >= 0 && g.points > 0;
      return {
        pos,
        state: 'locked',
        text: g.text,
        called,
        slot: g.slot,
        points: called ? g.points : 0,
        bonus: called ? (g.bonus ?? 0) : 0,
        gem: called && g.gem === true,
        repeat: g.slot >= 0 && !called,
        spotAnswer: !called && slot.revealed ? (slot.text ?? '') : '',
      };
    }
    const base = { pos, called: false, slot: -1, points: 0, bonus: 0, gem: false, repeat: false, spotAnswer: '' };
    if (slot.revealed) return { ...base, state: 'board', text: slot.text ?? '' };
    return { ...base, state: open ? 'open' : 'closed', text: '' };
  });
  return { rows, used, limit, left, open, loose };
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const unit = n % 10;
  return `${n}${unit === 1 ? 'st' : unit === 2 ? 'nd' : unit === 3 ? 'rd' : 'th'}`;
}

/** "4th of 38", "Tied 2nd of 38" ('' = no points yet, so no place). */
export function rankWords(rank: number, of: number, tied = false): string {
  if (rank <= 0) return '';
  const place = `${tied ? 'Tied ' : ''}${ordinal(rank)}`;
  return of > 0 ? `${place} of ${of}` : place;
}

/** "27 pts · 4th of 38" (the summary line), or how to get going. */
export function summaryWords(score: Pick<ShowdownMyScore, 'points' | 'rank' | 'of'> | null | undefined): string {
  if (!score || score.points <= 0) return '0 pts — lock in guesses before their answers flip';
  const place = rankWords(score.rank, score.of);
  return `${score.points} ${score.points === 1 ? 'pt' : 'pts'}${place ? ` · ${place}` : ''}`;
}

/** The medals you hold, in order, with counts (none when you have none). */
export function medalList(
  medals: ShowdownMedals | null | undefined,
): Array<{ kind: keyof ShowdownMedals; icon: string; title: string; n: number }> {
  if (!medals) return [];
  return (Object.keys(SHOWDOWN_MEDAL_INFO) as Array<keyof ShowdownMedals>)
    .filter((kind) => (medals[kind] ?? 0) > 0)
    .map((kind) => ({ kind, icon: SHOWDOWN_MEDAL_INFO[kind].icon, title: SHOWDOWN_MEDAL_INFO[kind].title, n: medals[kind] }));
}

const key = (g: ShowdownMyGuess) => `${g.pos ?? -1}:${g.text}`;

/** Guesses that started paying between two updates (a tile just flipped; Undo never flashes). */
export function newlyPaid(prev: readonly ShowdownMyGuess[], next: readonly ShowdownMyGuess[]): ShowdownMyGuess[] {
  const before = new Map(prev.map((g) => [key(g), g.points]));
  return next.filter((g) => g.points > 0 && (before.get(key(g)) ?? 0) <= 0 && before.has(key(g)));
}

/**
 * "Called it! +9, +1 spot on" — or "+18 (hidden gem)", several at once ("Called 2! +17, +1 spot on"),
 * and "Perfect list! +20" when the whole board landed in its spots. '' = nothing to say.
 */
export function flashText(paid: readonly ShowdownMyGuess[], perfect = 0): string {
  const parts: string[] = [];
  if (paid.length) {
    const points = paid.reduce((n, g) => n + g.points, 0);
    const bonus = paid.reduce((n, g) => n + (g.bonus ?? 0), 0);
    const gem = paid.some((g) => g.gem);
    const head = paid.length === 1 ? 'Called it!' : `Called ${paid.length}!`;
    parts.push(`${head} +${points}${gem ? ' (hidden gem)' : ''}${bonus ? `, +${bonus} spot on` : ''}`);
  }
  if (perfect > 0) parts.push(`Perfect list! +${20 * perfect}`);
  return parts.join(' ');
}
