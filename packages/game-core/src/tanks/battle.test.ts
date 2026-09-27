import { describe, expect, it } from 'vitest';
import { createSeededRng, type Rng } from '@dascade/shared';
import { TANKS_WORLD, TANK_GEOM, WEAPON_IDS, type ShotScript } from '@dascade/shared/games/tanks';
import {
  abandon,
  assignTeams,
  checkForfeit,
  createBattle,
  drive,
  endByRounds,
  fire,
  nextTurn,
  nextWind,
  setAim,
  skipTurn,
  spawnXs,
  tankById,
  upcoming,
  type Battle,
  type BattleConfig,
  type BattleEntrant,
} from './battle.ts';
import { createTerrain, restHeight } from './terrain.ts';

const CONFIG: BattleConfig = {
  mode: 'ffa',
  style: 'hills',
  windMax: 10,
  fuelPerTurn: 60,
  armor: 100,
  arsenal: 'standard',
  maxRounds: 15,
  friendlyFire: false,
  theme: 'dusk',
};

const entrants = (n: number, teams = false): BattleEntrant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#ffffff', team: teams ? i % 2 : -1 }));

function battle(n = 3, over: Partial<BattleConfig> = {}, seed: string | number = 'b', teams = false): { b: Battle; rng: Rng } {
  const rng = createSeededRng(seed);
  return { b: createBattle(rng, entrants(n, teams || over.mode === 'teams'), { ...CONFIG, ...over }), rng };
}

/** Flatten the ground and line the tanks up at the given xs (test fixture). */
function flatten(b: Battle, xs: number[], height = 200): void {
  b.terrain = createTerrain(TANKS_WORLD.width, TANKS_WORLD.height, height);
  b.tanks.forEach((t, i) => {
    t.x = xs[i] ?? t.x;
    t.y = restHeight(b.terrain, t.x);
  });
}

function turn(b: Battle, rng: Rng): string {
  const r = nextTurn(b, rng);
  if (r.kind !== 'turn') throw new Error(`expected a turn, got ${r.kind}`);
  return r.activeId;
}

describe('battle setup', () => {
  it('spawns every tank on the ground, spread across the field, left to right', () => {
    for (let seed = 0; seed < 10; seed++) {
      const { b } = battle(8, {}, seed);
      expect(b.tanks).toHaveLength(8);
      const xs = b.tanks.map((t) => t.x);
      expect([...xs].sort((a, c) => a - c)).toEqual(xs);
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(TANK_GEOM.halfWidth * 4);
      for (const t of b.tanks) {
        expect(t.y).toBe(restHeight(b.terrain, t.x));
        expect(t.hp).toBe(100);
        expect(t.alive).toBe(true);
        expect(t.ammo.shell).toBe(-1);
        expect(t.ammo.heavy).toBe(2);
        expect(t.ammo.dirt).toBe(3);
      }
      expect(b.tanks.map((t) => t.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('spawn columns stay inside the world', () => {
    for (let n = 2; n <= 8; n++) {
      const xs = spawnXs(createSeededRng(n), n);
      expect(Math.min(...xs)).toBeGreaterThan(40);
      expect(Math.max(...xs)).toBeLessThan(TANKS_WORLD.width - 40);
    }
  });

  it('puts teams on opposite sides of the field', () => {
    for (let seed = 0; seed < 8; seed++) {
      const { b } = battle(6, { mode: 'teams' }, seed);
      const teams = b.tanks.map((t) => t.team);
      expect(teams.slice(0, 3).every((t) => t === teams[0])).toBe(true);
      expect(teams.slice(3).every((t) => t === teams[3])).toBe(true);
      expect(teams[0]).not.toBe(teams[3]);
    }
  });

  it('honours armor, arsenal and "random" terrain', () => {
    const { b } = battle(2, { armor: 200, arsenal: 'shells', style: 'random' });
    expect(b.tanks[0]!.hp).toBe(200);
    expect(b.tanks[0]!.maxHp).toBe(200);
    expect(b.tanks[0]!.ammo.heavy).toBe(0);
    expect(['hills', 'mesa', 'valley', 'peaks']).toContain(b.style);
  });

  it('a tournament "first" entrant takes the first turn', () => {
    for (let seed = 0; seed < 6; seed++) {
      const rng = createSeededRng(seed);
      const list = entrants(2);
      list[1]!.first = true;
      const b = createBattle(rng, list, CONFIG);
      expect(turn(b, rng)).toBe('p1');
    }
  });
});

describe('team assignment', () => {
  it('keeps picks and balances everyone else', () => {
    const rng = createSeededRng('assign');
    const m = assignTeams(
      [
        { id: 'a', pick: 0 },
        { id: 'b', pick: 0 },
        { id: 'c', pick: -1 },
        { id: 'd', pick: -1 },
        { id: 'e', pick: -1 },
        { id: 'f', pick: 1 },
      ],
      rng,
    );
    expect(m.get('a')).toBe(0);
    expect(m.get('b')).toBe(0);
    expect(m.get('f')).toBe(1);
    const sizes = [0, 1].map((t) => [...m.values()].filter((v) => v === t).length);
    expect(sizes).toEqual([3, 3]);
  });

  it('leaves lopsided explicit picks alone', () => {
    const m = assignTeams(
      [
        { id: 'a', pick: 1 },
        { id: 'b', pick: 1 },
      ],
      createSeededRng(1),
    );
    expect([...m.values()]).toEqual([1, 1]);
  });
});

describe('turn order', () => {
  it('free-for-all cycles through every tank once per round', () => {
    const { b, rng } = battle(4);
    const first = [turn(b, rng), turn(b, rng), turn(b, rng), turn(b, rng)];
    expect(new Set(first).size).toBe(4);
    expect(b.round).toBe(1);
    expect(turn(b, rng)).toBe(first[0]);
    expect(b.round).toBe(2);
  });

  it('skips destroyed tanks', () => {
    const { b, rng } = battle(4);
    const order = [turn(b, rng), turn(b, rng), turn(b, rng), turn(b, rng)];
    tankById(b, order[1]!)!.alive = false;
    expect([turn(b, rng), turn(b, rng), turn(b, rng)]).toEqual([order[0], order[2], order[3]]);
  });

  it('teams alternate and rotate through their members (uneven teams too)', () => {
    const rng = createSeededRng('teams');
    const list: BattleEntrant[] = [
      { id: 'a1', name: 'a1', color: '#fff', team: 0 },
      { id: 'a2', name: 'a2', color: '#fff', team: 0 },
      { id: 'a3', name: 'a3', color: '#fff', team: 0 },
      { id: 'b1', name: 'b1', color: '#fff', team: 1 },
    ];
    const b = createBattle(rng, list, { ...CONFIG, mode: 'teams' });
    const seq = Array.from({ length: 8 }, () => turn(b, rng));
    const teamOf = (id: string) => (id.startsWith('a') ? 0 : 1);
    for (let i = 1; i < seq.length; i++) expect(teamOf(seq[i]!)).not.toBe(teamOf(seq[i - 1]!));
    const aTurns = seq.filter((id) => id.startsWith('a'));
    expect(new Set(aTurns.slice(0, 3)).size).toBe(3);
    expect(seq.filter((id) => id === 'b1')).toHaveLength(4);
  });

  it('teams prefer present members: an absent teammate never burns the team turn', () => {
    const rng = createSeededRng('presence');
    const list: BattleEntrant[] = [
      { id: 'a1', name: 'a1', color: '#fff', team: 0 },
      { id: 'a2', name: 'a2', color: '#fff', team: 0 },
      { id: 'b1', name: 'b1', color: '#fff', team: 1 },
    ];
    const b = createBattle(rng, list, { ...CONFIG, mode: 'teams' });
    const present = (id: string) => id !== 'a2';
    const seq: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = nextTurn(b, rng, present);
      if (r.kind !== 'turn') throw new Error(r.kind);
      seq.push(r.activeId);
    }
    expect(seq).not.toContain('a2');
    expect(seq.filter((id) => id === 'a1')).toHaveLength(4);
    expect(upcoming(b, 4, present)).not.toContain('a2');
    // Nobody on a side present: that side still gets its turn (the room skips it quickly).
    const ids = [nextTurn(b, rng, (id) => id === 'b1'), nextTurn(b, rng, (id) => id === 'b1')].map((r) => (r.kind === 'turn' ? r.activeId : ''));
    expect(ids.some((id) => id.startsWith('a'))).toBe(true);
    // Without a predicate the rotation is unchanged (everyone counts as present).
    const plain = createBattle(createSeededRng('presence'), list, { ...CONFIG, mode: 'teams' });
    const withAll = createBattle(createSeededRng('presence'), list, { ...CONFIG, mode: 'teams' });
    const rngA = createSeededRng('x');
    const rngB = createSeededRng('x');
    for (let i = 0; i < 6; i++) expect(nextTurn(plain, rngA)).toEqual(nextTurn(withAll, rngB, () => true));
  });

  it('changes the wind every turn within the configured bounds', () => {
    const { b, rng } = battle(3, { windMax: 15 });
    const winds = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const r = nextTurn(b, rng);
      if (r.kind !== 'turn') break;
      expect(Math.abs(r.wind)).toBeLessThanOrEqual(15);
      expect(Number.isInteger(r.wind)).toBe(true);
      winds.add(r.wind);
    }
    expect(winds.size).toBeGreaterThan(5);
    expect(nextWind(createSeededRng(1), 7, 0)).toBe(0);
  });

  it('refuels the active tank and bumps the turn id', () => {
    const { b, rng } = battle(2);
    const r = nextTurn(b, rng);
    expect(r.kind === 'turn' && r.turnId).toBe(1);
    expect(tankById(b, b.activeId!)!.fuel).toBe(60);
  });

  it('reports the round limit instead of starting round maxRounds + 1', () => {
    const { b, rng } = battle(2, { maxRounds: 3 });
    for (let i = 0; i < 6; i++) turn(b, rng);
    expect(nextTurn(b, rng).kind).toBe('round_limit');
  });

  it('lists who plays next', () => {
    const { b, rng } = battle(4);
    const a = turn(b, rng);
    const next = upcoming(b, 3);
    expect(next).toHaveLength(3);
    expect(next).not.toContain(a);
    expect([turn(b, rng), turn(b, rng), turn(b, rng)]).toEqual(next);
  });
});

describe('intents', () => {
  it('only the active, living tank may aim, drive or fire', () => {
    const { b, rng } = battle(2);
    const active = turn(b, rng);
    const other = b.tanks.find((t) => t.id !== active)!.id;
    expect(setAim(b, other, 10, 10, 'shell')).toBe(false);
    expect(drive(b, other, 1, 6).moved).toBe(0);
    expect(fire(b, other, 45, 50, 'shell')).toBe('not_your_turn');
    expect(setAim(b, active, 300, -5, 'heavy')).toBe(true);
    const t = tankById(b, active)!;
    expect(t.angle).toBe(180);
    expect(t.power).toBe(5);
    expect(t.weapon).toBe('heavy');
  });

  it('spends special ammo, keeps shells unlimited and falls back when empty', () => {
    const { b, rng } = battle(2, { windMax: 0 });
    flatten(b, [300, 1300]);
    const a = turn(b, rng);
    const t = tankById(b, a)!;
    for (let i = 0; i < 2; i++) {
      b.activeId = a;
      const s = fire(b, a, t.x < 800 ? 60 : 120, 30, 'heavy');
      expect(typeof s).toBe('object');
    }
    expect(t.ammo.heavy).toBe(0);
    expect(t.weapon).toBe('shell');
    b.activeId = a;
    expect(fire(b, a, 60, 30, 'heavy')).toBe('no_ammo');
    b.activeId = a;
    expect(setAim(b, a, 45, 50, 'heavy')).toBe(true);
    expect(t.weapon).toBe('shell');
    b.activeId = a;
    fire(b, a, 45, 20, 'shell');
    expect(t.ammo.shell).toBe(-1);
    expect(t.shots).toBe(3);
  });

  it('drives along the ground, spending fuel, and stops at walls, edges and tanks', () => {
    const { b } = battle(2);
    flatten(b, [300, 330]);
    const a = b.tanks[0]!;
    b.activeId = a.id;
    a.fuel = 60;
    // Blocked by the neighbouring tank.
    const r1 = drive(b, a.id, 1, 6);
    expect(r1.moved).toBeLessThan(6);
    expect(r1.blocked).toBe('tank');
    // Backwards is free.
    const r2 = drive(b, a.id, -1, 6);
    expect(r2.moved).toBe(6);
    expect(a.x).toBe(300 + r1.moved - 6);
    expect(a.fuel).toBe(60 - r1.moved - 6);
    // A wall.
    for (let i = 250; i < 270; i++) b.terrain.h[i] = 400;
    let blocked = null;
    for (let i = 0; i < 20 && !blocked; i++) blocked = drive(b, a.id, -1, 6).blocked;
    expect(blocked).toBe('steep');
    expect(a.x).toBeGreaterThan(270);
    // Out of fuel.
    a.fuel = 0;
    expect(drive(b, a.id, 1, 6)).toEqual({ moved: 0, blocked: 'fuel' });
    // Gentle slopes are climbable and the tank follows the ground.
    b.terrain = createTerrain(TANKS_WORLD.width, TANKS_WORLD.height, 200);
    for (let i = 0; i < TANKS_WORLD.width; i++) b.terrain.h[i] = 200 + Math.max(0, i - 300) * 0.5;
    b.tanks[1]!.x = 1300;
    a.x = 300;
    a.y = restHeight(b.terrain, 300);
    a.fuel = 60;
    const r3 = drive(b, a.id, 1, 6);
    expect(r3.moved).toBe(6);
    expect(a.y).toBe(restHeight(b.terrain, a.x));
    // The world edge.
    a.x = TANK_GEOM.halfWidth + 4;
    a.y = restHeight(b.terrain, a.x);
    expect(drive(b, a.id, -1, 6).blocked).toBe('edge');
  });

  it('refuses to drive off a cliff', () => {
    const { b } = battle(2);
    flatten(b, [300, 1300]);
    for (let i = 0; i < 305 + 10; i++) b.terrain.h[i] = 300;
    const a = b.tanks[0]!;
    a.y = restHeight(b.terrain, a.x);
    b.activeId = a.id;
    a.fuel = 60;
    let blocked = null;
    for (let i = 0; i < 10 && !blocked; i++) blocked = drive(b, a.id, 1, 6).blocked;
    expect(blocked).toBe('cliff');
  });
});

describe('results', () => {
  const kill = (b: Battle, id: string) => {
    const t = tankById(b, id)!;
    t.hp = 0;
    t.alive = false;
    b.eliminations.push([id]);
  };

  it('the last tank standing wins; places follow elimination order', () => {
    const { b, rng } = battle(4, { windMax: 0 });
    flatten(b, [200, 600, 1000, 1400]);
    kill(b, 'p0');
    kill(b, 'p3');
    // p1 finishes p2 with a direct hit.
    const p1 = tankById(b, 'p1')!;
    const p2 = tankById(b, 'p2')!;
    p2.hp = 10;
    b.activeId = 'p1';
    let script: ShotScript | null = null;
    for (let power = 30; power <= 100 && !b.result; power++) {
      const snapshot = structuredClone({ h: Array.from(b.terrain.h), tanks: b.tanks.map((t) => ({ ...t })) });
      b.activeId = 'p1';
      const r = fire(b, 'p1', 45, power, 'shell');
      if (typeof r === 'object' && r.kills.includes('p2')) {
        script = r;
        break;
      }
      // Undo the miss.
      b.terrain.h.set(snapshot.h);
      snapshot.tanks.forEach((t, i) => Object.assign(b.tanks[i]!, t));
      b.eliminations = b.eliminations.filter((g) => !g.includes('p2'));
      b.result = null;
    }
    expect(script).not.toBeNull();
    expect(b.result).not.toBeNull();
    expect(b.result!.reason).toBe('last_standing');
    expect(b.result!.winners).toEqual(['p1']);
    expect(b.result!.placements).toEqual([['p1'], ['p2'], ['p3'], ['p0']]);
    expect(p1.place).toBe(1);
    expect(p1.kills).toBe(1);
    expect(p1.damage).toBe(10);
    expect(p1.hits).toBe(1);
    expect(tankById(b, 'p0')!.place).toBe(4);
    expect(nextTurn(b, rng).kind).toBe('over');
    expect(fire(b, 'p1', 45, 50, 'shell')).toBe('over');
  });

  it('a team wins when the other team is wiped out', () => {
    const { b } = battle(4, { mode: 'teams' });
    const foes = b.tanks.filter((t) => t.team === 1);
    for (const f of foes) kill(b, f.id);
    const { settleResult } = { settleResult: (x: Battle) => checkForfeit(x, () => true) };
    const r = settleResult(b)!;
    expect(r.reason).toBe('team_win');
    expect(r.winnerTeam).toBe(0);
    expect(r.placements).toHaveLength(2);
    expect(r.placements[0]!.sort()).toEqual(b.tanks.filter((t) => t.team === 0).map((t) => t.id).sort());
    expect(r.placements[1]!.sort()).toEqual(foes.map((t) => t.id).sort());
  });

  it('mutual destruction is a draw shared by the last group eliminated', () => {
    const { b } = battle(3);
    kill(b, 'p0');
    for (const id of ['p1', 'p2']) {
      tankById(b, id)!.alive = false;
    }
    b.eliminations.push(['p1', 'p2']);
    const r = checkForfeit(b, () => true)!;
    expect(r.reason).toBe('draw');
    expect(r.placements).toEqual([['p1', 'p2'], ['p0']]);
    expect(tankById(b, 'p2')!.place).toBe(1);
    expect(tankById(b, 'p0')!.place).toBe(3);
  });

  it('the round limit ranks survivors by hit points (ties share a place)', () => {
    const { b } = battle(4);
    tankById(b, 'p0')!.hp = 80;
    tankById(b, 'p1')!.hp = 30;
    tankById(b, 'p2')!.hp = 80;
    kill(b, 'p3');
    const r = endByRounds(b);
    expect(r.reason).toBe('round_limit');
    expect(r.placements.map((g) => [...g].sort())).toEqual([['p0', 'p2'], ['p1'], ['p3']]);
    expect(tankById(b, 'p1')!.place).toBe(3);
  });

  it('the round limit in teams compares total team hit points', () => {
    const { b } = battle(4, { mode: 'teams' });
    for (const t of b.tanks) t.hp = t.team === 1 ? 90 : 40;
    const r = endByRounds(b);
    expect(r.winnerTeam).toBe(1);
    const even = battle(2, { mode: 'teams' }).b;
    expect(endByRounds(even).reason).toBe('draw');
  });

  it('leaving scuttles the tank and can hand the win to the others', () => {
    const { b } = battle(2);
    expect(abandon(b, 'p0')).toBe(true);
    expect(abandon(b, 'p0')).toBe(false);
    expect(tankById(b, 'p0')).toMatchObject({ gone: true, alive: false });
    expect(b.result?.winners).toEqual(['p1']);
    expect(b.result?.placements).toEqual([['p1'], ['p0']]);
  });

  it('when only one side is still manned, the absent sides forfeit (listed last)', () => {
    const { b } = battle(3);
    kill(b, 'p2');
    expect(checkForfeit(b, () => true)).toBeNull();
    const r = checkForfeit(b, (id) => id === 'p1')!;
    expect(r.reason).toBe('forfeit');
    expect(r.placements).toEqual([['p1'], ['p2'], ['p0']]);
    const nobody = battle(3).b;
    expect(checkForfeit(nobody, () => false)!.reason).toBe('forfeit');
  });

  it('skipping clears the active tank', () => {
    const { b, rng } = battle(2);
    turn(b, rng);
    skipTurn(b);
    expect(b.activeId).toBeNull();
  });
});

describe('seeded full-match playouts', () => {
  it('always finish with every tank placed exactly once and sane state', () => {
    for (let seed = 0; seed < 40; seed++) {
      const teams = seed % 3 === 0;
      const n = 2 + (seed % 7);
      const rng = createSeededRng(`match-${seed}`);
      const b = createBattle(rng, entrants(n, teams), {
        ...CONFIG,
        mode: teams ? 'teams' : 'ffa',
        style: 'random',
        maxRounds: 12,
        friendlyFire: seed % 2 === 0,
        arsenal: seed % 4 === 0 ? 'plenty' : 'standard',
      });
      let turns = 0;
      while (!b.result && turns < 500) {
        const r = nextTurn(b, rng);
        if (r.kind === 'round_limit') {
          endByRounds(b);
          break;
        }
        if (r.kind !== 'turn') break;
        turns++;
        const t = tankById(b, r.activeId)!;
        drive(b, t.id, rng.int(2) === 0 ? -1 : 1, 6 * (1 + rng.int(4)));
        const choices = WEAPON_IDS.filter((w) => t.ammo[w] !== 0);
        const weapon = choices[rng.int(choices.length)]!;
        // Aim roughly at a random enemy.
        const s = fire(b, t.id, 20 + rng.int(141), 30 + rng.int(71), weapon);
        expect(typeof s).toBe('object');
        for (const x of b.tanks) {
          expect(x.hp).toBeGreaterThanOrEqual(0);
          if (x.alive) expect(x.y).toBe(restHeight(b.terrain, x.x));
          if (!x.gone) expect(x.alive).toBe(x.hp > 0);
        }
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of b.terrain.h) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        expect(lo).toBeGreaterThanOrEqual(TANKS_WORLD.bedrock);
        expect(hi).toBeLessThanOrEqual(TANKS_WORLD.ceiling);
      }
      expect(b.result).not.toBeNull();
      const placed = b.result!.placements.flat();
      expect(placed.sort()).toEqual(b.tanks.map((t) => t.id).sort());
      expect(b.tanks.every((t) => t.place >= 1 && t.place <= n)).toBe(true);
      expect(turns).toBeLessThanOrEqual(12 * n);
    }
  });
});
