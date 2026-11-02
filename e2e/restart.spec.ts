/**
 * After a restart (a deploy) an ordinary room is gone for good: the "arcade restarted" screen offers a
 * new room of the same game (a full load, which also picks up the new build) and never promises a
 * reconnect. The server's warning before the restart is covered by test/shutdown-notice.test.ts.
 */
import { expect, test } from '@playwright/test';
import { createRoom } from './helpers.ts';

test('the "arcade restarted" screen offers a new room of the same game', async ({ page }) => {
  await createRoom(page, 'wheel', 'Restarted');

  // The socket closes the way a server shutdown closes it (4001).
  await page.evaluate(() => (window as any).__DASCADE__.session.room.connection.transport.ws.close(4001));

  const screen = page.locator('[data-part="error-screen"]');
  await expect(screen.getByRole('heading', { name: 'The arcade restarted' })).toBeVisible();
  await expect(screen).not.toContainText(/reconnect/i);
  await expect(screen.getByRole('button', { name: 'Back to arcade' })).toBeVisible();

  await screen.getByRole('button', { name: 'New Wheel of DAStiny room' }).click();
  await page.waitForURL(/\/play\/wheel$/);
  await expect(page.getByRole('button', { name: 'Create game' })).toBeVisible();
});
