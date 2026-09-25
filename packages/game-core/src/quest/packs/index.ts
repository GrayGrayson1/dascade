/**
 * Adventure pack registry.
 *
 * To add a pack: create `packs/<your-pack>.ts` exporting an AdventureInput and add
 * it to BUILT_IN_PACKS below. Nothing else changes — the engine, the room and the
 * client all discover packs through this registry (the client receives the pack
 * list from the server). Packs are validated on first use and invalid packs are
 * rejected with a readable list of problems.
 */
import type { QuestPackSummary } from '@dascade/shared/games/quest';
import type { Adventure, AdventureInput } from '../schema.ts';
import { loadAdventure } from '../validate.ts';
import { GLITCH_BENEATH } from './glitch-beneath.ts';
import { MISSING_BEANS } from './missing-beans.ts';

export const BUILT_IN_PACKS: readonly AdventureInput[] = [GLITCH_BENEATH, MISSING_BEANS];

const sources = new Map<string, AdventureInput>(BUILT_IN_PACKS.map((p) => [p.id, p]));
const loaded = new Map<string, Adventure>();

/** Register an additional pack at runtime (e.g. from a plugin module). */
export function registerPack(input: AdventureInput): void {
  sources.set(input.id, input);
  loaded.delete(input.id);
}

export function packIds(): string[] {
  return [...sources.keys()];
}

export function hasPack(id: string): boolean {
  return sources.has(id);
}

/** Load (and cache) a validated pack. Throws AdventureError for invalid content. */
export function getPack(id: string): Adventure {
  const cached = loaded.get(id);
  if (cached) return cached;
  const src = sources.get(id);
  if (!src) throw new Error(`Unknown adventure pack "${id}"`);
  const adv = loadAdventure(src);
  loaded.set(id, adv);
  return adv;
}

export function summarizePack(adv: Adventure): QuestPackSummary {
  const kits: QuestPackSummary['kits'] = {};
  for (const [archetype, kit] of Object.entries(adv.kits)) {
    kits[archetype as keyof QuestPackSummary['kits']] = (kit ?? []).map((k) => ({ name: adv.items[k.item]?.name ?? k.item, qty: k.qty }));
  }
  return {
    id: adv.id,
    title: adv.title,
    tagline: adv.tagline,
    version: adv.version,
    chapters: adv.chapters.length,
    nodes: adv.nodes.length,
    endings: Object.keys(adv.endings).length,
    length: adv.length,
    archetypes: [...adv.archetypes],
    kits,
  };
}

/** Summaries of every valid pack (invalid packs are skipped and reported via onError). */
export function packCatalog(onError?: (id: string, err: unknown) => void): QuestPackSummary[] {
  const out: QuestPackSummary[] = [];
  for (const id of sources.keys()) {
    try {
      out.push(summarizePack(getPack(id)));
    } catch (err) {
      onError?.(id, err);
    }
  }
  return out;
}
