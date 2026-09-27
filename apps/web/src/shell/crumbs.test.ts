import { describe, expect, it } from 'vitest';
import { GAME_IDS, cabinetForGame } from '@dascade/shared';
import { crumbCabinet } from './crumbs.ts';

describe('crumbCabinet', () => {
  it('names the multi-game cabinet before a game inside it', () => {
    expect(crumbCabinet('holdem')?.id).toBe('dasino');
    expect(crumbCabinet('blackjack')?.id).toBe('dasino');
    expect(crumbCabinet('chess')?.id).toBe('boardroom');
    expect(crumbCabinet('trivia')?.id).toBe('stravaganza');
    expect(crumbCabinet('circuit')?.id).toBe('circuit');
    expect(crumbCabinet('kart')?.id).toBe('circuit');
  });

  it('never repeats the game ("DASino › DASino") and skips single-game cabinets', () => {
    expect(crumbCabinet('dasino')).toBeNull();
    expect(crumbCabinet('wheel')).toBeNull();
    expect(crumbCabinet('tournament')).toBeNull();
    for (const id of GAME_IDS) {
      const cabinet = crumbCabinet(id);
      if (cabinet) expect(cabinet).toBe(cabinetForGame(id));
    }
  });
});
