/**
 * DASQuest adventure content schema.
 *
 * Packs are plain typed data validated by these Zod schemas at load time (see
 * validate.ts for the cross-reference / graph checks). Conditions and effects use a
 * compact "discriminated by key" form so content reads naturally:
 *
 *   if: { all: [{ archetype: 'tinker' }, { hasItem: 'duct_tape' }] }
 *   success: [{ addItem: 'grapple' }, { hp: -2, target: 'roller' }]
 *
 * Narrative text is plain text (never HTML). `*word*` renders as emphasis and
 * `{variables}` are interpolated (see interpolate.ts).
 */
import { z } from 'zod';
import {
  QUEST_ARCHETYPE_IDS,
  QUEST_CHECK_TAGS,
  QUEST_STATS,
  QUEST_THEMES,
  type QuestArchetypeId,
  type QuestCheckTag,
  type QuestStat,
} from '@dascade/shared/games/quest';

export const IdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9_-]+$/i, 'ids use letters, digits, - and _');

const Text = (max: number) => z.string().min(1).max(max);
const StatSchema = z.enum(QUEST_STATS);
const ArchetypeSchema = z.enum(QUEST_ARCHETYPE_IDS);
const TagSchema = z.enum(QUEST_CHECK_TAGS);

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type Condition =
  | { hasItem: string; qty?: number }
  | { flag: string; equals?: boolean | number }
  | { counter: string; atLeast?: number; below?: number }
  | { archetype: QuestArchetypeId }
  | { stat: QuestStat; atLeast: number }
  | { credits: number }
  | { partyHp: { belowPct?: number; atLeastPct?: number } }
  | { anyKo: boolean }
  | { visited: string }
  | { partySize: { min?: number; max?: number } }
  | { status: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ hasItem: IdSchema, qty: z.number().int().min(1).max(99).optional() }),
    z.strictObject({ flag: IdSchema, equals: z.union([z.boolean(), z.number()]).optional() }),
    z.strictObject({ counter: IdSchema, atLeast: z.number().int().optional(), below: z.number().int().optional() }),
    z.strictObject({ archetype: ArchetypeSchema }),
    z.strictObject({ stat: StatSchema, atLeast: z.number().int().min(-5).max(20) }),
    z.strictObject({ credits: z.number().int().min(0).max(9999) }),
    z.strictObject({
      partyHp: z.strictObject({ belowPct: z.number().min(0).max(1).optional(), atLeastPct: z.number().min(0).max(1).optional() }),
    }),
    z.strictObject({ anyKo: z.boolean() }),
    z.strictObject({ visited: IdSchema }),
    z.strictObject({ partySize: z.strictObject({ min: z.number().int().min(1).optional(), max: z.number().int().min(1).optional() }) }),
    z.strictObject({ status: IdSchema }),
    z.strictObject({ all: z.array(ConditionSchema).min(1).max(12) }),
    z.strictObject({ any: z.array(ConditionSchema).min(1).max(12) }),
    z.strictObject({ not: ConditionSchema }),
  ]),
);

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * Who an effect applies to.
 *  party    — every hero (conscious ones for damage/heal)
 *  roller   — the hero(es) the outcome applies to: the roller, or for group checks the
 *             heroes whose own die matched the outcome (success effects → heroes who
 *             passed, failure effects → heroes who failed). No check → the party.
 *  random   — one random conscious hero (server RNG)
 *  weakest  — the conscious hero with the lowest HP
 *  leader   — the party leader's (host's) hero
 *  target   — the hero chosen when using an item
 */
export const TARGETS = ['party', 'roller', 'random', 'weakest', 'leader', 'target'] as const;
export type Target = (typeof TARGETS)[number];
const TargetSchema = z.enum(TARGETS);

export type Effect =
  | { hp: number; target?: Target }
  | { revive: Target; hp?: number }
  | { addStatus: string; target?: Target; turns?: number }
  | { removeStatus: string; target?: Target }
  | { addItem: string; qty?: number }
  | { removeItem: string; qty?: number }
  | { credits: number }
  | { setFlag: string; value?: boolean | number }
  | { addCounter: string; by?: number }
  | { score: number }
  | { note: string };

export const EffectSchema: z.ZodType<Effect> = z.union([
  z.strictObject({ hp: z.number().int().min(-20).max(20), target: TargetSchema.optional() }),
  z.strictObject({ revive: TargetSchema, hp: z.number().int().min(1).max(20).optional() }),
  z.strictObject({ addStatus: IdSchema, target: TargetSchema.optional(), turns: z.number().int().min(0).max(20).optional() }),
  z.strictObject({ removeStatus: IdSchema, target: TargetSchema.optional() }),
  z.strictObject({ addItem: IdSchema, qty: z.number().int().min(1).max(20).optional() }),
  z.strictObject({ removeItem: IdSchema, qty: z.number().int().min(1).max(20).optional() }),
  z.strictObject({ credits: z.number().int().min(-99).max(99) }),
  z.strictObject({ setFlag: IdSchema, value: z.union([z.boolean(), z.number()]).optional() }),
  z.strictObject({ addCounter: IdSchema, by: z.number().int().min(-20).max(20).optional() }),
  z.strictObject({ score: z.number().int().min(-5000).max(5000) }),
  z.strictObject({ note: Text(240) }),
]);

// ---------------------------------------------------------------------------
// Checks, choices, nodes
// ---------------------------------------------------------------------------

export const CheckSchema = z.strictObject({
  stat: StatSchema,
  dc: z.number().int().min(2).max(30),
  /**
   * best    — the conscious hero with the best modifier rolls
   * chosen  — the best hero among those whose players voted for this choice (fallback: best)
   * all     — every conscious hero rolls; success if at least half succeed
   * random  — a random conscious hero rolls
   */
  who: z.enum(['best', 'chosen', 'all', 'random']).default('best'),
  tags: z.array(TagSchema).max(3).default([]),
  /** Roll two d20 and keep the higher when this holds. */
  advantageIf: ConditionSchema.optional(),
});
export type CheckInput = z.input<typeof CheckSchema>;
export type Check = z.output<typeof CheckSchema>;

export const ChoiceSchema = z.strictObject({
  id: IdSchema,
  label: Text(90),
  flavor: z.string().max(200).default(''),
  /** Availability condition. */
  if: ConditionSchema.optional(),
  /** Unavailable choices are shown disabled with a reason (default) or hidden. */
  unavailable: z.enum(['disable', 'hide']).default('disable'),
  /** Overrides the auto-generated "Requires: …" text. */
  reason: z.string().max(90).optional(),
  /** Secret choices only appear while a Scout is conscious. */
  secret: z.boolean().default(false),
  /** Disappears after being chosen once in this run. */
  once: z.boolean().default(false),
  check: CheckSchema.optional(),
  /** Applied when chosen, before any check (costs, consumed items). */
  effects: z.array(EffectSchema).max(12).default([]),
  success: z.array(EffectSchema).max(12).default([]),
  failure: z.array(EffectSchema).max(12).default([]),
  next: IdSchema.optional(),
  nextOnSuccess: IdSchema.optional(),
  nextOnFailure: IdSchema.optional(),
  /** Outcome narration (no check) or shared fallback text. */
  text: z.string().max(400).optional(),
  successText: z.string().max(400).optional(),
  failureText: z.string().max(400).optional(),
  /** Signal Seer omen. Auto-generated when omitted. */
  omen: z.string().max(200).optional(),
});
export type ChoiceInput = z.input<typeof ChoiceSchema>;
export type Choice = z.output<typeof ChoiceSchema>;

export const NodeSchema = z.strictObject({
  id: IdSchema,
  chapter: z.number().int().min(1).max(12),
  title: Text(60),
  theme: z.enum(QUEST_THEMES),
  /** Scene props drawn over the environment (see the client scene renderer). */
  art: z.array(z.string().max(24)).max(6).default([]),
  narrative: z.array(Text(1200)).min(1).max(8),
  onEnter: z.array(EffectSchema).max(12).default([]),
  /** Evaluated in order after onEnter; the first match redirects immediately. */
  routes: z.array(z.strictObject({ if: ConditionSchema, to: IdSchema })).max(6).default([]),
  choices: z.array(ChoiceSchema).max(8).default([]),
  /** Terminal node: the ending shown on the results screen. */
  ending: IdSchema.optional(),
  /** Major node: emits a signed save and marks a chapter start. */
  checkpoint: z.boolean().default(false),
});
export type NodeInput = z.input<typeof NodeSchema>;
export type AdventureNode = z.output<typeof NodeSchema>;

export const ItemSchema = z.strictObject({
  name: Text(40),
  description: Text(200),
  /** A PixelIcon name or a quest glyph id (client falls back to a generic icon). */
  icon: z.string().max(24).default('star'),
  /** Plot items can't be used directly. */
  key: z.boolean().default(false),
  use: z
    .strictObject({
      label: Text(24),
      /** 'hero' targets one hero (effects use target: 'target'); 'party' affects everyone. */
      target: z.enum(['hero', 'party']),
      effects: z.array(EffectSchema).min(1).max(6),
      /** Only KO'd heroes (revives) or only conscious heroes (heals) may be targeted. */
      requires: z.enum(['conscious', 'ko', 'any']).default('conscious'),
    })
    .optional(),
  /** Passive bonus while the party carries at least one. */
  bonus: z.strictObject({ stat: StatSchema.optional(), tag: TagSchema.optional(), amount: z.number().int().min(-5).max(5) }).optional(),
});
export type ItemDef = z.output<typeof ItemSchema>;

export const StatusSchema = z.strictObject({
  name: Text(30),
  description: Text(160),
  tone: z.enum(['buff', 'debuff']),
  /** Default duration in decisions: it ticks down after each scene's choice resolves (0 = until removed). */
  turns: z.number().int().min(0).max(20).default(3),
  mods: z.partialRecord(StatSchema, z.number().int().min(-5).max(5)).default({}),
  allChecks: z.number().int().min(-5).max(5).default(0),
  damagePerScene: z.number().int().min(0).max(5).default(0),
});
export type StatusDef = z.output<typeof StatusSchema>;

export const EndingSchema = z.strictObject({
  title: Text(60),
  tier: z.enum(['great', 'good', 'bittersweet', 'bad', 'comedic']),
  epilogue: z.array(Text(1200)).min(1).max(6),
  theme: z.enum(QUEST_THEMES),
  /** Score bonus for reaching it. */
  bonus: z.number().int().min(-5000).max(10000).default(0),
});
export type EndingDef = z.output<typeof EndingSchema>;

export const AdventureSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  title: Text(60),
  tagline: Text(120),
  description: Text(600),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Rough play length shown in the pack picker, e.g. "45–75 min". */
  length: Text(24),
  startNode: IdSchema,
  /** Where the party goes when every hero is KO'd (must be an ending node). */
  defeatNode: IdSchema,
  chapters: z.array(z.strictObject({ number: z.number().int().min(1).max(12), title: Text(60) })).min(1).max(12),
  archetypes: z.array(ArchetypeSchema).min(1).max(6).default([...QUEST_ARCHETYPE_IDS]),
  /** Stats the pack's checks use (validated to be a subset of the engine stats). */
  stats: z.array(StatSchema).min(1).max(6).default([...QUEST_STATS]),
  kits: z.partialRecord(ArchetypeSchema, z.array(z.strictObject({ item: IdSchema, qty: z.number().int().min(1).max(9).default(1) })).max(4)).default({}),
  startCredits: z.number().int().min(0).max(999).default(0),
  /** In-game clock at the start ("HH:MM", 24h) and minutes per decision. */
  clockStart: z.string().regex(/^\d{2}:\d{2}$/).default('18:47'),
  minutesPerTurn: z.number().int().min(0).max(120).default(7),
  items: z.record(IdSchema, ItemSchema),
  statuses: z.record(IdSchema, StatusSchema),
  endings: z.record(IdSchema, EndingSchema),
  nodes: z.array(NodeSchema).min(2).max(400),
});
export type AdventureInput = z.input<typeof AdventureSchema>;
export type AdventureData = z.output<typeof AdventureSchema>;

/** A loaded, validated adventure with a node index. */
export interface Adventure extends AdventureData {
  nodeMap: ReadonlyMap<string, AdventureNode>;
  chapterTitle(chapter: number): string;
}

export type { QuestArchetypeId, QuestCheckTag, QuestStat };
