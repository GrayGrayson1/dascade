import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  DEFAULT_SHIPS_SETTINGS,
  SHIPS_FLEETS,
  SHIPS_FLEET_IDS,
  SHIPS_GRID_SIZES,
  ShipsSettingsSchema,
  VESSELS,
  fleetCells,
  type ShipsPlacement,
} from '@dascade/shared/games/ships';
import {
  allPlacements,
  canPlace,
  occupancy,
  orderByFleet,
  placementCells,
  randomLayout,
  rotatePlacement,
  rulesFromSettings,
  validateLayout,
  type ShipsRules,
} from './index.ts';

const STANDARD: ShipsRules = rulesFromSettings(DEFAULT_SHIPS_SETTINGS);
const APART: ShipsRules = { ...STANDARD, apart: true };

/** A hand-made valid standard layout (rows 0, 2, 4, 6, 8 — never touching). */
const LAYOUT: ShipsPlacement[] = [
  { id: 'arcology', x: 0, y: 0, dir: 'h' },
  { id: 'tidebreaker', x: 0, y: 2, dir: 'h' },
  { id: 'lanternfish', x: 0, y: 4, dir: 'h' },
  { id: 'riptide', x: 0, y: 6, dir: 'h' },
  { id: 'glowdart', x: 0, y: 8, dir: 'h' },
];

describe('ships settings contract', () => {
  it('accepts the defaults and every grid/fleet preset combination that fits', () => {
    expect(ShipsSettingsSchema.safeParse(DEFAULT_SHIPS_SETTINGS).success).toBe(true);
    for (const gridSize of SHIPS_GRID_SIZES) {
      for (const fleet of SHIPS_FLEET_IDS) {
        const ok = ShipsSettingsSchema.safeParse({ ...DEFAULT_SHIPS_SETTINGS, gridSize, fleet }).success;
        expect(ok).toBe(gridSize >= SHIPS_FLEETS[fleet].minGrid);
      }
    }
  });

  it('rejects out-of-range values', () => {
    const bad = [
      { gridSize: 9 },
      { gridSize: 14 },
      { fleet: 'navy' },
      { firing: 'nuke' },
      { turnSeconds: 5 },
      { turnSeconds: 121 },
      { turnSeconds: 12.5 },
      { placementSeconds: 10 },
      { placementSeconds: 301 },
      { spacing: 'stacked' },
      { onTimeout: 'explode' },
    ];
    for (const patch of bad)
      expect(ShipsSettingsSchema.safeParse({ ...DEFAULT_SHIPS_SETTINGS, ...patch }).success, JSON.stringify(patch)).toBe(false);
    expect(ShipsSettingsSchema.safeParse({ ...DEFAULT_SHIPS_SETTINGS, turnSeconds: 0 }).success).toBe(true);
  });

  it('fleet presets are made of distinct original vessel classes', () => {
    for (const id of SHIPS_FLEET_IDS) {
      const vessels = SHIPS_FLEETS[id].vessels;
      expect(new Set(vessels).size).toBe(vessels.length);
      for (const v of vessels) expect(VESSELS[v].length).toBeGreaterThanOrEqual(2);
    }
    expect(fleetCells('standard')).toBe(17);
    expect(fleetCells('skirmish')).toBe(12);
    expect(fleetCells('armada')).toBe(23);
  });
});

describe('placement geometry', () => {
  it('covers the right squares for both headings', () => {
    expect(placementCells({ id: 'riptide', x: 2, y: 3, dir: 'h' })).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(placementCells({ id: 'glowdart', x: 9, y: 8, dir: 'v' })).toEqual([
      { x: 9, y: 8 },
      { x: 9, y: 9 },
    ]);
  });

  it('enumerates every in-bounds placement', () => {
    for (const size of [8, 10, 12]) {
      for (const id of ['arcology', 'glowdart'] as const) {
        const len = VESSELS[id].length;
        const all = allPlacements(id, size);
        expect(all).toHaveLength(2 * size * (size - len + 1));
        for (const p of all) for (const c of placementCells(p)) expect(c.x < size && c.y < size && c.x >= 0 && c.y >= 0).toBe(true);
      }
    }
  });

  it('builds an occupancy grid', () => {
    const grid = occupancy(LAYOUT, 10);
    expect(grid.filter(Boolean)).toHaveLength(17);
    expect(grid[0]).toBe('arcology');
    expect(grid[4]).toBe('arcology');
    expect(grid[5]).toBeNull();
    expect(grid[2 * 10 + 3]).toBe('tidebreaker');
  });
});

describe('layout validation', () => {
  it('accepts a valid complete layout', () => {
    expect(validateLayout(LAYOUT, STANDARD, { complete: true })).toBeNull();
    expect(validateLayout(LAYOUT, APART, { complete: true })).toBeNull();
  });

  it('accepts partial drafts only when completeness is not required', () => {
    const draft = LAYOUT.slice(0, 2);
    expect(validateLayout(draft, STANDARD, { complete: false })).toBeNull();
    expect(validateLayout(draft, STANDARD, { complete: true })?.code).toBe('incomplete');
    expect(validateLayout([], STANDARD, { complete: true })?.code).toBe('incomplete');
  });

  it('rejects overlapping vessels', () => {
    const overlapping = [...LAYOUT.slice(0, 4), { id: 'glowdart', x: 2, y: 0, dir: 'v' } as ShipsPlacement];
    const err = validateLayout(overlapping, STANDARD, { complete: true });
    expect(err?.code).toBe('overlap');
    expect(err?.message).toMatch(/overlaps Arcology at C1/);
  });

  it('rejects vessels running off the grid (right edge, bottom edge, 8×8 bounds)', () => {
    expect(validateLayout([{ id: 'arcology', x: 6, y: 0, dir: 'h' }], STANDARD, { complete: false })?.code).toBe('out_of_bounds');
    expect(validateLayout([{ id: 'arcology', x: 0, y: 6, dir: 'v' }], STANDARD, { complete: false })?.code).toBe('out_of_bounds');
    expect(validateLayout([{ id: 'arcology', x: 5, y: 0, dir: 'h' }], STANDARD, { complete: false })).toBeNull();
    const small = { ...STANDARD, size: 8 };
    expect(validateLayout([{ id: 'glowdart', x: 8, y: 0, dir: 'h' }], small, { complete: false })?.code).toBe('out_of_bounds');
    expect(validateLayout([{ id: 'glowdart', x: 7, y: 0, dir: 'h' }], small, { complete: false })?.code).toBe('out_of_bounds');
    expect(validateLayout([{ id: 'glowdart', x: 6, y: 7, dir: 'h' }], small, { complete: false })).toBeNull();
  });

  it('rejects the wrong fleet: foreign classes, duplicates and missing vessels', () => {
    const foreign = [...LAYOUT.slice(0, 4), { id: 'wisp', x: 0, y: 8, dir: 'h' } as ShipsPlacement];
    expect(validateLayout(foreign, STANDARD, { complete: true })?.code).toBe('unknown_vessel');
    const dupe = [...LAYOUT, { id: 'glowdart', x: 5, y: 8, dir: 'h' } as ShipsPlacement];
    expect(validateLayout(dupe, STANDARD, { complete: true })?.code).toBe('duplicate_vessel');
    expect(validateLayout(LAYOUT.slice(1), STANDARD, { complete: true })?.code).toBe('incomplete');
    const skirmish = rulesFromSettings({ gridSize: 10, fleet: 'skirmish', spacing: 'touching' });
    expect(validateLayout(LAYOUT, skirmish, { complete: true })?.code).toBe('unknown_vessel'); // no Arcology in a skirmish
  });

  it('enforces the keep-apart rule (sides and diagonals) only when enabled', () => {
    const side: ShipsPlacement[] = [
      { id: 'riptide', x: 0, y: 0, dir: 'h' },
      { id: 'glowdart', x: 0, y: 1, dir: 'h' },
    ];
    const diagonal: ShipsPlacement[] = [
      { id: 'riptide', x: 0, y: 0, dir: 'h' },
      { id: 'glowdart', x: 3, y: 1, dir: 'h' },
    ];
    const clear: ShipsPlacement[] = [
      { id: 'riptide', x: 0, y: 0, dir: 'h' },
      { id: 'glowdart', x: 4, y: 0, dir: 'h' },
    ];
    expect(validateLayout(side, APART, { complete: false })?.code).toBe('touching');
    expect(validateLayout(diagonal, APART, { complete: false })?.code).toBe('touching');
    expect(validateLayout(clear, APART, { complete: false })).toBeNull();
    expect(validateLayout(side, STANDARD, { complete: false })).toBeNull();
    expect(validateLayout(diagonal, STANDARD, { complete: false })).toBeNull();
  });

  it('canPlace checks a move against the rest of the layout (ignoring the vessel itself)', () => {
    expect(canPlace(LAYOUT, { id: 'glowdart', x: 8, y: 8, dir: 'h' }, STANDARD)).toBe(true);
    expect(canPlace(LAYOUT, { id: 'glowdart', x: 0, y: 0, dir: 'h' }, STANDARD)).toBe(false);
    expect(canPlace(LAYOUT, { id: 'glowdart', x: 1, y: 8, dir: 'h' }, STANDARD)).toBe(true); // overlapping its own old spot is fine
    // Row 7 is open water, but it sits right against the Riptide (row 6): fine unless vessels must stay apart.
    expect(canPlace(LAYOUT, { id: 'glowdart', x: 0, y: 7, dir: 'h' }, STANDARD)).toBe(true);
    expect(canPlace(LAYOUT, { id: 'glowdart', x: 0, y: 7, dir: 'h' }, APART)).toBe(false);
  });
});

describe('random deployment', () => {
  it('always produces a complete, in-bounds, non-overlapping layout (every preset, both spacing rules)', () => {
    let runs = 0;
    for (const gridSize of SHIPS_GRID_SIZES) {
      for (const fleet of SHIPS_FLEET_IDS) {
        if (gridSize < SHIPS_FLEETS[fleet].minGrid) continue;
        for (const spacing of ['touching', 'apart'] as const) {
          const rules = rulesFromSettings({ gridSize, fleet, spacing });
          for (let seed = 0; seed < 40; seed++) {
            const layout = randomLayout(createSeededRng(`${gridSize}-${fleet}-${spacing}-${seed}`), rules);
            expect(validateLayout(layout, rules, { complete: true })).toBeNull();
            expect(layout.map((p) => p.id)).toEqual([...rules.fleet]);
            const cells = layout.flatMap((p) => placementCells(p).map((c) => c.y * gridSize + c.x));
            expect(new Set(cells).size).toBe(fleetCells(fleet));
            for (const c of cells) expect(c >= 0 && c < gridSize * gridSize).toBe(true);
            runs++;
          }
        }
      }
    }
    expect(runs).toBe(40 * 2 * 8);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const a = randomLayout(createSeededRng('x'), STANDARD);
    const b = randomLayout(createSeededRng('x'), STANDARD);
    const c = randomLayout(createSeededRng('y'), STANDARD);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(c));
  });

  it('completes a partial draft around the vessels the captain already placed', () => {
    const keep = LAYOUT.slice(0, 2);
    for (let seed = 0; seed < 25; seed++) {
      const layout = randomLayout(createSeededRng(seed), APART, keep);
      expect(validateLayout(layout, APART, { complete: true })).toBeNull();
      expect(layout).toEqual(expect.arrayContaining(keep));
    }
  });

  it('ignores an invalid draft and deploys from scratch', () => {
    const invalid: ShipsPlacement[] = [
      { id: 'arcology', x: 0, y: 0, dir: 'h' },
      { id: 'tidebreaker', x: 0, y: 0, dir: 'v' },
    ];
    const layout = randomLayout(createSeededRng(3), STANDARD, invalid);
    expect(validateLayout(layout, STANDARD, { complete: true })).toBeNull();
  });

  it('orders a layout by the fleet dock order', () => {
    expect(orderByFleet([...LAYOUT].reverse(), STANDARD).map((p) => p.id)).toEqual([...STANDARD.fleet]);
  });
});

describe('rotation', () => {
  it('rotates in place about the bow when there is room', () => {
    const layout: ShipsPlacement[] = [{ id: 'riptide', x: 4, y: 4, dir: 'h' }];
    expect(rotatePlacement(layout, 'riptide', STANDARD)).toEqual({ id: 'riptide', x: 4, y: 4, dir: 'v' });
  });

  it('slides the vessel back onto the grid near an edge', () => {
    const layout: ShipsPlacement[] = [{ id: 'arcology', x: 3, y: 8, dir: 'h' }];
    const r = rotatePlacement(layout, 'arcology', STANDARD);
    expect(r?.dir).toBe('v');
    expect(r && validateLayout([r], STANDARD, { complete: false })).toBeNull();
    expect(r?.x).toBe(3);
  });

  it('returns null when no rotation fits', () => {
    const boxed: ShipsPlacement[] = [
      { id: 'glowdart', x: 0, y: 0, dir: 'h' },
      { id: 'riptide', x: 0, y: 1, dir: 'h' },
    ];
    // Rotating the Glowdart at the top-left corner would need (0,1), which the Riptide holds.
    expect(rotatePlacement(boxed, 'glowdart', STANDARD)).toBeNull();
    expect(rotatePlacement(boxed, 'arcology', STANDARD)).toBeNull(); // not placed
  });
});
