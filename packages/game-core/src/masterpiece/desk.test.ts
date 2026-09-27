import { describe, expect, it } from 'vitest';
import { WriteDesk } from './desk.ts';

const prompts = [
  { showdownId: 's1', authors: ['ann', 'bob'] },
  { showdownId: 's2', authors: ['bob', 'cat'] },
  { showdownId: 's3', authors: ['cat', 'ann'] },
];

describe('WriteDesk', () => {
  it('knows each writer’s prompts', () => {
    const desk = new WriteDesk(prompts, 1000);
    expect(desk.promptsOf('ann')).toEqual(['s1', 's3']);
    expect(desk.promptsOf('zed')).toEqual([]);
    expect(desk.writers().sort()).toEqual(['ann', 'bob', 'cat']);
  });

  it('accepts one answer per writer per prompt and reports completion', () => {
    const desk = new WriteDesk(prompts, 1000);
    expect(desk.submit('ann', 's1', 'first', 3000)).toEqual({ ok: true, done: false });
    expect(desk.submit('ann', 's1', 'again', 3100)).toEqual({ ok: false, reason: 'already_locked' });
    expect(desk.answerOf('ann', 's1')).toBe('first');
    expect(desk.submittedCount('ann')).toBe(1);
    expect(desk.submit('ann', 's3', 'second', 5000)).toEqual({ ok: true, done: true });
    expect(desk.isDone('ann')).toBe(true);
    expect(desk.submitMs('ann')).toBe(2000 + 4000);
  });

  it('refuses prompts that belong to someone else and unknown prompts', () => {
    const desk = new WriteDesk(prompts);
    expect(desk.submit('ann', 's2', 'nope')).toEqual({ ok: false, reason: 'not_eligible' });
    expect(desk.submit('ann', 'zz', 'nope')).toEqual({ ok: false, reason: 'stale' });
    expect(desk.submit('zed', 's1', 'nope')).toEqual({ ok: false, reason: 'not_eligible' });
  });

  it('tracks completion among present writers only', () => {
    const desk = new WriteDesk(prompts);
    desk.submit('ann', 's1', 'a1');
    desk.submit('ann', 's3', 'a3');
    desk.submit('bob', 's1', 'b1');
    expect(desk.pending(['ann', 'bob'])).toEqual(['bob']);
    expect(desk.isComplete(['ann'])).toBe(true);
    expect(desk.isComplete(['ann', 'bob'])).toBe(false);
    expect(desk.isComplete([])).toBe(false);
    expect(desk.isComplete(['spectator'])).toBe(false);
  });

  it('closes for good and exposes entries with blanks for missing answers', () => {
    const desk = new WriteDesk(prompts);
    desk.submit('bob', 's2', 'b2');
    desk.close();
    expect(desk.isOpen).toBe(false);
    expect(desk.submit('cat', 's2', 'late')).toEqual({ ok: false, reason: 'closed' });
    expect(desk.entries('s2')).toEqual([
      { authorId: 'bob', text: 'b2' },
      { authorId: 'cat', text: null },
    ]);
    expect(desk.entries('nope')).toEqual([]);
  });
});
