/**
 * Two-tier scoring for Presenter Showcase (Brian's picks from the Scoring Studio, 2026-10-27). Pure.
 *
 *   - The CROWD earns points ("Called it"): a guess locked in before its answer flipped scores the
 *     tile's value, #1 = 10 … #10 = 1, however it flipped (the hot seat, the chat, out loud, the
 *     sweep). +1 when it sat in the same spot on your Top 10 scorecard. +20 for a perfect list:
 *     every answer on the board, each in its exact spot. Hidden gems: an answer only Reveal
 *     remaining found pays double (the spot bonus stays +1). Another spelling of an answer you
 *     already locked never scores.
 *   - The HOT SEAT earns medals: 🎃 for the special answer, 🥇 #1–#3, 🥈 #4–#7, 🥉 #8–#10, and a
 *     🎗️ Brave ribbon for a turn marked done with nothing found.
 *   - The two never touch: no medal turns into points, no points buy medals.
 *
 * Everything is DERIVED from the board, the guess book and the credits — never accumulated — so an
 * Undo, a restart or a restored black box recomputes exactly, and a repeated message can't score twice.
 */
import {
  answerValue,
  emptyMedals,
  medalCount,
  medalFor,
  type ShowdownMedals,
  type ShowdownScorePerson,
  type ShowdownStar,
} from '@dascade/shared/games/showdown';
import type { BookGuess } from './guesses.ts';

/** +20 for every answer on a board, each in its exact spot. */
export const PERFECT_BONUS = 20;
/** +1 for an answer that landed in the spot you put it. */
export const SPOT_BONUS = 1;

/** A hot-seat credit: who was up when the tile flipped, and the draw they were up for. */
export interface ScoreCredit {
  id: string;
  name: string;
  /** The draw number of that turn (-1 = unknown: an older black box). */
  draw?: number;
}

/** A finished turn (Mark done): a Brave ribbon when nothing was credited to that draw. */
export interface ScoreTurn {
  draw: number;
  id: string;
  name: string;
  round: number;
}

export interface ScoreInput {
  /** The show's rounds (only their sizes and special answers matter). */
  rounds: ReadonlyArray<{ answers: readonly unknown[]; special?: number }>;
  revealed: (round: number) => readonly boolean[];
  late: (round: number) => readonly boolean[];
  guesses: (round: number) => ReadonlyMap<string, readonly BookGuess[]>;
  /** `${round}:${slot}` → the hot seat when it flipped. */
  credits: ReadonlyMap<string, ScoreCredit>;
  turns: readonly ScoreTurn[];
  gems: boolean;
  /** A name for anyone (people who left keep theirs). */
  nameOf: (id: string) => string;
}

export interface ShowScores {
  /** Everyone with points, medals or a guess, best first (ties share a rank; rank 0 = no points). */
  people: ShowdownScorePerson[];
  byId: ReadonlyMap<string, ShowdownScorePerson>;
  /** People with points. */
  of: number;
  /** The medal wall, Olympic order. */
  stars: ShowdownStar[];
  /** Hot-seat finds that still stand (revealed tiles with a credit). */
  finds: Array<{ round: number; slot: number; id: string; name: string; medal: keyof ShowdownMedals }>;
}

/** Which round/slot a credit key names (null if it's malformed). */
export function creditKey(key: string): { round: number; slot: number } | null {
  const m = /^(\d+):(\d+)$/.exec(key);
  return m ? { round: Number(m[1]), slot: Number(m[2]) } : null;
}

/** Olympic order: pumpkins, then golds, silvers, bronzes, ribbons; then by name. */
export function olympic(a: { medals: ShowdownMedals; name: string }, b: { medals: ShowdownMedals; name: string }): number {
  const m = a.medals;
  const n = b.medals;
  return (
    n.pumpkin - m.pumpkin ||
    n.gold - m.gold ||
    n.silver - m.silver ||
    n.bronze - m.bronze ||
    n.ribbon - m.ribbon ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

/** Competition ranking (1, 1, 3): ties share a place. `points` must be sorted high to low. */
export function rankOf(points: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i++) out.push(i > 0 && points[i] === points[i - 1] ? out[i - 1]! : i + 1);
  return out;
}

export function scoreShow(input: ScoreInput): ShowScores {
  const people = new Map<string, ShowdownScorePerson>();
  const roundCount = input.rounds.length;
  const person = (id: string): ShowdownScorePerson => {
    let p = people.get(id);
    if (!p) {
      p = {
        playerId: id,
        name: input.nameOf(id),
        points: 0,
        rank: 0,
        medals: emptyMedals(),
        positionHits: 0,
        perfect: 0,
        gems: 0,
        calls: 0,
        rounds: Array.from({ length: roundCount }, () => 0),
      };
      people.set(id, p);
    }
    return p;
  };

  // ---- The crowd: called-it points ----
  for (let r = 0; r < roundCount; r++) {
    const size = input.rounds[r]!.answers.length;
    const revealed = input.revealed(r);
    const late = input.late(r);
    for (const [id, list] of input.guesses(r)) {
      const p = person(id);
      let exact = 0;
      for (const g of list) {
        if (g.repeat || g.slot < 0 || g.slot >= size || revealed[g.slot] !== true) continue;
        const gem = input.gems && late[g.slot] === true;
        let pts = answerValue(g.slot, gem);
        p.calls++;
        if (gem) p.gems++;
        if (g.pos === g.slot) {
          pts += SPOT_BONUS;
          p.positionHits++;
          exact++;
        }
        p.points += pts;
        p.rounds[r] = (p.rounds[r] ?? 0) + pts;
      }
      if (size > 0 && exact === size) {
        p.points += PERFECT_BONUS;
        p.rounds[r] = (p.rounds[r] ?? 0) + PERFECT_BONUS;
        p.perfect++;
      }
    }
  }

  // ---- The hot seat: medals ----
  const finds: ShowScores['finds'] = [];
  const creditedDraws = new Set<number>();
  for (const [key, credit] of input.credits) {
    const at = creditKey(key);
    if (!at || at.round >= roundCount) continue;
    if (input.revealed(at.round)[at.slot] !== true) continue;
    const special = input.rounds[at.round]!.special ?? -1;
    const medal = medalFor(at.slot, special);
    person(credit.id).medals[medal]++;
    if (credit.draw !== undefined && credit.draw >= 0) creditedDraws.add(credit.draw);
    finds.push({ round: at.round, slot: at.slot, id: credit.id, name: input.nameOf(credit.id) || credit.name, medal });
  }
  for (const turn of input.turns) {
    if (creditedDraws.has(turn.draw)) continue;
    person(turn.id).medals.ribbon++;
  }
  finds.sort((a, b) => a.round - b.round || a.slot - b.slot);

  // ---- Ranks: by points (ties share a place); nobody with 0 points is ranked ----
  const list = [...people.values()].sort(
    (a, b) =>
      b.points - a.points || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.playerId.localeCompare(b.playerId),
  );
  const scored = list.filter((p) => p.points > 0);
  const ranks = rankOf(scored.map((p) => p.points));
  scored.forEach((p, i) => (p.rank = ranks[i]!));
  const stars: ShowdownStar[] = list
    .filter((p) => medalCount(p.medals) > 0)
    .map((p) => ({ playerId: p.playerId, name: p.name, medals: { ...p.medals } }))
    .sort(olympic);
  return { people: list, byId: people, of: scored.length, stars, finds };
}
