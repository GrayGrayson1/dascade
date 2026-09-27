/**
 * DASino client-only UI state (never game truth): which table this client is
 * looking at, the selected chip, slot bet preferences, and a "held" slot win
 * that keeps the balance display from spoiling a spin before the reels stop.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { InsideBetType } from '@dascade/game-core/dasino';
import type { DasinoTable, SlotResultPayload } from '@dascade/shared/games/dasino';
import { useApp } from '../../app/store.ts';
import { sfx, type SfxName } from '../../audio/audio.ts';

interface DasinoUiState {
  table: DasinoTable;
  chip: number;
  lines: 1 | 3 | 5;
  lineBet: number;
  /** Inside-bet type for tap placement on touch layouts. */
  betMode: InsideBetType;
  /**
   * Balance to display while my slot reels are turning (the server has already
   * settled the spin; showing the new balance would spoil the result).
   */
  freeze: number | null;
  /** My recent slot spins (newest first), in the room `logRoom`. */
  slotLog: SlotResultPayload[];
  /** Room code the spin log (and held balance) belongs to. */
  logRoom: string | null;
  setTable: (table: DasinoTable) => void;
  setChip: (chip: number) => void;
  setLines: (lines: 1 | 3 | 5) => void;
  setLineBet: (lineBet: number) => void;
  setBetMode: (mode: InsideBetType) => void;
  setFreeze: (freeze: number | null) => void;
  logSlot: (result: SlotResultPayload) => void;
  /** Entering a room: a different room than the log's clears it (the store outlives rooms). */
  enterRoom: (code: string) => void;
}

export const useDasinoUi = create<DasinoUiState>((set) => ({
  table: 'floor',
  chip: 25,
  lines: 5,
  lineBet: 5,
  betMode: 'straight',
  freeze: null,
  slotLog: [],
  logRoom: null,
  setTable: (table) => set({ table }),
  setChip: (chip) => set({ chip }),
  setLines: (lines) => set({ lines }),
  setLineBet: (lineBet) => set({ lineBet }),
  setBetMode: (betMode) => set({ betMode }),
  setFreeze: (freeze) => set({ freeze }),
  logSlot: (result) => set((s) => (s.slotLog.some((r) => r.id === result.id && r.at === result.at) ? s : { slotLog: [result, ...s.slotLog].slice(0, 12) })),
  enterRoom: (code) => set((s) => (s.logRoom === code ? s : { logRoom: code, slotLog: [], freeze: null })),
}));

export function useMotion(): { reduced: boolean; fx: 'high' | 'low' | 'off' } {
  const reduced = useApp((s) => s.settings.reducedMotion);
  const fx = useApp((s) => s.settings.fx);
  return { reduced, fx };
}

export function play(name: SfxName, gap?: number): void {
  sfx(name, gap);
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function signed(n: number): string {
  if (n > 0) return `+${fmt(n)}`;
  if (n < 0) return `−${fmt(Math.abs(n))}`;
  return '±0';
}

/** Tracks a CSS media query. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** "You won 360 (+350)" / "You lost 25" / "100 back on 400 (−300)". */
export function payoutLine(p: { staked: number; returned: number }): string {
  const net = p.returned - p.staked;
  if (p.returned === 0) return `You lost ${fmt(p.staked)}`;
  if (net > 0) return `You won ${fmt(p.returned)} (${signed(net)})`;
  if (net === 0) return `Break even — ${fmt(p.returned)} back`;
  return `${fmt(p.returned)} back on ${fmt(p.staked)} (${signed(net)})`;
}
