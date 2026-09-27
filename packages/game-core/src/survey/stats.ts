/**
 * Standings, awards and the end-of-game recap. Everything here is built from PREDICTION
 * accuracy and anonymous aggregates only — never from individual answers, so nothing at the
 * end of the game can reveal how a particular player answered.
 */
import type { SurveyAward, SurveyHistoryEntry, SurveyRecapItem, SurveyResult } from '@dascade/shared/games/survey';
import { formatPercent } from '@dascade/shared/games/survey';
import { spread } from './tally.ts';

export interface ScoreRow {
  id: string;
  score: number;
}

/**
 * Standard competition ranking ("1, 1, 3"): sorted by score (highest first), players on equal
 * scores share a place and keep their input order (the room passes join order).
 */
export function placeStandings<T extends ScoreRow>(rows: readonly T[]): Array<T & { place: number }> {
  const sorted = rows.map((row, i) => ({ row, i })).sort((a, b) => b.row.score - a.row.score || a.i - b.i);
  let place = 0;
  let prev: number | null = null;
  return sorted.map(({ row }, idx) => {
    if (prev === null || row.score !== prev) place = idx + 1;
    prev = row.score;
    return { ...row, place };
  });
}

/** Placement groups for reportOutcome: [[winners…], [second…], …]. */
export function placementGroups(rows: readonly ScoreRow[]): string[][] {
  const groups: string[][] = [];
  let last = -1;
  for (const row of placeStandings(rows)) {
    if (row.place !== last) groups.push([]);
    groups[groups.length - 1]!.push(row.id);
    last = row.place;
  }
  return groups;
}

interface PlayerStat {
  majorityHits: number;
  calledIt: number;
  percentCount: number;
  /** Sum of percentage points off, in tenths (integers keep comparisons exact). */
  percentOffTenths: number;
  rankCount: number;
  rankOff: number;
  perfect: number;
}

const blank = (): PlayerStat => ({
  majorityHits: 0,
  calledIt: 0,
  percentCount: 0,
  percentOffTenths: 0,
  rankCount: 0,
  rankOff: 0,
  perfect: 0,
});

export class SurveyStats {
  private readonly per = new Map<string, PlayerStat>();
  private percentQuestions = 0;
  private rankQuestions = 0;

  /** Fold one revealed (non-voided) question's scores into the per-player stats. */
  record(result: SurveyResult): void {
    if (result.voided) return;
    const mode = result.question.mode;
    if (mode === 'percent') this.percentQuestions++;
    if (mode === 'rank') this.rankQuestions++;
    for (const s of result.scores) {
      let st = this.per.get(s.playerId);
      if (!st) {
        st = blank();
        this.per.set(s.playerId, st);
      }
      if (mode === 'majority') {
        if (s.hit) st.majorityHits++;
        if (s.bonus > 0) st.calledIt++;
      } else if (mode === 'percent') {
        st.percentCount++;
        st.percentOffTenths += Math.round(s.off * 10);
      } else {
        st.rankCount++;
        st.rankOff += s.off;
        if (s.hit) st.perfect++;
      }
    }
  }

  reset(): void {
    this.per.clear();
    this.percentQuestions = 0;
    this.rankQuestions = 0;
  }

  /**
   * Awards for players still in the room (`nameOf` returns undefined for players who left).
   * Ties share an award, but an award is only given when it singles out standouts: if more
   * than half of the players tie for it (e.g. everyone got every ranking right) it is skipped.
   */
  awards(nameOf: (id: string) => string | undefined): SurveyAward[] {
    const present = [...this.per.entries()].filter(([id]) => nameOf(id) !== undefined);
    const out: SurveyAward[] = [];
    const maxWinners = Math.max(1, Math.floor(present.length / 2));
    const push = (id: SurveyAward['id'], ids: string[], value: string) => {
      if (ids.length === 0 || ids.length > maxWinners) return;
      out.push({ id, playerIds: ids, names: ids.map((pid) => nameOf(pid) ?? 'Player'), value });
    };

    const most = (score: (s: PlayerStat) => number): { ids: string[]; value: number } => {
      let best = 0;
      let ids: string[] = [];
      for (const [id, st] of present) {
        const v = score(st);
        if (v <= 0) continue;
        if (v > best) {
          best = v;
          ids = [id];
        } else if (v === best) ids.push(id);
      }
      return { ids, value: best };
    };

    // Lowest average (sum/count), compared exactly by cross-multiplication.
    const lowestAvg = (sum: (s: PlayerStat) => number, count: (s: PlayerStat) => number, minCount: number) => {
      let best: { sum: number; count: number } | null = null;
      let ids: string[] = [];
      for (const [id, st] of present) {
        const c = count(st);
        if (c < minCount || c === 0) continue;
        const v = { sum: sum(st), count: c };
        const cmp = best ? v.sum * best.count - best.sum * v.count : -1;
        if (cmp < 0) {
          best = v;
          ids = [id];
        } else if (cmp === 0) ids.push(id);
      }
      return { ids, avg: best ? best.sum / best.count : 0 };
    };

    const reader = most((s) => s.majorityHits);
    push('mind-reader', reader.ids, `${reader.value} majority call${reader.value === 1 ? '' : 's'}`);

    if (this.percentQuestions > 0) {
      const baro = lowestAvg(
        (s) => s.percentOffTenths,
        (s) => s.percentCount,
        Math.min(2, this.percentQuestions),
      );
      const avg = Math.round(baro.avg) / 10;
      push('barometer', baro.ids, `avg ${Number.isInteger(avg) ? avg.toFixed(0) : avg.toFixed(1)} points off`);
    }

    if (this.rankQuestions > 0) {
      const ranker = lowestAvg(
        (s) => s.rankOff,
        (s) => s.rankCount,
        Math.min(2, this.rankQuestions),
      );
      const avg = Math.round(ranker.avg * 10) / 10;
      push(
        'ranker',
        ranker.ids,
        avg === 0 ? 'every order perfect' : `avg ${Number.isInteger(avg) ? avg.toFixed(0) : avg.toFixed(1)} spots off`,
      );
    }

    const bold = most((s) => s.calledIt);
    push('bold', bold.ids, `${bold.value} bold call${bold.value === 1 ? '' : 's'}`);
    return out;
  }
}

/** Summarises a revealed question for the history / recap (aggregates only). */
export function historyEntry(result: SurveyResult): SurveyHistoryEntry {
  const q = result.question;
  const base: SurveyHistoryEntry = {
    q: result.q,
    index: result.index,
    mode: q.mode,
    prompt: q.prompt,
    voided: result.voided,
    respondents: result.respondents,
    headline: '',
    share: 0,
    margin: 0,
    predictors: result.predictors,
    hitRate: 0,
  };
  if (result.voided) return base;
  const { top, margin } = spread(result.counts);
  base.headline = result.leaders.map((i) => q.options[i] ?? '').join(' & ');
  base.share = top;
  base.margin = margin;
  const hits = result.scores.filter((s) => s.hit).length;
  base.hitRate = result.scores.length > 0 ? Math.round((hits * 100) / result.scores.length) : 0;
  return base;
}

/** "Your room in numbers": the most united, most divided and most surprising questions. */
export function buildRecap(history: readonly SurveyHistoryEntry[]): SurveyRecapItem[] {
  const live = history.filter((h) => !h.voided && h.respondents > 0);
  const out: SurveyRecapItem[] = [];
  const used = new Set<number>();

  const united = [...live].filter((h) => h.share >= 60).sort((a, b) => b.share - a.share || a.index - b.index)[0];
  if (united) {
    used.add(united.q);
    out.push({
      id: 'united',
      title: 'Most united',
      prompt: united.prompt,
      detail: united.share >= 100 ? `Everyone picked “${united.headline}”.` : `${formatPercent(united.share)} picked “${united.headline}”.`,
    });
  }

  const divided = [...live].filter((h) => !used.has(h.q) && h.margin <= 20).sort((a, b) => a.margin - b.margin || a.index - b.index)[0];
  if (divided) {
    used.add(divided.q);
    out.push({
      id: 'divided',
      title: 'Most divided',
      prompt: divided.prompt,
      detail:
        divided.margin === 0
          ? `A dead heat: ${divided.headline}.`
          : `Only ${formatPercent(divided.margin).replace('%', '')} points separated the top two.`,
    });
  }

  const surprise = [...live]
    .filter((h) => !used.has(h.q) && h.predictors >= 2 && h.hitRate < 50)
    .sort((a, b) => a.hitRate - b.hitRate || a.index - b.index)[0];
  if (surprise) {
    out.push({
      id: 'surprise',
      title: 'Biggest surprise',
      prompt: surprise.prompt,
      detail: surprise.hitRate === 0 ? 'Nobody saw that result coming.' : `Only ${surprise.hitRate}% of predictions landed.`,
    });
  }
  return out;
}
