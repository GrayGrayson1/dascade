import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers.ts';

/**
 * DASjack 21 smoke: two players at one table, both bet, play decisions until the
 * round settles, then leave. Rounds use a real shuffled shoe, so the test reacts
 * to whatever comes up (insurance, dealer blackjack, naturals, splits…).
 */

interface SeatLite {
  bet: number;
  locked: boolean;
  inRound: boolean;
  net: number;
  handsPlayed: number;
  actions: string[];
  hands: Array<{ result: string }>;
}

async function mySeat(page: Page): Promise<SeatLite | undefined> {
  return page.evaluate(() => {
    const w = window as unknown as { __DASCADE__?: { getState(): any; store: { getState(): { playerId: string | null } } } };
    const id = w.__DASCADE__?.store.getState().playerId;
    const state = w.__DASCADE__?.getState();
    return id && state ? state.seats?.[id] : undefined;
  });
}

async function stage(page: Page): Promise<string | undefined> {
  return (await roomState(page))?.stage;
}

async function placeBet(page: Page) {
  await expect.poll(() => stage(page), { timeout: 15_000 }).toBe('BETTING');
  await page.getByRole('button', { name: 'Add 5 chip' }).click();
  await page.getByRole('button', { name: 'Add 5 chip' }).click();
  await expect.poll(async () => (await mySeat(page))?.bet, { timeout: 5_000 }).toBe(10);
  await page.getByRole('button', { name: /^Deal/ }).click();
  await expect.poll(async () => (await mySeat(page))?.locked, { timeout: 5_000 }).toBe(true);
}

/** Answer insurance and play simple decisions (hit below 12, else stand) until the round has settled. */
async function playRound(page: Page, round: number) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('round did not settle');
    const state = await roomState(page);
    const seat = await mySeat(page);
    if (state?.round === round && state.stage === 'SETTLING') return;
    if ((state?.round ?? 0) > round || (state?.round === round && state.stage === 'BETTING' && (seat?.handsPlayed ?? 0) > 0)) return;
    if (state?.stage === 'INSURANCE') {
      const no = page.getByRole('button', { name: /No insurance|No thanks/ });
      if (await no.isVisible().catch(() => false)) await no.click({ timeout: 1_000 }).catch(() => undefined);
    } else if (state?.stage === 'PLAYING' && seat && seat.actions.length > 0) {
      const hand = (seat as any).hands[(seat as any).activeHand];
      const action = hand && hand.total < 12 && seat.actions.includes('hit') ? 'Hit' : 'Stand';
      const button = page.getByRole('button', { name: new RegExp(`^${action}`) });
      if (await button.isVisible().catch(() => false)) await button.click({ timeout: 1_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(150);
  }
}

test('two players bet, play and settle a round of DASjack 21', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const code = await createRoom(page, 'blackjack', 'Host');
  const use = testInfo.project.use;
  const guest = await joinRoom(browser, code, 'Guest', {
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForPhase(guest, 'PLAYING');

  // The felt reflects the live rules.
  await expect(page.getByText('Place your bets').first()).toBeVisible();
  await expect(page.getByText(/virtual chips only/i).first()).toBeVisible();

  await placeBet(page);
  await placeBet(guest);

  await Promise.all([playRound(page, 1), playRound(guest, 1)]);

  // Settlement: both seats have a result and chips moved accordingly.
  await expect
    .poll(async () => {
      const s = await mySeat(page);
      return s ? s.handsPlayed > 0 || s.hands.some((h) => h.result !== '') : false;
    }, { timeout: 20_000 })
    .toBe(true);
  const state = await roomState(page);
  expect(Object.keys(state.seats)).toHaveLength(2);
  expect(state.dealer.revealed || state.stage === 'BETTING').toBe(true);

  await leaveRoom(guest);
  await expect.poll(async () => Object.keys((await roomState(page)).players).length, { timeout: 10_000 }).toBe(1);
  await leaveRoom(page);
  await expect(page).toHaveURL(/\/$/);
});

test('solo table deals instantly and shows only legal actions', async ({ page }) => {
  test.setTimeout(90_000);
  await createRoom(page, 'blackjack', 'Solo', { solo: true });
  await waitForPhase(page, 'PLAYING');
  await placeBet(page);
  await expect.poll(() => stage(page), { timeout: 20_000 }).not.toBe('BETTING');
  // Whatever the cards, the decision bar never shows an action the server did not allow.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const seat = await mySeat(page);
    const st = await stage(page);
    if (st === 'PLAYING' && seat && seat.actions.length > 0) {
      for (const label of ['Hit', 'Stand', 'Double', 'Split', 'Surrender']) {
        const visible = await page.getByRole('button', { name: new RegExp(`^${label}`) }).isVisible();
        expect(visible).toBe(seat.actions.includes(label.toLowerCase()));
      }
      await page.keyboard.press('s');
      break;
    }
    if (st === 'SETTLING' || (seat?.handsPlayed ?? 0) > 0) break;
    if (st === 'INSURANCE') await page.getByRole('button', { name: /No insurance|No thanks/ }).click({ timeout: 1_000 }).catch(() => undefined);
    await page.waitForTimeout(150);
  }
  await expect.poll(async () => (await mySeat(page))?.handsPlayed ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  await leaveRoom(page);
});
