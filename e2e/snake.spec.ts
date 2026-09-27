import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers';

const arena = (page: Page) => page.locator('canvas.sn-canvas');
const serverDir = async (page: Page) => (await arena(page).getAttribute('data-dir')) ?? '';

/**
 * Turn the snake "up" in arena terms. Desktop: the ↑ key. Phones (portrait) see the arena on its
 * side, so arena-up is the on-screen LEFT button.
 */
async function turnUp(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) await page.getByRole('button', { name: 'Turn left' }).click();
  else await page.keyboard.press('ArrowUp');
}

test.describe('Neon Snake', () => {
  test('solo run: start, turn, crash into a wall, run again, back to Classics', async ({ page, isMobile }) => {
    test.setTimeout(90_000);
    await createRoom(page, 'snake', 'Solo', { solo: true });
    const me = (await myPlayerId(page))!;
    await page.getByRole('button', { name: 'Start run' }).click();
    await expect.poll(async () => (await roomState(page))?.match?.status, { timeout: 10_000 }).toBe('running');
    await expect.poll(() => serverDir(page)).toBe('1'); // heading right
    await turnUp(page, isMobile);
    // The server applied the turn …
    await expect.poll(() => serverDir(page), { timeout: 5_000 }).toBe('0');
    // … and heading straight up ends in the top wall: a verified game over.
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/Final score/)).toBeVisible();
    expect((await roomState(page)).standings[me].status).toBe('over');
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect.poll(async () => (await roomState(page)).match.matchId, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => (await roomState(page)).standings[me].status).toBe('playing');
    await page.getByRole('button', { name: 'Back to Classics' }).first().click();
    await page.waitForURL(/\/cabinet\/classics/);
  });

  test('arena: two snakes race, a turn is applied by the server, then leave', async ({ page, browser, isMobile }) => {
    test.setTimeout(120_000);
    const code = await createRoom(page, 'snake', 'Host');
    const guest = await joinRoom(browser, code, 'Guest');
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);
    await startGame(page);
    await waitForPhase(page, 'PLAYING', 20_000);
    await expect.poll(async () => (await roomState(page)).match.status, { timeout: 10_000 }).toBe('running');
    const s = await roomState(page);
    expect(Object.keys(s.snakes)).toHaveLength(2);
    const hostId = (await myPlayerId(page))!;
    expect(s.snakes[hostId].alive).toBe(true);
    await expect.poll(() => serverDir(page)).toMatch(/[13]/);
    await turnUp(page, isMobile);
    await expect.poll(() => serverDir(page), { timeout: 5_000 }).toBe('0');
    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });
});
