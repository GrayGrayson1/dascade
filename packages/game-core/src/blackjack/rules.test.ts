import { describe, expect, it } from 'vitest';
import {
  blackjackWinnings,
  dealerHasBlackjack,
  dealerPeeksWith,
  dealerShouldHit,
  doubleRuleAllows,
  insuranceCost,
  surrenderRefund,
} from './index.ts';

describe('payout math (integer chips, fractions round down)', () => {
  it('pays 3:2 naturals', () => {
    expect(blackjackWinnings(10, '3:2')).toBe(15);
    expect(blackjackWinnings(100, '3:2')).toBe(150);
    expect(blackjackWinnings(5, '3:2')).toBe(7); // 7.5 → 7
    expect(blackjackWinnings(1, '3:2')).toBe(1); // 1.5 → 1
  });
  it('pays 6:5 naturals', () => {
    expect(blackjackWinnings(10, '6:5')).toBe(12);
    expect(blackjackWinnings(25, '6:5')).toBe(30);
    expect(blackjackWinnings(7, '6:5')).toBe(8); // 8.4 → 8
  });
  it('pays 1:1 naturals', () => {
    expect(blackjackWinnings(10, '1:1')).toBe(10);
    expect(blackjackWinnings(7, '1:1')).toBe(7);
  });
  it('refunds half on surrender, rounding down', () => {
    expect(surrenderRefund(10)).toBe(5);
    expect(surrenderRefund(5)).toBe(2);
    expect(surrenderRefund(1)).toBe(0);
  });
  it('prices insurance at half the bet, rounding down', () => {
    expect(insuranceCost(10)).toBe(5);
    expect(insuranceCost(25)).toBe(12);
    expect(insuranceCost(1)).toBe(0);
  });
});

describe('dealer strategy', () => {
  it('always hits 16 or less and stands on hard 17+', () => {
    for (const h17 of [true, false]) {
      expect(dealerShouldHit(['Ts', '6d'], h17)).toBe(true);
      expect(dealerShouldHit(['2s', '3d'], h17)).toBe(true);
      expect(dealerShouldHit(['Ts', '7d'], h17)).toBe(false);
      expect(dealerShouldHit(['Ts', '6d', 'As'], h17)).toBe(false); // hard 17
      expect(dealerShouldHit(['Ts', '9d'], h17)).toBe(false);
    }
  });
  it('stands on soft 17 under S17 and hits it under H17', () => {
    expect(dealerShouldHit(['As', '6d'], false)).toBe(false);
    expect(dealerShouldHit(['As', '6d'], true)).toBe(true);
    expect(dealerShouldHit(['As', 'Ad', '5c'], true)).toBe(true);
    expect(dealerShouldHit(['As', 'Ad', '5c'], false)).toBe(false);
    expect(dealerShouldHit(['Ac', 'Ad', 'Ah', 'As', '3c'], true)).toBe(true);
  });
  it('stands on soft 18+ under both rules', () => {
    expect(dealerShouldHit(['As', '7d'], true)).toBe(false);
    expect(dealerShouldHit(['As', '7d'], false)).toBe(false);
  });
  it('peeks only under an Ace or 10-value up card when the rule is on', () => {
    expect(dealerPeeksWith('As', { dealerPeek: true })).toBe(true);
    expect(dealerPeeksWith('Kd', { dealerPeek: true })).toBe(true);
    expect(dealerPeeksWith('Tc', { dealerPeek: true })).toBe(true);
    expect(dealerPeeksWith('9c', { dealerPeek: true })).toBe(false);
    expect(dealerPeeksWith('As', { dealerPeek: false })).toBe(false);
  });
  it('detects a dealer natural', () => {
    expect(dealerHasBlackjack(['As', 'Kd'])).toBe(true);
    expect(dealerHasBlackjack(['As', '5d', '5c'])).toBe(false);
  });
});

describe('double rule', () => {
  it('any two cards', () => {
    expect(doubleRuleAllows(['As', '7d'], 'any')).toBe(true);
    expect(doubleRuleAllows(['Ts', '8d'], 'any')).toBe(true);
    expect(doubleRuleAllows(['2s', '3d', '4c'], 'any')).toBe(false);
  });
  it('hard 9–11 only', () => {
    expect(doubleRuleAllows(['4s', '5d'], '9-11')).toBe(true);
    expect(doubleRuleAllows(['5s', '5d'], '9-11')).toBe(true);
    expect(doubleRuleAllows(['5s', '6d'], '9-11')).toBe(true);
    expect(doubleRuleAllows(['6s', '6d'], '9-11')).toBe(false);
    expect(doubleRuleAllows(['As', '8d'], '9-11')).toBe(false); // soft 19
    expect(doubleRuleAllows(['3s', '5d'], '9-11')).toBe(false);
  });
  it('hard 10–11 only', () => {
    expect(doubleRuleAllows(['4s', '5d'], '10-11')).toBe(false);
    expect(doubleRuleAllows(['4s', '6d'], '10-11')).toBe(true);
    expect(doubleRuleAllows(['5s', '6d'], '10-11')).toBe(true);
    expect(doubleRuleAllows(['As', 'Kd'], '10-11')).toBe(false);
  });
});
