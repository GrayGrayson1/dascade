/**
 * Test helpers for the tournament engine (imported by *.test.ts only; not exported from index).
 */
import { createSeededRng, defaultTournamentConfig, type GameId, type Rng, type TournamentConfig } from '@dascade/shared';
import { TournamentEngine } from './engine.ts';
import { isFinished } from './standings.ts';
import type { EngineMatch } from './types.ts';

export interface Harness {
  engine: TournamentEngine;
  rng: Rng;
  ids: string[];
  clock: { t: number };
}

export function makeTournament(
  n: number,
  patch: Partial<TournamentConfig> = {},
  opts: { seed?: string | number; gameId?: GameId; ratings?: number[]; begin?: boolean; fixedClock?: boolean } = {},
): Harness {
  const gameId = opts.gameId ?? patch.gameId ?? 'chess';
  const rng = createSeededRng(opts.seed ?? `t-${n}`);
  const clock = { t: 1_700_000_000_000 };
  const config: TournamentConfig = { ...defaultTournamentConfig(gameId), maxField: 64, ...patch, gameId };
  const engine = TournamentEngine.create(config, { rng, now: () => (opts.fixedClock ? clock.t : (clock.t += 1000)) });
  engine.openRegistration();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = engine.register({
      name: `P${i + 1}`,
      avatar: 'rocket',
      identity: `g:${i + 1}`,
      rating: opts.ratings?.[i] ?? 1200,
      ratingGames: 0,
      provisional: true,
    });
    ids.push(p.id);
  }
  if (opts.begin !== false) {
    engine.seed('manual', ids);
    engine.begin();
  }
  return { engine, rng, ids, clock };
}

export function live(engine: TournamentEngine): EngineMatch[] {
  return engine.data.matches.filter((m) => m.status === 'READY' || m.status === 'IN_PROGRESS');
}

/** Play one game of `m`: `outcome` 'a' | 'b' | 'draw'. */
export function playGame(engine: TournamentEngine, m: EngineMatch, outcome: 'a' | 'b' | 'draw', reason = 'test') {
  const winner = outcome === 'draw' ? null : outcome === 'a' ? m.a : m.b;
  return engine.recordGame(m.id, m.games.length + 1, winner, reason);
}

/** Win the whole series for slot a / b. */
export function winSeries(engine: TournamentEngine, m: EngineMatch, side: 'a' | 'b'): void {
  let guard = 0;
  while (!isFinished(m) && guard++ < 20) playGame(engine, m, side);
}

/** Assert-style invariant checks; returns a list of violations (empty = fine). */
export function invariantViolations(engine: TournamentEngine): string[] {
  const out: string[] = [];
  const d = engine.data;
  const active = live(engine);
  const busy = new Map<string, string>();
  for (const m of active) {
    if (!m.a || !m.b) out.push(`${m.id} live without both participants`);
    if (m.a && m.a === m.b) out.push(`${m.id} pairs a participant with themself`);
    for (const pid of [m.a, m.b]) {
      if (!pid) continue;
      if (busy.has(pid)) out.push(`${pid} in two live matches (${busy.get(pid)}, ${m.id})`);
      busy.set(pid, m.id);
      const p = engine.participant(pid);
      if (!p || ['disqualified', 'withdrawn', 'no_show'].includes(p.status)) out.push(`${pid} is out but plays ${m.id}`);
      if (p?.status === 'eliminated') out.push(`${pid} is eliminated but plays ${m.id}`);
    }
  }
  if (d.config.format === 'single_elimination' || d.config.format === 'double_elimination') {
    // A bracket slot is filled only when its feeder finishes, so nobody ever sits in two unfinished matches
    // (e.g. both brackets at once after a result change).
    const slotted = new Map<string, string>();
    for (const m of d.matches) {
      if (isFinished(m)) continue;
      for (const pid of [m.a, m.b]) {
        if (!pid) continue;
        if (slotted.has(pid)) out.push(`${pid} slotted in two unfinished matches (${slotted.get(pid)}, ${m.id})`);
        slotted.set(pid, m.id);
      }
    }
  }
  for (const m of d.matches) {
    if (isFinished(m) && m.status !== 'VOID' && m.resultKind !== 'bye' && m.resultKind !== 'double_forfeit' && !m.draw && !m.winner) {
      out.push(`${m.id} finished without a winner`);
    }
    if (m.winner && m.winner !== m.a && m.winner !== m.b) out.push(`${m.id} winner not in match`);
    if (m.requireWinner && m.draw) out.push(`${m.id} bracket match drawn`);
  }
  return out;
}

/** Random playout to completion. Returns the number of steps. */
export function playout(
  engine: TournamentEngine,
  rng: Rng,
  opts: { drawRate?: number; check?: (step: number) => void; maxSteps?: number } = {},
): number {
  let steps = 0;
  const max = opts.maxSteps ?? 20_000;
  while (engine.status === 'IN_PROGRESS' && steps < max) {
    const ms = live(engine);
    if (ms.length === 0) throw new Error(`stuck: no live matches (${engine.stageLabel()})`);
    const m = ms[rng.int(ms.length)]!;
    const r = rng.next();
    const outcome = r < (opts.drawRate ?? 0) ? 'draw' : rng.int(2) === 0 ? 'a' : 'b';
    const res = playGame(engine, m, outcome);
    if (!res.accepted) throw new Error(`game rejected: ${res.reason}`);
    steps++;
    opts.check?.(steps);
  }
  return steps;
}
