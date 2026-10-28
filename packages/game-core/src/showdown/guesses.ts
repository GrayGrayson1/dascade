/**
 * The audience game: private "survey says" guesses.
 *
 * While a question is up, every audience member may lock in a few guesses. Each guess is matched
 * against the board when it is submitted (typo-tolerant, aliases included) but the match is kept
 * secret: a guesser only learns they "called it" when that answer is revealed to everyone, so a
 * guess never leaks whether an answer is on the board.
 *
 * Scoring is DERIVED, never accumulated: called-it points = survey points of every revealed answer a
 * player's guess matched. Recomputing from the show state makes the presenter's Undo exact (an undone
 * reveal takes its points back) and a duplicate message can never score twice.
 */
import { cleanText, maskProfanity } from '@dascade/shared';
import {
  SHOWDOWN_LIMITS,
  type ShowdownGuessCloudEntry,
  type ShowdownMe,
  type ShowdownMyGuess,
  type ShowdownRoundDef,
} from '@dascade/shared/games/showdown';
import { answerKey, matchAnswer } from '../party/text.ts';

interface Guess {
  text: string;
  key: string;
  /** Matching slot on that round's board (-1 = none). Secret until that slot is revealed. */
  slot: number;
  /** The scorecard spot it was locked into (0 = #1; -1 = none). */
  pos: number;
  /** Another spelling of an answer this player already guessed: shown, but never scored or counted twice. */
  repeat: boolean;
  at: number;
}

export type GuessRejection = 'empty' | 'limit' | 'duplicate' | 'revealed' | 'spot' | 'spotRevealed' | 'spotRange';

export const GUESS_REJECTION_TEXT: Record<GuessRejection, string> = {
  empty: 'Type a guess first.',
  limit: `You've locked in all your guesses for this question.`,
  duplicate: 'You already guessed that.',
  revealed: 'That answer is already on the board!',
  spot: 'You already have a guess in that spot.',
  spotRevealed: 'That spot’s answer is already on the board — pick another spot.',
  spotRange: 'This board doesn’t have that many answers.',
};

/** One stored guess as the scoring sees it. */
export interface BookGuess {
  slot: number;
  pos: number;
  repeat: boolean;
}

/** The guess book in the black box: round → player → [text, slot, pos, repeat (0/1)]. Compact on purpose. */
export type GuessBookExport = Array<[number, Array<[string, Array<[string, number, number, number]>]>]>;

export type SubmitResult = { ok: true; slot: number } | { ok: false; reason: GuessRejection };

/** First slot whose answer (or alias) matches `text`, -1 if none. */
export function matchSlot(round: Pick<ShowdownRoundDef, 'answers'>, text: string): number {
  for (let i = 0; i < round.answers.length; i++) {
    const a = round.answers[i]!;
    if (matchAnswer(text, [a.text, ...a.aliases]).verdict !== 'wrong') return i;
  }
  return -1;
}

export class GuessBook {
  /** round → player → guesses. */
  private readonly rounds = new Map<number, Map<string, Guess[]>>();
  private clock = 0;

  /**
   * Locks in a guess for `round`. `revealed` = the round's revealed flags right now (a guess that
   * matches an answer already showing is refused — that answer is public anyway). `limit` = guesses
   * per player per board (the show's `guesses` setting).
   */
  submit(
    playerId: string,
    round: number,
    def: Pick<ShowdownRoundDef, 'answers'>,
    rawText: string,
    revealed: readonly boolean[],
    limit: number = SHOWDOWN_LIMITS.guessesDefault,
    /** The scorecard spot (0 = #1); -1 = no spot (Team Showdown). */
    pos = -1,
  ): SubmitResult {
    const text = maskProfanity(cleanText(rawText, SHOWDOWN_LIMITS.guessText));
    const key = answerKey(text);
    if (!text || !key) return { ok: false, reason: 'empty' };
    let byPlayer = this.rounds.get(round);
    if (!byPlayer) {
      byPlayer = new Map();
      this.rounds.set(round, byPlayer);
    }
    const mine = byPlayer.get(playerId) ?? [];
    if (pos >= 0) {
      if (pos >= def.answers.length) return { ok: false, reason: 'spotRange' };
      if (revealed[pos]) return { ok: false, reason: 'spotRevealed' };
      if (mine.some((g) => g.pos === pos)) return { ok: false, reason: 'spot' };
    }
    if (mine.some((g) => g.key === key)) return { ok: false, reason: 'duplicate' };
    const slot = matchSlot(def, text);
    if (slot >= 0 && revealed[slot]) return { ok: false, reason: 'revealed' };
    if (mine.length >= limit) return { ok: false, reason: 'limit' };
    // A second spelling of the same hidden answer is locked in like any guess (refusing it would tell
    // the player their earlier guess is on the board), but it never scores or counts twice.
    const repeat = slot >= 0 && mine.some((g) => g.slot === slot);
    mine.push({ text, key, slot, pos, repeat, at: ++this.clock });
    byPlayer.set(playerId, mine);
    return { ok: true, slot };
  }

  /** Guesses locked in for a round (all players). */
  count(round: number): number {
    let n = 0;
    for (const list of this.rounds.get(round)?.values() ?? []) n += list.length;
    return n;
  }

  /** Per slot: how many players' guesses match it (presenter sheet; public only for revealed slots). */
  matchesPerSlot(round: number, slots: number): number[] {
    const out = Array.from({ length: slots }, () => 0);
    for (const list of this.rounds.get(round)?.values() ?? []) {
      for (const g of list) if (!g.repeat && g.slot >= 0 && g.slot < slots) out[g.slot]!++;
    }
    return out;
  }

  /** Callers per slot, published only for revealed slots. */
  callers(round: number, revealed: readonly boolean[]): number[] {
    return this.matchesPerSlot(round, revealed.length).map((n, i) => (revealed[i] ? n : 0));
  }

  /** The presenter's guess cloud: answers the audience is going for, then popular misses. */
  cloud(round: number, def: Pick<ShowdownRoundDef, 'answers'> | null, limit = 8): ShowdownGuessCloudEntry[] {
    const groups = new Map<string, ShowdownGuessCloudEntry & { first: number }>();
    for (const list of this.rounds.get(round)?.values() ?? []) {
      for (const g of list) {
        if (g.repeat) continue;
        const id = g.slot >= 0 ? `slot:${g.slot}` : `key:${g.key}`;
        const entry = groups.get(id);
        if (entry) {
          entry.count++;
          if (g.at < entry.first) {
            entry.first = g.at;
            if (g.slot < 0) entry.text = g.text;
          }
        } else {
          const text = g.slot >= 0 && def ? (def.answers[g.slot]?.text ?? g.text) : g.text;
          groups.set(id, { text, count: 1, slot: g.slot, first: g.at });
        }
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.count - a.count || a.first - b.first)
      .slice(0, limit)
      .map(({ text, count, slot }) => ({ text, count, slot }));
  }

  /**
   * One player's private view: their guesses this round (a match is shown only once revealed) and
   * their called-it totals over the whole show.
   */
  me(
    playerId: string,
    current: number,
    rounds: readonly Pick<ShowdownRoundDef, 'answers'>[],
    revealedIn: (round: number) => readonly boolean[],
  ): ShowdownMe {
    let points = 0;
    let calls = 0;
    let guesses: ShowdownMyGuess[] = [];
    for (const [round, byPlayer] of this.rounds) {
      const list = byPlayer.get(playerId);
      if (!list) continue;
      const revealed = revealedIn(round);
      const def = rounds[round];
      const view = list.map((g): ShowdownMyGuess => {
        const called = g.slot >= 0 && revealed[g.slot] === true && def !== undefined;
        const pts = called && !g.repeat ? (def.answers[g.slot]?.points ?? 0) : 0;
        if (called && !g.repeat) {
          points += pts;
          calls++;
        }
        return { text: g.text, slot: called ? g.slot : -1, points: pts, ...(g.pos >= 0 ? { pos: g.pos } : {}) };
      });
      if (round === current) guesses = view;
    }
    return { round: current, guesses, points, calls };
  }

  /** Every player with at least one guess this show. */
  players(): Set<string> {
    const out = new Set<string>();
    for (const byPlayer of this.rounds.values()) for (const id of byPlayer.keys()) out.add(id);
    return out;
  }

  /** Every player's guesses in a round, for the scoring (never the text: scoring needs only matches). */
  round(round: number): ReadonlyMap<string, readonly BookGuess[]> {
    return this.rounds.get(round) ?? EMPTY_ROUND;
  }

  /** One player's guesses in a round as they typed them (the phone's scorecard). */
  mine(playerId: string, round: number): ReadonlyArray<{ text: string; slot: number; pos: number; repeat: boolean }> {
    return this.rounds.get(round)?.get(playerId) ?? [];
  }

  /** For the black box: everything, compactly (the matches included, so a restore never re-matches). */
  export(): GuessBookExport {
    return [...this.rounds].map(([round, byPlayer]) => [
      round,
      [...byPlayer].map(([id, list]) => [
        id,
        list.map((g) => [g.text, g.slot, g.pos, g.repeat ? 1 : 0] as [string, number, number, number]),
      ]),
    ]);
  }

  /** Restores an export (anything malformed is skipped). */
  import(data: unknown): void {
    this.clear();
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'number' || !Array.isArray(entry[1])) continue;
      const byPlayer = new Map<string, Guess[]>();
      for (const row of entry[1] as unknown[]) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || !Array.isArray(row[1])) continue;
        const list: Guess[] = [];
        for (const g of row[1] as unknown[]) {
          if (!Array.isArray(g) || typeof g[0] !== 'string' || typeof g[1] !== 'number' || typeof g[2] !== 'number') continue;
          const text = String(g[0]).slice(0, SHOWDOWN_LIMITS.guessText);
          list.push({ text, key: answerKey(text), slot: g[1], pos: g[2], repeat: g[3] === 1, at: ++this.clock });
        }
        if (list.length) byPlayer.set(row[0], list);
      }
      if (byPlayer.size) this.rounds.set(entry[0], byPlayer);
    }
  }

  clear(): void {
    this.rounds.clear();
    this.clock = 0;
  }
}

const EMPTY_ROUND: ReadonlyMap<string, readonly BookGuess[]> = new Map();
