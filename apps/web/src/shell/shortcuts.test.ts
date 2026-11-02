import { describe, expect, it, vi } from 'vitest';

// The real store boots persistence; these tests only need the pure parts. (shortcuts.ts loads the
// session itself only on /room/ paths; matchOn takes it as a parameter here.)
vi.mock('../app/store.ts', () => ({ useApp: { getState: () => ({ modal: null }) } }));

const { helpTopicFor, isTypingTarget, matchOn, shortcutFor } = await import('./shortcuts.ts');
type SessionLike = NonNullable<Parameters<typeof matchOn>[1]>;

/** A stand-in for net/session.ts: in room `code` (or none) with the room in `phase`. */
const fakeSession = (code: string | null, phase?: string) =>
  ({
    useSessionStore: { getState: () => ({ code, gameId: code ? 'wheel' : null }) },
    getStateSnapshot: () => (phase ? { phase } : null),
  }) as unknown as SessionLike;

const key = (k: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'defaultPrevented'>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  defaultPrevented: false,
  ...mods,
});
const free = { typing: false, modalOpen: false, inMatch: false };

describe('shortcutFor', () => {
  it('? opens help and M (either case) mutes', () => {
    expect(shortcutFor(key('?'), free)).toBe('help');
    expect(shortcutFor(key('m'), free)).toBe('mute');
    expect(shortcutFor(key('M'), free)).toBe('mute');
  });

  it('ignores every other key', () => {
    for (const k of ['/', 'h', 'n', 'Escape', 'Enter', ' ', 'ArrowUp', 'F1']) expect(shortcutFor(key(k), free)).toBeNull();
  });

  it('never fires while typing, in a pop-up or during a match', () => {
    expect(shortcutFor(key('m'), { ...free, typing: true })).toBeNull();
    expect(shortcutFor(key('?'), { ...free, modalOpen: true })).toBeNull();
    expect(shortcutFor(key('m'), { ...free, inMatch: true })).toBeNull();
  });

  it('leaves modified, held and already-handled keys alone', () => {
    expect(shortcutFor(key('m', { ctrlKey: true }), free)).toBeNull();
    expect(shortcutFor(key('m', { metaKey: true }), free)).toBeNull();
    expect(shortcutFor(key('?', { altKey: true }), free)).toBeNull();
    expect(shortcutFor(key('m', { repeat: true }), free)).toBeNull();
    expect(shortcutFor(key('m', { defaultPrevented: true }), free)).toBeNull();
  });
});

describe('isTypingTarget', () => {
  const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;
  it('is true for fields, text areas, selects and editable text', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isTypingTarget(el(tag))).toBe(true);
    expect(isTypingTarget(el('DIV', true))).toBe(true);
  });
  it('is false elsewhere, and for non-elements', () => {
    for (const tag of ['BUTTON', 'DIV', 'BODY', 'CANVAS', 'A']) expect(isTypingTarget(el(tag))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});

describe('helpTopicFor', () => {
  it('opens the room’s game in a room, a title screen’s game on /play', () => {
    expect(helpTopicFor('/room/K7QXM', 'holdem')).toBe('holdem');
    expect(helpTopicFor('/play/snake', null)).toBe('snake');
    expect(helpTopicFor('/play/dasino', null)).toBe('dasino');
  });
  it('opens the tournament page in the Tournament Center, basics elsewhere', () => {
    expect(helpTopicFor('/tournaments', null)).toBe('tournament');
    expect(helpTopicFor('/', null)).toBeNull();
    expect(helpTopicFor('/cabinet/dasino', null)).toBeNull();
    expect(helpTopicFor('/play/not-a-game', null)).toBeNull();
    // A room whose game isn't known yet (still joining): basics.
    expect(helpTopicFor('/room/K7QXM', null)).toBeNull();
  });
});

describe('matchOn', () => {
  it('is off away from /room/ paths, whatever the session says (no match can be on there)', () => {
    for (const path of ['/', '/play/wheel', '/cabinet/dasino', '/tournaments', '/r/K7QXM']) {
      expect(matchOn(path, fakeSession('K7QXM', 'PLAYING'))).toBe(false);
      expect(matchOn(path, null)).toBe(false);
    }
  });

  it('on a room path, follows the room’s phase', () => {
    for (const phase of ['COUNTDOWN', 'PLAYING', 'INTERMISSION']) expect(matchOn('/room/K7QXM', fakeSession('K7QXM', phase))).toBe(true);
    for (const phase of ['LOBBY', 'RESULTS', 'ENDED']) expect(matchOn('/room/K7QXM', fakeSession('K7QXM', phase))).toBe(false);
    expect(matchOn('/room/K7QXM', fakeSession('K7QXM'))).toBe(false);
    expect(matchOn('/room/K7QXM', fakeSession(null, 'PLAYING'))).toBe(false);
  });

  it('on a room path before the session has loaded, stands aside (assumes a match)', () => {
    expect(matchOn('/room/K7QXM', null)).toBe(true);
  });
});

