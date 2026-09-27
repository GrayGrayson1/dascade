/**
 * Tournament persistence adapter: with Supabase configured, snapshots are mirrored to the
 * 0002_tournaments tables (no identities, audit written incrementally, failures swallowed).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  rows: unknown;
}
const calls: Call[] = [];
let failNext = false;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      upsert: async (rows: unknown) => {
        calls.push({ table, rows });
        if (failNext) {
          failNext = false;
          return { error: new Error('boom') };
        }
        return { error: null };
      },
    }),
  }),
}));

beforeAll(() => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:1';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
});

describe('tournamentStore (Supabase)', () => {
  it('writes definition, entrants, matches and new audit entries — never identities', async () => {
    vi.resetModules();
    const { tournamentStore } = await import('../src/platform/tournamentStore.ts');
    const { makeTournament, winSeries, live } = await import('../../../packages/game-core/src/tournament/testkit.ts');
    const { engine } = makeTournament(4, { name: 'Persisted Open', format: 'single_elimination' });
    await tournamentStore.save('tid-123456789', 'ABCDE', engine.data);
    const tables = calls.map((c) => c.table);
    expect(tables).toEqual(['tournaments', 'tournament_entrants', 'tournament_matches', 'tournament_audit']);
    const def = calls[0]!.rows as Record<string, unknown>;
    expect(def).toMatchObject({ id: 'tid-123456789', code: 'ABCDE', name: 'Persisted Open', status: 'IN_PROGRESS', format: 'single_elimination' });
    const everything = JSON.stringify(calls);
    expect(everything).not.toContain('g:1'); // rating identities never leave the server
    const auditRows = calls[3]!.rows as Array<{ entry_id: number }>;
    expect(auditRows.length).toBe(engine.data.audit.length);

    // Next save only writes audit entries that are new.
    calls.length = 0;
    winSeries(engine, live(engine)[0]!, 'a');
    engine.pause();
    await tournamentStore.save('tid-123456789', 'ABCDE', engine.data);
    const audit2 = calls.find((c) => c.table === 'tournament_audit')!.rows as Array<{ entry_id: number; action: string }>;
    expect(audit2.map((a) => a.action)).toEqual(['pause']);
  });

  it('a failing database never throws into the room', async () => {
    vi.resetModules();
    const { tournamentStore } = await import('../src/platform/tournamentStore.ts');
    const { makeTournament } = await import('../../../packages/game-core/src/tournament/testkit.ts');
    const { engine } = makeTournament(2);
    failNext = true;
    await expect(tournamentStore.save('tid-failing-1', 'FGHJK', engine.data)).resolves.toBeUndefined();
  });
});
