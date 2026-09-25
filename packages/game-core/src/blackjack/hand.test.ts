import { describe, expect, it } from 'vitest';
import { cardPoints, handLabel, handValue, isAce, isNatural, isPair, isTenValue, upCardLabel } from './index.ts';

const hv = (...codes: string[]) => handValue(codes);

describe('card points', () => {
  it('counts aces as 1, pips at face value and pictures as 10', () => {
    expect(cardPoints('As')).toBe(1);
    expect(cardPoints('2h')).toBe(2);
    expect(cardPoints('9c')).toBe(9);
    for (const r of ['T', 'J', 'Q', 'K']) expect(cardPoints(`${r}d`)).toBe(10);
  });
  it('classifies aces and ten-value cards', () => {
    expect(isAce('Ah')).toBe(true);
    expect(isAce('Kh')).toBe(false);
    expect(isTenValue('Tc')).toBe(true);
    expect(isTenValue('Qs')).toBe(true);
    expect(isTenValue('9s')).toBe(false);
    expect(isTenValue('As')).toBe(false);
  });
});

describe('hand value (hard / soft)', () => {
  it('scores simple hard hands', () => {
    expect(hv('Ts', '7d')).toMatchObject({ total: 17, soft: false, bust: false });
    expect(hv('Ks', 'Qd', '2c')).toMatchObject({ total: 22, soft: false, bust: true });
  });

  it('counts one ace as 11 when it fits (soft)', () => {
    expect(hv('As', '6d')).toMatchObject({ total: 17, soft: true, hard: 7 });
    expect(hv('6d', 'As')).toMatchObject({ total: 17, soft: true });
    expect(hv('As', 'Kd')).toMatchObject({ total: 21, soft: true });
  });

  it('hardens a soft hand that would bust', () => {
    expect(hv('As', '6d', 'Tc')).toMatchObject({ total: 17, soft: false });
    expect(hv('As', '6d', '5c')).toMatchObject({ total: 12, soft: false });
    expect(hv('As', 'Td', 'Ac')).toMatchObject({ total: 12, soft: false });
  });

  it('handles multiple aces (only one can ever be 11)', () => {
    expect(hv('As', 'Ad')).toMatchObject({ total: 12, soft: true, aces: 2 });
    expect(hv('As', 'Ad', 'Ac')).toMatchObject({ total: 13, soft: true, aces: 3 });
    expect(hv('As', 'Ad', 'Ac', 'Ah')).toMatchObject({ total: 14, soft: true, aces: 4 });
    expect(hv('As', 'Ad', '9c')).toMatchObject({ total: 21, soft: true });
    expect(hv('As', 'Ad', 'Ac', '8h')).toMatchObject({ total: 21, soft: true });
    expect(hv('As', '5d', 'Ac', '5h')).toMatchObject({ total: 12, soft: false });
    expect(hv('9s', 'Ad', 'Ac')).toMatchObject({ total: 21, soft: true });
    expect(hv('As', 'Ad', 'Ac', 'Ah', 'Ks', '9d')).toMatchObject({ total: 23, bust: true });
  });

  it('scores the empty hand as zero', () => {
    expect(hv()).toMatchObject({ total: 0, soft: false, bust: false });
  });
});

describe('naturals', () => {
  it('is only a two-card 21 on an unsplit hand', () => {
    expect(isNatural(['As', 'Kd'])).toBe(true);
    expect(isNatural(['Td', 'Ah'])).toBe(true);
    expect(isNatural(['Qc', 'As'])).toBe(true);
    expect(isNatural(['As', 'Kd'], true)).toBe(false);
    expect(isNatural(['7s', '7d', '7c'])).toBe(false);
    expect(isNatural(['As', '9d'])).toBe(false);
    expect(isNatural(['As', 'Ad', '9c'])).toBe(false);
  });
});

describe('pairs', () => {
  it('matches by point value so any two 10-value cards can be split', () => {
    expect(isPair(['8s', '8d'])).toBe(true);
    expect(isPair(['As', 'Ad'])).toBe(true);
    expect(isPair(['Ks', 'Qd'])).toBe(true);
    expect(isPair(['Ts', 'Jd'])).toBe(true);
    expect(isPair(['9s', 'Td'])).toBe(false);
    expect(isPair(['8s', '8d', '8c'])).toBe(false);
  });
});

describe('labels', () => {
  it('describes hands for the table', () => {
    expect(handLabel(['As', 'Kd'])).toBe('Blackjack');
    expect(handLabel(['As', 'Kd'], true)).toBe('21');
    expect(handLabel(['As', '6d'])).toBe('Soft 17');
    expect(handLabel(['As', '6d', 'Tc'])).toBe('17');
    expect(handLabel(['As', 'Ad', '9c'])).toBe('21');
    expect(handLabel(['Ks', 'Qd', '5c'])).toBe('Bust');
    expect(handLabel([])).toBe('');
  });
  it('describes the dealer up card', () => {
    expect(upCardLabel('As')).toBe('Showing A');
    expect(upCardLabel('Kd')).toBe('Showing 10');
    expect(upCardLabel('6c')).toBe('Showing 6');
  });
});
