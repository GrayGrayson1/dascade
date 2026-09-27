/** Item wire codes and small pure item rules shared by the physics, the sim and the predictor. */
import { KART_ITEM_IDS, KART_ITEMS, type KartInput, type KartItemId } from '@dascade/shared/games/kart';

/** Wire code of an item (0 = none). */
export function itemCode(id: KartItemId): number {
  return KART_ITEM_IDS.indexOf(id) + 1;
}

/** Item id for a wire code (null for 0 / out of range). */
export function itemFromCode(code: number): KartItemId | null {
  return code >= 1 && code <= KART_ITEM_IDS.length ? KART_ITEM_IDS[code - 1]! : null;
}

export function itemUses(id: KartItemId): number {
  return KART_ITEMS[id].uses;
}

/** Items that trail behind the kart while the item button is held (fired/dropped on release). */
export const TRAILABLE_ITEMS: ReadonlySet<KartItemId> = new Set<KartItemId>(['puck', 'puck3', 'mine', 'fizz']);

export const CODE_TURBO = itemCode('turbo');
export const CODE_TURBO3 = itemCode('turbo3');
export const CODE_SHIELD = itemCode('shield');
export const CODE_WARP = itemCode('warp');

export function isTrailableCode(code: number): boolean {
  const id = itemFromCode(code);
  return id !== null && TRAILABLE_ITEMS.has(id);
}

/**
 * Item aim is three-way (input bits `back` / `ahead`; `back` wins when both are set):
 *  - projectiles (puck, puck3, seeker) fire forward by default, backward with `back`;
 *  - traps (mine, fizz) drop behind by default and are lobbed ahead only with `ahead`.
 */
export function aimsBack(input: Pick<KartInput, 'back'>): boolean {
  return input.back;
}

/** Traps are lobbed ahead only with the explicit `ahead` aim (never inferred from the throttle). */
export function trapThrowsAhead(input: Pick<KartInput, 'back' | 'ahead'>): boolean {
  return !input.back && input.ahead === true;
}
