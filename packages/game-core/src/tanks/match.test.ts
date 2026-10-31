import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import {
  EARNINGS,
  MAX_STOCK,
  PERSONAS,
  SCORING,
  STOCKED_LOADOUT,
  TANKS_WORLD,
  WEAPONS,
  ITEMS,
  type ShopId,
} from '@dascade/shared/games/tanks';
import {
  allLocked,
  beginVolley,
  createBattle,
  drive,
  fire,
  lock,
  nextTurn,
  resolveVolley,
  strikeHazard,
  tankById,
  useItem,
  type Battle,
  type BattleConfig,
} from './battle.ts';
import {
  CHEAPEST_PRICE,
  allReady,
  basketString,
  buy,
  createMatch,
  finishMatch,
  openShop,
  prepareBattle,
  sell,
  setReady,
  settleBattle,
  shopOpens,
  standings,
  type MatchConfig,
} from './match.ts';
import { planItems, planShop, planShot } from './bot.ts';
import { createTerrain, restHeight } from './terrain.ts';

const BATTLE: BattleConfig = {
  mode: 'ffa',
  turnMode: 'turns',
  style: 'hills',
  walls: 'open',
  gravity: 'normal',
  windMax: 0,
  fuelPerTurn: 60,
  armor: 100,
  maxRounds: 12,
  friendlyFire: false,
  theme: 'dusk',
  talk: 'off',
  order: 'given',
};

const MATCH: MatchConfig = { battles: 3, economy: 'shop', startCredits: 20_000, mode: 'ffa' };

const members = (n: number, teams = false) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: '#fff', team: teams ? i % 2 : -1 }));

/** Flat ground with each tank (by id: p0, p1, …) at the given column. */
function flatten(b: Battle, xs: number[]): void {
  b.terrain = createTerrain(TANKS_WORLD.width, TANKS_WORLD.height, 200);
  for (const t of b.tanks) {
    const i = Number(t.id.replace(/\D/g, '')) || (t.id === 'cpu' ? xs.length - 1 : 0);
    t.x = xs[i] ?? t.x;
    t.y = restHeight(b.terrain, t.x);
  }
}

describe('the shop', () => {
  it('starts every crew with the starting credits and nothing but shells', () => {
    const m = createMatch(members(3), MATCH);
    for (const f of m.fleet) {
      expect(f.credits).toBe(20_000);
      expect(f.ammo.shell).toBe(-1);
      expect(f.ammo.heavy).toBe(0);
      expect(f.items.parachute).toBe(0);
    }
    expect(shopOpens(m)).toBe(true);
    expect(shopOpens(createMatch(members(2), { ...MATCH, startCredits: 0 }))).toBe(false);
    expect(shopOpens(createMatch(members(2), { ...MATCH, economy: 'stocked' }))).toBe(false);
  });

  it('buys bundles with credits, refuses what you can’t afford, and caps stock', () => {
    const m = createMatch(members(1), { ...MATCH, startCredits: 12_000 });
    openShop(m);
    expect(buy(m, 'p0', 'heavy')).toBeNull();
    const f = m.fleet[0]!;
    expect(f.ammo.heavy).toBe(WEAPONS.heavy.bundle);
    expect(f.credits).toBe(12_000 - WEAPONS.heavy.price);
    expect(buy(m, 'p0', 'nuke')).toBe('credits');
    expect(buy(m, 'p0', 'fuel', new Set<ShopId>(['fuel']))).toBe('blocked');
    expect(buy(m, 'nobody', 'heavy')).toBe('unknown');
    f.credits = 1_000_000;
    let n = 0;
    while (buy(m, 'p0', 'tracer') === null) n++;
    expect(f.ammo.tracer).toBeLessThanOrEqual(MAX_STOCK);
    expect(f.ammo.tracer + WEAPONS.tracer.bundle).toBeGreaterThan(MAX_STOCK);
    expect(n).toBe(Math.floor(MAX_STOCK / WEAPONS.tracer.bundle));
    expect(buy(m, 'p0', 'tracer')).toBe('full');
  });

  it('sells back only what was bought this visit, for a full refund', () => {
    const m = createMatch(members(1), MATCH);
    openShop(m);
    buy(m, 'p0', 'shield');
    buy(m, 'p0', 'shield');
    const f = m.fleet[0]!;
    expect(basketString(f)).toBe('shield:2');
    expect(sell(m, 'p0', 'shield')).toBeNull();
    expect(f.items.shield).toBe(1);
    expect(f.credits).toBe(20_000 - ITEMS.shield.price);
    expect(sell(m, 'p0', 'heavy')).toBe('not_in_basket');
    openShop(m);
    expect(sell(m, 'p0', 'shield')).toBe('not_in_basket');
    expect(f.items.shield).toBe(1);
  });

  it('waits for every present human to be ready; CPU crews never hold it up', () => {
    const m = createMatch([...members(2), { id: 'cpu-1', name: 'C', color: '#fff', team: -1, cpu: true }], MATCH);
    openShop(m);
    expect(allReady(m, () => true)).toBe(false);
    setReady(m, 'p0', true);
    expect(allReady(m, () => true)).toBe(false);
    expect(allReady(m, (id) => id !== 'p1')).toBe(true);
    setReady(m, 'p1', true);
    expect(allReady(m, () => true)).toBe(true);
  });

  it('the cheapest thing on the shelf is what decides whether the shop opens', () => {
    const m = createMatch(members(2), { ...MATCH, startCredits: CHEAPEST_PRICE - 1 });
    expect(shopOpens(m)).toBe(false);
    m.fleet[1]!.credits = CHEAPEST_PRICE;
    expect(shopOpens(m)).toBe(true);
  });
});

describe('battles inside a match', () => {
  it('hands out the stocked loadout fresh every battle (and nothing in shells-only)', () => {
    const rng = createSeededRng(1);
    const m = createMatch(members(2), { ...MATCH, economy: 'stocked' });
    prepareBattle(m, rng);
    expect(m.fleet[0]!.ammo.heavy).toBe(STOCKED_LOADOUT.heavy);
    m.fleet[0]!.ammo.heavy = 0;
    prepareBattle(m, rng);
    expect(m.fleet[0]!.ammo.heavy).toBe(STOCKED_LOADOUT.heavy);
    expect(m.battleNo).toBe(2);
    const shells = createMatch(members(2), { ...MATCH, economy: 'shells' });
    prepareBattle(shells, rng);
    expect(shells.fleet[0]!.ammo.heavy).toBe(0);
    expect(shells.fleet[0]!.ammo.shell).toBe(-1);
  });

  it('puts the lowest score first in the next battle’s turn order', () => {
    const m = createMatch(members(3), MATCH);
    m.fleet[0]!.score = 300;
    m.fleet[1]!.score = 10;
    m.fleet[2]!.score = 120;
    const entrants = prepareBattle(m, createSeededRng(2));
    expect(entrants.map((e) => e.id)).toEqual(['p1', 'p2', 'p0']);
    const rng = createSeededRng(3);
    const b = createBattle(rng, entrants, BATTLE);
    const r = nextTurn(b, rng);
    expect(r.kind === 'turn' && r.activeId).toBe('p1');
  });

  it('pays out and scores a decided battle; ammo spent in battle is gone for good', () => {
    const rng = createSeededRng(4);
    const m = createMatch(members(2), MATCH);
    openShop(m);
    buy(m, 'p0', 'heavy');
    const b = createBattle(rng, prepareBattle(m, rng), BATTLE);
    flatten(b, [300, 1300]);
    const p0 = tankById(b, 'p0')!;
    const p1 = tankById(b, 'p1')!;
    p1.hp = 30;
    b.activeId = 'p0';
    // Find a power that finishes p1 with the heavy shell.
    let ok = false;
    for (let power = 40; power <= 100 && !ok; power++) {
      const snapshot = { h: Array.from(b.terrain.h), tanks: b.tanks.map((t) => ({ ...t })), ammo: p0.ammo.heavy };
      b.activeId = 'p0';
      const r = fire(b, 'p0', 45, power, 'heavy');
      if (typeof r === 'object' && r.kills.some((k) => k.id === 'p1')) ok = true;
      else {
        b.terrain.h.set(snapshot.h);
        snapshot.tanks.forEach((t, i) => Object.assign(b.tanks[i]!, t));
        p0.ammo.heavy = snapshot.ammo;
        b.eliminations = [];
        b.result = null;
      }
    }
    expect(ok).toBe(true);
    expect(b.result?.winners).toEqual(['p0']);
    const before = m.fleet[0]!.credits;
    const earn = settleBattle(m, b).get('p0')!;
    expect(earn.damage).toBe(30 * EARNINGS.perDamage);
    expect(earn.kills).toBe(EARNINGS.perKill);
    expect(earn.win).toBe(EARNINGS.win);
    expect(earn.survive).toBe(p0.alive ? EARNINGS.survive : 0);
    expect(m.fleet[0]!.credits).toBe(before + earn.total);
    expect(m.fleet[0]!.score).toBe(30 + SCORING.perKill + SCORING.place[0]!);
    expect(m.fleet[0]!.wins).toBe(1);
    expect(m.fleet[1]!.score).toBe(SCORING.place[1]!);
    expect(m.fleet[0]!.ammo.heavy).toBe(WEAPONS.heavy.bundle - 1);
  });

  it('decides the match on points, shares places on ties, and sums team scores', () => {
    const m = createMatch(members(3), MATCH);
    m.fleet[0]!.score = 200;
    m.fleet[1]!.score = 350;
    m.fleet[2]!.score = 200;
    m.fleet[2]!.wins = 1;
    const r = finishMatch(m);
    expect(r.winners).toEqual(['p1']);
    expect(standings(m).map((f) => f.id)).toEqual(['p1', 'p2', 'p0']);
    expect(m.fleet.map((f) => f.place)).toEqual([3, 1, 2]);
    const t = createMatch(members(4, true), { ...MATCH, mode: 'teams' });
    t.fleet[0]!.score = 100;
    t.fleet[2]!.score = 100;
    t.fleet[1]!.score = 150;
    t.fleet[3]!.score = 10;
    const tr = finishMatch(t);
    expect(tr.winnerTeam).toBe(0);
    expect(tr.winners.sort()).toEqual(['p0', 'p2']);
  });
});

describe('volleys', () => {
  it('everyone aims at once; locked shots fly together and the volley ends', () => {
    const rng = createSeededRng(5);
    const m = createMatch(members(3), MATCH);
    const b = createBattle(rng, prepareBattle(m, rng), { ...BATTLE, turnMode: 'volley' });
    flatten(b, [300, 800, 1300]);
    const v = beginVolley(b, rng);
    expect(v.kind).toBe('volley');
    expect(b.activeId).toBeNull();
    expect(drive(b, 'p0', 1, 6).moved).toBeGreaterThan(0);
    expect(fire(b, 'p0', 45, 50, 'shell')).toBe('not_your_turn');
    expect(lock(b, 'p0', 45, 50, 'shell')).toBeNull();
    expect(lock(b, 'p0', 45, 50, 'shell')).toBe('locked');
    expect(drive(b, 'p0', 1, 6).moved).toBe(0);
    expect(allLocked(b)).toBe(false);
    expect(allLocked(b, (id) => id === 'p0')).toBe(true);
    lock(b, 'p2', 135, 50, 'shell');
    const s = resolveVolley(b, { seed: 1 })!;
    expect(s.kind).toBe('volley');
    expect(s.launches.map((l) => l.shooterId).sort()).toEqual(['p0', 'p2']);
    expect(b.acting).toEqual([]);
    expect(b.tanks.every((t) => !t.locked)).toBe(true);
    expect(tankById(b, 'p1')!.shots).toBe(0);
    expect(beginVolley(b, rng).kind).toBe('volley');
    expect(b.round).toBe(2);
    expect(resolveVolley(b, { seed: 2 })).toBeNull();
  });

  it('stops at the round limit', () => {
    const rng = createSeededRng(6);
    const m = createMatch(members(2), MATCH);
    const b = createBattle(rng, prepareBattle(m, rng), { ...BATTLE, turnMode: 'volley', maxRounds: 3 });
    for (let i = 0; i < 3; i++) expect(beginVolley(b, rng).kind).toBe('volley');
    expect(beginVolley(b, rng).kind).toBe('round_limit');
  });
});

describe('items', () => {
  it('shields, batteries and fuel come out of the crew’s inventory, on your turn only', () => {
    const rng = createSeededRng(7);
    const m = createMatch(members(2), MATCH);
    openShop(m);
    buy(m, 'p0', 'heavyshield');
    buy(m, 'p0', 'battery');
    buy(m, 'p0', 'fuel');
    const b = createBattle(rng, prepareBattle(m, rng), BATTLE);
    nextTurn(b, rng);
    b.activeId = 'p0';
    const t = tankById(b, 'p0')!;
    t.fuel = 60;
    expect(useItem(b, 'p1', 'shield')).toBe('not_your_turn');
    expect(useItem(b, 'p0', 'shield')).toBe('none_left');
    expect(useItem(b, 'p0', 'battery')).toBe('full_armor');
    expect(useItem(b, 'p0', 'heavyshield')).toBeNull();
    expect(t.shield).toBe(130);
    expect(t.shieldKind).toBe('heavyshield');
    expect(m.fleet[0]!.items.heavyshield).toBe(0);
    t.hp = 50;
    expect(useItem(b, 'p0', 'battery')).toBeNull();
    expect(t.hp).toBe(75);
    const fuel = t.fuel;
    expect(useItem(b, 'p0', 'fuel')).toBeNull();
    expect(t.fuel).toBe(fuel + 150);
    const noDrive = createBattle(rng, prepareBattle(m, rng), { ...BATTLE, fuelPerTurn: 0 });
    nextTurn(noDrive, rng);
    expect(useItem(noDrive, noDrive.activeId!, 'fuel')).toBe(
      m.fleet.find((f) => f.id === noDrive.activeId)!.items.fuel > 0 ? 'no_driving' : 'none_left',
    );
  });

  it('parachutes spent in a fall come off the crew’s inventory', () => {
    const rng = createSeededRng(8);
    const m = createMatch(members(2), MATCH);
    m.fleet[1]!.items.parachute = 2;
    const b = createBattle(rng, prepareBattle(m, rng), BATTLE);
    flatten(b, [300, 700]);
    b.terrain.h.fill(300);
    for (const t of b.tanks) t.y = 300;
    tankById(b, 'p1')!.hp = 300;
    b.activeId = 'p0';
    // A nuke beside p1 drops it a long way.
    let used = false;
    for (let power = 40; power <= 70 && !used; power++) {
      const snapshot = { h: Array.from(b.terrain.h), tanks: b.tanks.map((t) => ({ ...t })) };
      b.activeId = 'p0';
      m.fleet[0]!.ammo.nuke = 1;
      fire(b, 'p0', 45, power, 'nuke');
      if (m.fleet[1]!.items.parachute === 1) used = true;
      else {
        b.terrain.h.set(snapshot.h);
        snapshot.tanks.forEach((t, i) => Object.assign(b.tanks[i]!, t));
        b.eliminations = [];
        b.result = null;
        m.fleet[1]!.items.parachute = 2;
      }
    }
    expect(used).toBe(true);
  });

  it('a buried tank can’t drive', () => {
    const rng = createSeededRng(9);
    const m = createMatch(members(2), MATCH);
    const b = createBattle(rng, prepareBattle(m, rng), BATTLE);
    flatten(b, [300, 1300]);
    for (let x = 250; x < 350; x++) b.terrain.h[x] = 260;
    b.activeId = 'p0';
    tankById(b, 'p0')!.fuel = 60;
    expect(drive(b, 'p0', 1, 6).blocked).toBe('buried');
  });
});

describe('hazards', () => {
  it('a hazard script plays against the battle and can end it', () => {
    const rng = createSeededRng(10);
    const m = createMatch(members(2), MATCH);
    const b = createBattle(rng, prepareBattle(m, rng), BATTLE);
    for (const t of b.tanks) t.hp = 1;
    let s = strikeHazard(b, rng, 'lightning', { seed: 1 });
    for (let i = 0; i < 20 && !b.result; i++) s = strikeHazard(b, rng, 'lightning', { seed: i });
    expect(s.kind).toBe('hazard');
    expect(b.result).not.toBeNull();
    expect(Object.keys(s.damage)).toHaveLength(0);
  });
});

describe('CPU crews', () => {
  it('shop to their persona within their credits', () => {
    for (const persona of PERSONAS) {
      const m = createMatch([{ id: 'cpu', name: 'C', color: '#fff', team: -1, cpu: true, persona }], { ...MATCH, startCredits: 30_000 });
      openShop(m);
      const f = m.fleet[0]!;
      const list = planShop(f, { skill: 'veteran', persona }, createSeededRng(persona), { lastBattle: false });
      expect(list.length).toBeGreaterThan(0);
      for (const id of list) expect(buy(m, 'cpu', id)).toBeNull();
      expect(f.credits).toBeGreaterThanOrEqual(0);
      if (persona === 'hoarder') expect(f.credits).toBeGreaterThanOrEqual(15_000 - 6000);
    }
  });

  it('switch on a shield and patch up with a battery when hurt', () => {
    const rng = createSeededRng(11);
    const m = createMatch([...members(1), { id: 'cpu', name: 'C', color: '#fff', team: -1, cpu: true, persona: 'gunner' as const }], MATCH);
    m.fleet[1]!.items.shield = 1;
    m.fleet[1]!.items.battery = 1;
    const b = createBattle(rng, prepareBattle(m, rng), BATTLE);
    tankById(b, 'cpu')!.hp = 40;
    expect(planItems(b, 'cpu', { skill: 'ace', persona: 'gunner' }, rng)).toEqual(['shield', 'battery']);
  });

  it('dig out with an excavator when buried', () => {
    const rng = createSeededRng(12);
    const m = createMatch([...members(1), { id: 'cpu', name: 'C', color: '#fff', team: -1, cpu: true, persona: 'cyborg' as const }], MATCH);
    m.fleet[1]!.ammo.excavator = 2;
    const b = createBattle(rng, prepareBattle(m, rng), BATTLE);
    flatten(b, [300, 1300]);
    const cpu = tankById(b, 'cpu')!;
    for (let x = cpu.x - 50; x < cpu.x + 50; x++) b.terrain.h[x] = 270;
    expect(planShot(b, 'cpu', { skill: 'ace', persona: 'cyborg' }, rng).weapon).toBe('excavator');
  });

  it('a cyborg with a full arsenal still plans within the server’s time budget', () => {
    const rng = createSeededRng(13);
    const m = createMatch([...members(3), { id: 'cpu', name: 'C', color: '#fff', team: -1, cpu: true, persona: 'cyborg' as const }], MATCH);
    const f = m.fleet[3]!;
    for (const id of ['mirv', 'seeker', 'railgun', 'heavy', 'hotnapalm', 'napalm', 'mininuke', 'popper', 'heavyroller'] as const)
      f.ammo[id] = 2;
    const b = createBattle(rng, prepareBattle(m, rng), { ...BATTLE, style: 'mesa', windMax: 10 });
    b.wind = 7;
    const t0 = performance.now();
    const plan = planShot(b, 'cpu', { skill: 'ace', persona: 'cyborg' }, rng);
    const ms = performance.now() - t0;
    expect(f.ammo[plan.weapon]).not.toBe(0);
    expect(ms).toBeLessThan(400);
  });
});
