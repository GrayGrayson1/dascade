import { describe, expect, it } from 'vitest';
import {
  AWARD_NAME_MAX,
  awardSteps,
  cleanAwardText,
  defaultCategories,
  fireworksAt,
  placesFromPodium,
  revealedPlaces,
  type AwardCategory,
} from './awards.ts';

const cat = (title: string, names: [string, string, string]): AwardCategory => ({
  id: title,
  title,
  places: [
    { name: names[0], photo: '' },
    { name: names[1], photo: '' },
    { name: names[2], photo: '' },
  ],
});

describe('the awards ceremony', () => {
  it('starts with Best Costume, Best Background and Trivia Champions (filled from the finale)', () => {
    const cats = defaultCategories();
    expect(cats.map((c) => c.title)).toEqual(['Best Costume', 'Best Background', 'Trivia Champions']);
    expect(cats.map((c) => Boolean(c.finale))).toEqual([false, false, true]);
  });

  it('steps: the title, each award with a winner and its places 3rd → 2nd → 1st (filled ones only), then Thanks', () => {
    const steps = awardSteps([cat('Costume', ['Ada', 'Ben', 'Cyd']), cat('Empty', ['', '', '']), cat('Background', ['Dee', '', 'Eve'])]);
    expect(steps).toEqual([
      { kind: 'title' },
      { kind: 'category', cat: 0 },
      { kind: 'place', cat: 0, place: 3 },
      { kind: 'place', cat: 0, place: 2 },
      { kind: 'place', cat: 0, place: 1 },
      { kind: 'category', cat: 2 },
      { kind: 'place', cat: 2, place: 3 },
      { kind: 'place', cat: 2, place: 1 },
      { kind: 'thanks' },
    ]);
    // What's up at each step: a category's places so far, never the next one's.
    expect([...revealedPlaces(steps, 3, 0)].sort()).toEqual([2, 3]);
    expect([...revealedPlaces(steps, 5, 2)]).toEqual([]);
    expect([...revealedPlaces(steps, 7, 2)].sort()).toEqual([1, 3]);
    // Fireworks from the very last winner on.
    expect(fireworksAt(steps, 6)).toBe(false);
    expect(fireworksAt(steps, 7)).toBe(true);
    expect(fireworksAt(steps, 8)).toBe(true);
    // Nobody to award: the title and the thanks, no fireworks.
    const none = awardSteps(defaultCategories());
    expect(none.map((s) => s.kind)).toEqual(['title', 'thanks']);
    expect(fireworksAt(none, 1)).toBe(false);
  });

  it('names are trimmed, single-spaced and capped; the finale’s podium fills Trivia Champions (ties share a place)', () => {
    expect(cleanAwardText('  Morgan   R.  ')).toBe('Morgan R.');
    expect(cleanAwardText('x'.repeat(100))).toHaveLength(AWARD_NAME_MAX);
    expect(
      placesFromPodium([
        { playerId: 'a', name: 'Ada', points: 30, rank: 1 },
        { playerId: 'b', name: 'Ben', points: 30, rank: 1 },
        { playerId: 'c', name: 'Cyd', points: 12, rank: 3 },
      ]),
    ).toEqual(['Ada & Ben', '', 'Cyd']);
  });
});
