/**
 * One per-tab "show feed": the latest board event, the host's line, presenter cues and audience
 * reactions, fed once by ShowdownView from the room's messages. Every stage on this device (the
 * console preview, the stage window, a phone's mini board) reads the same feed, so they animate in
 * step — and sounds are played once per device by the feed, never per stage.
 */
import { useSyncExternalStore } from 'react';
import type { ShowdownCue, ShowdownEvent, ShowdownReactions } from '@dascade/shared/games/showdown';
import type { HostLine } from './look.ts';

export interface FloatingReaction {
  id: number;
  /** Reaction kind (index into the look's emoji set). */
  kind: number;
  /** Which side it rises from: the cheering team's (-1 = middle). */
  side: -1 | 0 | 1;
  /** 0..1 horizontal jitter. */
  x: number;
  at: number;
}

export interface ShowFeed {
  /** Last board event with the time it arrived (performance.now()). */
  event: { e: ShowdownEvent; at: number } | null;
  cue: { cue: ShowdownCue; id: number; at: number } | null;
  line: HostLine | null;
  lineAt: number;
  reactions: FloatingReaction[];
  /** Your own guess was just called (private flash). */
  calledAt: number;
  calledPoints: number;
}

const EMPTY: ShowFeed = { event: null, cue: null, line: null, lineAt: 0, reactions: [], calledAt: 0, calledPoints: 0 };
let feed: ShowFeed = EMPTY;
const listeners = new Set<() => void>();
let reactionSeq = 0;
/** Floating reactions alive at once (older ones are dropped first). */
const MAX_FLOATING = 40;
const REACTION_LIFE_MS = 3200;

function set(patch: Partial<ShowFeed>): void {
  feed = { ...feed, ...patch };
  for (const l of [...listeners]) l();
}

export const showFeed = {
  reset(): void {
    feed = EMPTY;
    for (const l of [...listeners]) l();
  },
  event(e: ShowdownEvent): void {
    set({ event: { e, at: performance.now() } });
  },
  cue(cue: ShowdownCue, id: number): void {
    set({ cue: { cue, id, at: performance.now() } });
  },
  say(line: HostLine | null): void {
    if (!line || line.key === feed.line?.key) return;
    set({ line, lineAt: performance.now() });
  },
  /** Spreads a batch of reactions into floating emoji (budgeted by the effects setting). */
  reactions(batch: ShowdownReactions, budget: number): void {
    if (budget <= 0) return;
    const now = performance.now();
    const alive = feed.reactions.filter((r) => now - r.at < REACTION_LIFE_MS);
    const total = batch.k.reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const show = Math.min(total, budget);
    const added: FloatingReaction[] = [];
    // Kinds in proportion to how often they were sent; sides in proportion to the teams cheering.
    const kinds: number[] = [];
    batch.k.forEach((n, kind) => {
      for (let i = 0; i < Math.min(n, 200); i++) kinds.push(kind);
    });
    const teamTotal = batch.t[0] + batch.t[1];
    for (let i = 0; i < show; i++) {
      const kind = kinds[Math.floor((i * kinds.length) / show)] ?? 0;
      const r = (reactionSeq * 0.618034) % 1;
      const side: -1 | 0 | 1 = teamTotal === 0 ? -1 : r < batch.t[0] / teamTotal ? 0 : 1;
      reactionSeq++;
      added.push({ id: reactionSeq, kind, side, x: (reactionSeq * 0.381966) % 1, at: now + i * 70 });
    }
    set({ reactions: [...alive, ...added].slice(-MAX_FLOATING) });
  },
  called(points: number): void {
    set({ calledAt: performance.now(), calledPoints: points });
  },
};

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useShowFeed(): ShowFeed {
  return useSyncExternalStore(subscribe, () => feed, () => EMPTY);
}

export const REACTION_LIFE = REACTION_LIFE_MS;
