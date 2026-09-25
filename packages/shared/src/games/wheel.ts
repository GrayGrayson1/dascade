/**
 * Wheel of DAStiny: shared contract (settings, messages, public state).
 *
 * The server owns every outcome. Clients send a bare `wheel:spin` intent; the
 * server snapshots the active segments, picks the winner with its crypto RNG and
 * publishes a deterministic spin description (start time, duration, start/end
 * rotation, segment snapshot) so every screen animates to the same result.
 */
import { z } from 'zod';
import type { BaseRoomView } from '../protocol.ts';
import { cleanText } from '../text.ts';

export const WHEEL_LIMITS = {
  /** Segments stored in settings (enabled + disabled). */
  segments: 200,
  /** Visible label length (code points) after cleaning. */
  label: 60,
  /** Raw label length accepted before cleaning. */
  labelRaw: 120,
  /** Icon / emoji: at most this many grapheme clusters… */
  emojiGraphemes: 2,
  /** …and this many UTF-16 code units. */
  emoji: 16,
  emojiRaw: 32,
  /** Weights live in [0, weightMax]; 0 = excluded from the wheel. */
  weightMax: 1000,
  durationMinMs: 2_000,
  durationMaxMs: 12_000,
  title: 48,
  titleRaw: 120,
  /** History entries kept in state (oldest are dropped). */
  history: 150,
  /** Bulk paste input bound (characters). */
  bulkChars: 20_000,
  presetName: 40,
} as const;

/** Spins start slightly in the future so every client begins together. */
export const WHEEL_SPIN_LEAD_MS = 350;
/** Pause after a landing before the next spin is accepted (lets the reveal breathe). */
export const WHEEL_SPIN_COOLDOWN_MS = 1_500;

/** Game-show palette (amber + hot pink first). Adjacent picks are kept distinct by the engine. */
export const WHEEL_PALETTE = [
  '#ffb020',
  '#ff4f81',
  '#22d3ee',
  '#a78bfa',
  '#2de38f',
  '#ff8a3d',
  '#60a5fa',
  '#ff5a5f',
  '#ffd23f',
  '#c084fc',
  '#14b8a6',
  '#f472b6',
  '#38bdf8',
  '#a3e635',
  '#fb7185',
  '#818cf8',
] as const;

// ---------------------------------------------------------------------------
// Text sanitation specific to the wheel
// ---------------------------------------------------------------------------

// Control chars, bidi overrides and invisible separators. ZWJ (U+200D) and
// variation selectors are KEPT so multi-codepoint emoji survive.
// eslint-disable-next-line no-control-regex
const EMOJI_STRIP_RE = /[\u{0000}-\u{001F}\u{007F}-\u{009F}\u{200B}\u{200C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}]/gu;
// Stacked combining marks ("zalgo"): keep at most 2 in a row, like cleanText does for labels.
// Real emoji need at most two (keycaps: VS16 + U+20E3), so they survive intact.
const EMOJI_ZALGO_RE = /(\p{M}{2})\p{M}+/gu;

let graphemeSegmenter: Intl.Segmenter | null | undefined;
/** Splits text into user-perceived characters (falls back to code points). */
export function graphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) {
    graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
}

/** Sanitizes the optional icon / emoji field: at most 2 graphemes and 16 UTF-16 units. */
export function cleanWheelEmoji(input: unknown): string {
  if (typeof input !== 'string') return '';
  const text = input.normalize('NFC').replace(EMOJI_STRIP_RE, '').replace(EMOJI_ZALGO_RE, '$1').replace(/\s+/gu, ' ').trim();
  let out = '';
  for (const g of graphemes(text).slice(0, WHEEL_LIMITS.emojiGraphemes)) {
    if (out.length + g.length > WHEEL_LIMITS.emoji) break;
    out += g;
  }
  return out.trim();
}

/** Sanitizes a segment label (single line, control chars stripped, 60 code points). */
export function cleanWheelLabel(input: unknown): string {
  return cleanText(input, WHEEL_LIMITS.label);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const WHEEL_SEGMENT_ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const WheelSegmentSchema = z.object({
  id: z.string().regex(WHEEL_SEGMENT_ID_RE, 'Invalid segment id'),
  label: z.string().max(WHEEL_LIMITS.labelRaw).transform(cleanWheelLabel),
  weight: z.number().min(0, 'Weights cannot be negative').max(WHEEL_LIMITS.weightMax, `Weights go up to ${WHEEL_LIMITS.weightMax}`),
  color: z
    .string()
    .regex(HEX_COLOR_RE, 'Colors must look like #ffb020')
    .transform((c) => c.toLowerCase()),
  emoji: z.string().max(WHEEL_LIMITS.emojiRaw).default('').transform(cleanWheelEmoji),
  enabled: z.boolean(),
});
export type WheelSegment = z.output<typeof WheelSegmentSchema>;

export const WHEEL_SLICE_MODES = ['equal', 'weighted'] as const;
export type WheelSliceMode = (typeof WHEEL_SLICE_MODES)[number];

export const WheelSettingsSchema = z.object({
  /** Optional question / title shown above the wheel. */
  title: z.string().max(WHEEL_LIMITS.titleRaw).transform((t) => cleanText(t, WHEEL_LIMITS.title)),
  segments: z
    .array(WheelSegmentSchema)
    .max(WHEEL_LIMITS.segments, `A wheel holds up to ${WHEEL_LIMITS.segments} options`)
    .refine((segs) => new Set(segs.map((s) => s.id)).size === segs.length, 'Segment ids must be unique'),
  /** 'equal' = every slice the same size; 'weighted' = slice size reflects weight. Probability is always weighted. */
  sliceMode: z.enum(WHEEL_SLICE_MODES),
  /** After a spin lands: keep the winner, or switch it off. */
  afterSpin: z.enum(['keep', 'remove']),
  /** 'prevent' excludes the previous winner from the next draw (when anything else is eligible). */
  repeats: z.enum(['allow', 'prevent']),
  spinDurationMs: z.number().int().min(WHEEL_LIMITS.durationMinMs).max(WHEEL_LIMITS.durationMaxMs),
  /** Who may press SPIN during play. Spectators never can. */
  spinPermission: z.enum(['host', 'anyone']),
});
export type WheelSettings = z.output<typeof WheelSettingsSchema>;
export type WheelSettingsInput = z.input<typeof WheelSettingsSchema>;

/** Starter wheel: a lunch picker that looks good out of the box. */
export const DEFAULT_WHEEL_SEGMENTS: WheelSegment[] = [
  { id: 'lunch-pizza', label: 'Pizza', emoji: '🍕', weight: 1, color: '#ffb020', enabled: true },
  { id: 'lunch-tacos', label: 'Tacos', emoji: '🌮', weight: 1, color: '#ff4f81', enabled: true },
  { id: 'lunch-sushi', label: 'Sushi', emoji: '🍣', weight: 1, color: '#22d3ee', enabled: true },
  { id: 'lunch-burgers', label: 'Burgers', emoji: '🍔', weight: 1, color: '#a78bfa', enabled: true },
  { id: 'lunch-ramen', label: 'Ramen', emoji: '🍜', weight: 1, color: '#2de38f', enabled: true },
  { id: 'lunch-salad', label: 'Salad bar', emoji: '🥗', weight: 1, color: '#ff8a3d', enabled: true },
  { id: 'lunch-deli', label: 'Deli', emoji: '🥪', weight: 1, color: '#60a5fa', enabled: true },
  { id: 'lunch-curry', label: 'Curry', emoji: '🍛', weight: 1, color: '#ff5a5f', enabled: true },
];

export const DEFAULT_WHEEL_SETTINGS: WheelSettings = {
  title: 'Where are we eating?',
  segments: DEFAULT_WHEEL_SEGMENTS,
  sliceMode: 'equal',
  afterSpin: 'keep',
  repeats: 'allow',
  spinDurationMs: 6_000,
  spinPermission: 'host',
};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const WHEEL_MSG = {
  /** client → server: request a spin. The payload carries NO outcome data; extra fields are stripped. */
  spin: 'wheel:spin',
  /** client → server (host): clear the result history. */
  resetHistory: 'wheel:resetHistory',
  /** client → server (host): end the session and show the summary. */
  end: 'wheel:end',
} as const;

/** Spin intent. Zod strips unknown keys, so any "winner"/"index" a client sneaks in is ignored. */
export const WheelSpinSchema = z.object({}).optional();
export const WheelEmptySchema = z.object({}).optional();

// ---------------------------------------------------------------------------
// Public state (what `state.toJSON()` looks like on clients)
// ---------------------------------------------------------------------------

/** A segment as frozen into a spin snapshot (already normalized: enabled, positive weight). */
export interface WheelSnapshotSegment {
  id: string;
  label: string;
  emoji: string;
  color: string;
  weight: number;
}

export interface WheelSpinSnapshot {
  sliceMode: WheelSliceMode;
  segments: WheelSnapshotSegment[];
}

export type WheelSpinStatus = 'idle' | 'spinning' | 'landed';

export interface WheelSpinView {
  /** Increments per spin (0 = never spun). */
  spinId: number;
  status: WheelSpinStatus;
  /** Server epoch ms when the rotation starts. */
  startAt: number;
  durationMs: number;
  /** Degrees, clockwise. The pointer sits at 12 o'clock. */
  fromRotation: number;
  toRotation: number;
  winnerId: string;
  /** Index into the snapshot's segments. */
  winnerIndex: number;
  spunById: string;
  spunByName: string;
  /** JSON of WheelSpinSnapshot. */
  snapshotJson: string;
}

export interface WheelHistoryView {
  spinId: number;
  segmentId: string;
  label: string;
  emoji: string;
  color: string;
  spunById: string;
  spunByName: string;
  /** Server epoch ms of the landing. */
  at: number;
}

export interface WheelPublicState extends BaseRoomView {
  spin: WheelSpinView;
  /** Oldest first. */
  history: WheelHistoryView[];
  /** Resting rotation (degrees, [0, 360)). */
  restRotation: number;
  /** Server epoch ms before which new spins are refused (cooldown after a landing). */
  nextSpinAt: number;
  totalSpins: number;
  /** Segment id of the most recent winner ('' after a history reset). */
  lastWinnerId: string;
}
