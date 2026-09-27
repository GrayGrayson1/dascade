/**
 * Standings and tiebreaks.
 *
 * Round robin / Swiss: match points (win 1, draw ½, forfeit win 1, Swiss bye 1, RR bye 0), then the
 * format's tiebreaks in order (FORMAT_TIEBREAKS in @dascade/shared), then shared place / better seed.
 * Rounds without a real opponent (bye, forfeit) count as a game against a virtual opponent with the
 * player's own score for Buchholz (FIDE 2023 tie-break regulations, simplified); Sonneborn-Berger
 * counts played games only.
 *
 * Elimination: ranked by how far each participant got (champion 1, runner-up 2, then shared places
 * by the stage they went out in).
 */
import { FORMAT_TIEBREAKS, type TiebreakId, type TournamentStandingRow, type TournamentStandings } from '@dascade/shared';
import { seriesState } from './series.ts';
import type { EngineMatch, EngineParticipant, TournamentData } from './types.ts';

export type ResultKind = 'played' | 'bye' | 'forfeit_win' | 'forfeit_loss' | 'double_forfeit';

export interface RoundResult {
  round: number;
  matchId: string;
  opponent: string | null;
  /** Match points earned. */
  score: number;
  kind: ResultKind;
  gamePoints: number;
}

const FINISHED = new Set(['COMPLETE', 'FORFEIT']);

export function isFinished(m: Pick<EngineMatch, 'status'>): boolean {
  return m.status === 'COMPLETE' || m.status === 'FORFEIT' || m.status === 'VOID';
}

/** Participants who entered the field (seeded at the start). */
export function fieldOf(data: TournamentData): EngineParticipant[] {
  return data.participants.filter((p) => p.seed > 0).sort((a, b) => a.seed - b.seed);
}

export function isOut(p: Pick<EngineParticipant, 'status'>): boolean {
  return p.status === 'disqualified' || p.status === 'withdrawn' || p.status === 'no_show';
}

/** Round-robin / Swiss results per participant (finished matches only, in round order). */
export function roundResults(data: TournamentData): Map<string, RoundResult[]> {
  const byeScore = data.config.format === 'swiss' ? 1 : 0;
  const out = new Map<string, RoundResult[]>();
  const push = (pid: string, r: RoundResult) => {
    const list = out.get(pid) ?? [];
    list.push(r);
    out.set(pid, list);
  };
  for (const m of data.matches) {
    if (m.bracket !== 'main' || !FINISHED.has(m.status)) continue;
    if (m.resultKind === 'bye') {
      if (m.a) push(m.a, { round: m.round, matchId: m.id, opponent: null, score: byeScore, kind: 'bye', gamePoints: 0 });
      continue;
    }
    if (!m.a || !m.b) continue;
    const gp = m.games.length > 0 ? gamePoints(m) : { [m.a]: 0, [m.b]: 0 };
    if (m.resultKind === 'double_forfeit') {
      push(m.a, { round: m.round, matchId: m.id, opponent: m.b, score: 0, kind: 'double_forfeit', gamePoints: 0 });
      push(m.b, { round: m.round, matchId: m.id, opponent: m.a, score: 0, kind: 'double_forfeit', gamePoints: 0 });
      continue;
    }
    const unplayed = m.resultKind === 'forfeit' || m.resultKind === 'dq' || (m.resultKind === 'override' && m.games.length === 0);
    for (const [me, other] of [
      [m.a, m.b],
      [m.b, m.a],
    ] as const) {
      const score = m.winner === me ? 1 : m.winner === other ? 0 : 0.5;
      const kind: ResultKind = unplayed ? (score >= 1 ? 'forfeit_win' : score === 0 ? 'forfeit_loss' : 'played') : 'played';
      push(me, { round: m.round, matchId: m.id, opponent: other, score, kind, gamePoints: gp[me] ?? 0 });
    }
  }
  for (const list of out.values()) list.sort((x, y) => x.round - y.round);
  return out;
}

function gamePoints(m: EngineMatch): Record<string, number> {
  if (!m.a || !m.b) return {};
  return seriesState({ a: m.a, b: m.b, bestOf: m.bestOf, requireWinner: m.requireWinner, sides: false, firstId: null }, m.games).points;
}

interface Row extends TournamentStandingRow {
  seedOrder: number;
  results: RoundResult[];
}

export function tableStandings(data: TournamentData): TournamentStandings {
  const format = data.config.format;
  const tiebreaks = [...FORMAT_TIEBREAKS[format]] as TiebreakId[];
  const results = roundResults(data);
  const field = fieldOf(data);
  const rows: Row[] = field.map((p) => {
    const res = results.get(p.id) ?? [];
    let points = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let byes = 0;
    let played = 0;
    let gp = 0;
    for (const r of res) {
      points += r.score;
      gp += r.gamePoints;
      if (r.kind === 'bye') {
        byes++;
        continue;
      }
      played++;
      if (r.score >= 1) wins++;
      else if (r.score === 0.5) draws++;
      else losses++;
    }
    return {
      participantId: p.id,
      rank: 0,
      shared: false,
      points,
      played,
      wins,
      draws,
      losses,
      byes,
      gamePoints: gp,
      tiebreaks: {},
      eliminatedIn: '',
      seedOrder: p.seed,
      results: res,
    };
  });
  const pointsOf = new Map(rows.map((r) => [r.participantId, r.points]));
  for (const row of rows) {
    const contributions = row.results.map((r) => (r.kind === 'played' && r.opponent ? (pointsOf.get(r.opponent) ?? 0) : row.points));
    const bh = contributions.reduce((s, v) => s + v, 0);
    const cut = contributions.length > 0 ? bh - Math.min(...contributions) : 0;
    let sb = 0;
    let progressive = 0;
    let running = 0;
    for (const r of row.results) {
      if (r.kind === 'played' && r.opponent) sb += r.score * (pointsOf.get(r.opponent) ?? 0);
      running += r.score;
      progressive += running;
    }
    const values: Partial<Record<TiebreakId, number>> = {
      buchholz: bh,
      buchholz_cut1: cut,
      sonneborn_berger: sb,
      wins: row.wins,
      progressive,
    };
    for (const id of tiebreaks) if (id !== 'direct_encounter') row.tiebreaks[id] = values[id] ?? 0;
  }

  const active = rows.filter((r) => !isOut(data.participants.find((p) => p.id === r.participantId)!));
  const out = rows.filter((r) => !active.includes(r));
  const classes = rankGroup(active.sort((a, b) => b.points - a.points), tiebreaks, 0, results, true);
  let position = 1;
  const ordered: Row[] = [];
  for (const cls of classes) {
    cls.sort((a, b) => a.seedOrder - b.seedOrder);
    for (const row of cls) {
      row.rank = position;
      row.shared = cls.length > 1;
      ordered.push(row);
    }
    position += cls.length;
  }
  for (const row of out.sort((a, b) => b.points - a.points || a.seedOrder - b.seedOrder)) {
    row.rank = 0;
    ordered.push(row);
  }
  return {
    format,
    tiebreaks,
    final: data.status === 'COMPLETE',
    rows: ordered.map(strip),
  };
}

function strip(row: Row): TournamentStandingRow {
  const { seedOrder: _s, results: _r, ...rest } = row;
  return rest;
}

/** Split a group into ordered tie classes by points (first call) and then each tiebreak in turn. */
function rankGroup(group: Row[], tiebreaks: TiebreakId[], index: number, results: Map<string, RoundResult[]>, byPoints: boolean): Row[][] {
  if (group.length <= 1) return group.length ? [group] : [];
  if (byPoints) return splitBy(group, (r) => r.points).flatMap((g) => rankGroup(g, tiebreaks, 0, results, false));
  if (index >= tiebreaks.length) return [group];
  const tb = tiebreaks[index]!;
  if (tb === 'direct_encounter') {
    const ids = new Set(group.map((r) => r.participantId));
    const allMet = group.every((r) => {
      const opps = new Set((results.get(r.participantId) ?? []).filter((x) => x.opponent && x.kind !== 'double_forfeit').map((x) => x.opponent));
      return [...ids].every((id) => id === r.participantId || opps.has(id));
    });
    for (const r of group) {
      r.tiebreaks.direct_encounter = allMet
        ? (results.get(r.participantId) ?? []).filter((x) => x.opponent && ids.has(x.opponent)).reduce((s, x) => s + x.score, 0)
        : 0;
    }
  }
  return splitBy(group, (r) => r.tiebreaks[tb] ?? 0).flatMap((g) => rankGroup(g, tiebreaks, index + 1, results, false));
}

function splitBy(group: Row[], key: (r: Row) => number): Row[][] {
  const sorted = [...group].sort((a, b) => key(b) - key(a));
  const out: Row[][] = [];
  for (const row of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(key(last[0]!) - key(row)) < 1e-9) last.push(row);
    else out.push([row]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Elimination
// ---------------------------------------------------------------------------

export interface EliminationOutcome {
  /** Participant id → elimination info (absent = still alive or champion). */
  eliminated: Map<string, { depth: number; stage: string }>;
  championId: string | null;
  /** The deciding match has finished (champion known, possibly null when everyone was removed). */
  decided: boolean;
}

function stageDepth(m: EngineMatch, lbRounds: number): number {
  if (m.bracket === 'winners') return m.round;
  if (m.bracket === 'losers') return m.round;
  return lbRounds + 1; // grand final / reset
}

export function eliminationOutcome(data: TournamentData): EliminationOutcome {
  const eliminated = new Map<string, { depth: number; stage: string }>();
  const lbRounds = Math.max(0, ...data.matches.filter((m) => m.bracket === 'losers').map((m) => m.round));
  const byId = new Map(data.matches.map((m) => [m.id, m]));
  for (const m of data.matches) {
    if (!FINISHED.has(m.status)) continue;
    const depth = stageDepth(m, lbRounds);
    if (m.resultKind === 'double_forfeit') {
      for (const p of [m.a, m.b]) if (p) eliminated.set(p, { depth, stage: m.roundLabel });
      continue;
    }
    if (!m.loser) continue;
    if (m.loserNext) {
      const dest = byId.get(m.loserNext.matchId);
      if (dest && dest.status !== 'VOID') continue; // drops into the losers bracket
    }
    if (m.id === 'GF') {
      const reset = byId.get('GF2');
      if (reset && reset.status !== 'VOID') continue; // bracket reset pending / played
    }
    eliminated.set(m.loser, { depth, stage: m.roundLabel });
  }
  const finalMatch =
    data.config.format === 'double_elimination'
      ? (() => {
          const reset = byId.get('GF2');
          return reset && reset.status !== 'VOID' ? reset : byId.get('GF');
        })()
      : data.matches.filter((m) => m.bracket === 'winners' && !m.next)[0];
  const decided = Boolean(finalMatch && isFinished(finalMatch));
  const championId = finalMatch && FINISHED.has(finalMatch.status) ? finalMatch.winner : null;
  return { eliminated, championId, decided };
}

export function eliminationStandings(data: TournamentData): TournamentStandings {
  const outcome = eliminationOutcome(data);
  const field = fieldOf(data);
  const rows: TournamentStandingRow[] = field.map((p) => {
    let wins = 0;
    let losses = 0;
    let draws = 0;
    let played = 0;
    let byes = 0;
    let gp = 0;
    for (const m of data.matches) {
      if (!FINISHED.has(m.status) || (m.a !== p.id && m.b !== p.id)) continue;
      if (m.resultKind === 'bye') {
        byes++;
        continue;
      }
      played++;
      if (m.winner === p.id) wins++;
      else if (m.winner) losses++;
      else if (m.resultKind === 'double_forfeit') losses++;
      else draws++;
      if (m.games.length > 0) gp += gamePoints(m)[p.id] ?? 0;
    }
    const out = outcome.eliminated.get(p.id);
    let rank = 0;
    if (p.id === outcome.championId && data.status === 'COMPLETE') rank = 1;
    else if (out && !isOut(p)) {
      const deeper = field.filter((q) => {
        if (q.id === p.id || isOut(q)) return false;
        const qo = outcome.eliminated.get(q.id);
        return !qo || qo.depth > out.depth;
      }).length;
      rank = deeper + 1;
    }
    return {
      participantId: p.id,
      rank,
      shared: false,
      points: wins,
      played,
      wins,
      draws,
      losses,
      byes,
      gamePoints: gp,
      tiebreaks: {},
      eliminatedIn: out?.stage ?? '',
    };
  });
  const rankCount = new Map<number, number>();
  for (const r of rows) if (r.rank > 0) rankCount.set(r.rank, (rankCount.get(r.rank) ?? 0) + 1);
  for (const r of rows) r.shared = r.rank > 0 && (rankCount.get(r.rank) ?? 0) > 1;
  const seedOf = new Map(field.map((p) => [p.id, p.seed]));
  rows.sort((a, b) => (a.rank || 1e6) - (b.rank || 1e6) || (seedOf.get(a.participantId) ?? 0) - (seedOf.get(b.participantId) ?? 0));
  return { format: data.config.format, tiebreaks: [], final: data.status === 'COMPLETE', rows };
}

export function computeStandings(data: TournamentData): TournamentStandings {
  if (data.config.format === 'round_robin' || data.config.format === 'swiss') return tableStandings(data);
  return eliminationStandings(data);
}
