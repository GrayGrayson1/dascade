/** Pure play-order helpers (shuffle without immediate repeats, next/prev in an order). */

/** Fisher–Yates shuffle; `first` (if present in ids) is placed at index 0. */
export function shuffleOrder(ids: readonly string[], random: () => number, first?: string | null): string[] {
  const out = ids.filter((id) => id !== first);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  if (first && ids.includes(first)) out.unshift(first);
  return out;
}

/**
 * A fresh shuffle for the next lap that never starts with `avoid` (the track that just played),
 * so a wrap-around doesn't repeat a song back to back.
 */
export function reshuffleAvoiding(ids: readonly string[], random: () => number, avoid: string | null): string[] {
  const out = shuffleOrder(ids, random);
  if (out.length > 1 && out[0] === avoid) {
    const j = 1 + Math.floor(random() * (out.length - 1));
    out[0] = out[j]!;
    out[j] = avoid;
  }
  return out;
}

/** The id after `current` in `order` (null at the end unless `wrap`). Unknown current → first. */
export function nextInOrder(order: readonly string[], current: string | null, wrap: boolean): string | null {
  if (!order.length) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i < 0) return order[0] ?? null;
  if (i + 1 < order.length) return order[i + 1] ?? null;
  return wrap ? (order[0] ?? null) : null;
}

/** The id before `current` in `order` (wraps to the last). */
export function prevInOrder(order: readonly string[], current: string | null): string | null {
  if (!order.length) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i <= 0) return order[order.length - 1] ?? null;
  return order[i - 1] ?? null;
}

/** Moves an item within a copy of `list` (indices clamped; invalid `from` → unchanged copy). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (!Number.isInteger(from) || from < 0 || from >= out.length || !Number.isFinite(to)) return out;
  const [item] = out.splice(from, 1);
  const dest = Math.max(0, Math.min(out.length, Math.trunc(to)));
  out.splice(dest, 0, item as T);
  return out;
}
