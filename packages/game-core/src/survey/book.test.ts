import { describe, expect, it } from 'vitest';
import { SURVEY_LIMITS, type SurveyQuestion } from '@dascade/shared/games/survey';
import { SurveyBook, isValidPrediction } from './book.ts';

const majorityQ: SurveyQuestion = {
  id: 't-m',
  mode: 'majority',
  prompt: 'Coffee or tea?',
  options: ['Coffee', 'Tea', 'Neither'],
  pack: 'food',
};
const rankQ: SurveyQuestion = {
  id: 't-r',
  mode: 'rank',
  prompt: 'Favourite fruit?',
  options: ['Apple', 'Mango', 'Grape', 'Kiwi'],
  pack: 'food',
};
const percentQ: SurveyQuestion = {
  id: 't-p',
  mode: 'percent',
  prompt: 'Do you like olives?',
  options: ['Yes', 'No'],
  target: 0,
  pack: 'food',
};

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

describe('SurveyBook — anonymous collection', () => {
  it('records one answer per player and rejects duplicates (idempotent)', () => {
    const book = new SurveyBook(majorityQ, 7);
    expect(book.answer('a', 1)).toEqual({ ok: true });
    expect(book.answer('a', 0)).toEqual({ ok: false, reason: 'duplicate' });
    expect(book.answer('a', 1)).toEqual({ ok: false, reason: 'duplicate' });
    expect(book.answerOf('a')).toBe(1);
    expect(book.answeredCount).toBe(1);
  });

  it('treats a skip as answered but not as a respondent', () => {
    const book = new SurveyBook(majorityQ, 1);
    book.answer('a', null);
    book.answer('b', 0);
    expect(book.hasAnswered('a')).toBe(true);
    expect(book.answeredCount).toBe(2);
    expect(book.respondents).toBe(1);
    expect(book.answer('a', 1)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('rejects out-of-range answers', () => {
    const book = new SurveyBook(majorityQ, 1);
    expect(book.answer('a', 3)).toEqual({ ok: false, reason: 'invalid' });
    expect(book.answer('a', -1)).toEqual({ ok: false, reason: 'invalid' });
    expect(book.answer('a', 0.5)).toEqual({ ok: false, reason: 'invalid' });
    expect(book.hasAnswered('a')).toBe(false);
  });

  it('withdraw() drops a leaver’s answer and prediction while they are open, never the sealed counts', () => {
    const book = new SurveyBook(majorityQ, 1);
    for (const id of ['a', 'b', 'c', 'd']) book.answer(id, id === 'd' ? 2 : 0);
    book.predict('d', { kind: 'majority', option: 2 });
    expect(book.withdraw('d')).toBe(true);
    expect(book.hasAnswered('d')).toBe(false);
    expect(book.answeredCount).toBe(3);
    expect(book.predictedCount).toBe(0);
    expect(book.withdraw('d')).toBe(false);
    // Once sealed, the anonymous counts stay as they are; only an open prediction can go.
    book.closeAnswers();
    book.discardAnswers();
    book.predict('c', { kind: 'majority', option: 0 });
    expect(book.withdraw('c')).toBe(true);
    const r = book.tally({ index: 1, seated: 3, order: ['a', 'b', 'c'] });
    expect(r.counts).toEqual([3, 0, 0]);
    expect(r.predictors).toBe(0);
  });

  it('rejects late answers once answering has closed', () => {
    const book = new SurveyBook(majorityQ, 1);
    book.closeAnswers();
    expect(book.answer('a', 0)).toEqual({ ok: false, reason: 'closed' });
  });

  it('requires answering (or skipping) before predicting while answers are open', () => {
    const book = new SurveyBook(majorityQ, 1);
    expect(book.predict('a', { kind: 'majority', option: 0 })).toEqual({ ok: false, reason: 'answer_first' });
    book.answer('a', null);
    expect(book.predict('a', { kind: 'majority', option: 0 })).toEqual({ ok: true });
  });

  it('lets anyone predict after answering closes, once', () => {
    const book = new SurveyBook(majorityQ, 1);
    book.closeAnswers();
    expect(book.predict('late', { kind: 'majority', option: 2 })).toEqual({ ok: true });
    expect(book.predict('late', { kind: 'majority', option: 1 })).toEqual({ ok: false, reason: 'duplicate' });
    expect(book.predictionOf('late')).toEqual({ kind: 'majority', option: 2 });
  });

  it('rejects predictions of the wrong kind or shape', () => {
    const book = new SurveyBook(rankQ, 1);
    book.closeAnswers();
    expect(book.predict('a', { kind: 'majority', option: 0 }).ok).toBe(false);
    expect(book.predict('a', { kind: 'rank', order: [0, 1, 2] }).ok).toBe(false);
    expect(book.predict('a', { kind: 'rank', order: [0, 1, 2, 2] }).ok).toBe(false);
    expect(book.predict('a', { kind: 'rank', order: [3, 1, 2, 0] }).ok).toBe(true);
    expect(isValidPrediction(percentQ, { kind: 'percent', percent: 101 })).toBe(false);
    expect(isValidPrediction(percentQ, { kind: 'percent', percent: 49.5 })).toBe(false);
    expect(isValidPrediction(percentQ, { kind: 'percent', percent: 0 })).toBe(true);
  });

  it('stores a copy of the prediction (callers cannot mutate it later)', () => {
    const book = new SurveyBook(rankQ, 1);
    book.closeAnswers();
    const order = [0, 1, 2, 3];
    book.predict('a', { kind: 'rank', order });
    order[0] = 3;
    expect(book.predictionOf('a')).toEqual({ kind: 'rank', order: [0, 1, 2, 3] });
  });

  it('closes predictions at tally time', () => {
    const book = new SurveyBook(majorityQ, 1);
    for (const id of ids(3)) book.answer(id, 0);
    book.tally({ index: 1, seated: 3, order: ids(3) });
    expect(book.predict('p1', { kind: 'majority', option: 0 })).toEqual({ ok: false, reason: 'closed' });
    expect(book.answer('p4', 0)).toEqual({ ok: false, reason: 'closed' });
  });
});

describe('SurveyBook — tally', () => {
  it('voids a question with fewer answers than the anonymity floor', () => {
    const book = new SurveyBook(majorityQ, 3);
    book.answer('a', 0);
    book.answer('b', 1);
    book.answer('c', null); // skip
    book.predict('a', { kind: 'majority', option: 0 });
    const result = book.tally({ index: 2, seated: 3, order: ['a', 'b', 'c'] });
    expect(SURVEY_LIMITS.minRespondents).toBe(3);
    expect(result.voided).toBe(true);
    expect(result.respondents).toBe(2);
    expect(result.counts).toEqual([]);
    expect(result.percents).toEqual([]);
    expect(result.scores).toEqual([]);
  });

  it('computes a Majority Mind result with prediction counts', () => {
    const book = new SurveyBook(majorityQ, 4);
    const players = ids(5);
    [0, 0, 1, 2, 0].forEach((opt, i) => book.answer(players[i]!, opt));
    [0, 1, 0, 0, 2].forEach((opt, i) => book.predict(players[i]!, { kind: 'majority', option: opt }));
    const result = book.tally({ index: 1, seated: 5, order: players });
    expect(result.voided).toBe(false);
    expect(result.counts).toEqual([3, 1, 1]);
    expect(result.percents).toEqual([60, 20, 20]);
    expect(result.leaders).toEqual([0]);
    expect(result.predictionCounts).toEqual([3, 1, 1]);
    expect(result.predictors).toBe(5);
    expect(result.scores.filter((s) => s.hit).map((s) => s.playerId)).toEqual(['p1', 'p3', 'p4']);
  });

  it('computes a Rank the Room result with tie ranges', () => {
    const book = new SurveyBook(rankQ, 5);
    const players = ids(4);
    [1, 1, 0, 2].forEach((opt, i) => book.answer(players[i]!, opt));
    book.predict('p1', { kind: 'rank', order: [1, 0, 2, 3] });
    book.predict('p2', { kind: 'rank', order: [1, 2, 0, 3] });
    const result = book.tally({ index: 1, seated: 4, order: players });
    expect(result.ranking).toEqual([
      { option: 1, lo: 1, hi: 1 },
      { option: 0, lo: 2, hi: 3 },
      { option: 2, lo: 2, hi: 3 },
      { option: 3, lo: 4, hi: 4 },
    ]);
    // Both predictions are perfect because options 0 and 2 are tied.
    expect(result.scores.map((s) => s.points)).toEqual([1250, 1250]);
  });

  it('computes an exact Guess the Percentage result', () => {
    const book = new SurveyBook(percentQ, 6);
    const players = ids(3);
    [0, 0, 1].forEach((opt, i) => book.answer(players[i]!, opt));
    book.predict('p1', { kind: 'percent', percent: 67 });
    book.predict('p2', { kind: 'percent', percent: 50 });
    book.predict('p3', { kind: 'percent', percent: 66 });
    const result = book.tally({ index: 3, seated: 3, order: players });
    expect(result.actual).toBe(66.7);
    expect(result.closest).toEqual(['p1']);
    expect(result.predictedPercents).toEqual([50, 66, 67]);
    expect(result.scores[0]!.playerId).toBe('p1');
  });

  it('drops predictions from players no longer in the room', () => {
    const book = new SurveyBook(majorityQ, 1);
    for (const id of ids(3)) {
      book.answer(id, 0);
      book.predict(id, { kind: 'majority', option: 0 });
    }
    const result = book.tally({ index: 1, seated: 2, order: ['p1', 'p3'] });
    expect(result.scores.map((s) => s.playerId)).toEqual(['p1', 'p3']);
    expect(result.respondents).toBe(3);
  });

  it('never exposes who answered what, and forgets the answers after the tally', () => {
    const book = new SurveyBook(majorityQ, 9);
    const players = ['alice-id', 'bob-id', 'cara-id', 'dan-id'];
    [2, 0, 1, 2].forEach((opt, i) => book.answer(players[i]!, opt));
    const result = book.tally({ index: 1, seated: 4, order: players });
    // Nobody predicted, so the result cannot mention any player at all.
    const json = JSON.stringify(result);
    for (const id of players) expect(json).not.toContain(id);
    // Raw answers are gone; only who-answered (public anyway) and counts remain.
    for (const id of players) expect(book.answerOf(id)).toBeUndefined();
    expect(book.hasAnswered('alice-id')).toBe(true);
    expect(book.respondents).toBe(4);
    expect(book.answeredCount).toBe(4);
  });

  it('keeps counts after an early discard', () => {
    const book = new SurveyBook(majorityQ, 1);
    for (const id of ids(4)) book.answer(id, 1);
    book.closeAnswers();
    book.discardAnswers();
    const result = book.tally({ index: 1, seated: 4, order: ids(4) });
    expect(result.counts).toEqual([0, 4, 0]);
  });

  it('handles a 30-player room', () => {
    const players = ids(30);
    const book = new SurveyBook(percentQ, 2);
    players.forEach((id, i) => book.answer(id, i % 3 === 0 ? 0 : 1)); // 10 yes / 20 no
    players.forEach((id, i) => book.predict(id, { kind: 'percent', percent: i * 3 }));
    const result = book.tally({ index: 1, seated: 30, order: players });
    expect(result.actual).toBe(33.3);
    expect(result.scores).toHaveLength(30);
    // 33 is 0.33 off (closest); 36 is 2.67 off.
    expect(result.closest).toEqual(['p12']);
  });
});
