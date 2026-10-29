/**
 * Two-tier scoring on the stage (pure, unit-tested): called-it pops on flipped tiles, medal lists,
 * the standings rows and the paced finale's view. Built only from public state — the board (revealed
 * tiles only), the scoreboard (`scoreJson`) and the finale (`finaleJson`).
 */
import {
  SHOWDOWN_LIMITS,
  SHOWDOWN_MEDAL_INFO,
  answerValue,
  finaleSteps,
  medalFor,
  type ShowdownBoardView,
  type ShowdownFinale,
  type ShowdownFinaleStepKind,
  type ShowdownMedals,
  type ShowdownScoreRow,
  type ShowdownSlotView,
} from '@dascade/shared/games/showdown';

export type MedalKind = keyof ShowdownMedals;

/** Olympic order: the Golden Pumpkin first, the Brave ribbon last. */
export const MEDAL_ORDER: readonly MedalKind[] = ['pumpkin', 'gold', 'silver', 'bronze', 'ribbon'];

export interface MedalItem {
  kind: MedalKind;
  count: number;
  icon: string;
  title: string;
}

/** The medals someone holds, Olympic order, kinds they don't have left out. */
export function medalList(medals: ShowdownMedals): MedalItem[] {
  return MEDAL_ORDER.filter((k) => (medals[k] ?? 0) > 0).map((kind) => ({
    kind,
    count: medals[kind],
    icon: SHOWDOWN_MEDAL_INFO[kind].icon,
    title: SHOWDOWN_MEDAL_INFO[kind].title,
  }));
}

/** The medal kinds anyone on the wall holds, Olympic order: the wall's columns, so the medals line up. */
export function medalKindsHeld(stars: ReadonlyArray<{ medals: ShowdownMedals }>): MedalKind[] {
  return MEDAL_ORDER.filter((kind) => stars.some((s) => (s.medals[kind] ?? 0) > 0));
}

/** Someone's medals in the wall's columns: one cell per kind in `kinds`, count 0 where they hold none. */
export function medalCells(medals: ShowdownMedals, kinds: readonly MedalKind[]): MedalItem[] {
  return kinds.map((kind) => ({
    kind,
    count: medals[kind] ?? 0,
    icon: SHOWDOWN_MEDAL_INFO[kind].icon,
    title: SHOWDOWN_MEDAL_INFO[kind].title,
  }));
}

/** One entry of the legend under the scores: an icon (medals) and what earns it. */
export interface LegendItem {
  key: string;
  text: string;
  icon?: string;
  /** The icon's name for screen readers. */
  title?: string;
}

/** The board spots (1-based, first and last) whose find earns `kind` from the hot seat (medalFor). */
function spotsFor(kind: MedalKind): [number, number] | null {
  const spots: number[] = [];
  for (let slot = 0; slot < SHOWDOWN_LIMITS.answersMax; slot++) if (medalFor(slot, -1) === kind) spots.push(slot + 1);
  return spots.length ? [spots[0]!, spots.at(-1)!] : null;
}

/** The legend's medal line, from the rules themselves (medalFor; a turn with nothing found earns the ribbon). */
export function medalLegend(): LegendItem[] {
  return MEDAL_ORDER.map((kind) => {
    const spots = spotsFor(kind);
    const text =
      kind === 'pumpkin' ? 'Special answer' : kind === 'ribbon' || !spots ? 'Brave try, nothing found' : `Answer #${spots[0]}–${spots[1]}`;
    return { key: kind, text, icon: SHOWDOWN_MEDAL_INFO[kind].icon, title: SHOWDOWN_MEDAL_INFO[kind].title };
  });
}

/**
 * The crowd's bonuses (game-core's scoring.ts; standings.test.ts keeps them in step). Not imported:
 * game-core's showdown module carries the question packs, which never go into the client bundle.
 */
export const SPOT_BONUS = 1;
export const PERFECT_BONUS = 20;

/** The legend's points line: a tile's value, the spot bonus, hidden gems (when on) and a perfect list. */
export function pointsLegend(gems: boolean): LegendItem[] {
  const last = SHOWDOWN_LIMITS.answersMax;
  return [
    { key: 'value', text: `Answer #1 = ${answerValue(0)} … #${last} = ${answerValue(last - 1)}` },
    { key: 'spot', text: `+${SPOT_BONUS} right spot` },
    ...(gems ? [{ key: 'gem', text: 'Hidden gem ×2' }] : []),
    { key: 'perfect', text: `+${PERFECT_BONUS} perfect list` },
  ];
}

/** "1 Golden Pumpkin, 2 Gold" — for screen readers. */
export function medalWords(medals: ShowdownMedals): string {
  return medalList(medals)
    .map((m) => `${m.count} ${m.title}${m.count > 1 && m.kind === 'ribbon' ? 's' : ''}`)
    .join(', ');
}

/** A called-it pop on a flipped tile: its value (doubled for a hidden gem) and how many called it. Null while hidden. */
export function popFor(slot: ShowdownSlotView, index: number, gems: boolean): { value: number; callers: number; gem: boolean } | null {
  if (!slot.revealed) return null;
  const gem = gems && slot.late;
  return { value: answerValue(index, gem), callers: Math.max(0, slot.callers), gem };
}

/** The medals pinned on the hot seat: tiles on this board credited to `name`, in board order. */
export function medalsOnBoard(board: Pick<ShowdownBoardView, 'slots' | 'special'>, name: string): MedalKind[] {
  if (!name) return [];
  const out: MedalKind[] = [];
  board.slots.forEach((slot, i) => {
    if (slot.revealed && slot.calledBy === name) out.push(medalFor(i, board.special));
  });
  return out;
}

/** "1st", "2nd", "3rd", "4th"… */
export function placeWord(rank: number): string {
  const n = Math.max(1, Math.floor(rank));
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

/** Rows grouped by their (shared) rank, best first. */
export function groupByRank<T extends Pick<ShowdownScoreRow, 'rank'>>(rows: readonly T[]): Array<{ rank: number; rows: T[] }> {
  const out: Array<{ rank: number; rows: T[] }> = [];
  for (const row of [...rows].sort((a, b) => a.rank - b.rank)) {
    const last = out.at(-1);
    if (last && last.rank === row.rank) last.rows.push(row);
    else out.push({ rank: row.rank, rows: [row] });
  }
  return out;
}

const PLACE_OF: Partial<Record<ShowdownFinaleStepKind, number>> = { third: 3, second: 2, first: 1 };

export interface FinaleView {
  steps: ShowdownFinaleStepKind[];
  /** The step on screen (clamped into the steps). */
  index: number;
  kind: ShowdownFinaleStepKind;
  /** Podium places already revealed (3rd → 2nd → 1st; earlier places stay up). */
  places: ReadonlySet<number>;
  /** Paced at all: more than the wrap-up (a podium or a medal ceremony). */
  paced: boolean;
}

/** The finale at `step` (the room's `finaleStep`): which scene shows, and which podium places are up. */
export function finaleView(finale: Pick<ShowdownFinale, 'podium' | 'stars' | 'medals'> | null, step: number): FinaleView {
  const steps = finaleSteps(finale);
  const index = Math.max(0, Math.min(steps.length - 1, Math.floor(step) || 0));
  const places = new Set<number>();
  for (const kind of steps.slice(0, index + 1)) {
    const place = PLACE_OF[kind];
    if (place) places.add(place);
  }
  return { steps, index, kind: steps[index]!, places, paced: steps.length > 1 };
}

/** The podium's columns, left to right: 2nd, 1st, 3rd (only the places someone holds). */
export function podiumColumns<T extends Pick<ShowdownScoreRow, 'rank'>>(podium: readonly T[]): Array<{ rank: number; rows: T[] }> {
  const groups = groupByRank(podium.filter((p) => p.rank >= 1 && p.rank <= 3));
  return [2, 1, 3].map((rank) => groups.find((g) => g.rank === rank)).filter((g): g is { rank: number; rows: T[] } => Boolean(g));
}
