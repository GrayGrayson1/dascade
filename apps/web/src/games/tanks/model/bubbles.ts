/**
 * Speech-bubble layout (pure; unit tested). Each tank shows at most two bubbles: the newest sits
 * just above the tank's label, an older one is pushed up a row. Bubbles pop in and fade out.
 */
import type { Quip } from './playback.ts';

export interface BubbleSlot {
  key: number;
  id: string;
  line: string;
  /** 0 = nearest the tank. */
  row: number;
  alpha: number;
  scale: number;
}

const POP_MS = 140;
const FADE_MS = 420;

/** Bubble rows per tank for the quips alive at `now`. */
export function layoutBubbles(quips: readonly Quip[], now: number): BubbleSlot[] {
  const byTank = new Map<string, Quip[]>();
  for (const q of quips) {
    const age = now - q.start;
    if (age < 0 || age > q.life) continue;
    const list = byTank.get(q.id) ?? [];
    list.push(q);
    byTank.set(q.id, list);
  }
  const out: BubbleSlot[] = [];
  for (const list of byTank.values()) {
    const sorted = [...list].sort((a, b) => b.start - a.start || b.key - a.key);
    sorted.forEach((q, row) => {
      const age = now - q.start;
      const pop = Math.min(1, age / POP_MS);
      const left = q.life - age;
      const alpha = Math.min(pop, left < FADE_MS ? left / FADE_MS : 1);
      out.push({ key: q.key, id: q.id, line: q.line, row, alpha: Math.max(0, alpha), scale: 0.7 + 0.3 * (1 - (1 - pop) * (1 - pop)) });
    });
  }
  return out;
}

/** Break a line into rows of at most `max` characters at spaces (long words are kept whole). */
export function wrapLine(text: string, max = 24): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let row = '';
  for (const w of words) {
    if (!row) row = w;
    else if (row.length + 1 + w.length <= max) row += ` ${w}`;
    else {
      rows.push(row);
      row = w;
    }
  }
  if (row) rows.push(row);
  return rows.length ? rows : [''];
}
