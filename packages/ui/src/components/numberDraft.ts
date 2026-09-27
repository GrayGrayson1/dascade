/**
 * Pure helpers behind <NumberInput>'s draft: what the typed text commits to. Kept DOM-free so the
 * rules are unit-tested (numberDraft.test.ts).
 */

export function clampNumber(n: number, min?: number, max?: number): number {
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
}

/**
 * The value a typed draft commits to (clamped into [min, max]), or null when the text isn't a
 * number (blank, "-", "1e") — the field then reverts to its current value instead of guessing.
 */
export function resolveNumberDraft(text: string, min?: number, max?: number): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? clampNumber(n, min, max) : null;
}
