/**
 * Unread lobby chat, for the phone lobby's Chat tab badge. Phones (≤ 760 px) show one lobby
 * section at a time, so a message can land while you're on Players or Settings and you'd never see
 * it. Pure, so it's unit-tested directly.
 */
import type { ChatMessage } from '@dascade/shared';

/** Phones show one lobby section at a time below this width (app.css). */
export const ONE_SECTION_QUERY = '(max-width: 760px)';

/** Messages that earn a badge: what other players said (not your own, not join/leave notes). */
export function countsAsUnread(m: Pick<ChatMessage, 'kind' | 'playerId'>, meId: string | null): boolean {
  return m.kind !== 'system' && m.playerId !== null && m.playerId !== meId;
}

/**
 * How many messages arrived after `lastSeenId` that count as unread. The room keeps the last 120
 * messages, so when the last one you saw has scrolled out, everything kept is new to you.
 */
export function countUnread(
  chat: ReadonlyArray<Pick<ChatMessage, 'id' | 'kind' | 'playerId'>>,
  lastSeenId: string | null,
  meId: string | null,
): number {
  const start = lastSeenId === null ? 0 : chat.findIndex((m) => m.id === lastSeenId) + 1;
  let n = 0;
  for (let i = start; i < chat.length; i++) if (countsAsUnread(chat[i]!, meId)) n++;
  return n;
}

/** The badge text: the count, capped at "9+" so the tab stays narrow. */
export function unreadLabel(n: number): string {
  return n > 9 ? '9+' : String(n);
}
