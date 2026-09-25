/**
 * Small client helpers for DASQuest: memoized JSON views of state fields, status
 * parsing, text emphasis and procedural sound cues.
 */
import { useMemo } from 'react';
import { QUEST_ARCHETYPES, type QuestArchetypeId, type QuestHeroView, type QuestPackSummary } from '@dascade/shared/games/quest';
import { sfx, synth } from '../../audio/audio.ts';

export function useJson<T>(json: string | null | undefined): T | null {
  return useMemo(() => {
    if (!json) return null;
    try {
      return JSON.parse(json) as T;
    } catch {
      return null;
    }
  }, [json]);
}

export function sortHeroes(heroes: Record<string, QuestHeroView> | undefined): QuestHeroView[] {
  return Object.values(heroes ?? {}).sort((a, b) => a.slot - b.slot || a.name.localeCompare(b.name));
}

export function parseStatus(entry: string): { id: string; turns: number } {
  const [id = entry, turns = '0'] = entry.split(':');
  return { id, turns: Number(turns) || 0 };
}

export function archetypeName(id: QuestArchetypeId | '' | undefined): string {
  return id ? QUEST_ARCHETYPES[id].name : 'Choosing…';
}

/** Split `*emphasis*` into segments (the only markup narrative supports). */
export function emphasis(text: string): Array<{ text: string; em: boolean }> {
  const out: Array<{ text: string; em: boolean }> = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), em: false });
    out.push({ text: m[1]!, em: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), em: false });
  return out;
}

export function packById(packsJson: string | undefined, id: string): QuestPackSummary | undefined {
  try {
    return (JSON.parse(packsJson || '[]') as QuestPackSummary[]).find((p) => p.id === id);
  } catch {
    return undefined;
  }
}

export function pct(odds: number): string {
  return `${Math.round(odds * 100)}%`;
}

// ---------------------------------------------------------------------------
// Sound cues (procedural, via the shared audio engine)
// ---------------------------------------------------------------------------

export const questSound = {
  scene: () => sfx('whoosh'),
  checkpoint: () => sfx('ding'),
  vote: () => sfx('select'),
  tick: () => sfx('tick', 200),
  diceStart: () => sfx('dice'),
  diceTick: () => synth.tone({ type: 'square', freq: synth.note(72 + Math.floor(Math.random() * 12)), dur: 0.03, gain: 0.03 }),
  diceLand: () => sfx('pop'),
  success: (crit: boolean) => sfx(crit ? 'bigwin' : 'correct'),
  failure: (crit: boolean) => sfx(crit ? 'lose' : 'wrong'),
  ko: () => sfx('crash'),
  revive: () => sfx('coin'),
  item: () => sfx('pop'),
  tie: () => sfx('tick'),
  ending: (good: boolean) => sfx(good ? 'win' : 'lose'),
};
