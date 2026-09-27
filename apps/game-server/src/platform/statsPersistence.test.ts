/**
 * Stats persistence failure handling (fake Supabase client / fake adapter): a database hiccup must
 * never overwrite stored ratings with defaults, and a failed write must never be lost.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GameId, GameOutcome } from '@dascade/shared';
import type { Rating } from '@dascade/game-core/rating';
import type { OutcomeContext } from './hub.ts';
import { applyRatedOutcome, getRating, resetRatings, setRating } from './ratings.ts';
import { ensureIdentityLoaded, loadedIdentityCount, resetIdentityLoads, withIdentitiesLoaded } from './statsLoader.ts';
import { SupabaseStatsPersistence, setStatsPersistence, type IdentitySnapshot, type StatsPersistence } from './statsPersistence.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!predicate()) throw new Error(`timed out: ${label}`);
};

/** Minimal stand-in for the two query shapes the adapter uses. */
function fakeSupabase(rows: Record<string, unknown[]> = {}) {
  const state = { failLoads: 0, failUpserts: 0, loads: 0, upserts: [] as Array<{ table: string; rows: Array<Record<string, unknown>> }> };
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          limit: async () => {
            state.loads++;
            if (state.failLoads > 0) {
              state.failLoads--;
              return { data: null, error: new Error('connection reset') };
            }
            return { data: rows[table] ?? [], error: null };
          },
        }),
      }),
      upsert: async (batch: Array<Record<string, unknown>>) => {
        if (state.failUpserts > 0) {
          state.failUpserts--;
          return { error: new Error('connection reset') };
        }
        state.upserts.push({ table, rows: batch });
        return { error: null };
      },
    }),
  };
  return { state, connect: async () => client as unknown as SupabaseClient };
}

const rating = (r: number, games: number): Rating => ({ rating: r, games, wins: games, losses: 0, draws: 0 });

describe('SupabaseStatsPersistence', () => {
  it('loadIdentity rejects when the database fails (never "no rows")', async () => {
    const db = fakeSupabase({
      player_ratings: [{ identity: 'g:a', game_id: 'chess', rating: 1500, games: 10, wins: 6, losses: 4, draws: 0 }],
    });
    const store = new SupabaseStatsPersistence(db.connect);
    db.state.failLoads = 1;
    await expect(store.loadIdentity('g:a')).rejects.toThrow(/connection reset/);
    const snap = await store.loadIdentity('g:a');
    expect(snap.ratings).toEqual([{ gameId: 'chess', rating: { rating: 1500, games: 10, wins: 6, losses: 4, draws: 0 } }]);
  });

  it('a failed flush keeps its rows (newer rows win) and the next flush writes them', async () => {
    const db = fakeSupabase();
    const store = new SupabaseStatsPersistence(db.connect);
    store.saveRating('g:a', 'chess', rating(1210, 1));
    store.saveRating('g:b', 'chess', rating(1190, 1));
    db.state.failUpserts = 1;
    await store.flush();
    expect(db.state.upserts).toEqual([]);
    expect(store.pendingCount).toBe(2);
    store.saveRating('g:a', 'chess', rating(1225, 2)); // newer than the failed row
    await store.flush();
    const written = db.state.upserts.flatMap((u) => u.rows);
    expect(written.map((r) => [r.identity, r.games]).sort()).toEqual([
      ['g:a', 2],
      ['g:b', 1],
    ]);
    expect(store.pendingCount).toBe(0);
  });
});

describe('identity hydration (statsLoader)', () => {
  let prev: StatsPersistence;
  let fake: {
    failures: number;
    loads: number;
    saved: Array<{ identity: string; rating: Rating }>;
    stored: Map<string, Rating>;
  };

  beforeEach(() => {
    fake = { failures: 0, loads: 0, saved: [], stored: new Map([['g:a', rating(1500, 10)]]) };
    const adapter: StatsPersistence = {
      enabled: true,
      async loadIdentity(identity: string): Promise<IdentitySnapshot> {
        fake.loads++;
        if (fake.failures > 0) {
          fake.failures--;
          throw new Error('connection reset');
        }
        const r = fake.stored.get(identity);
        return { ratings: r ? [{ gameId: 'chess' as GameId, rating: r }] : [], stats: [] };
      },
      async loadRecentRatings() {
        return [];
      },
      saveRating(identity, _gameId, r) {
        fake.saved.push({ identity, rating: r });
      },
      saveStats() {},
      async flush() {},
    };
    prev = setStatsPersistence(adapter);
    resetRatings();
    resetIdentityLoads({ retryDelaysMs: [5, 5] });
  });
  afterEach(() => {
    setStatsPersistence(prev);
    resetIdentityLoads({ retryDelaysMs: [2_000, 10_000, 30_000, 60_000, 120_000], maxLoaded: 20_000 });
    resetRatings();
  });

  const outcome: GameOutcome = { placements: [['pa'], ['pb']], reason: 'checkmate' };
  const ctx = (): OutcomeContext => ({
    gameId: 'chess',
    roomCode: 'ABCDE',
    rated: true,
    players: new Map([
      ['pa', { playerId: 'pa', name: 'A', guestId: 'a', spectator: false }],
      ['pb', { playerId: 'pb', name: 'B', guestId: 'b', spectator: false }],
    ]),
    tournament: null,
    startedAt: 1,
    endedAt: 2,
  });

  it('a load failure holds the update and retries; it then builds on the stored rating', async () => {
    fake.failures = 1;
    withIdentitiesLoaded(['g:a', 'g:b'], () => applyRatedOutcome(outcome, ctx()));
    await tick();
    expect(fake.saved).toEqual([]); // nothing written on top of defaults
    await until(() => fake.saved.length === 2, 'update applied');
    expect(fake.loads).toBeGreaterThanOrEqual(3); // g:a twice (failed, retried) + g:b
    const a = fake.saved.find((s) => s.identity === 'g:a')!.rating;
    expect(a.games).toBe(11);
    expect(a.rating).toBeGreaterThan(1500);
    expect(getRating('g:a', 'chess').games).toBe(11);
  });

  it('when the database stays down, the update is dropped (not applied to defaults) and the identity stays unloaded', async () => {
    fake.failures = 99;
    let ran = false;
    withIdentitiesLoaded(['g:a'], () => {
      ran = true;
    });
    const load = ensureIdentityLoaded('g:a');
    expect(load).not.toBeNull();
    await expect(load).rejects.toThrow(/connection reset/);
    await tick();
    expect(ran).toBe(false);
    expect(loadedIdentityCount()).toBe(0);
    fake.failures = 0;
    await ensureIdentityLoaded('g:a');
    expect(getRating('g:a', 'chess')).toMatchObject({ rating: 1500, games: 10 });
    expect(ensureIdentityLoaded('g:a')).toBeNull();
  });

  it('bounds the set of hydrated identities (random guest ids from the public stats route)', async () => {
    resetIdentityLoads({ maxLoaded: 50 });
    await ensureIdentityLoaded('g:a');
    setRating('g:a', 'chess', rating(1600, 12)); // newer than the stored row
    for (let i = 0; i < 200; i++) await ensureIdentityLoaded(`g:random-${i}`);
    expect(loadedIdentityCount()).toBe(50);
    // A forgotten identity is simply read again; numbers this process holds are never overwritten.
    const again = ensureIdentityLoaded('g:a');
    expect(again).not.toBeNull();
    await again;
    expect(getRating('g:a', 'chess')).toMatchObject({ rating: 1600, games: 12 });
  });
});
