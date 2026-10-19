/**
 * One per-tab "show feed": the latest board event, the host's line, presenter cues and audience
 * reactions, fed once by ShowdownView from the room's messages. Every stage on this device (the
 * console preview, the stage window, a phone's mini board) reads the same feed, so they animate in
 * step — and sounds are played once per device by the feed, never per stage.
 *
 * The Presenter Tour's demo source (source.ts) brings a feed of its own, so a tour never adds to the
 * live show's feed.
 */
import { useSyncExternalStore } from 'react';
import type { ShowdownCue, ShowdownEvent, ShowdownReactions } from '@dascade/shared/games/showdown';
import type { HostLine } from './look.ts';
import { useShowSource } from './source.ts';

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

export type FeedEntry<T extends ShowdownEvent['type'] = ShowdownEvent['type']> = { e: Extract<ShowdownEvent, { type: T }>; at: number };

export interface ShowFeed {
  /** Last board event with the time it arrived (performance.now()). */
  event: { e: ShowdownEvent; at: number } | null;
  /**
   * The latest event of each kind, so overlays don't cut each other off: a wrong answer pressed
   * during the special answer's celebration shows its ✕ without ending the celebration.
   */
  last: { [T in ShowdownEvent['type']]?: FeedEntry<T> };
  /**
   * The big celebration: a special answer flipped (slot ≥ 0, with its text) or the presenter's
   * "Celebrate!" cue (slot -1). `key` re-keys the animation.
   */
  celebrate: { at: number; slot: number; text: string; key: string } | null;
  cue: { cue: ShowdownCue; id: number; at: number } | null;
  line: HostLine | null;
  lineAt: number;
  reactions: FloatingReaction[];
  /** The latest reaction batch's size and when it came (the host reacts to a cheering crowd). */
  cheer: { at: number; count: number } | null;
  /** Your own guess was just called (private flash). */
  calledAt: number;
  calledPoints: number;
}

const EMPTY: ShowFeed = { event: null, last: {}, celebrate: null, cue: null, line: null, lineAt: 0, reactions: [], cheer: null, calledAt: 0, calledPoints: 0 };
/** Floating reactions alive at once (older ones are dropped first). */
const MAX_FLOATING = 40;
const REACTION_LIFE_MS = 3200;

export interface ShowFeedStore {
  reset(): void;
  event(e: ShowdownEvent): void;
  cue(cue: ShowdownCue, id: number): void;
  say(line: HostLine | null): void;
  /** Spreads a batch of reactions into floating emoji (budgeted by the effects setting). */
  reactions(batch: ShowdownReactions, budget: number): void;
  called(points: number): void;
  /** Stable functions, for useSyncExternalStore. */
  subscribe: (fn: () => void) => () => void;
  get: () => ShowFeed;
}

/** A feed store. The room's is `showFeed`; a demo source (the Presenter Tour) makes its own. */
export function createShowFeed(): ShowFeedStore {
  let feed: ShowFeed = EMPTY;
  const listeners = new Set<() => void>();
  let reactionSeq = 0;

  function set(patch: Partial<ShowFeed>): void {
    feed = { ...feed, ...patch };
    for (const l of [...listeners]) l();
  }

  return {
    reset(): void {
      feed = EMPTY;
      for (const l of [...listeners]) l();
    },
    event(e: ShowdownEvent): void {
      const at = performance.now();
      const patch: Partial<ShowFeed> = { event: { e, at }, last: { ...feed.last, [e.type]: { e, at } } };
      if (e.type === 'reveal' && e.special) patch.celebrate = { at, slot: e.slot, text: e.text, key: `reveal:${e.rev}` };
      // Rewinding the board (undo, restart, reset) ends a celebration that was still on.
      if (e.type === 'undo' || e.type === 'restart' || e.type === 'reset') patch.celebrate = null;
      set(patch);
    },
    cue(cue: ShowdownCue, id: number): void {
      const at = performance.now();
      set({ cue: { cue, id, at }, ...(cue === 'celebrate' ? { celebrate: { at, slot: -1, text: '', key: `cue:${id}` } } : {}) });
    },
    say(line: HostLine | null): void {
      if (!line || line.key === feed.line?.key) return;
      set({ line, lineAt: performance.now() });
    },
    reactions(batch: ShowdownReactions, budget: number): void {
      const now = performance.now();
      const count = batch.k.reduce((a, b) => a + b, 0);
      if (count > 0) feed = { ...feed, cheer: { at: now, count } };
      if (budget <= 0) {
        if (count > 0) set({});
        return;
      }
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
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get: () => feed,
  };
}

/** The room's feed, fed once by ShowdownView from the room's messages. */
export const showFeed = createShowFeed();

/** The show feed: the room's, or the demo source's inside a ShowSourceProvider. */
export function useShowFeed(): ShowFeed {
  const demo = useShowSource()?.feed;
  const store = demo ?? showFeed;
  return useSyncExternalStore(store.subscribe, store.get, demo ? demo.get : () => EMPTY);
}

export const REACTION_LIFE = REACTION_LIFE_MS;
