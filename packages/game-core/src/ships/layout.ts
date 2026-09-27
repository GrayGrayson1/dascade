/**
 * DAS Ships — fleet layout rules: geometry, validation and random deployment.
 * Pure and deterministic (random deployment takes an injected Rng).
 */
import { shuffleInPlace, type Rng } from '@dascade/shared';
import {
  SHIPS_FLEETS,
  VESSELS,
  coordLabel,
  type ShipsDir,
  type ShipsPlacement,
  type ShipsSettings,
  type VesselId,
} from '@dascade/shared/games/ships';

export interface ShipsRules {
  size: number;
  /** Exact fleet composition (each class once). */
  fleet: readonly VesselId[];
  /** Vessels may not touch each other, not even diagonally. */
  apart: boolean;
}

export function rulesFromSettings(settings: Pick<ShipsSettings, 'gridSize' | 'fleet' | 'spacing'>): ShipsRules {
  return { size: settings.gridSize, fleet: SHIPS_FLEETS[settings.fleet].vessels, apart: settings.spacing === 'apart' };
}

export function vesselLength(id: VesselId): number {
  return VESSELS[id].length;
}

/** The squares a placement covers, bow first. */
export function placementCells(p: Pick<ShipsPlacement, 'id' | 'x' | 'y' | 'dir'>): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const len = vesselLength(p.id);
  for (let i = 0; i < len; i++) out.push(p.dir === 'h' ? { x: p.x + i, y: p.y } : { x: p.x, y: p.y + i });
  return out;
}

export function inBounds(x: number, y: number, size: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size;
}

export function placementInBounds(p: ShipsPlacement, size: number): boolean {
  return placementCells(p).every((c) => inBounds(c.x, c.y, size));
}

export type LayoutErrorCode = 'unknown_vessel' | 'duplicate_vessel' | 'out_of_bounds' | 'overlap' | 'touching' | 'incomplete';

export interface LayoutError {
  code: LayoutErrorCode;
  message: string;
  vessel?: VesselId;
}

/**
 * Validate a layout against the rules. With `complete`, every vessel of the fleet must be placed
 * exactly once; otherwise a subset (a deployment draft) is accepted.
 */
export function validateLayout(vessels: readonly ShipsPlacement[], rules: ShipsRules, opts: { complete: boolean }): LayoutError | null {
  const allowed = new Set<VesselId>(rules.fleet);
  const seen = new Set<VesselId>();
  // owner[index] = vessel id occupying that square.
  const owner = new Map<number, VesselId>();
  for (const p of vessels) {
    if (!allowed.has(p.id))
      return { code: 'unknown_vessel', vessel: p.id, message: `${VESSELS[p.id]?.name ?? 'That vessel'} is not part of this fleet.` };
    if (seen.has(p.id)) return { code: 'duplicate_vessel', vessel: p.id, message: `${VESSELS[p.id].name} is placed twice.` };
    seen.add(p.id);
    if (p.dir !== 'h' && p.dir !== 'v') return { code: 'out_of_bounds', vessel: p.id, message: 'Unknown heading.' };
    if (!placementInBounds(p, rules.size)) {
      return { code: 'out_of_bounds', vessel: p.id, message: `${VESSELS[p.id].name} runs off the grid at ${coordLabel(p.x, p.y)}.` };
    }
    for (const c of placementCells(p)) {
      const idx = c.y * rules.size + c.x;
      const other = owner.get(idx);
      if (other) {
        return {
          code: 'overlap',
          vessel: p.id,
          message: `${VESSELS[p.id].name} overlaps ${VESSELS[other].name} at ${coordLabel(c.x, c.y)}.`,
        };
      }
      owner.set(idx, p.id);
    }
  }
  if (rules.apart) {
    for (const [idx, id] of owner) {
      const x = idx % rules.size;
      const y = Math.floor(idx / rules.size);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny, rules.size)) continue;
          const other = owner.get(ny * rules.size + nx);
          if (other && other !== id) {
            return {
              code: 'touching',
              vessel: id,
              message: `${VESSELS[id].name} touches ${VESSELS[other].name} — vessels must keep a square apart.`,
            };
          }
        }
      }
    }
  }
  if (opts.complete) {
    const missing = rules.fleet.filter((id) => !seen.has(id));
    if (missing.length) {
      return {
        code: 'incomplete',
        vessel: missing[0],
        message: `Deploy every vessel first (${missing.map((id) => VESSELS[id].name).join(', ')} still docked).`,
      };
    }
  }
  return null;
}

/** Whether `p` can join the already-valid `layout` (replacing any placement of the same vessel). */
export function canPlace(layout: readonly ShipsPlacement[], p: ShipsPlacement, rules: ShipsRules): boolean {
  const others = layout.filter((q) => q.id !== p.id);
  return validateLayout([...others, p], rules, { complete: false }) === null;
}

/** Occupancy grid (vessel id or null per square) for a layout that is assumed valid. */
export function occupancy(layout: readonly ShipsPlacement[], size: number): Array<VesselId | null> {
  const grid: Array<VesselId | null> = new Array<VesselId | null>(size * size).fill(null);
  for (const p of layout) for (const c of placementCells(p)) if (inBounds(c.x, c.y, size)) grid[c.y * size + c.x] = p.id;
  return grid;
}

/** Every in-bounds placement of one vessel (both headings). */
export function allPlacements(id: VesselId, size: number): ShipsPlacement[] {
  const len = vesselLength(id);
  const out: ShipsPlacement[] = [];
  for (const dir of ['h', 'v'] as const satisfies readonly ShipsDir[]) {
    const maxX = dir === 'h' ? size - len : size - 1;
    const maxY = dir === 'v' ? size - len : size - 1;
    for (let y = 0; y <= maxY; y++) for (let x = 0; x <= maxX; x++) out.push({ id, x, y, dir });
  }
  return out;
}

/** Blocked squares (occupied, plus their neighbours when vessels must stay apart). */
function blockedMask(layout: readonly ShipsPlacement[], rules: ShipsRules): Uint8Array {
  const mask = new Uint8Array(rules.size * rules.size);
  for (const p of layout) {
    for (const c of placementCells(p)) {
      const r = rules.apart ? 1 : 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = c.x + dx;
          const ny = c.y + dy;
          if (inBounds(nx, ny, rules.size)) mask[ny * rules.size + nx] = 1;
        }
      }
    }
  }
  return mask;
}

function fits(p: ShipsPlacement, mask: Uint8Array, size: number): boolean {
  for (const c of placementCells(p)) if (mask[c.y * size + c.x]) return false;
  return true;
}

/** Search budget per attempt (nodes) before reshuffling; generous for every preset. */
const NODE_BUDGET = 25_000;
const MAX_ATTEMPTS = 40;

/**
 * Deploy the rest of the fleet at random around `keep` (a valid partial layout the player chose),
 * returning a complete valid layout. Randomised backtracking: always finds a layout when one exists
 * within the budget. If `keep` is invalid or can't be completed, the whole fleet is re-deployed.
 */
export function randomLayout(rng: Rng, rules: ShipsRules, keep: readonly ShipsPlacement[] = []): ShipsPlacement[] {
  const base = validateLayout(keep, rules, { complete: false }) === null ? [...keep] : [];
  const attempt = (fixed: ShipsPlacement[]): ShipsPlacement[] | null => {
    const todo = rules.fleet.filter((id) => !fixed.some((p) => p.id === id));
    // Longest first: the hardest vessels to fit get the most freedom.
    todo.sort((a, b) => vesselLength(b) - vesselLength(a));
    for (let tries = 0; tries < MAX_ATTEMPTS; tries++) {
      let nodes = 0;
      const placed: ShipsPlacement[] = [...fixed];
      const search = (i: number): boolean => {
        if (i >= todo.length) return true;
        const mask = blockedMask(placed, rules);
        const options = shuffleInPlace(allPlacements(todo[i]!, rules.size), rng);
        for (const p of options) {
          if (++nodes > NODE_BUDGET) return false;
          if (!fits(p, mask, rules.size)) continue;
          placed.push(p);
          if (search(i + 1)) return true;
          placed.pop();
        }
        return false;
      };
      if (search(0)) return placed;
    }
    return null;
  };
  const result = attempt(base) ?? (base.length ? attempt([]) : null);
  if (!result) throw new Error('No valid fleet layout exists for these rules');
  return orderByFleet(result, rules);
}

/** Layout sorted into fleet (dock) order — stable output for clients and tests. */
export function orderByFleet(layout: readonly ShipsPlacement[], rules: ShipsRules): ShipsPlacement[] {
  const rank = new Map(rules.fleet.map((id, i) => [id, i]));
  return [...layout].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)).map((p) => ({ id: p.id, x: p.x, y: p.y, dir: p.dir }));
}

/**
 * Try to rotate a placed vessel in place (about its bow); if that doesn't fit, slide it along the new
 * heading so it stays on the grid and clear of others. Returns null when no rotation fits nearby.
 */
export function rotatePlacement(layout: readonly ShipsPlacement[], id: VesselId, rules: ShipsRules): ShipsPlacement | null {
  const cur = layout.find((p) => p.id === id);
  if (!cur) return null;
  const dir: ShipsDir = cur.dir === 'h' ? 'v' : 'h';
  const len = vesselLength(id);
  const candidates: ShipsPlacement[] = [];
  for (let shift = 0; shift < len; shift++) {
    candidates.push(dir === 'v' ? { id, x: cur.x, y: cur.y - shift, dir } : { id, x: cur.x - shift, y: cur.y, dir });
  }
  for (const p of candidates) {
    if (p.x < 0 || p.y < 0) continue;
    if (canPlace(layout, p, rules)) return p;
  }
  return null;
}
