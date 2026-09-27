import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import { CHAIN_BONUS, chainPrefixOf, lengthPoints } from '@dascade/shared/games/words';
import { WordDictionary } from './dictionary.ts';
import { ChainGame, VIABLE_FOLLOWUPS, followUps, isViableLink, linkSeconds, pickStarter } from './chain.ts';

// Build a dictionary where every letter has plenty of everyday follow-ups, except "x" and "q".
const syllables = ['ab', 'el', 'on', 'ur', 'id', 'et', 'an', 'or', 'is', 'um', 'ep', 'ag'];
const common: string[] = [];
for (const first of 'abcdefghijklmnoprstuvwyz') {
  for (const s of syllables) common.push(`${first}${s}ed`, `${first}${s}ing`);
}
const extra = ['lemon', 'nectar', 'radish', 'hazel', 'zebra', 'apple', 'eagle', 'relax', 'onion', 'next', 'xylem', 'narthex'];
const DICT = WordDictionary.fromWords([...common, ...extra, 'qat', 'shit'], [...common, ...extra]);

function game(opts: Partial<ConstructorParameters<typeof ChainGame>[0]> = {}) {
  return new ChainGame({ rule: 'last', minLength: 3, lives: 2, maxLinks: 10, ...opts }, DICT, createSeededRng('chain'));
}

describe('link rules', () => {
  it('prefix = last letter, or last two letters', () => {
    expect(chainPrefixOf('lemon', 'last')).toBe('n');
    expect(chainPrefixOf('lemon', 'last2')).toBe('on');
  });

  it('link timer speeds up every two links down to half (min 6 s)', () => {
    expect(linkSeconds(15, 1)).toBe(15);
    expect(linkSeconds(15, 2)).toBe(15);
    expect(linkSeconds(15, 3)).toBe(14);
    expect(linkSeconds(15, 30)).toBe(8);
    expect(linkSeconds(8, 30)).toBe(6);
  });

  it('viability counts unburned everyday follow-ups', () => {
    expect(followUps('n', DICT, new Set(), 3).length).toBeGreaterThanOrEqual(VIABLE_FOLLOWUPS);
    expect(isViableLink('lemon', 'last', DICT, new Set(), 3)).toBe(true);
    expect(isViableLink('relax', 'last', DICT, new Set(), 3)).toBe(false); // only "xylem" starts with x
    const burned = new Set(followUps('n', DICT, new Set(), 3));
    expect(isViableLink('lemon', 'last', DICT, burned, 3)).toBe(false);
  });

  it('starter words are everyday and viable', () => {
    const w = pickStarter(DICT, 'last', createSeededRng(3), new Set(), 3);
    expect(DICT.isCommon(w)).toBe(true);
    expect(isViableLink(w, 'last', DICT, new Set(), 3)).toBe(true);
  });
});

describe('ChainGame submissions', () => {
  it('validates start letters, length, dictionary, burned words and blocked words', () => {
    const g = game({ minLength: 4 });
    g.start(['a', 'b', 'c', 'd', 'e'], 'lemon');
    expect(g.prefix).toBe('n');
    expect(g.submit('a', 'zebra', 1)).toMatchObject({ ok: false, reason: 'wrong_start' });
    expect(g.submit('a', 'nab', 1)).toMatchObject({ ok: false, reason: 'too_short' });
    expect(g.submit('a', 'nxyzq', 1)).toMatchObject({ ok: false, reason: 'not_word' });
    expect(g.submit('b', 'Nabed', 2)).toEqual({ ok: true, word: 'nabed', points: lengthPoints(5) });
    expect(g.submit('c', 'nabed', 3)).toMatchObject({ ok: true }); // same link: both may play it
    g.closeLink();
    g.nextLink();
    // nabed is burned now; the current word is also burned.
    expect(g.current).toBe('nabed');
    expect(g.submit('d', 'dabed', 4)).toMatchObject({ ok: true });
  });

  it('one answer per player per link — duplicates are refused, not double-scored', () => {
    const g = game();
    g.start(['a', 'b'], 'lemon');
    expect(g.submit('a', 'nabed', 1).ok).toBe(true);
    expect(g.submit('a', 'neling', 2)).toMatchObject({ ok: false, reason: 'answered' });
    expect(g.submit('a', 'nabed', 3)).toMatchObject({ ok: false, reason: 'answered' });
    expect(g.answerOf('a')).toBe('nabed');
  });

  it('refuses burned words, the current word, and players who are out or unknown', () => {
    const g = game({ lives: 1 });
    g.start(['a', 'b', 'c'], 'lemon');
    g.submit('a', 'nabed', 1);
    g.closeLink(); // b and c miss → out (1 life)
    expect(g.isAlive('b')).toBe(false);
    expect(g.shouldEnd()).toBe(true);
    const h = game();
    h.start(['a', 'b'], 'nabed');
    expect(h.submit('a', 'dabed', 1).ok).toBe(true);
    expect(h.submit('zz', 'dabing', 1)).toMatchObject({ ok: false, reason: 'eliminated' });
    h.closeLink();
    h.nextLink();
    expect(h.current).toBe('dabed');
    expect(h.submit('a', 'dabed', 2)).toMatchObject({ ok: false, reason: 'used' });
  });

  it('refuses blocked words', () => {
    const g = game();
    g.start(['a', 'b'], 'cats');
    expect(g.submit('a', 'shit', 1)).toMatchObject({ ok: false, reason: 'blocked' });
  });

  it('last2 rule needs the last two letters', () => {
    const g = game({ rule: 'last2' });
    g.start(['a', 'b'], 'lemon');
    expect(g.prefix).toBe('on');
    expect(g.submit('a', 'nabed', 1)).toMatchObject({ ok: false, reason: 'wrong_start' });
    expect(g.submit('a', 'onion', 1)).toMatchObject({ ok: true });
  });

  it('closed links refuse answers', () => {
    const g = game();
    g.start(['a', 'b'], 'lemon');
    g.closeLink();
    expect(g.submit('a', 'nabed', 9)).toMatchObject({ ok: false, reason: 'answered' });
  });
});

describe('closing a link', () => {
  it('costs a heart for every alive player without an answer; zero hearts = out', () => {
    const g = game({ lives: 2 });
    g.start(['a', 'b', 'c'], 'lemon');
    g.submit('a', 'nabed', 1);
    const r1 = g.closeLink();
    expect(r1.missed.sort()).toEqual(['b', 'c']);
    expect(r1.eliminated).toEqual([]);
    expect(g.lives.get('b')).toBe(1);
    g.nextLink();
    g.submit('a', g.prefix + 'abed', 2);
    g.submit('b', g.prefix + 'eling', 3);
    const r2 = g.closeLink();
    expect(r2.missed).toEqual(['c']);
    expect(r2.eliminated).toEqual(['c']);
    expect(g.alive().sort()).toEqual(['a', 'b']);
  });

  it('the longest answer becomes the next link (ties: earliest) and earns the Link bonus', () => {
    const g = game();
    g.start(['a', 'b', 'c'], 'lemon');
    g.submit('a', 'nabed', 5);
    g.submit('b', 'neling', 9);
    g.submit('c', 'noning', 7); // same length as neling, earlier
    const r = g.closeLink();
    expect(r.next).toBe('noning');
    expect(r.answers.find((x) => x.playerId === 'c')).toMatchObject({ maker: true, points: lengthPoints(6) + CHAIN_BONUS.link });
    expect(r.answers.find((x) => x.playerId === 'b')).toMatchObject({ maker: false, points: lengthPoints(6) });
    expect(r.points.get('a')).toBe(lengthPoints(5));
    expect([...g.burned]).toEqual(expect.arrayContaining(['lemon', 'nabed', 'neling', 'noning']));
    expect(g.trail.map((t) => t.word)).toEqual(['lemon', 'noning']);
  });

  it('skips a longest answer that would leave no everyday follow-ups (e.g. ends in X)', () => {
    const g = game();
    g.start(['a', 'b'], 'lemon');
    g.submit('a', 'narthex', 1); // 7 letters, but only "xylem" starts with x
    g.submit('b', 'nabed', 2);
    const r = g.closeLink();
    expect(r.next).toBe('nabed');
    expect(r.answers.find((x) => x.playerId === 'b')?.maker).toBe(true);
    expect(r.answers.find((x) => x.playerId === 'a')).toMatchObject({ maker: false, points: lengthPoints(7) });
    // With only a dead-end answer it is still used (better than breaking the chain).
    const h = game();
    h.start(['a', 'b'], 'lemon');
    h.submit('a', 'narthex', 1);
    expect(h.closeLink().next).toBe('narthex');
  });

  it('when nobody links, DASwords picks an everyday word with the right start', () => {
    const g = game({ lives: 3 });
    g.start(['a', 'b'], 'lemon');
    const r = g.closeLink();
    expect(r.fallback).toBe(true);
    expect(r.next.startsWith('n')).toBe(true);
    expect(DICT.isCommon(r.next)).toBe(true);
    expect(r.answers).toEqual([]);
    expect(r.missed.sort()).toEqual(['a', 'b']);
  });

  it('ends after maxLinks, when one player is left (multiplayer) or none (solo)', () => {
    const g = game({ maxLinks: 2, lives: 5 });
    g.start(['a', 'b'], 'lemon');
    g.submit('a', 'nabed', 1);
    g.submit('b', 'neling', 1);
    g.closeLink();
    expect(g.shouldEnd()).toBe(false);
    g.nextLink();
    g.submit('a', g.prefix + 'abed', 1);
    g.submit('b', g.prefix + 'eling', 1);
    const last = g.closeLink();
    expect(g.shouldEnd()).toBe(true);
    expect(last.next).toBe('');

    const solo = game({ lives: 1 });
    solo.start(['a'], 'lemon');
    solo.submit('a', 'nabed', 1);
    solo.closeLink();
    expect(solo.shouldEnd()).toBe(false); // one player alone keeps going
    solo.nextLink();
    solo.closeLink();
    expect(solo.shouldEnd()).toBe(true);
  });

  it('late joiners get full hearts; survivors get the bonus', () => {
    const g = game({ lives: 2 });
    g.start(['a'], 'lemon');
    g.addPlayer('b');
    expect(g.lives.get('b')).toBe(2);
    g.submit('a', 'nabed', 1);
    g.closeLink();
    expect(g.lives.get('b')).toBe(1);
    expect(g.survivorPoints().get('a')).toBe(CHAIN_BONUS.survivor);
    g.removePlayer('b');
    expect(g.lives.has('b')).toBe(false);
  });

  it('allAnswered only waits for alive, present players', () => {
    const g = game({ lives: 1 });
    g.start(['a', 'b', 'c'], 'lemon');
    g.submit('a', 'nabed', 1);
    g.submit('b', 'neling', 1);
    g.closeLink(); // c is out
    g.nextLink();
    expect(g.allAnswered(['a', 'b', 'c'])).toBe(false);
    g.submit('a', g.prefix + 'abed', 2);
    expect(g.allAnswered(['a', 'c'])).toBe(true);
    expect(g.allAnswered(['c'])).toBe(false); // nobody alive to wait for
  });
});
