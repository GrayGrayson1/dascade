import { describe, expect, it } from 'vitest';
import { LIMITS, cleanNickname, maskProfanity } from '@dascade/shared';
import {
  EMPTY_NAME_ERROR,
  JOIN_START,
  cleanInitial,
  hasStoredSeat,
  joinReducer,
  nameToSend,
  previewName,
  takenPrompt,
  withInitial,
  type JoinAction,
  type JoinState,
} from './joinNames.ts';

const run = (...actions: JoinAction[]): JoinState => actions.reduce(joinReducer, JOIN_START);

describe('previewName — the name tag shows what the server will seat', () => {
  it('is empty while nothing usable is typed (no invented fallback name)', () => {
    expect(previewName('')).toBe('');
    expect(previewName('   ')).toBe('');
    expect(previewName('​‍')).toBe('');
  });

  it('matches the server: cleanNickname then maskProfanity, capped at LIMITS.nickname', () => {
    for (const raw of ['  Priya   S. ', 'Sam', 'A name that is much too long for the stage', 'shit happens', 'Zoë́', 'Ana​Bel']) {
      expect(previewName(raw)).toBe(maskProfanity(cleanNickname(raw, LIMITS.nickname)));
    }
    expect(Array.from(previewName('x'.repeat(64))).length).toBe(LIMITS.nickname);
    expect(previewName('  Priya   S. ')).toBe('Priya S.');
    expect(previewName('shit happens')).toBe('s*** happens');
  });

  it('shows reserved names as the server seats them ("Player")', () => {
    expect(previewName('Admin')).toBe('Player');
    expect(previewName('mod-erator')).toBe('Player');
    expect(previewName('Sam Admin')).toBe('Sam Admin');
  });
});

describe('initials', () => {
  it('keeps the first letter or digit, upper-cased', () => {
    expect(cleanInitial('p')).toBe('P');
    expect(cleanInitial(' .ó')).toBe('Ó');
    expect(cleanInitial('7')).toBe('7');
    expect(cleanInitial('ß')).toBe('S');
    expect(cleanInitial('  ')).toBe('');
    expect(cleanInitial('.-')).toBe('');
  });

  it('builds "Sam P." and always fits the nickname limit', () => {
    expect(withInitial('Sam', 'p')).toBe('Sam P.');
    expect(withInitial('Sam', '')).toBe('Sam');
    const long = withInitial('Bartholomew-Maximilian', 'q');
    expect(long.endsWith(' Q.')).toBe(true);
    expect(Array.from(long).length).toBeLessThanOrEqual(LIMITS.nickname);
    // What the server makes of it is unchanged (nothing cut off the initial).
    expect(previewName(long)).toBe(long);
  });
});

describe('the duplicate prompt (JOI-03 B)', () => {
  it('asks a one-word name for a last initial', () => {
    const p = takenPrompt({ name: 'Sam', suggestion: 'Sam 2' });
    expect(p.headline).toBe('There’s already a Sam here.');
    expect(p.ask).toBe('Add your last initial?');
    expect(p.initial).toBe(true);
  });

  it('asks a longer name to add a little more instead of a second initial', () => {
    const p = takenPrompt({ name: 'Sam P.', suggestion: 'Sam P. 2' });
    expect(p.headline).toBe('There’s already a Sam P. here.');
    expect(p.initial).toBe(false);
  });

  it('opens on name_taken with the room’s suggestion, and Join sends the initialled name', () => {
    let s = run({ type: 'submit' }, { type: 'taken', name: 'Sam', suggestion: 'Sam 2' });
    expect(s.step).toBe('taken');
    expect(s.taken).toEqual({ name: 'Sam', suggestion: 'Sam 2' });
    // No initial yet: Join sends the typed name again.
    expect(nameToSend(s, 'Sam')).toBe('Sam');
    s = joinReducer(s, { type: 'initial', value: 'p' });
    expect(nameToSend(s, 'Sam')).toBe('Sam P.');
    s = joinReducer(s, { type: 'submit' });
    expect(s.step).toBe('joining');
    // Still taken: the prompt comes back for the new name, initial cleared.
    s = joinReducer(s, { type: 'taken', name: 'Sam P.', suggestion: 'Sam P. 2' });
    expect(s).toEqual({ step: 'taken', taken: { name: 'Sam P.', suggestion: 'Sam P. 2' }, initial: '', error: '' });
    expect(nameToSend(s, 'Sam P.')).toBe('Sam P.');
  });

  it('falls back to a distinct suggestion when the server sent none', () => {
    expect(run({ type: 'taken', name: 'Sam', suggestion: ' ' }).taken?.suggestion).toBe('Sam 2');
  });

  it('closes when the name is edited, but not while a join is in flight', () => {
    const open = run({ type: 'taken', name: 'Sam', suggestion: 'Sam 2' });
    expect(joinReducer(open, { type: 'edit' })).toEqual(JOIN_START);
    const joining = joinReducer(open, { type: 'submit' });
    expect(joinReducer(joining, { type: 'edit' })).toBe(joining);
    // Nothing to close: the same state (no re-render churn while typing).
    expect(joinReducer(JOIN_START, { type: 'edit' })).toBe(JOIN_START);
  });

  it('keeps the prompt open when another error happens, and says why', () => {
    const s = run(
      { type: 'taken', name: 'Sam', suggestion: 'Sam 2' },
      { type: 'submit' },
      { type: 'failed', error: 'This room is locked by the host.' },
    );
    expect(s.step).toBe('taken');
    expect(s.error).toBe('This room is locked by the host.');
    expect(run({ type: 'submit' }, { type: 'failed', error: 'Nope' })).toEqual({ ...JOIN_START, error: 'Nope' });
  });

  it('says so when Join is pressed with no name, and a second submit while joining is ignored', () => {
    expect(run({ type: 'empty' }).error).toBe(EMPTY_NAME_ERROR);
    const joining = run({ type: 'submit' });
    expect(joinReducer(joining, { type: 'submit' })).toBe(joining);
  });
});

describe('seats this device holds', () => {
  const now = 1_800_000_000_000;
  const store = (entries: Record<string, string>) => ({ getItem: (k: string) => entries[k] ?? null });
  const seat = (code: string, savedAt = now - 1000) => JSON.stringify({ code, gameId: 'showdown', seatToken: 'tok', savedAt });

  it('finds a fresh seat for that code in either store', () => {
    expect(hasStoredSeat('ABCDE', [store({}), store({ 'dascade:seat:ABCDE': seat('ABCDE') })], now)).toBe(true);
    expect(hasStoredSeat('ABCDE', [store({ 'dascade:seat:ABCDE': seat('ABCDE') }), null], now)).toBe(true);
  });

  it('ignores missing, expired, foreign and unreadable entries', () => {
    expect(hasStoredSeat('ABCDE', [store({}), null, undefined], now)).toBe(false);
    expect(hasStoredSeat('ABCDE', [store({ 'dascade:seat:ABCDE': seat('ABCDE', now - 13 * 3600_000) })], now)).toBe(false);
    expect(hasStoredSeat('ABCDE', [store({ 'dascade:seat:ABCDE': seat('ZZZZZ') })], now)).toBe(false);
    expect(hasStoredSeat('ABCDE', [store({ 'dascade:seat:ABCDE': '{not json' })], now)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(hasStoredSeat('ABCDE', [throwing, store({ 'dascade:seat:ABCDE': seat('ABCDE') })], now)).toBe(true);
  });
});
