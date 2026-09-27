import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers';

async function mySeat(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as any;
    const id = w.__DASCADE__?.store.getState().playerId;
    const state = w.__DASCADE__?.getState();
    return state?.seats?.findIndex((s: any) => s.playerId === id) ?? -1;
  });
}

/** Whoever is to act presses Check (or Call) in the action bar. */
async function actOnce(pages: Page[]): Promise<void> {
  const state = await roomState(pages[0]!);
  for (const page of pages) {
    if ((await mySeat(page)) !== state.toActSeat) continue;
    const bar = page.locator('.hd-actions');
    const check = bar.getByRole('button', { name: /^Check/ });
    const button = (await check.count()) ? check : bar.getByRole('button', { name: /^Call/ });
    await expect(button).toBeEnabled();
    await button.click();
    await expect.poll(async () => (await roomState(pages[0]!)).actionSeq).toBeGreaterThan(state.actionSeq);
    return;
  }
}

test("DAS Hold'em smoke: create, join, start, play a hand to the pot award, leave", async ({ page, browser }) => {
  const code = await createRoom(page, 'holdem', 'Hostess');
  const guest = await joinRoom(browser, code, 'Guest');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');

  // Both players see a dealt hand: hole cards for themselves, blinds posted, a pot in the middle.
  await expect(page.getByTestId('holdem-pot')).toHaveText('150');
  const start = await roomState(page);
  expect(start.seats.filter((s: any) => s.inHand)).toHaveLength(2);
  expect(start.seats.reduce((sum: number, s: any) => sum + s.stack + s.committed, 0)).toBe(20_000);

  // The player to act sees only legal actions with amounts (heads-up: the button calls 50 more).
  const pages = [page, guest];
  const actor = (await mySeat(page)) === start.toActSeat ? page : guest;
  const bar = actor.locator('.hd-actions');
  await expect(bar.getByRole('button', { name: 'Fold' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Call 50' })).toBeVisible();
  // Short screens (e.g. iPhone 14, ≤ 800px tall) collapse the sizing panel: "Raise 200 +" opens it.
  await expect(bar.getByRole('button', { name: /^Raise (to )?200/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Check/ })).toHaveCount(0);

  // Call, then check it down to the showdown.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const s = await roomState(page);
    if (s.winners.length > 0) break;
    if (s.toActSeat < 0) {
      await page.waitForTimeout(250);
      continue;
    }
    await actOnce(pages);
  }
  await expect.poll(async () => (await roomState(page)).winners.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // Pot awarded: 200 in total goes to the winner(s), chips are conserved, the winner banner shows.
  const done = await roomState(page);
  expect(done.winners.reduce((sum: number, w: any) => sum + w.amount, 0)).toBe(200);
  expect(done.seats.reduce((sum: number, s: any) => sum + s.stack, 0)).toBe(20_000);
  await expect(page.locator('.hd-winner')).toContainText(/wins 200|wins 100/);

  // The next hand deals automatically.
  await expect.poll(async () => (await roomState(page)).handNumber, { timeout: 15_000 }).toBe(2);

  await leaveRoom(guest);
  await leaveRoom(page);
  await expect(page).toHaveURL(/\/$/);
});

test("DAS Hold'em: a fold ends the hand and the pot goes to the other player", async ({ page, browser }) => {
  const code = await createRoom(page, 'holdem', 'Folder');
  const guest = await joinRoom(browser, code, 'Taker');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await expect.poll(async () => (await roomState(page)).toActSeat).toBeGreaterThanOrEqual(0);
  const start = await roomState(page);
  const actor = (await mySeat(page)) === start.toActSeat ? page : guest;
  const other = actor === page ? guest : page;
  await actor.locator('.hd-actions').getByRole('button', { name: 'Fold' }).click();
  await expect.poll(async () => (await roomState(page)).winners.length).toBe(1);
  const done = await roomState(page);
  expect(done.winners[0].amount).toBe(100);
  expect(done.winners[0].seat).toBe(await mySeat(other));
  await expect(other.locator('.hd-seat--me .hd-seat__status')).toHaveText(/Wins 100/i);
  await leaveRoom(guest);
  await leaveRoom(page);
});
