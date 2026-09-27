import { describe, expect, it } from 'vitest';
import { createSeededRng, TOURNAMENT_FORMATS, type TournamentFormat } from '@dascade/shared';
import { isFinished, isOut } from './standings.ts';
import { invariantViolations, live, makeTournament, playGame } from './testkit.ts';
import type { TournamentEngine } from './engine.ts';
import { TournamentError } from './types.ts';

/**
 * Chaos playouts: organizer actions and removals interleaved with games. The event must never get
 * stuck (a running tournament always has something playable unless paused), invariants hold after
 * every step, and it always completes.
 */
function chaos(engine: TournamentEngine, seed: string): void {
  const rng = createSeededRng(seed);
  let steps = 0;
  while (engine.status === 'IN_PROGRESS' && steps++ < 5000) {
    const roll = rng.next();
    const eligible = engine.data.participants.filter((p) => p.seed > 0 && !isOut(p) && p.status !== 'eliminated');
    if (engine.data.paused) {
      engine.resume();
    } else if (roll < 0.03) {
      engine.pause();
    } else if (roll < 0.06 && eligible.length > 1) {
      const p = eligible[rng.int(eligible.length)]!;
      if (rng.int(2) === 0) engine.disqualify(p.id, 'chaos');
      else engine.withdraw(p.id);
    } else if (roll < 0.1) {
      const ms = live(engine);
      if (ms.length) {
        const m = ms[rng.int(ms.length)]!;
        engine.forfeit(m.id, rng.int(2) === 0 ? m.a! : m.b!, 'chaos', 'system');
      }
    } else if (roll < 0.13) {
      const ms = live(engine);
      if (ms.length) {
        const m = ms[rng.int(ms.length)]!;
        const r = rng.int(3);
        if (r === 0) engine.override(m.id, 'double_forfeit', null, 'chaos');
        else if (r === 1 && !m.requireWinner) engine.override(m.id, 'draw', null, 'chaos');
        else engine.override(m.id, 'win', rng.int(2) === 0 ? m.a : m.b, 'chaos');
      }
    } else if (roll < 0.15) {
      // Amend a finished result: allowed only while nothing derived from it (directly or through byes) has started.
      const done = engine.data.matches.filter((m) => isFinished(m) && m.a && m.b && m.status !== 'VOID' && m.resultKind !== 'bye');
      if (done.length) {
        const m = done[rng.int(done.length)]!;
        try {
          if (m.requireWinner || rng.int(2) === 0) engine.override(m.id, 'win', m.winner === m.a ? m.b : m.a, 'chaos');
          else engine.override(m.id, 'draw', null, 'chaos');
        } catch (err) {
          if (!(err instanceof TournamentError) || err.code !== 'not_allowed') throw err;
        }
      }
    } else {
      const ms = live(engine);
      if (ms.length === 0) throw new Error(`stuck at step ${steps}: ${engine.stageLabel()}`);
      const m = ms[rng.int(ms.length)]!;
      const outcome = rng.next() < 0.15 ? 'draw' : rng.int(2) === 0 ? 'a' : 'b';
      const res = playGame(engine, m, outcome);
      expect(res.accepted).toBe(true);
    }
    const violations = invariantViolations(engine);
    if (violations.length) throw new Error(`step ${steps}: ${violations.join('; ')}`);
    if (engine.status === 'IN_PROGRESS' && !engine.data.paused && live(engine).length === 0) {
      throw new Error(`stuck after step ${steps}: ${engine.stageLabel()}`);
    }
  }
}

describe('chaos playouts', () => {
  for (const format of TOURNAMENT_FORMATS) {
    it(`${format}: removals, forfeits, overrides and pauses never corrupt or stall the event`, () => {
      const rng = createSeededRng(`chaos-${format}`);
      for (let trial = 0; trial < 60; trial++) {
        const n = 2 + rng.int(format === 'round_robin' ? 10 : 30);
        const bestOf = [1, 2, 3][rng.int(3)]!;
        const { engine } = makeTournament(n, { format: format as TournamentFormat, bestOf, swissRounds: 0 }, { seed: `${format}-${trial}` });
        chaos(engine, `${format}-${trial}-play`);
        expect(engine.status).toBe('COMPLETE');
        expect(engine.data.matches.every((m) => isFinished(m))).toBe(true);
        const remaining = engine.data.participants.filter((p) => p.seed > 0 && !isOut(p));
        if (engine.data.championId) {
          const champ = engine.participant(engine.data.championId)!;
          expect(isOut(champ)).toBe(false);
          expect(champ.status).toBe('champion');
        } else if (format === 'round_robin' || format === 'swiss') {
          expect(remaining).toHaveLength(0);
        }
        // Standings always compute and never rank a removed participant.
        const rows = engine.standings().rows;
        for (const r of rows) {
          const p = engine.participant(r.participantId)!;
          if (isOut(p)) expect(r.rank).toBe(0);
        }
      }
    });
  }
});
