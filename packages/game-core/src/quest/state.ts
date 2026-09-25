/**
 * Runtime state of one DASQuest run. Plain JSON (no classes) so it can be cloned,
 * snapshotted into signed saves and validated back with RunStateSchema.
 */
import { z } from 'zod';
import { QUEST_ARCHETYPE_IDS, QUEST_STATS, type QuestArchetypeId } from '@dascade/shared/games/quest';

export interface HeroStats {
  rolls: number;
  successes: number;
  failures: number;
  crits: number;
  fumbles: number;
  damageTaken: number;
  damagePrevented: number;
  healing: number;
  itemsUsed: number;
  votes: number;
  majorityVotes: number;
  rollSum: number;
}

export interface RunStatus {
  id: string;
  /** Scenes left (0 = until removed). */
  turns: number;
}

export interface RunHero {
  /** Stable party slot (0-based, join order at start). */
  slot: number;
  /** Controlling player ('' while unassigned, e.g. inside a save). */
  playerId: string;
  name: string;
  color: string;
  archetype: QuestArchetypeId;
  hp: number;
  maxHp: number;
  ko: boolean;
  statuses: RunStatus[];
  stats: HeroStats;
}

export interface TimelineRecord {
  turn: number;
  chapter: number;
  nodeId: string;
  nodeTitle: string;
  choiceId: string;
  choiceLabel: string;
  votes: number;
  voters: number;
  tieRule?: string;
  stat?: string;
  success?: boolean;
  crit?: 'success' | 'failure' | null;
}

export interface RunState {
  v: 1;
  runId: string;
  packId: string;
  packVersion: string;
  nodeId: string;
  chapter: number;
  turn: number;
  heroes: RunHero[];
  inventory: Record<string, number>;
  credits: number;
  score: number;
  flags: Record<string, boolean | number>;
  visited: string[];
  /** "nodeId/choiceId" keys of `once` choices already taken. */
  taken: string[];
  /** Guardian slots that used Shield Wall in the current scene. */
  shieldUsed: number[];
  /** Trickster slots that used Silver Tongue in the current chapter. */
  rerollUsed: number[];
  /** DC shift from settings (story −2 … hard +2). */
  dcShift: number;
  timeline: TimelineRecord[];
  endingId: string | null;
}

export const TIMELINE_LIMIT = 150;

export function emptyStats(): HeroStats {
  return {
    rolls: 0,
    successes: 0,
    failures: 0,
    crits: 0,
    fumbles: 0,
    damageTaken: 0,
    damagePrevented: 0,
    healing: 0,
    itemsUsed: 0,
    votes: 0,
    majorityVotes: 0,
    rollSum: 0,
  };
}

// ---------------------------------------------------------------------------
// Validation schema for restoring snapshots (saves come from clients, so they are
// verified by signature on the server AND re-validated structurally here).
// ---------------------------------------------------------------------------

const Id = z.string().min(1).max(64);
const Int = z.number().int();

const HeroStatsSchema = z.strictObject({
  rolls: Int.min(0),
  successes: Int.min(0),
  failures: Int.min(0),
  crits: Int.min(0),
  fumbles: Int.min(0),
  damageTaken: Int.min(0),
  damagePrevented: Int.min(0),
  healing: Int.min(0),
  itemsUsed: Int.min(0),
  votes: Int.min(0),
  majorityVotes: Int.min(0),
  rollSum: Int.min(0),
});

export const RunHeroSchema = z.strictObject({
  slot: Int.min(0).max(15),
  playerId: z.string().max(64),
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  archetype: z.enum(QUEST_ARCHETYPE_IDS),
  hp: Int.min(0).max(99),
  maxHp: Int.min(1).max(99),
  ko: z.boolean(),
  statuses: z.array(z.strictObject({ id: Id, turns: Int.min(0).max(99) })).max(16),
  stats: HeroStatsSchema,
});

export const RunStateSchema = z.strictObject({
  v: z.literal(1),
  runId: z.string().min(4).max(64),
  packId: z.string().min(1).max(40),
  packVersion: z.string().max(20),
  nodeId: Id,
  chapter: Int.min(1).max(12),
  turn: Int.min(0).max(100_000),
  heroes: z.array(RunHeroSchema).min(1).max(16),
  inventory: z.record(Id, Int.min(0).max(999)),
  credits: Int.min(-9999).max(99_999),
  score: Int.min(-1_000_000).max(10_000_000),
  flags: z.record(Id, z.union([z.boolean(), z.number()])),
  visited: z.array(Id).max(1000),
  taken: z.array(z.string().max(130)).max(1000),
  shieldUsed: z.array(Int.min(0).max(15)).max(16),
  rerollUsed: z.array(Int.min(0).max(15)).max(16),
  dcShift: Int.min(-10).max(10),
  timeline: z
    .array(
      z.strictObject({
        turn: Int.min(0),
        chapter: Int.min(1).max(12),
        nodeId: Id,
        nodeTitle: z.string().max(80),
        choiceId: Id,
        choiceLabel: z.string().max(120),
        votes: Int.min(0),
        voters: Int.min(0),
        tieRule: z.string().max(120).optional(),
        stat: z.enum(QUEST_STATS).optional(),
        success: z.boolean().optional(),
        crit: z.enum(['success', 'failure']).nullable().optional(),
      }),
    )
    .max(TIMELINE_LIMIT),
  endingId: z.string().max(64).nullable(),
});
