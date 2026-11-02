import { describe, expect, it } from 'vitest';
import type { ChatKind } from '@dascade/shared';
import { countUnread, countsAsUnread, unreadLabel } from './chatUnread.ts';

const msg = (id: string, playerId: string | null, kind: ChatKind = 'chat') => ({ id, playerId, kind });

describe('countsAsUnread', () => {
  it('counts other players’ messages only', () => {
    expect(countsAsUnread(msg('1', 'them'), 'me')).toBe(true);
    expect(countsAsUnread(msg('1', 'me'), 'me')).toBe(false);
    expect(countsAsUnread(msg('1', null, 'system'), 'me')).toBe(false);
    expect(countsAsUnread(msg('1', 'them', 'system'), 'me')).toBe(false);
    expect(countsAsUnread(msg('1', null), 'me')).toBe(false);
  });
});

describe('countUnread', () => {
  const chat = [msg('a', 'them'), msg('b', 'me'), msg('c', null, 'system'), msg('d', 'them'), msg('e', 'other')];

  it('counts what arrived after the last message you saw', () => {
    expect(countUnread(chat, 'a', 'me')).toBe(2);
    expect(countUnread(chat, 'd', 'me')).toBe(1);
    expect(countUnread(chat, 'e', 'me')).toBe(0);
  });

  it('is zero for an empty chat, and counts everything when nothing was seen yet', () => {
    expect(countUnread([], null, 'me')).toBe(0);
    expect(countUnread([], 'gone', 'me')).toBe(0);
    expect(countUnread(chat, null, 'me')).toBe(3);
  });

  it('counts everything kept when the last seen message has scrolled out of the room’s history', () => {
    expect(countUnread(chat, 'trimmed-long-ago', 'me')).toBe(3);
  });

  it('never counts your own messages, even before you have an id', () => {
    expect(countUnread([msg('x', 'me'), msg('y', 'me')], null, 'me')).toBe(0);
    expect(countUnread([msg('x', 'them')], null, null)).toBe(1);
  });
});

describe('unreadLabel', () => {
  it('caps at 9+', () => {
    expect(unreadLabel(1)).toBe('1');
    expect(unreadLabel(9)).toBe('9');
    expect(unreadLabel(10)).toBe('9+');
    expect(unreadLabel(120)).toBe('9+');
  });
});
