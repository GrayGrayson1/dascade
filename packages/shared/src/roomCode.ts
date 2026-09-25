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

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}
