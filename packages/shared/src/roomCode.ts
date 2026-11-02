import type { Rng } from './random.ts';

/** Human-friendly alphabet: no 0/O, 1/I/L to avoid confusion when read aloud or typed. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;

const BLOCKED_FRAGMENTS = ['FUK', 'FCK', 'SHT', 'KKK', 'NGR', 'CNT', 'DCK', 'SEX', 'ASS', 'XXX', 'WTF', 'FAG', 'TWT', 'PNS', 'VGN', 'CUM'];

export function generateRoomCode(rng: Rng): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[rng.int(ROOM_CODE_ALPHABET.length)];
    if (!BLOCKED_FRAGMENTS.some((f) => code.includes(f))) return code;
  }
}

/** Uppercases and removes separators/whitespace so "abc de" and "ABC-DE" both become "ABCDE". */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

/** A room link's code: `/room/<code>` (lobby and crew links) or `/r/<code>` (the short join link). */
const ROOM_LINK_RE = /\/(?:r|room)\/([A-Z0-9]{5})(?![A-Z0-9])/i;

/**
 * The room code in whatever was typed or pasted into a code box. An invite link
 * (`https://dascade.onrender.com/room/k7qxm`, `…/r/K7QXM?x=1`, or a message with a link in it)
 * gives its code; anything else is a typed code and goes through normalizeRoomCode, so "abc-de"
 * still reads "ABCDE". Without this, a pasted link kept its first letters and became "HTTPS".
 */
export function extractRoomCode(input: string): string {
  const link = ROOM_LINK_RE.exec(input);
  return link ? link[1]!.toUpperCase() : normalizeRoomCode(input);
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}
