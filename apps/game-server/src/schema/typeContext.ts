/**
 * Lean schema TypeContexts for room states.
 *
 * Every joining client receives a reflection of all schema types in its room's TypeContext.
 * @colyseus/schema's TypeContext.discoverTypes() also pulls in every registered SUBCLASS of each
 * ancestor of the root state (so polymorphic fields can decode any subclass). All DASCADE room
 * states extend BaseRoomState (some through a kit base such as PartyRoomState), so without this
 * every room would describe the schemas of every cabinet: ~90 types / ~24 KB per join instead of a
 * handful, plus a "buffer overflow" warning on the server for every room created.
 *
 * A room's root state is always an instance of exactly its own class and no DASCADE field is typed
 * with a room-state class, so those sibling subclasses are never needed: build and cache the root
 * class's context with the root's and its ancestors' subclass lists hidden. Field types (and their
 * own subclasses) are still discovered as usual.
 */
import { Schema, TypeContext } from '@colyseus/schema';

/** Call before assigning `this.state` (Colyseus builds the room's Encoder from the cached context). */
export function primeRoomStateContext(state: Schema): TypeContext {
  const rootClass = state.constructor as typeof Schema;
  const cached = TypeContext.cachedContexts.get(rootClass);
  if (cached) return cached;
  const hidden = new Map<typeof Schema, Set<typeof Schema>>();
  for (let klass: unknown = rootClass; klass && klass !== Schema && klass !== Function.prototype; klass = Object.getPrototypeOf(klass)) {
    const children = TypeContext.inheritedTypes.get(klass as typeof Schema);
    if (!children) continue;
    hidden.set(klass as typeof Schema, children);
    TypeContext.inheritedTypes.delete(klass as typeof Schema);
  }
  try {
    return TypeContext.cache(rootClass);
  } finally {
    for (const [klass, children] of hidden) TypeContext.inheritedTypes.set(klass, children);
  }
}
