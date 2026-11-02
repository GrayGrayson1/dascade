import { describe, expect, it } from 'vitest';
import { extractRoomCode, isValidRoomCode } from './roomCode.ts';

describe('extractRoomCode', () => {
  it('reads the code out of a whole invite link', () => {
    expect(extractRoomCode('https://dascade.onrender.com/room/K7QXM')).toBe('K7QXM');
    expect(extractRoomCode('http://localhost:5173/room/k7qxm')).toBe('K7QXM');
    expect(extractRoomCode('dascade.onrender.com/room/K7QXM/')).toBe('K7QXM');
  });

  it('reads short /r/ links', () => {
    expect(extractRoomCode('https://dascade.onrender.com/r/ABCDE')).toBe('ABCDE');
    expect(extractRoomCode('/r/abcde')).toBe('ABCDE');
  });

  it('ignores query strings, fragments and text around the link', () => {
    expect(extractRoomCode('https://dascade.onrender.com/room/K7QXM?screen=1')).toBe('K7QXM');
    expect(extractRoomCode('https://dascade.onrender.com/room/K7QXM#crew=abc123')).toBe('K7QXM');
    expect(extractRoomCode('Join me! https://dascade.onrender.com/r/K7QXM see you there')).toBe('K7QXM');
    expect(extractRoomCode('  https://dascade.onrender.com/room/K7QXM\n')).toBe('K7QXM');
  });

  it('never turns a link into "HTTPS"', () => {
    for (const link of ['https://dascade.onrender.com/room/K7QXM', 'https://dascade.onrender.com/r/K7QXM']) {
      const code = extractRoomCode(link);
      expect(code).not.toMatch(/^HTTP/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('still normalizes typed codes with spaces, dashes and lower case', () => {
    expect(extractRoomCode('abcde')).toBe('ABCDE');
    expect(extractRoomCode(' ab-cd e')).toBe('ABCDE');
    expect(extractRoomCode('AB_CD.E')).toBe('ABCDE');
    expect(extractRoomCode('ab')).toBe('AB');
    expect(extractRoomCode('')).toBe('');
  });

  it('does not take a code from paths that only look like room links', () => {
    // A six-character segment is not a room code, and "/bar/" is not "/r/".
    expect(extractRoomCode('https://x.test/room/ABCDEF')).not.toBe('ABCDE');
    expect(extractRoomCode('https://x.test/bar/ABCDE')).not.toBe('ABCDE');
    expect(extractRoomCode('https://x.test/roomy/ABCDE')).not.toBe('ABCDE');
  });

  it('falls back to normalizeRoomCode for junk, never throwing', () => {
    expect(extractRoomCode('!!!')).toBe('');
    expect(extractRoomCode('🎮🎮🎮')).toBe('');
    expect(extractRoomCode('https://dascade.onrender.com/')).toBe('HTTPSDASCADE');
    expect(extractRoomCode('x'.repeat(10_000))).toBe('XXXXXXXXXXXX');
  });
});
