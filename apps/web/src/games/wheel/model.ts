/**
 * Client-side helpers for Wheel of DAStiny: typed room access, snapshot parsing
 * and segment factories. No rendering here.
 */
import { createCryptoRng, randomId, type Rng } from '@dascade/shared';
import {
  HEX_COLOR_RE,
  WHEEL_LIMITS,
  type WheelSegment,
  type WheelSettings,
  type WheelSliceMode,
  type WheelSnapshotSegment,
  type WheelSpinSnapshot,
} from '@dascade/shared/games/wheel';
import { colorBetween } from '@dascade/game-core/wheel';

export type { WheelSegment, WheelSettings };

/** Cosmetic randomness (colors, shuffles). Outcomes are never decided on the client. */
export const uiRng: Rng = createCryptoRng();

export interface WheelLayout {
  segments: WheelSnapshotSegment[];
  sliceMode: WheelSliceMode;
}

/** Defensive parse of a server-published spin snapshot. */
export function parseSnapshot(json: string | undefined | null): WheelSpinSnapshot | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<WheelSpinSnapshot>;
    if (!raw || !Array.isArray(raw.segments)) return null;
    const segments = raw.segments
      .filter((s): s is WheelSnapshotSegment => !!s && typeof s === 'object' && typeof s.id === 'string')
      .map((s) => ({
        id: s.id,
        label: typeof s.label === 'string' ? s.label : '',
        emoji: typeof s.emoji === 'string' ? s.emoji : '',
        color: typeof s.color === 'string' && HEX_COLOR_RE.test(s.color) ? s.color : '#ffb020',
        weight: typeof s.weight === 'number' && Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 1,
      }));
    return { sliceMode: raw.sliceMode === 'weighted' ? 'weighted' : 'equal', segments };
  } catch {
    return null;
  }
}

export function newSegmentId(): string {
  return randomId(10);
}

/** A fresh enabled segment whose color differs from its would-be neighbours. */
export function makeSegment(input: { label: string; emoji?: string; weight?: number; color?: string }, prev?: WheelSegment, next?: WheelSegment): WheelSegment {
  return {
    id: newSegmentId(),
    label: input.label.slice(0, WHEEL_LIMITS.labelRaw),
    emoji: input.emoji ?? '',
    weight: input.weight ?? 1,
    color: input.color && HEX_COLOR_RE.test(input.color) ? input.color.toLowerCase() : colorBetween(prev?.color, next?.color, uiRng),
    enabled: true,
  };
}

/** Deep-ish clone of segments with brand-new ids (presets, duplicates). */
export function withFreshIds(segments: readonly WheelSegment[]): WheelSegment[] {
  const used = new Set<string>();
  return segments.map((s) => {
    let id = newSegmentId();
    while (used.has(id)) id = newSegmentId();
    used.add(id);
    return { ...s, id };
  });
}

/**
 * Rebases a waiting local segment list onto on/off switches the SERVER made since the
 * batch started (base → server), e.g. "remove winner" switching the winner off at a
 * landing while the host's debounced edit was held back by the in-flight lock. Without
 * this the deferred flush would silently switch the winner back on. Toggles the host
 * made locally (local ≠ base) always win. Returns `local` itself when nothing changes.
 */
export function rebaseServerToggles(local: readonly WheelSegment[], base: readonly WheelSegment[], server: readonly WheelSegment[]): WheelSegment[] {
  const baseById = new Map(base.map((s) => [s.id, s]));
  const serverById = new Map(server.map((s) => [s.id, s]));
  let changed = false;
  const out = local.map((s) => {
    const b = baseById.get(s.id);
    const c = serverById.get(s.id);
    if (!b || !c || b.enabled === c.enabled || s.enabled !== b.enabled) return s;
    changed = true;
    return { ...s, enabled: c.enabled };
  });
  return changed ? out : (local as WheelSegment[]);
}

export function formatWeight(weight: number): string {
  if (!Number.isFinite(weight)) return '0';
  return String(Number(weight.toFixed(2)));
}

export function formatPercent(p: number): string {
  if (!(p > 0)) return '0%';
  if (p >= 0.995) return '100%';
  if (p < 0.001) return '<0.1%';
  const pct = p * 100;
  return `${Math.abs(pct - Math.round(pct)) < 0.05 ? Math.round(pct) : pct.toFixed(1)}%`;
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

export function relativeTime(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
