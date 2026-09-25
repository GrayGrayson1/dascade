/**
 * DASQuest shared contract: settings, message names, client → server payload
 * schemas, the original hero archetypes and every public view shape the server
 * publishes (state.toJSON() and event payloads).
 *
 * Adventure content lives in @dascade/game-core/quest (packs); the client never
 * needs it because the server renders each scene into `sceneJson`.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';

// ---------------------------------------------------------------------------
// Stats & archetypes (original to DASCADE)
// ---------------------------------------------------------------------------

export const QUEST_STATS = ['GRIT', 'REFLEX', 'WITS', 'CHARM', 'LOGIC', 'INTUITION'] as const;
export type QuestStat = (typeof QUEST_STATS)[number];

export const QUEST_STAT_INFO: Record<QuestStat, { name: string; short: string; description: string; color: string }> = {
  GRIT: { name: 'Grit', short: 'GRT', description: 'Toughness, stubbornness and heavy lifting.', color: '#ff8a3d' },
  REFLEX: { name: 'Reflex', short: 'RFX', description: 'Speed, balance and getting out of the way.', color: '#22d3ee' },
  WITS: { name: 'Wits', short: 'WIT', description: 'Hands-on tech, repairs and improvisation.', color: '#a3e635' },
  CHARM: { name: 'Charm', short: 'CHA', description: 'Persuasion, confidence and reading the room.', color: '#ff4fd8' },
  LOGIC: { name: 'Logic', short: 'LOG', description: 'Puzzles, data and cold hard reasoning.', color: '#60a5fa' },
  INTUITION: { name: 'Intuition', short: 'INT', description: 'Hunches, omens and hearing the building hum.', color: '#a78bfa' },
};

/** Tags a check can carry; archetype abilities and items key off them. */
export const QUEST_CHECK_TAGS = ['tech', 'social', 'physical', 'mystic', 'data'] as const;
export type QuestCheckTag = (typeof QUEST_CHECK_TAGS)[number];

export const QUEST_ARCHETYPE_IDS = ['guardian', 'scout', 'tinker', 'trickster', 'analyst', 'seer'] as const;
export type QuestArchetypeId = (typeof QUEST_ARCHETYPE_IDS)[number];

export interface QuestArchetype {
  id: QuestArchetypeId;
  name: string;
  /** One-line identity. */
  tagline: string;
  description: string;
  /** Check modifiers per stat (added to the d20). */
  stats: Record<QuestStat, number>;
  maxHp: number;
  ability: { id: string; name: string; description: string };
  /** Highlight color used for the archetype's badge (the portrait itself uses the player's color). */
  tint: string;
}

export const QUEST_ARCHETYPES: Record<QuestArchetypeId, QuestArchetype> = {
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    tagline: 'Always the one holding the door.',
    description: 'Built like a filing cabinet and twice as dependable. Guardians wade in first and take the hits so nobody else has to.',
    stats: { GRIT: 4, REFLEX: 1, WITS: 0, CHARM: 1, LOGIC: 0, INTUITION: 1 },
    maxHp: 12,
    ability: {
      id: 'shield-wall',
      name: 'Shield Wall',
      description: 'Once per scene, automatically absorbs one harmful hit aimed at the whole party.',
    },
    tint: '#ff8a3d',
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    tagline: 'Knows every shortcut, including the forbidden ones.',
    description: 'Scouts notice the loose ceiling tile, the unlabeled door and the fire exit nobody uses. They are rarely where you left them.',
    stats: { GRIT: 1, REFLEX: 4, WITS: 1, CHARM: 0, LOGIC: 0, INTUITION: 2 },
    maxHp: 9,
    ability: {
      id: 'keen-eyes',
      name: 'Keen Eyes',
      description: 'Reveals secret choices hidden in scenes while the Scout is conscious.',
    },
    tint: '#22d3ee',
  },
  tinker: {
    id: 'tinker',
    name: 'Tinker',
    tagline: 'Fixes anything with duct tape and optimism.',
    description: 'Tinkers see a broken printer and think "project". They get a bonus on anything technical and can craft gear from party supplies.',
    stats: { GRIT: 1, REFLEX: 0, WITS: 4, CHARM: 0, LOGIC: 2, INTUITION: 1 },
    maxHp: 8,
    ability: {
      id: 'jury-rig',
      name: 'Jury-Rig',
      description: '+2 on every tech check, and unlocks Tinker-only crafting choices.',
    },
    tint: '#a3e635',
  },
  trickster: {
    id: 'trickster',
    name: 'Trickster',
    tagline: 'Talks their way into (and out of) anything.',
    description: 'Tricksters have a smile for every security guard and an excuse for every missed deadline. The rules are more of a suggestion.',
    stats: { GRIT: 0, REFLEX: 2, WITS: 1, CHARM: 4, LOGIC: 0, INTUITION: 1 },
    maxHp: 8,
    ability: {
      id: 'silver-tongue',
      name: 'Silver Tongue',
      description: 'Once per chapter, automatically rerolls a failed social or Charm check.',
    },
    tint: '#ff4fd8',
  },
  analyst: {
    id: 'analyst',
    name: 'Analyst',
    tagline: 'Has a spreadsheet for this. Has a spreadsheet for everything.',
    description: 'Analysts turn chaos into columns. With one in the party, everyone sees the exact difficulty and odds of every check.',
    stats: { GRIT: 0, REFLEX: 0, WITS: 2, CHARM: 0, LOGIC: 4, INTUITION: 1 },
    maxHp: 7,
    ability: {
      id: 'run-the-numbers',
      name: 'Run the Numbers',
      description: 'While conscious, reveals exact DCs and success odds on every choice for the whole party.',
    },
    tint: '#60a5fa',
  },
  seer: {
    id: 'seer',
    name: 'Signal Seer',
    tagline: 'Hears the building hum in a minor key.',
    description: 'Signal Seers pick up omens in the static: flickering lights, a printer sighing, a feeling in the elbows. They are unsettlingly often right.',
    stats: { GRIT: 0, REFLEX: 0, WITS: 1, CHARM: 1, LOGIC: 1, INTUITION: 4 },
    maxHp: 8,
    ability: {
      id: 'foresight',
      name: 'Foresight',
      description: 'Privately receives omens about where each choice leads. Share them, or keep the mystery.',
    },
    tint: '#a78bfa',
  },
};

// ---------------------------------------------------------------------------
// Scene environments (each has a procedural pixel-art renderer on the client)
// ---------------------------------------------------------------------------

export const QUEST_THEMES = [
  'office',
  'copyRoom',
  'breakArea',
  'serverRoom',
  'elevator',
  'stairwell',
  'lobby',
  'cubicleMaze',
  'meetingRoom',
  'breakRoom',
  'dataRiver',
  'arcade',
  'vault',
  'glitchCore',
  'dawn',
] as const;
export type QuestThemeId = (typeof QUEST_THEMES)[number];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const QUEST_DIFFICULTY_DC: Record<'story' | 'normal' | 'hard', number> = { story: -2, normal: 0, hard: 2 };

/** How long the host has to settle a 'host' mode tie before the auto rule decides (ms). */
export const QUEST_TIEBREAK_MS = 15_000;

export const QuestSettingsSchema = z.object({
  /** Adventure pack id (see the pack registry in @dascade/game-core/quest). */
  pack: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  /** Seconds the party has to vote on each scene. */
  voteSeconds: z.number().int().min(15).max(120),
  /** Whether several players may pick the same archetype. */
  allowDuplicates: z.boolean(),
  /** Shifts every DC: story −2, normal ±0, hard +2. */
  difficulty: z.enum(['story', 'normal', 'hard']),
  /** 'auto': best odds → leader's vote → random. 'host': the host settles ties. */
  tieBreak: z.enum(['auto', 'host']),
});
export type QuestSettings = z.infer<typeof QuestSettingsSchema>;

export const DEFAULT_QUEST_SETTINGS: QuestSettings = {
  pack: 'glitch-beneath',
  voteSeconds: 45,
  allowDuplicates: true,
  difficulty: 'normal',
  tieBreak: 'auto',
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const QUEST_MSG = {
  /** c→s (lobby) pick an archetype. */
  hero: 'quest:hero',
  /** c→s (lobby) claim a hero slot from a loaded save (-1 to release). */
  claim: 'quest:claim',
  /** c→s (lobby, host) load a signed save blob. */
  load: 'quest:load',
  /** c→s (lobby, host) discard the loaded save. */
  unload: 'quest:unload',
  /** c→s vote for a choice (null clears your vote). */
  vote: 'quest:vote',
  /** c→s (host) stop the vote timer and decide now. */
  decide: 'quest:decide',
  /** c→s (host) settle a tie between the tied choices. */
  tiebreak: 'quest:tiebreak',
  /** c→s use a party item on a hero. */
  use: 'quest:use',
  /** c→s (debug builds only, host) jump to a node or ending. */
  debug: 'quest:debug',
  /** s→c public roll event for the dice animation. */
  roll: 'quest:roll',
  /** s→c public scene/log events for sounds and flourishes. */
  event: 'quest:event',
  /** s→c private per-player info (Signal Seer omens). */
  private: 'quest:private',
  /** s→c (host only) signed checkpoint save. */
  checkpoint: 'quest:checkpoint',
} as const;

export const QuestHeroPickSchema = z.strictObject({ archetype: z.enum(QUEST_ARCHETYPE_IDS) });
export const QuestClaimSchema = z.strictObject({ slot: z.number().int().min(-1).max(15) });
export const QuestLoadSchema = z.strictObject({ blob: z.string().min(16).max(120_000) });
/** `rev` is the scene revision the vote was cast for (stale votes are rejected). */
export const QuestVoteSchema = z.strictObject({ choiceId: z.string().min(1).max(48).nullable(), rev: z.number().int().min(0).max(4_294_967_295) });
export const QuestTiebreakSchema = z.strictObject({ choiceId: z.string().min(1).max(48) });
export const QuestUseSchema = z.strictObject({ itemId: z.string().min(1).max(48), targetId: z.string().min(1).max(64) });
export const QuestDebugSchema = z.strictObject({
  nodeId: z.string().min(1).max(48).optional(),
  endingId: z.string().min(1).max(48).optional(),
});

// ---------------------------------------------------------------------------
// Public views (server → client)
// ---------------------------------------------------------------------------

export type QuestStage = 'lobby' | 'voting' | 'tiebreak' | 'rolling' | 'ended';
export type QuestTone = 'good' | 'bad' | 'neutral';
export type QuestDifficultyLabel = 'Trivial' | 'Easy' | 'Moderate' | 'Hard' | 'Very hard' | 'Heroic';

export interface QuestHeroView {
  playerId: string;
  name: string;
  color: string;
  archetype: QuestArchetypeId | '';
  hp: number;
  maxHp: number;
  /** Encoded as "statusId:turnsLeft" (0 = until removed). */
  statuses: string[];
  ko: boolean;
  /** Claimed slot from a loaded save (-1 = none). */
  slot: number;
  /** False once the player has left the room for good (their hero stays with the party). */
  present: boolean;
}

export interface QuestLogEntryView {
  id: number;
  kind: 'scene' | 'vote' | 'roll' | 'effect' | 'tie' | 'item' | 'system' | 'ending';
  text: string;
  turn: number;
  tone: QuestTone | '';
}

export interface QuestCheckView {
  stat: QuestStat;
  who: 'best' | 'chosen' | 'all' | 'random';
  tags: QuestCheckTag[];
  difficulty: QuestDifficultyLabel;
  /** Exact DC and odds are only present while an Analyst is conscious. */
  dc?: number;
  odds?: number;
  advantage: boolean;
  /** Who would roll if this were chosen now ('all' → every conscious hero). */
  rollerName?: string;
}

export interface QuestChoiceView {
  id: string;
  label: string;
  flavor: string;
  available: boolean;
  /** Why it is unavailable ("Requires: Keycard", "Tinker only"). */
  reason?: string;
  /** A secret choice revealed by the Scout. */
  secret?: boolean;
  check?: QuestCheckView;
}

export interface QuestSceneView {
  nodeId: string;
  rev: number;
  chapter: number;
  chapterTitle: string;
  title: string;
  theme: QuestThemeId;
  art: string[];
  paragraphs: string[];
  clock: string;
  checkpoint: boolean;
  ending: boolean;
  revealOdds: boolean;
  choices: QuestChoiceView[];
}

export interface QuestDieView {
  heroPlayerId: string;
  name: string;
  color: string;
  archetype: QuestArchetypeId;
  /** Natural d20 results (two when rolling with advantage). */
  naturals: number[];
  kept: number;
  modifier: number;
  parts: Array<{ label: string; value: number }>;
  total: number;
  success: boolean;
  crit: 'success' | 'failure' | null;
  /** Present when a Trickster's Silver Tongue replaced a failed roll. */
  rerolledFrom?: number;
}

export interface QuestRollView {
  id: number;
  turn: number;
  choiceId: string;
  choiceLabel: string;
  stat: QuestStat;
  who: 'best' | 'chosen' | 'all' | 'random';
  dc: number;
  dice: QuestDieView[];
  /** Group checks need this many successes. */
  needed: number;
  success: boolean;
  crit: 'success' | 'failure' | null;
  rerollBy?: string;
}

export interface QuestChangeView {
  kind: 'hp' | 'ko' | 'revive' | 'status' | 'item' | 'credits' | 'score' | 'shield' | 'note';
  text: string;
  tone: QuestTone;
  heroPlayerId?: string;
}

export interface QuestOutcomeView {
  turn: number;
  fromTitle: string;
  choiceLabel: string;
  votes: number;
  voters: number;
  tieRule?: string;
  success: boolean | null;
  crit: 'success' | 'failure' | null;
  text: string;
  changes: QuestChangeView[];
}

export interface QuestTieView {
  choiceIds: string[];
  counts: number;
}

export interface QuestItemView {
  id: string;
  name: string;
  description: string;
  icon: string;
  usable: boolean;
  useLabel?: string;
  /** 'hero' items need a target; 'party' items affect everyone. */
  useTarget?: 'hero' | 'party';
  key: boolean;
  bonus?: string;
}

export interface QuestStatusView {
  id: string;
  name: string;
  description: string;
  tone: 'buff' | 'debuff';
}

export interface QuestCatalogView {
  items: Record<string, QuestItemView>;
  statuses: Record<string, QuestStatusView>;
}

export interface QuestPackSummary {
  id: string;
  title: string;
  tagline: string;
  version: string;
  chapters: number;
  nodes: number;
  endings: number;
  length: string;
  archetypes: QuestArchetypeId[];
  kits: Partial<Record<QuestArchetypeId, Array<{ name: string; qty: number }>>>;
}

export interface QuestSaveHero {
  slot: number;
  name: string;
  archetype: QuestArchetypeId;
  hp: number;
  maxHp: number;
  ko: boolean;
}

export interface QuestSaveInfo {
  id: string;
  packId: string;
  packTitle: string;
  chapter: number;
  chapterTitle: string;
  nodeTitle: string;
  savedAt: number;
  credits: number;
  score: number;
  heroes: QuestSaveHero[];
}

export interface QuestAwardView {
  id: string;
  title: string;
  description: string;
  heroPlayerId: string;
  name: string;
  color: string;
  archetype: QuestArchetypeId;
}

export interface QuestResultHero {
  playerId: string;
  name: string;
  color: string;
  archetype: QuestArchetypeId;
  hp: number;
  maxHp: number;
  ko: boolean;
  rolls: number;
  successes: number;
  crits: number;
  fumbles: number;
  damageTaken: number;
  healing: number;
}

export interface QuestTimelineEntry {
  turn: number;
  chapter: number;
  nodeTitle: string;
  choiceLabel: string;
  votes: number;
  voters: number;
  tieRule?: string;
  stat?: QuestStat;
  success?: boolean;
  crit?: 'success' | 'failure' | null;
}

export interface QuestResultView {
  endingId: string;
  title: string;
  tier: 'great' | 'good' | 'bittersweet' | 'bad' | 'comedic';
  epilogue: string[];
  theme: QuestThemeId;
  score: number;
  turns: number;
  clock: string;
  packTitle: string;
  endingsFound: number;
  endingsTotal: number;
  heroes: QuestResultHero[];
  awards: QuestAwardView[];
  timeline: QuestTimelineEntry[];
}

export interface QuestPublicState extends BaseRoomView {
  stage: QuestStage;
  packId: string;
  packTitle: string;
  packsJson: string;
  catalogJson: string;
  heroes: Record<string, QuestHeroView>;
  inventory: Record<string, number>;
  credits: number;
  score: number;
  turn: number;
  chapter: number;
  sceneJson: string;
  sceneRev: number;
  votes: Record<string, string>;
  tieJson: string;
  rollJson: string;
  outcomeJson: string;
  resultJson: string;
  saveJson: string;
  log: QuestLogEntryView[];
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface QuestEventPayload {
  kind: 'scene' | 'ko' | 'revive' | 'item' | 'tie' | 'ending' | 'checkpoint';
  text?: string;
  tone?: QuestTone;
}

export interface QuestPrivatePayload {
  /** Scene revision these omens belong to. */
  rev: number;
  omens: Array<{ choiceId: string; text: string }>;
}

export interface QuestCheckpointPayload {
  /** Stable save id for this run (the client overwrites the same slot). */
  id: string;
  name: string;
  blob: string;
  info: QuestSaveInfo;
}
