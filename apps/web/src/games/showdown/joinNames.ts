/**
 * The event join screen's name rules (JOI-01 B, JOI-03 B). Pure, so they're tested on their own:
 *
 *   - the live name tag shows exactly what the server will seat (BaseGameRoom.cleanJoinName:
 *     `maskProfanity(cleanNickname(name, LIMITS.nickname))`, reserved names become "Player");
 *   - the duplicate prompt: a strict join refused with `name_taken` asks the second "Sam" for a last
 *     initial ("Sam P.") — or to keep the name the room offered ("Sam 2"), which is still distinct;
 *   - whether this device already holds a seat for a room (same storage as net/session.ts), so the
 *     join link opened again goes straight back into the room.
 */
import { LIMITS, cleanNickname, cleanText, maskProfanity } from '@dascade/shared';

/** Names the server never seats as typed (BaseGameRoom RESERVED_NAMES: they become "Player"). */
const RESERVED = new Set(['dascade', 'system', 'server', 'admin', 'moderator']);

/** The name the server will show for what's typed ('' while nothing usable is typed). */
export function previewName(raw: string): string {
  // cleanNickname invents a name for blanks; the preview shows the placeholder instead.
  if (!cleanText(raw, LIMITS.nickname)) return '';
  const name = maskProfanity(cleanNickname(raw, LIMITS.nickname));
  return RESERVED.has(name.toLowerCase().replace(/[^a-z]/g, '')) ? 'Player' : name;
}

/** The first letter or digit typed, upper-cased ('' = none): "p" → "P", " ó" → "Ó". */
export function cleanInitial(raw: string): string {
  const ch = Array.from(cleanText(raw, 8)).find((c) => /[\p{L}\p{N}]/u.test(c));
  return ch ? (Array.from(ch.toUpperCase())[0] ?? '') : '';
}

/** "Sam" + "p" → "Sam P." The name is shortened so the initial always fits in a nickname. */
export function withInitial(base: string, initial: string): string {
  const letter = cleanInitial(initial);
  if (!letter) return base;
  const head = Array.from(base)
    .slice(0, LIMITS.nickname - 3)
    .join('')
    .trimEnd();
  return `${head} ${letter}.`;
}

// ---------------------------------------------------------------------------
// The join form (EventJoin): name → joining → (taken → joining)* → in the room
// ---------------------------------------------------------------------------

export interface TakenName {
  /** The name someone in the room already has (as the server compared it). */
  name: string;
  /** What the room would call you instead ("Sam 2"). */
  suggestion: string;
}

export interface JoinState {
  step: 'name' | 'joining' | 'taken';
  /** The duplicate prompt (JOI-03 B), or null. */
  taken: TakenName | null;
  /** The initial typed into the prompt (raw). */
  initial: string;
  /** Why the last attempt didn't seat you ('' = nothing to say). */
  error: string;
}

export type JoinAction =
  /** The name field changed: a prompt about the old name no longer applies. */
  | { type: 'edit' }
  | { type: 'initial'; value: string }
  | { type: 'submit' }
  | { type: 'taken'; name: string; suggestion: string }
  | { type: 'failed'; error: string }
  /** Join pressed with nothing usable typed. */
  | { type: 'empty' };

export const JOIN_START: JoinState = { step: 'name', taken: null, initial: '', error: '' };

export const EMPTY_NAME_ERROR = 'Type your name first — the one your coworkers know you by.';

export function joinReducer(state: JoinState, action: JoinAction): JoinState {
  switch (action.type) {
    case 'edit':
      if (state.step === 'joining') return state;
      return state.taken || state.error ? { ...JOIN_START } : state;
    case 'initial':
      return { ...state, initial: action.value, error: '' };
    case 'submit':
      return state.step === 'joining' ? state : { ...state, step: 'joining', error: '' };
    case 'taken':
      return {
        step: 'taken',
        taken: { name: action.name, suggestion: action.suggestion.trim() || `${action.name} 2` },
        initial: '',
        error: '',
      };
    case 'failed':
      return { ...state, step: state.taken ? 'taken' : 'name', error: action.error };
    case 'empty':
      return { ...state, step: state.taken ? 'taken' : 'name', error: EMPTY_NAME_ERROR };
  }
}

export interface TakenPrompt {
  /** "There's already a Sam here." */
  headline: string;
  /** The question after it. */
  ask: string;
  /** Ask for a last initial (one-word names); longer names are edited in the name field instead. */
  initial: boolean;
}

export function takenPrompt(taken: TakenName): TakenPrompt {
  const oneWord = !/\s/.test(taken.name);
  return {
    headline: `There’s already a ${taken.name} here.`,
    ask: oneWord ? 'Add your last initial?' : 'Add a little more to your name so people can tell you apart?',
    initial: oneWord,
  };
}

/**
 * The name a Join press sends: with the prompt open and an initial typed, "Sam P."; otherwise the
 * typed name ('' = nothing usable typed).
 */
export function nameToSend(state: JoinState, typed: string): string {
  if (state.taken && takenPrompt(state.taken).initial && cleanInitial(state.initial)) return withInitial(state.taken.name, state.initial);
  return previewName(typed);
}

// ---------------------------------------------------------------------------
// Seats this device already holds (net/session.ts saves them under the same key)
// ---------------------------------------------------------------------------

/** net/session.ts SEAT_TTL_MS: a seat older than this is never resumed. */
const SEAT_TTL_MS = 12 * 3600_000;

type SeatStore = Pick<Storage, 'getItem'>;

/** One of these stores holds a live seat for `code` (a refresh, or the join link opened again). */
export function hasStoredSeat(code: string, stores: ReadonlyArray<SeatStore | null | undefined>, now = Date.now()): boolean {
  for (const store of stores) {
    try {
      const raw = store?.getItem(`dascade:seat:${code}`);
      if (!raw) continue;
      const seat = JSON.parse(raw) as { code?: unknown; seatToken?: unknown; savedAt?: unknown } | null;
      if (
        seat &&
        seat.code === code &&
        typeof seat.seatToken === 'string' &&
        typeof seat.savedAt === 'number' &&
        now - seat.savedAt <= SEAT_TTL_MS
      ) {
        return true;
      }
    } catch {
      /* unreadable entry: no seat */
    }
  }
  return false;
}

/** This browser holds a seat for `code` (tab storage first, then the cross-tab copy). */
export function deviceHasSeat(code: string): boolean {
  const store = (get: () => Storage): SeatStore | null => {
    try {
      return get();
    } catch {
      return null; // storage blocked (private mode, sandboxed frame)
    }
  };
  return hasStoredSeat(code, [store(() => sessionStorage), store(() => localStorage)]);
}
