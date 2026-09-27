import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@dascade/shared';
import type { DeceptionRole } from '@dascade/shared/games/deception';
import { resolveNight, type NightInput } from './night.ts';

/** g1/g2 Glitches, jm Jammer, sc Scanner, fw Firewall, tr Tracer, s1..s3 Sysops. */
const ROLES = new Map<string, DeceptionRole>([
  ['g1', 'glitch'],
  ['g2', 'glitch'],
  ['jm', 'jammer'],
  ['sc', 'scanner'],
  ['fw', 'firewall'],
  ['tr', 'tracer'],
  ['s1', 'sysop'],
  ['s2', 'sysop'],
  ['s3', 'sysop'],
]);
const ALL = new Set(ROLES.keys());

function night(patch: Partial<NightInput> = {}, seed: string | number = 1) {
  const input: NightInput = {
    cycle: 1,
    roles: ROLES,
    alive: ALL,
    attacks: new Map(),
    scans: new Map(),
    shields: new Map(),
    jams: new Map(),
    ...patch,
  };
  return resolveNight(input, createSeededRng(seed));
}
const m = (entries: Record<string, string | null>) => new Map(Object.entries(entries));

describe('attack', () => {
  it('corrupts the unanimous target', () => {
    const r = night({ attacks: m({ g1: 's1', g2: 's1', jm: 's1' }) });
    expect(r.attackTarget).toBe('s1');
    expect(r.corrupted).toBe('s1');
    expect(r.blocked).toBe(false);
    expect(r.attackTieBreak).toBe(false);
  });

  it('follows the plurality of Glitch picks', () => {
    const r = night({ attacks: m({ g1: 's1', g2: 's2', jm: 's2' }) });
    expect(r.corrupted).toBe('s2');
  });

  it('breaks ties with the RNG, deterministically per seed, and can pick either side', () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const r = night({ attacks: m({ g1: 's1', g2: 's2' }) }, seed);
      expect(r.attackTieBreak).toBe(true);
      expect(['s1', 's2']).toContain(r.corrupted);
      picks.add(r.corrupted!);
      expect(night({ attacks: m({ g1: 's1', g2: 's2' }) }, seed).corrupted).toBe(r.corrupted);
    }
    expect(picks).toEqual(new Set(['s1', 's2']));
  });

  it('means no attack when nobody picked', () => {
    const r = night();
    expect(r.attackTarget).toBeNull();
    expect(r.corrupted).toBeNull();
    expect(r.blocked).toBe(false);
  });

  it('ignores picks at fellow Glitches, offline targets, offline or non-Glitch attackers', () => {
    const alive = new Set([...ALL].filter((id) => id !== 's3' && id !== 'g2'));
    const r = night({ alive, attacks: m({ g1: 'jm', g2: 's1', sc: 's2', jm: 's3' }) });
    expect(r.attackTarget).toBeNull();
  });
});

describe('shield', () => {
  it('blocks the attack on the shielded player', () => {
    const r = night({ attacks: m({ g1: 's1' }), shields: m({ fw: 's1' }) });
    expect(r.blocked).toBe(true);
    expect(r.corrupted).toBeNull();
    expect(r.shields).toEqual([{ actorId: 'fw', targetId: 's1', jammed: false, held: true }]);
  });

  it('allows a self-shield', () => {
    const r = night({ attacks: m({ g1: 'fw', g2: 'fw' }), shields: m({ fw: 'fw' }) });
    expect(r.blocked).toBe(true);
    expect(r.corrupted).toBeNull();
  });

  it('does not help a different player', () => {
    const r = night({ attacks: m({ g1: 's2' }), shields: m({ fw: 's1' }) });
    expect(r.corrupted).toBe('s2');
    expect(r.shields[0]!.held).toBe(false);
  });

  it('fails when the Firewall is jammed', () => {
    const r = night({ attacks: m({ g1: 's1' }), shields: m({ fw: 's1' }), jams: m({ jm: 'fw' }) });
    expect(r.blocked).toBe(false);
    expect(r.corrupted).toBe('s1');
    expect(r.shields).toEqual([{ actorId: 'fw', targetId: 's1', jammed: true, held: false }]);
  });

  it('ignores a shield on last night’s player', () => {
    const r = night({ attacks: m({ g1: 's1' }), shields: m({ fw: 's1' }), lastShield: new Map([['fw', 's1']]) });
    expect(r.shields).toEqual([]);
    expect(r.corrupted).toBe('s1');
  });

  it('ignores shields from non-Firewalls and offline Firewalls', () => {
    expect(night({ attacks: m({ g1: 's1' }), shields: m({ s2: 's1' }) }).corrupted).toBe('s1');
    const alive = new Set([...ALL].filter((id) => id !== 'fw'));
    expect(night({ alive, attacks: m({ g1: 's1' }), shields: m({ fw: 's1' }) }).corrupted).toBe('s1');
  });
});

describe('scan', () => {
  it('reads Glitch for every Glitch-team role and Clean for Sysops', () => {
    expect(night({ scans: m({ sc: 'g1' }) }).scans).toEqual([{ actorId: 'sc', targetId: 'g1', result: 'glitch' }]);
    expect(night({ scans: m({ sc: 'jm' }) }).scans[0]!.result).toBe('glitch');
    expect(night({ scans: m({ sc: 'fw' }) }).scans[0]!.result).toBe('clean');
    expect(night({ scans: m({ sc: 's1' }) }).scans[0]!.result).toBe('clean');
  });

  it('reads JAMMED when the Scanner is jammed (even when scanning the Jammer)', () => {
    const r = night({ scans: m({ sc: 'jm' }), jams: m({ jm: 'sc' }) });
    expect(r.scans).toEqual([{ actorId: 'sc', targetId: 'jm', result: 'jammed' }]);
    expect(r.jammed).toEqual(['sc']);
  });

  it('still resolves when the Scanner is corrupted the same night', () => {
    const r = night({ attacks: m({ g1: 'sc' }), scans: m({ sc: 'g2' }) });
    expect(r.corrupted).toBe('sc');
    expect(r.scans[0]!.result).toBe('glitch');
  });

  it('ignores self-scans, offline targets and non-Scanners', () => {
    expect(night({ scans: m({ sc: 'sc' }) }).scans).toEqual([]);
    expect(night({ scans: m({ s1: 'g1' }) }).scans).toEqual([]);
    const alive = new Set([...ALL].filter((id) => id !== 'g1'));
    expect(night({ alive, scans: m({ sc: 'g1' }) }).scans).toEqual([]);
  });
});

describe('jam', () => {
  it('only a living Jammer jams, never itself or a fellow Glitch', () => {
    expect(night({ jams: m({ jm: 'jm' }) }).jams).toEqual([]);
    expect(night({ jams: m({ jm: 'g1' }) }).jams).toEqual([]);
    expect(night({ jams: m({ g1: 'sc' }) }).jams).toEqual([]);
    const alive = new Set([...ALL].filter((id) => id !== 'jm'));
    expect(night({ alive, jams: m({ jm: 'sc' }) }).jams).toEqual([]);
    expect(night({ jams: m({ jm: 's1' }) }).jams).toEqual([{ actorId: 'jm', targetId: 's1' }]);
  });

  it('jamming a plain Sysop changes nothing else', () => {
    const r = night({ attacks: m({ g1: 's2' }), jams: m({ jm: 's1' }), scans: m({ sc: 'g1' }), shields: m({ fw: 's2' }) });
    expect(r.blocked).toBe(true);
    expect(r.scans[0]!.result).toBe('glitch');
  });
});

describe('tracer clue', () => {
  it('names exactly one Glitch and one Sysop, never the Tracer', () => {
    for (let seed = 0; seed < 60; seed++) {
      const r = night({}, seed);
      expect(r.clues).toHaveLength(1);
      const clue = r.clues[0]!;
      expect(clue.actorId).toBe('tr');
      expect(clue.jammed).toBe(false);
      const pair = clue.pair!;
      expect(pair).not.toContain('tr');
      const glitches = pair.filter((id) => ['g1', 'g2', 'jm'].includes(id));
      expect(glitches).toHaveLength(1);
    }
  });

  it('puts the Glitch first or second at random', () => {
    const firsts = new Set<boolean>();
    for (let seed = 0; seed < 30; seed++) firsts.add(['g1', 'g2', 'jm'].includes(night({}, seed).clues[0]!.pair![0]));
    expect(firsts).toEqual(new Set([true, false]));
  });

  it('never names the player corrupted tonight', () => {
    for (let seed = 0; seed < 40; seed++) {
      const r = night({ attacks: m({ g1: 's1' }) }, seed);
      expect(r.clues[0]!.pair).not.toContain('s1');
    }
  });

  it('reads JAMMED when jammed', () => {
    expect(night({ jams: m({ jm: 'tr' }) }).clues).toEqual([{ actorId: 'tr', pair: null, jammed: true }]);
  });

  it('gives no clue to a Tracer corrupted tonight', () => {
    expect(night({ attacks: m({ g1: 'tr' }) }).clues).toEqual([]);
  });

  it('has no signal when no Glitch (or no other Sysop) is online', () => {
    const alive = new Set(['tr', 's1', 's2']);
    expect(night({ alive }).clues).toEqual([{ actorId: 'tr', pair: null, jammed: false }]);
  });
});
