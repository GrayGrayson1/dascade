/**
 * Registers every party-game load scenario found in scripts/load/<gameId>.ts with load-test.ts.
 * A missing file is skipped silently (games are added by their owners).
 */
import { existsSync } from 'node:fs';
import type { AddScenario, ScenarioContext } from './helpers.ts';

const PARTY_SCENARIO_FILES = ['trivia', 'deception', 'masterpiece', 'words', 'survey'] as const;

export async function register(add: AddScenario, ctx: ScenarioContext): Promise<void> {
  for (const id of PARTY_SCENARIO_FILES) {
    const url = new URL(`./${id}.ts`, import.meta.url);
    if (!existsSync(url)) continue;
    try {
      const mod = (await import(url.href)) as { register?: (add: AddScenario, ctx: ScenarioContext) => void | Promise<void> };
      await mod.register?.(add, ctx);
    } catch (err) {
      console.warn(`  (load scenario ${id} failed to load: ${(err as Error).message})`);
    }
  }
}
