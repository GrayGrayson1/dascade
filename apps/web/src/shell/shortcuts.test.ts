import { describe, expect, it, vi } from 'vitest';

// The real store and session boot persistence and the network; these tests only need the pure parts.
vi.mock('../app/store.ts', () => ({ useApp: { getState: () => ({ modal: null }) } }));
vi.mock('../net/session.ts', () => ({ getStateSnapshot: () => null, useSessionStore: { getState: () => ({ code: null, gameId: null }) } }));

const { helpTopicFor, isTypingTarget, shortcutFor } = await import('./shortcuts.ts');

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
