import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers';

async function myId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__DASCADE__?.store.getState().playerId as string);
}

async function distance(page: Page, playerId: string): Promise<number> {
  const s = await roomState(page);
  return s?.racers?.[playerId]?.distance ?? -1e9;
}

async function openSetup(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Your setup' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

test.describe('DASh Circuit', () => {
  test('customize, race with a second player, make progress, leave', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const code = await createRoom(page, 'circuit', 'Host');
    const hostId = await myId(page);

    // Customize the car in the lobby.
    await openSetup(page);
    await page.getByRole('radio', { name: 'Comet chassis' }).click();
    await page.getByRole('radio', { name: 'Flames' }).click();
    const plate = page.getByLabel('Nameplate');
    await plate.fill('E2E');
    await plate.blur();
    await expect.poll(async () => (await roomState(page))?.cars?.[hostId]?.chassis, { timeout: 10_000 }).toBe('comet');
    await expect.poll(async () => (await roomState(page))?.cars?.[hostId]?.nameplate, { timeout: 10_000 }).toBe('E2E');

    // Second player joins.
    const guest = await joinRoom(browser, code, 'Guest');
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);

    await startGame(page);
    await waitForPhase(page, 'COUNTDOWN');
    await expect(page.getByRole('img', { name: 'Race view' })).toBeVisible();
    await waitForPhase(page, 'PLAYING', 20_000);
    const before = await distance(page, hostId);

    // Hold the throttle for a few seconds.
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3500);
    await page.keyboard.up('KeyW');

    // Server-side progress increased (the client only sends inputs).
    await expect.poll(async () => (await distance(page, hostId)) - before, { timeout: 10_000 }).toBeGreaterThan(400);
    const s = await roomState(page);
    expect(s.race.status).toBe('racing');
    expect(Object.keys(s.racers).length).toBe(2);
    await expect(page.getByLabel('Speedometer')).toBeVisible();
    await expect(page.getByRole('img', { name: /Track map/ })).toBeVisible();

    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });

  test('solo time trial starts immediately and the car drives', async ({ page }) => {
    test.setTimeout(90_000);
    await createRoom(page, 'circuit', 'Solo', { solo: true });
    const me = await myId(page);
    await waitForPhase(page, 'PLAYING', 20_000);
    const s0 = await roomState(page);
    expect(s0.race.solo).toBe(true);
    expect(s0.locked).toBe(true);
    const before = await distance(page, me);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3000);
    await page.keyboard.up('ArrowUp');
    await expect.poll(async () => (await distance(page, me)) - before, { timeout: 10_000 }).toBeGreaterThan(400);
    await leaveRoom(page);
  });
});
