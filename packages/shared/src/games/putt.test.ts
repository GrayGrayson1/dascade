import { describe, expect, it } from 'vitest';
import { TOURNAMENT_GAME_SETTINGS } from '../tournamentGames.ts';
import {
  PUTT_PLAYOFF_HOLES,
  PUTT_TOURNAMENT_COURSES,
  PUTT_TOURNAMENT_SETTINGS,
  PuttSettingsSchema,
  puttPlayoffHoles,
  puttRoute,
  puttTournamentSettings,
} from './putt.ts';

describe('DAS Putt tournament course', () => {
  it('keeps the fixed tournament format and only takes the course length from the organizer', () => {
    for (const course of PUTT_TOURNAMENT_COURSES) {
      const s = puttTournamentSettings(course);
      expect(s).toEqual({ ...PUTT_TOURNAMENT_SETTINGS, course });
      expect(PuttSettingsSchema.safeParse(s).success).toBe(true);
    }
    expect(puttRoute(puttTournamentSettings('front'))).toEqual([1, 2, 3]);
    expect(puttRoute(puttTournamentSettings('back'))).toEqual([7, 8, 9]);
  });

  it('plays the full nine for a missing, practice-hole or bogus course', () => {
    for (const course of [undefined, 'single', 'nine', 3, null]) expect(puttTournamentSettings(course)).toEqual(PUTT_TOURNAMENT_SETTINGS);
  });

  it('the wizard offers exactly the tournament course lengths, full course first', () => {
    const [course] = TOURNAMENT_GAME_SETTINGS.putt!;
    expect(course!.key).toBe('course');
    expect(course!.options.map((o) => o.value)).toEqual([...PUTT_TOURNAMENT_COURSES]);
    expect(course!.defaultId).toBe('full');
  });
});

describe('DAS Putt playoff holes', () => {
  it('the full course keeps its playoff holes', () => {
    expect(puttPlayoffHoles(puttRoute({ course: 'full', hole: 1 }))).toEqual(PUTT_PLAYOFF_HOLES);
  });

  it('a shorter route replays its own holes, from its last one back', () => {
    expect(puttPlayoffHoles(puttRoute({ course: 'front', hole: 1 }))).toEqual([3, 2, 1]);
    expect(puttPlayoffHoles(puttRoute({ course: 'back', hole: 1 }))).toEqual([9, 8, 7]);
    for (const course of PUTT_TOURNAMENT_COURSES) {
      const route = puttRoute({ course, hole: 1 });
      for (const n of puttPlayoffHoles(route)) expect(route).toContain(n);
    }
  });
});
