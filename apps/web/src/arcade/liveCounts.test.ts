import { describe, expect, it } from 'vitest';
import { CABINETS } from '@dascade/shared';
import { cabinetLive, liveLabel, parseLiveGames } from './liveCounts.ts';

describe('parseLiveGames', () => {
  it('treats a missing or malformed field as no data', () => {
    expect(parseLiveGames(undefined)).toBeNull();
    expect(parseLiveGames(null)).toBeNull();
    expect(parseLiveGames([1, 2])).toBeNull();
    expect(parseLiveGames('chess')).toBeNull();
  });

  it('keeps known games with rooms and drops junk', () => {
    expect(
      parseLiveGames({
        chess: { rooms: 2, players: 4 },
        trivia: { rooms: 1, players: 7.9 },
        holdem: { rooms: 0, players: 0 },
        bogus: { rooms: 3, players: 3 },
        words: { rooms: -1, players: 2 },
        snake: { rooms: 'x' },
        bingo: null,
      }),
    ).toEqual({ chess: { rooms: 2, players: 4 }, trivia: { rooms: 1, players: 7 } });
    expect(parseLiveGames({})).toEqual({});
  });
});

describe('cabinetLive', () => {
  it('sums a cabinet’s games and is null with nothing live', () => {
    const party = CABINETS.stravaganza;
    const games = parseLiveGames({
      trivia: { rooms: 1, players: 6 },
      deception: { rooms: 1, players: 3 },
      chess: { rooms: 5, players: 10 },
    });
    expect(cabinetLive(party, games)).toEqual({ rooms: 2, players: 9 });
    expect(cabinetLive(CABINETS.putt, games)).toBeNull();
    expect(cabinetLive(party, null)).toBeNull();
    expect(cabinetLive(party, {})).toBeNull();
  });

  it('counts a game once even when several menu entries share it (DASino tables)', () => {
    const dasino = CABINETS.dasino;
    const shared = dasino.games.filter((g) => g.gameId === 'dasino').length;
    expect(shared).toBeGreaterThan(1);
    expect(cabinetLive(dasino, { dasino: { rooms: 1, players: 4 } })).toEqual({ rooms: 1, players: 4 });
  });
});

describe('liveLabel', () => {
  it('reads naturally', () => {
    expect(liveLabel({ rooms: 2, players: 9 })).toBe('2 rooms live · 9 playing');
    expect(liveLabel({ rooms: 1, players: 1 })).toBe('1 room live · 1 playing');
    expect(liveLabel({ rooms: 1, players: 0 })).toBe('1 room live');
  });
});
