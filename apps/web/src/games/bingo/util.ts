/**
 * DAS Bingo client helpers: labels, colors, text fitting, plan parsing, voice caller,
 * local preferences and small hooks.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BINGO_LETTERS, type BingoCardPayload, type BingoPlanRound, type BingoPublicState, type BingoSettings } from '@dascade/shared/games/bingo';
import { columnForNumber, letterForNumber } from '@dascade/game-core/bingo';
import { useApp } from '../../app/store.ts';
import { useLatestMessage } from '../../net/hooks.ts';

/** Ball / column colors: B sky · I violet · N pink · G green · O amber. */
export const LETTER_COLORS = ['#38bdf8', '#a78bfa', '#ff4fd8', '#2de38f', '#ffb020'] as const;

export function tokenColor(mode: 'numbers' | 'text', token: number): string {
  if (mode === 'numbers') return LETTER_COLORS[columnForNumber(token)] as string;
  return LETTER_COLORS[((token % 5) + 5) % 5] as string;
}

export function tokenLetter(mode: 'numbers' | 'text', token: number): string {
  return mode === 'numbers' ? letterForNumber(token) : '#';
}

export function tokenText(mode: 'numbers' | 'text', token: number, items: readonly string[]): string {
  if (mode === 'numbers') return String(token);
  return items[token] ?? `#${token + 1}`;
}

/** Full label for chat, aria and the voice caller. */
export function tokenLabel(mode: 'numbers' | 'text', token: number, items: readonly string[]): string {
  return mode === 'numbers' ? `${letterForNumber(token)} ${token}` : (items[token] ?? `#${token + 1}`);
}

export { BINGO_LETTERS };

/**
 * Font scale (in container-inline-size % units) that makes a phrase fit a square cell:
 * the longest word must fit on one line and the whole phrase must fit the area.
 */
export function textFit(text: string): number {
  // Browsers may break after hyphens/slashes, so those split "words" for the width check.
  const words = text.split(/[\s\-/–—]+/).filter(Boolean);
  const longest = Math.max(1, ...words.map((w) => Array.from(w).length));
  const chars = Math.max(1, Array.from(text).length);
  return Math.max(6.5, Math.min(19, 136 / longest, 84 / Math.sqrt(chars)));
}

export function parsePlan(json: string | undefined): BingoPlanRound[] {
  if (!json) return [];
  try {
    const plan = JSON.parse(json) as BingoPlanRound[];
    return Array.isArray(plan) ? plan : [];
  } catch {
    return [];
  }
}

export function maskOf(s: string): boolean[] {
  return Array.from(s, (c) => c === '1');
}

/** The player's current card (ignores cards from a previous match). */
export function useMyCard(matchId: string | undefined): BingoCardPayload | null {
  const card = useLatestMessage<BingoCardPayload>('bingo:card');
  if (!card || !matchId || card.matchId !== matchId) return null;
  return card;
}

export function useReducedMotion(): boolean {
  return useApp((s) => s.settings.reducedMotion);
}

export function useFx(): 'high' | 'low' | 'off' {
  return useApp((s) => s.settings.fx);
}

/** Re-renders every `ms` while `active` (for countdown labels). */
export function useTicker(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** Cycles 0…count-1 every `ms` (family pattern animation). Static when reduced motion or count ≤ 1. */
export function useCycle(count: number, ms = 900): number {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (reduced || count <= 1) return;
    const id = setInterval(() => setI((v) => (v + 1) % count), ms);
    return () => clearInterval(id);
  }, [count, ms, reduced]);
  return count > 0 ? i % count : 0;
}

/** Local copy of a setting that commits after a quiet period (settings messages are rate limited). */
export function useDebouncedCommit<T>(value: T, commit: (v: T) => void, delay = 400): [T, (v: T) => void] {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) setLocal(value);
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const set = (v: T) => {
    setLocal(v);
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = false;
      commitRef.current(v);
    }, delay);
  };
  return [local, set];
}

// ---------------------------------------------------------------------------
// Voice caller (Web Speech API, opt-in per device)
// ---------------------------------------------------------------------------
const VOICE_KEY = 'dascade:bingo:voice';

export function loadVoicePref(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveVoicePref(on: boolean): void {
  try {
    localStorage.setItem(VOICE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function speak(text: string): void {
  if (!voiceSupported()) return;
  const { muted, masterVolume, sfxVolume } = useApp.getState().settings;
  if (muted || masterVolume <= 0) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.pitch = 1.05;
    u.volume = Math.min(1, masterVolume * Math.max(0.3, sfxVolume));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* speech is a nicety */
  }
}

export function spokenCall(mode: 'numbers' | 'text', token: number, items: readonly string[]): string {
  if (mode === 'text') return items[token] ?? '';
  const letter = letterForNumber(token);
  const digits = token >= 10 ? `, ${String(token).split('').join(' ')}` : '';
  return `${letter}. ${token}${digits}`;
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  color: string;
  avatar: string;
  connected: boolean;
  wins: number;
  falseClaims: number;
  lockedUntil: number;
  need: number;
  isYou: boolean;
}

export function standings(state: BingoPublicState, meId: string | null): Standing[] {
  const out: Standing[] = [];
  for (const p of Object.values(state.players)) {
    if (p.spectator) continue;
    const b = state.bingo?.[p.id];
    out.push({
      id: p.id,
      name: p.name,
      color: p.color,
      avatar: p.avatar,
      connected: p.connected,
      wins: b?.wins ?? 0,
      falseClaims: b?.falseClaims ?? 0,
      lockedUntil: b?.lockedUntil ?? 0,
      need: b?.need ?? -1,
      isYou: p.id === meId,
    });
  }
  const needKey = (n: number) => (n < 0 ? 999 : n);
  return out.sort((a, b) => b.wins - a.wins || needKey(a.need) - needKey(b.need) || a.name.localeCompare(b.name));
}

export function useCalledSet(calls: readonly number[] | undefined): Set<number> {
  const key = calls?.join(',') ?? '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Set(calls ?? []), [key]);
}

export type SettingsPatch = Partial<BingoSettings>;
