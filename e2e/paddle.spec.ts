import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers';

const court = (page: Page) => page.locator('canvas.pd-canvas');
const serverY = async (page: Page) => Number((await court(page).getAttribute('data-server-y')) ?? 'NaN');

async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test.describe('Pixel Paddle', () => {
  test('solo vs the house: pick a level, steer, serve, pause, restart, back to Classics', async ({ page, isMobile }) => {
    test.setTimeout(90_000);
    await createRoom(page, 'paddle', 'Solo', { solo: true });
    const me = (await myPlayerId(page))!;
    const play = page.getByRole('button', { name: 'Play the house' });
    await expect(play).toBeVisible();
    await page.getByRole('radio', { name: 'Rookie' }).click();
    await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).ai).toBe('rookie');
    await play.click();
    await expect.poll(async () => (await roomState(page))?.standings?.[me]?.status).toBe('playing');
    expect((await roomState(page)).left.playerId).toBe(me);
    // READY lead-in, then steer: the server moves our paddle towards the target.
    await page.waitForTimeout(1_900);
    await expect.poll(() => serverY(page)).toBeGreaterThan(0);
    const y0 = await serverY(page);
    await holdKey(page, 'KeyW', 700);
    await expect.poll(() => serverY(page), { timeout: 10_000 }).toBeLessThan(y0 - 100);
    // Serve (ours) or wait for the house's serve: the ball goes into play.
    if (isMobile) await page.getByRole('button', { name: 'Serve' }).click();
    else await page.keyboard.press('Space');
    await expect.poll(async () => (await roomState(page)).match.status, { timeout: 15_000 }).toMatch(/play|point/);
    // Pause and resume from the header.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(async () => (await roomState(page)).match.paused).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    // Restart from the pause card = a fresh game.
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect.poll(async () => (await roomState(page)).match.matchId, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => (await roomState(page)).standings[me].status).toBe('playing');
    // Back to the Classics cabinet.
    await page.getByRole('button', { name: 'Back to Classics' }).first().click();
    await page.waitForURL(/\/cabinet\/classics/);
  });

  test('network duel: two players steer; leaving forfeits and shows results', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const code = await createRoom(page, 'paddle', 'Host');
    const guest = await joinRoom(browser, code, 'Guest');
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);
    await startGame(page);
    await waitForPhase(page, 'PLAYING', 20_000);
    const s = await roomState(page);
    const hostId = (await myPlayerId(page))!;
    const guestId = (await myPlayerId(guest))!;
    expect([s.left.playerId, s.right.playerId].sort()).toEqual([hostId, guestId].sort());
    await page.waitForTimeout(600);
    const y0 = await serverY(page);
    await holdKey(page, 'KeyS', 700);
    await expect.poll(() => serverY(page), { timeout: 10_000 }).toBeGreaterThan(y0 + 100);
    // The guest walks away mid-game: the host wins by forfeit.
    await leaveRoom(guest);
    await guest.context().close();
    await waitForPhase(page, 'RESULTS', 20_000);
    expect((await roomState(page)).match.reason).toBe('forfeit');
    await expect(page.getByRole('button', { name: 'Rematch' })).toBeVisible();
    await leaveRoom(page);
  });
});
