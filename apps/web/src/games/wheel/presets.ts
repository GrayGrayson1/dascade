/**
 * Wheel presets: built-in examples plus user presets stored through the
 * persistence adapter (kind 'wheel'). Everything loaded is re-validated with the
 * shared settings schema before it is sent to the server.
 */
import {
  WHEEL_LIMITS,
  WHEEL_PALETTE,
  WheelSettingsSchema,
  type WheelSegment,
  type WheelSettings,
} from '@dascade/shared/games/wheel';
import { persistence, type Preset } from '../../persistence/index.ts';
import { withFreshIds } from './model.ts';

export const PRESET_KIND = 'wheel';

/** What a preset carries: everything except transient ids. */
export type WheelPresetData = Pick<WheelSettings, 'title' | 'segments' | 'sliceMode' | 'afterSpin' | 'repeats' | 'spinDurationMs' | 'spinPermission'>;

export interface BuiltinPreset {
  id: string;
  name: string;
  description: string;
  /** Theme ids under which the editor pre-selects this preset. It is never applied automatically. */
  suggestFor?: readonly string[];
  build: (ctx: { playerNames: string[] }) => Partial<WheelPresetData> & { segments: WheelSegment[] };
}

const seg = (label: string, emoji: string, color: string, weight = 1): WheelSegment => ({ id: 'x', label, emoji, color, weight, enabled: true });
const palette = (i: number) => WHEEL_PALETTE[i % WHEEL_PALETTE.length] as string;

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: 'builtin:lunch',
    name: 'Lunch spot',
    description: 'Eight classic lunch options.',
    build: () => ({
      title: 'Where are we eating?',
      sliceMode: 'equal',
      afterSpin: 'keep',
      repeats: 'prevent',
      segments: [
        seg('Pizza', '🍕', '#ffb020'),
        seg('Tacos', '🌮', '#ff4f81'),
        seg('Sushi', '🍣', '#22d3ee'),
        seg('Burgers', '🍔', '#a78bfa'),
        seg('Ramen', '🍜', '#2de38f'),
        seg('Salad bar', '🥗', '#ff8a3d'),
        seg('Deli', '🥪', '#60a5fa'),
        seg('Curry', '🍛', '#ff5a5f'),
      ],
    }),
  },
  {
    id: 'builtin:presenter',
    name: 'Who presents next',
    description: 'Everyone in the room. Winners drop off.',
    build: ({ playerNames }) => {
      const names = playerNames.length >= 2 ? playerNames : ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley'];
      return {
        title: 'Who presents next?',
        sliceMode: 'equal',
        afterSpin: 'remove',
        repeats: 'prevent',
        segments: names.slice(0, WHEEL_LIMITS.segments).map((n, i) => seg(n, '', palette(i))),
      };
    },
  },
  {
    id: 'builtin:yesno',
    name: 'Yes / No / Maybe',
    description: 'Let the wheel decide.',
    build: () => ({
      title: 'Should we?',
      sliceMode: 'equal',
      afterSpin: 'keep',
      repeats: 'allow',
      segments: [seg('Yes', '✅', '#2de38f'), seg('No', '❌', '#ff5a5f'), seg('Maybe', '🤔', '#ffb020')],
    }),
  },
  {
    id: 'builtin:teams',
    name: 'Team picker',
    description: 'Four teams, spin once per player.',
    build: () => ({
      title: 'Which team are you on?',
      sliceMode: 'equal',
      afterSpin: 'keep',
      repeats: 'allow',
      segments: [
        seg('Team Amber', '🟧', '#ffb020'),
        seg('Team Pink', '🌸', '#ff4f81'),
        seg('Team Cyan', '🟦', '#22d3ee'),
        seg('Team Lime', '🟩', '#a3e635'),
      ],
    }),
  },
  {
    id: 'builtin:prizes',
    name: 'Prize wheel',
    description: 'Weighted slices: rare prizes are small.',
    build: () => ({
      title: 'Spin for a prize!',
      sliceMode: 'weighted',
      afterSpin: 'keep',
      repeats: 'allow',
      segments: [
        seg('Grand prize', '🏆', '#ffd23f', 1),
        seg('Mystery box', '🎁', '#ff4f81', 3),
        seg('Donuts', '🍩', '#ff8a3d', 5),
        seg('Coffee round', '☕', '#a78bfa', 6),
        seg('Spin again', '🔁', '#22d3ee', 4),
        seg('Better luck next time', '😅', '#60a5fa', 8),
      ],
    }),
  },
  {
    id: 'builtin:trick-or-treat',
    name: 'Trick or Treat',
    description: 'Treats, harmless tricks and Halloween creatures. The Pumpkin Jackpot is ultra rare.',
    suggestFor: ['halloween-night'],
    build: () => ({
      title: 'Trick or treat?',
      sliceMode: 'weighted',
      afterSpin: 'keep',
      repeats: 'allow',
      // Weights are relative odds (candy corn 20 … jackpot 1, out of 90). Readable labels on every slice
      // (≥ 4.5:1 with the renderer's text colour), no near-black slices (the slice colour also marks the
      // readout and history), neighbours distinct all the way round. Under Halloween Night each slice's
      // emoji/name also picks its landing show (themes/halloween-night/wheelReactions.ts).
      segments: [
        seg('Candy Corn: grab a treat', '🍬', '#ff8a3d', 20),
        seg("Witch's Brew: cackle!", '🧪', '#7ed957', 15),
        seg('Trick: talk tiny for a round', '🤏', '#ffb020', 6),
        seg('Friendly Ghost: tell a ghost story', '👻', '#f2ecff', 15),
        seg('Trick: BOO someone!', '😱', '#ff6fa8', 8),
        seg('Black Cat: your best meow', '🐈\u200d⬛', '#b07cf0', 10),
        seg('Pumpkin Jackpot', '🎃', '#ffd23f', 1),
        seg('Skeleton Dance: dance break!', '💀', '#2ec4b6', 10),
        seg('Monster Surprise: ROAR!', '🐺', '#7aa2ff', 5),
      ],
    }),
  },
];

/** The built-in preset the editor pre-selects under a theme (Lunch spot unless one suggests itself). */
export function suggestedPresetId(themeId: string): string {
  return (BUILTIN_PRESETS.find((p) => p.suggestFor?.includes(themeId)) ?? BUILTIN_PRESETS[0]!).id;
}

/**
 * Merges preset data over the current settings, assigns fresh ids and validates.
 * Returns null when the data is unusable.
 */
export function applyPreset(current: WheelSettings, data: Partial<WheelPresetData>): WheelSettings | null {
  const segments = Array.isArray(data.segments) ? withFreshIds(data.segments.slice(0, WHEEL_LIMITS.segments)) : current.segments;
  const parsed = WheelSettingsSchema.safeParse({ ...current, ...pickPresetFields(data), segments });
  return parsed.success ? parsed.data : null;
}

function pickPresetFields(data: Partial<WheelPresetData>): Partial<WheelPresetData> {
  const out: Partial<WheelPresetData> = {};
  if (typeof data.title === 'string') out.title = data.title;
  if (data.sliceMode === 'equal' || data.sliceMode === 'weighted') out.sliceMode = data.sliceMode;
  if (data.afterSpin === 'keep' || data.afterSpin === 'remove') out.afterSpin = data.afterSpin;
  if (data.repeats === 'allow' || data.repeats === 'prevent') out.repeats = data.repeats;
  if (typeof data.spinDurationMs === 'number') out.spinDurationMs = data.spinDurationMs;
  if (data.spinPermission === 'host' || data.spinPermission === 'anyone') out.spinPermission = data.spinPermission;
  return out;
}

export function presetFromSettings(settings: WheelSettings): WheelPresetData {
  return {
    title: settings.title,
    segments: settings.segments,
    sliceMode: settings.sliceMode,
    afterSpin: settings.afterSpin,
    repeats: settings.repeats,
    spinDurationMs: settings.spinDurationMs,
    spinPermission: settings.spinPermission,
  };
}

export async function listSavedPresets(): Promise<Array<Preset<Partial<WheelPresetData>>>> {
  try {
    const list = await persistence().listPresets<Partial<WheelPresetData>>(PRESET_KIND);
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveUserPreset(name: string, settings: WheelSettings, id?: string): Promise<Preset<WheelPresetData>> {
  return persistence().savePreset<WheelPresetData>(PRESET_KIND, name.trim().slice(0, WHEEL_LIMITS.presetName) || 'My wheel', presetFromSettings(settings), id);
}

export async function deleteUserPreset(id: string): Promise<void> {
  await persistence().deletePreset(PRESET_KIND, id);
}
