import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers';

const belt = (page: Page) => page.locator('canvas.as-canvas');
const shots = async (page: Page) => Number((await belt(page).getAttribute('data-shots')) ?? '0');
const pos = async (page: Page) => (await belt(page).getAttribute('data-pos')) ?? '';

/** Fire for a moment: Space on desktop, the on-screen Fire button (held) on phones. */
async function fire(page: Page, isMobile: boolean, ms = 700): Promise<void> {
  if (isMobile) {
    const box = await page.getByRole('button', { name: 'Fire' }).boundingBox();
    if (!box) throw new Error('Fire button missing');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
    return;
  }
  await page.keyboard.down('Space');
  await page.waitForTimeout(ms);
  await page.keyboard.up('Space');
}

test.describe('Asteroid Run', () => {
  test('solo: launch, fly, fire (server-confirmed shots), pause, restart, back to Classics', async ({ page, isMobile }) => {
    test.setTimeout(90_000);
    await createRoom(page, 'asteroids', 'Solo', { solo: true });
    const me = (await myPlayerId(page))!;
    await page.getByRole('button', { name: 'Launch' }).click();
    await expect.poll(async () => (await roomState(page))?.standings?.[me]?.status).toBe('playing');
    await page.waitForTimeout(1_800);
    await expect.poll(() => pos(page)).not.toBe('');
    const start = await pos(page);
    await page.keyboard.down('ArrowUp');
    await fire(page, isMobile, 800);
    await page.keyboard.up('ArrowUp');
    await expect.poll(() => shots(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => pos(page), { timeout: 10_000 }).not.toBe(start);
    expect((await roomState(page)).run.wave).toBe(1);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect.poll(async () => (await roomState(page)).run.paused).toBe(true);
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect.poll(async () => (await roomState(page)).run.matchId, { timeout: 10_000 }).toBe(2);
    await page.getByRole('button', { name: 'Back to Classics' }).first().click();
    await page.waitForURL(/\/cabinet\/classics/);
  });

  test('co-op: two pilots launch together and fire', async ({ page, browser, isMobile }) => {
    test.setTimeout(120_000);
    const code = await createRoom(page, 'asteroids', 'Lead');
    const guest = await joinRoom(browser, code, 'Wing');
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);
    await startGame(page);
    await waitForPhase(page, 'PLAYING', 20_000);
    const s = await roomState(page);
    expect(Object.keys(s.pilots)).toHaveLength(2);
    expect(s.run.coop).toBe(true);
    await page.waitForTimeout(600);
    await fire(page, isMobile, 700);
    await expect.poll(() => shots(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });
});
