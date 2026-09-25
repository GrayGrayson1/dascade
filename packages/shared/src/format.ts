/** Formats a virtual chip amount: 1234 → "1,234". */
export function formatChips(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

/** Compact chip format: 1_250_000 → "1.25M". */
export function formatChipsCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${+(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${+(amount / 1_000).toFixed(1)}K`;
  return formatChips(amount);
}

/** mm:ss from milliseconds (clamped at 0). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Race time: m:ss.mmm */
export function formatRaceTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${milli.toString().padStart(3, '0')}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? 'th');
}
