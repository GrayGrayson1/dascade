/**
 * Structural size guard for decoded client messages (see BaseGameRoom.handle()).
 *
 * Zod parses every element of an array before it checks `.max()`, and the websocket transport
 * accepts frames of up to `config.maxPayloadBytes`, so a single ~250 KB frame can make a handler
 * walk a quarter of a million elements. `handle()` counts the payload's values with this guard
 * first: iterative (deep nesting is fine), with an early exit, so the cost is O(min(size, limit)).
 */

/**
 * Platform default for `MessageOptions.maxNodes`. The largest legitimate payloads that rely on it:
 * an organizer's `tournament:admin` action (≤ 4,096 values, from its 8 KB byte cap), a 200-question
 * custom trivia pack (3,607) and a custom bingo settings list (1,717); every other handler allows
 * far fewer. `test/payload-limits.test.ts` recomputes these maxima from the schemas of every
 * registered handler and fails if any reaches its limit. At this size Zod's worst case is about a
 * millisecond per message.
 */
export const DEFAULT_MAX_NODES = 10_000;

/**
 * True when `value` holds more than `limit` values: every object, array, primitive (and Map/Set
 * entry) counts one; strings and binary blobs count one whatever their length (their size is bounded
 * by the frame limit and checked in O(1) by the schema). Never reads more than about `limit` values:
 * an array or object whose children cannot fit is refused before it is walked.
 */
export function exceedsNodeLimit(value: unknown, limit: number): boolean {
  const stack: unknown[] = [value];
  let count = 0;
  while (stack.length > 0) {
    const v = stack.pop();
    count++;
    if (count > limit) return true;
    if (typeof v !== 'object' || v === null || ArrayBuffer.isView(v)) continue;
    // Every value still on the stack costs at least one more node.
    if (Array.isArray(v)) {
      const n = v.length;
      if (count + stack.length + n > limit) return true;
      for (let i = 0; i < n; i++) stack.push(v[i]);
    } else if (v instanceof Map) {
      if (count + stack.length + v.size * 2 > limit) return true;
      for (const [k, item] of v) stack.push(k, item);
    } else if (v instanceof Set) {
      if (count + stack.length + v.size > limit) return true;
      for (const item of v) stack.push(item);
    } else {
      for (const key in v) {
        if (!Object.prototype.hasOwnProperty.call(v, key)) continue;
        if (count + stack.length + 1 > limit) return true;
        stack.push((v as Record<string, unknown>)[key]);
      }
    }
  }
  return false;
}
