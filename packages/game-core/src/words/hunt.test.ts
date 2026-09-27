import { describe, expect, it } from 'vitest';
import { HuntRound, markHunt, type HuntVerdict } from './hunt.ts';

const ok = (word: string, points = 1, extra: Partial<Extract<HuntVerdict, { ok: true }>> = {}): (() => HuntVerdict) => () => ({ ok: true, key: word, word, points, ...extra });

describe('HuntRound', () => {
  it('banks valid words and lists them privately in order', () => {
    const r = new HuntRound({ maxWords: 10, maxRejects: 5, openedAt: 1000 });
    expect(r.submit('p1', 'cat', 'cat', 1500, ok('cat'))).toMatchObject({ ok: true, record: { word: 'cat', at: 500, status: 'ok' } });
    r.submit('p1', 'dog', 'dog', 1600, ok('dog', 2));
    expect(r.entriesOf('p1').map((e) => e.word)).toEqual(['cat', 'dog']);
    expect(r.countOf('p1')).toBe(2);
    expect(r.countOf('p2')).toBe(0);
  });

  it('duplicates are rejected without re-validating (idempotent)', () => {
    const r = new HuntRound({ maxWords: 10, maxRejects: 5 });
    let calls = 0;
    const v = () => {
      calls++;
      return ok('cat')();
    };
    r.submit('p1', 'cat', 'cat', 1, v);
    expect(r.submit('p1', 'cat', 'cat', 2, v)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(r.submit('p1', 'CAT', 'cat', 3, v)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(calls).toBe(1);
    expect(r.countOf('p1')).toBe(1);
    // Another player may still find it.
    expect(r.submit('p2', 'cat', 'cat', 4, v).ok).toBe(true);
  });

  it('a validator-normalized key catches duplicates too (e.g. plural folding)', () => {
    const r = new HuntRound({ maxWords: 10, maxRejects: 5 });
    r.submit('p1', 'cats', 'cats', 1, () => ({ ok: true, key: 'cat', word: 'cats', points: 1 }));
    expect(r.submit('p1', 'cat', 'cat', 2, () => ({ ok: true, key: 'cat', word: 'cat', points: 1 }))).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('late submissions are refused once the round closes', () => {
    const r = new HuntRound({ maxWords: 10, maxRejects: 5 });
    r.close();
    expect(r.submit('p1', 'cat', 'cat', 1, ok('cat'))).toEqual({ ok: false, reason: 'closed', word: 'cat' });
    expect(r.entriesOf('p1')).toEqual([]);
  });

  it('caps banked words and remembered rejections', () => {
    const r = new HuntRound({ maxWords: 3, maxRejects: 2 });
    for (const w of ['x1', 'x2', 'x3']) r.submit('p1', w, w, 1, () => ({ ok: false, reason: 'not_word' }));
    for (const w of ['a1', 'a2', 'a3']) r.submit('p1', w, w, 1, ok(w));
    expect(r.submit('p1', 'a4', 'a4', 1, ok('a4'))).toMatchObject({ ok: false, reason: 'too_many' });
    const entries = r.entriesOf('p1');
    expect(entries.filter((e) => e.status === 'rejected').map((e) => e.word)).toEqual(['x2', 'x3']);
    expect(entries.filter((e) => e.status === 'ok')).toHaveLength(3);
  });

  it('rejections carry the validator reason and display word', () => {
    const r = new HuntRound({ maxWords: 3, maxRejects: 5 });
    expect(r.submit('p1', 'shit', 'shit', 1, () => ({ ok: false, reason: 'blocked', word: 's***' }))).toEqual({ ok: false, reason: 'blocked', word: 's***' });
    expect(r.entriesOf('p1')[0]).toMatchObject({ word: 's***', status: 'rejected', reason: 'blocked', points: 0 });
  });

  it('pending answers: grouped for review; the host verdict applies to everyone who gave it', () => {
    const r = new HuntRound({ maxWords: 10, maxRejects: 5, openedAt: 0 });
    r.submit('p1', 'durian', 'durian', 5, ok('durian', 2, { pending: true }));
    r.submit('p2', 'durian', 'durian', 3, ok('durian', 2, { pending: true }));
    r.submit('p2', 'lychee', 'lychee', 9, ok('lychee', 2, { pending: true }));
    r.submit('p3', 'kiwi', 'kiwi', 1, ok('kiwi', 2, { known: true }));
    expect(r.pendingKeys()).toEqual([
      { key: 'durian', word: 'durian', count: 2, firstAt: 3 },
      { key: 'lychee', word: 'lychee', count: 1, firstAt: 9 },
    ]);
    expect(r.setVerdict('durian', false).sort()).toEqual(['p1', 'p2']);
    expect(r.wordsOf('p1')[0]).toMatchObject({ status: 'rejected', reason: 'category', points: 0, hostDecided: true });
    expect(r.setVerdict('durian', true)).toEqual([]); // already decided
    expect(r.resolvePending(true)).toEqual(['p2']);
    expect(r.wordsOf('p2').find((w) => w.key === 'lychee')).toMatchObject({ status: 'ok', hostDecided: true });
    expect(r.pendingKeys()).toEqual([]);
    expect(r.all().map((x) => x.key).sort()).toEqual(['kiwi', 'lychee']);
  });
});

describe('markHunt', () => {
  const round = () => {
    const r = new HuntRound({ maxWords: 20, maxRejects: 5, openedAt: 0 });
    r.submit('ann', 'cat', 'cat', 10, ok('cat'));
    r.submit('bob', 'cat', 'cat', 5, ok('cat'));
    r.submit('cid', 'cat', 'cat', 20, ok('cat'));
    r.submit('ann', 'dog', 'dog', 30, ok('dog'));
    r.submit('bob', 'emu', 'emu', 40, ok('emu'));
    return r;
  };

  it('free-for-all: unique = only one player found it; shared otherwise', () => {
    const marks = markHunt(round().all(), (id) => id, 3);
    const by = (p: string, w: string) => marks.find((m) => m.record.playerId === p && m.record.key === w)!;
    expect(by('ann', 'cat')).toMatchObject({ credited: true, unique: false, shared: true, teammate: false });
    expect(by('ann', 'dog')).toMatchObject({ credited: true, unique: true, shared: false });
    expect(by('bob', 'emu').unique).toBe(true);
  });

  it('teams: a word counts once per team (earliest teammate credited); uniqueness is across teams', () => {
    const team: Record<string, string> = { ann: 'red', bob: 'red', cid: 'blue' };
    const marks = markHunt(round().all(), (id) => team[id]!, 2);
    const by = (p: string, w: string) => marks.find((m) => m.record.playerId === p && m.record.key === w)!;
    expect(by('bob', 'cat')).toMatchObject({ credited: true, teammate: false, shared: true });
    expect(by('ann', 'cat')).toMatchObject({ credited: false, teammate: true });
    expect(by('cid', 'cat')).toMatchObject({ credited: true, shared: true, unique: false });
    expect(by('ann', 'dog')).toMatchObject({ unique: true });
  });

  it('solo / single group: nothing is "unique" (no one to beat)', () => {
    const marks = markHunt(round().all(), () => 'everyone', 1);
    expect(marks.every((m) => !m.unique)).toBe(true);
    expect(marks.filter((m) => m.credited).map((m) => m.record.key).sort()).toEqual(['cat', 'dog', 'emu']);
  });

  it('ignores pending and rejected records', () => {
    const r = new HuntRound({ maxWords: 20, maxRejects: 5, openedAt: 0 });
    r.submit('ann', 'x', 'x', 1, ok('x', 1, { pending: true }));
    expect(markHunt(r.all(), (id) => id, 2)).toEqual([]);
  });
});
