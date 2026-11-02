import { describe, expect, it } from 'vitest';
import type { RoomLookup } from '@dascade/shared';
import { joinOutlook } from './joinOutlook.ts';

const room = (patch: Partial<RoomLookup> = {}): RoomLookup => ({
  exists: true,
  code: 'ABCDE',
  gameId: 'chess',
  phase: 'LOBBY',
  players: 1,
  maxPlayers: 2,
  locked: false,
  full: false,
  allowSpectators: true,
  ...patch,
});

describe('joinOutlook', () => {
  it('a lobby with a free seat: just the count, no warning', () => {
    expect(joinOutlook(room(), false)).toEqual({ status: 'Lobby · 1/2 players', joinsAs: 'player', warning: null, offerWatch: false });
  });

  it('a running game that takes late players: a seat, with "Watch instead" on offer', () => {
    const out = joinOutlook(room({ phase: 'PLAYING', players: 4, maxPlayers: 8 }), true);
    expect(out).toEqual({ status: 'In progress · 4/8 players', joinsAs: 'player', warning: null, offerWatch: true });
  });

  it('a running game that does not take late players warns before seating them as a spectator', () => {
    const out = joinOutlook(room({ phase: 'PLAYING' }), false)!;
    expect(out.joinsAs).toBe('spectator');
    expect(out.warning).toMatch(/you’ll watch it, and you’re dealt in when the next one starts/);
    expect(out.offerWatch).toBe(true);
  });

  it('a full room: spectating, said up front', () => {
    const out = joinOutlook(room({ players: 2, full: true }), true)!;
    expect(out).toMatchObject({ status: 'Full · 2/2 players', joinsAs: 'spectator', offerWatch: false });
    expect(out.warning).toMatch(/spectator/);
  });

  it('refusals the server would give: locked, closing, or full / in progress without spectators', () => {
    expect(joinOutlook(room({ locked: true }), true)).toMatchObject({ status: 'Locked', joinsAs: 'refused' });
    expect(joinOutlook(room({ phase: 'ENDED' }), true)).toMatchObject({ joinsAs: 'refused' });
    expect(joinOutlook(room({ full: true, allowSpectators: false }), true)).toMatchObject({ joinsAs: 'refused', offerWatch: false });
    expect(joinOutlook(room({ phase: 'PLAYING', allowSpectators: false }), false)).toMatchObject({ joinsAs: 'refused' });
  });

  it('no outlook for a room that does not exist', () => {
    expect(joinOutlook({ exists: false, code: 'ABCDE' }, true)).toBeNull();
  });
});
