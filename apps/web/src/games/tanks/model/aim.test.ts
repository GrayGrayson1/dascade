import { describe, expect, it } from 'vitest';
import { emptyAmmo, emptyItems, type FleetView, type TankView, type TanksPublicState } from '@dascade/shared/games/tanks';
import { itemBlock, readAimView, type AimSnapshot } from './aim.ts';

function tank(id: string, patch: Partial<TankView> = {}): TankView {
  return {
    id,
    slot: 0,
    name: id,
    color: '#fff',
    team: -1,
    x: 100,
    y: 200,
    hp: 80,
    maxHp: 100,
    alive: true,
    angle: 50,
    power: 60,
    weapon: 'shell',
    fuel: 60,
    maxFuel: 60,
    shield: 0,
    shieldMax: 0,
    shieldKind: '',
    buried: 0,
    locked: false,
    place: 0,
    kills: 0,
    damage: 0,
    shots: 0,
    hits: 0,
    gone: false,
    cpu: false,
    ...patch,
  };
}

function state(
  patch: {
    turnMode?: 'turns' | 'volley';
    activeId?: string;
    stage?: TanksPublicState['battle']['stage'];
    me?: Partial<TankView>;
    fleet?: Partial<FleetView>;
  } = {},
): TanksPublicState {
  return {
    phase: 'PLAYING',
    tanks: { me: tank('me', patch.me), you: tank('you') },
    fleet: { me: { ammo: { ...emptyAmmo(), heavy: 2 }, items: { ...emptyItems(), battery: 1 }, ...patch.fleet } as FleetView },
    battle: {
      stage: patch.stage ?? 'aim',
      turnMode: patch.turnMode ?? 'turns',
      activeId: patch.activeId ?? 'me',
      turnId: 7,
      battleSerial: 3,
    } as TanksPublicState['battle'],
    crew: {},
  } as unknown as TanksPublicState;
}

describe('readAimView', () => {
  it('turns mode: only the active tank acts', () => {
    expect(readAimView(state(), 'me')?.acting).toBe(true);
    expect(readAimView(state({ activeId: 'you' }), 'me')?.acting).toBe(false);
    expect(readAimView(state({ stage: 'resolving' }), 'me')?.acting).toBe(false);
  });

  it('volley mode: everyone acts until locked in', () => {
    const v = readAimView(state({ turnMode: 'volley', activeId: '' }), 'me');
    expect(v?.acting).toBe(true);
    expect(v?.volley).toBe(true);
    const locked = readAimView(state({ turnMode: 'volley', activeId: '', me: { locked: true } }), 'me');
    expect(locked?.acting).toBe(false);
    expect(locked?.locked).toBe(true);
  });

  it('reads inventory from the fleet and buried / shield state from the tank', () => {
    const v = readAimView(state({ me: { buried: 14, shield: 40, shieldMax: 60, shieldKind: 'shield' } }), 'me')!;
    expect(v.ammo.heavy).toBe(2);
    expect(v.items.battery).toBe(1);
    expect(v.buried).toBe(true);
    expect(v.shield).toBe(40);
    expect(v.serial).toBe(3);
  });

  it('dead or missing tanks never act', () => {
    expect(readAimView(state({ me: { alive: false } }), 'me')?.acting).toBe(false);
    expect(readAimView(state(), 'nobody')).toBeNull();
    expect(readAimView(null, 'me')).toBeNull();
  });
});

describe('itemBlock', () => {
  const base: Pick<AimSnapshot, 'items' | 'hp' | 'maxHp' | 'maxFuel' | 'canAct' | 'inBattle' | 'locked' | 'volley'> = {
    items: { ...emptyItems(), battery: 1, fuel: 1, shield: 1 },
    hp: 70,
    maxHp: 100,
    maxFuel: 60,
    canAct: true,
    inBattle: true,
    locked: false,
    volley: false,
  };
  it('allows items in stock while acting', () => {
    expect(itemBlock('battery', base)).toBeNull();
    expect(itemBlock('shield', base)).toBeNull();
  });
  it('explains every refusal', () => {
    expect(itemBlock('deflector', base)).toBe('None left');
    expect(itemBlock('battery', { ...base, hp: 100 })).toBe('Armor is full');
    expect(itemBlock('fuel', { ...base, maxFuel: 0 })).toBe('Driving is off');
    expect(itemBlock('shield', { ...base, canAct: false })).toBe('Wait for your turn');
    expect(itemBlock('shield', { ...base, canAct: false, volley: true, locked: true })).toBe('Locked in');
  });
});
