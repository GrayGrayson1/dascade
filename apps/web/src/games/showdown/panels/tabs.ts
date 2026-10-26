/**
 * Which crew tabs a person gets (pure, unit-tested). The server checks every action again; this only
 * decides what the screen offers, from the permissions the server sent (deny by default).
 */
import type { ShowdownPermission } from '@dascade/shared/games/showdown';

export type CrewTab = 'names' | 'crew' | 'preflight';

export const CREW_TAB_LABEL: Record<CrewTab, string> = {
  names: 'Names',
  crew: 'Crew & log',
  preflight: 'Preflight',
};

export function crewTabs(perms: readonly ShowdownPermission[] | readonly string[]): CrewTab[] {
  const has = (p: ShowdownPermission) => (perms as readonly string[]).includes(p);
  const out: CrewTab[] = [];
  if (has('people.rename') || has('people.hide')) out.push('names');
  if (has('audit.read') || has('crew.issue') || has('presenter.assign')) out.push('crew');
  if (has('preflight.read')) out.push('preflight');
  return out;
}

/** "Producer · Moderator" (roles in words, in a stable order). */
export function roleWords(roles: readonly string[], titles: Record<string, { title: string }>): string {
  const order = ['producer', 'presenter', 'backup', 'moderator'];
  return [...new Set(roles)]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((r) => titles[r]?.title ?? r)
    .join(' · ');
}
