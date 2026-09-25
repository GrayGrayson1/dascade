/**
 * Narrative interpolation. Plain text only — the result is rendered as React text,
 * never as HTML. Supported variables:
 *
 *   {party.names}  "Alex, Sam and Jo"      {party.size}  3
 *   {leader}       the leader's hero name  {clock}       "7:15 PM"
 *   {credits}      party credits           {chapter}     current chapter number
 *   {item.<id>}    party count of an item  {hero.<archetype>}  first hero of that archetype
 *
 * Unknown variables are left untouched (and flagged by the pack validator).
 */
import { QUEST_ARCHETYPE_IDS } from '@dascade/shared/games/quest';
import type { Adventure } from './schema.ts';
import type { RunState } from './state.ts';

export const VARIABLE_RE = /\{([a-z0-9_.-]+)\}/gi;

export function isKnownVariable(adv: Adventure, name: string): boolean {
  if (['party.names', 'party.size', 'leader', 'clock', 'credits', 'chapter'].includes(name)) return true;
  if (name.startsWith('item.')) return adv.items[name.slice(5)] !== undefined;
  if (name.startsWith('hero.')) return (QUEST_ARCHETYPE_IDS as readonly string[]).includes(name.slice(5));
  return false;
}

export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return 'nobody';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function formatClock(adv: Pick<Adventure, 'clockStart' | 'minutesPerTurn'>, turn: number): string {
  const [h, m] = adv.clockStart.split(':').map(Number) as [number, number];
  const total = (h * 60 + m + turn * adv.minutesPerTurn) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

export function interpolate(adv: Adventure, run: RunState, text: string, leaderSlot?: number): string {
  return text.replace(VARIABLE_RE, (match, name: string) => {
    switch (name) {
      case 'party.names':
        return joinNames(run.heroes.map((h) => h.name));
      case 'party.size':
        return String(run.heroes.length);
      case 'leader':
        return (run.heroes.find((h) => h.slot === leaderSlot) ?? run.heroes[0])?.name ?? 'the leader';
      case 'clock':
        return formatClock(adv, run.turn);
      case 'credits':
        return String(run.credits);
      case 'chapter':
        return String(run.chapter);
      default:
        if (name.startsWith('item.')) return String(run.inventory[name.slice(5)] ?? 0);
        if (name.startsWith('hero.')) {
          const hero = run.heroes.find((h) => h.archetype === name.slice(5) && !h.ko) ?? run.heroes.find((h) => h.archetype === name.slice(5));
          return hero?.name ?? 'someone';
        }
        return match;
    }
  });
}
