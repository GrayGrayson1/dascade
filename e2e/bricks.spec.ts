import { expect, test } from '@playwright/test';
import { backToClassics, myStanding, openSoloFromPicker, pressStart } from './classics-helpers';

test.describe('Brick Blitz', () => {
  test('solo from the Classics picker: launch, break a brick (server-verified), pause, retry, back to Classics', async ({ page }, info) => {
    test.setTimeout(120_000);
    await openSoloFromPicker(page, /Brick Blitz/i, 'bricks');
    await pressStart(page);
    await expect(page.getByRole('img', { name: 'Brick Blitz playfield' })).toBeVisible();
    const mobile = info.project.name.startsWith('mobile');
    if (mobile) await page.getByRole('button', { name: 'Launch or fire' }).tap();
    else await page.keyboard.press('Space');
    // The first flight reaches the wall of bricks; the server's replay scores it.
    await expect.poll(async () => (await myStanding(page))?.stat ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
    const s = await myStanding(page);
    expect(s.score).toBeGreaterThanOrEqual(50);
    // Move the paddle a little (keyboard / on-screen button).
    if (mobile) await page.getByRole('button', { name: 'Move right' }).tap();
    else {
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(200);
      await page.keyboard.up('ArrowRight');
    }

    // Pause → Restart (retry) starts a fresh run.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Restart' }).click();
    await expect.poll(async () => (await myStanding(page))?.runs, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => (await myStanding(page))?.score, { timeout: 10_000 }).toBe(0);

    await backToClassics(page);
    await expect(page.getByRole('link', { name: /Brick Blitz/i }).first()).toBeVisible();
  });
});
