/**
 * Shared shell polish: cabinet context in the lobby, clear room status, results → "Back to cabinet",
 * dismissible toasts. Only shared shell behaviour is asserted.
 */
import { expect, test } from '@playwright/test';
import { createRoom, roomState, startGame, waitForPhase } from './helpers.ts';

test('the lobby shows its cabinet, seats and lock state', async ({ page }) => {
  await createRoom(page, 'holdem', 'Dealer');
  const crumb = page.getByRole('navigation', { name: 'You are here' });
  await expect(crumb).toContainText('DASino');
  await expect(crumb).toContainText('Hold');
  const status = page.getByRole('list', { name: 'Room status' });
  await expect(status).toContainText(/1\/\d+ seats/);
  await expect(status).toContainText('Open to join');
  await expect(page.getByRole('img', { name: /1 of \d+ seats taken · 1 more needed to start/ })).toBeVisible();

  await page.evaluate(() => (window as any).__DASCADE__.session.lobby.room({ locked: true }));
  await expect.poll(async () => (await roomState(page)).locked).toBe(true);
  await expect(status).toContainText('Locked');
  await expect(page.locator('.player-list')).toContainText('Room locked — no new players');
  if ((page.viewportSize()?.width ?? 1000) > 720)
    await expect(page.locator('.topbar').getByRole('img', { name: 'Room locked' })).toBeVisible();
});

test('results offer "Back to cabinet", which leaves the room for the cabinet title screen', async ({ page }) => {
  await createRoom(page, 'wheel', 'Spinner');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await page.getByRole('button', { name: 'End session' }).click();
  await page.getByRole('button', { name: 'Show the summary' }).click();
  await waitForPhase(page, 'RESULTS');
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to cabinet' }).click();
  await page.waitForURL((url) => url.pathname === '/play/wheel');
  await expect(page.getByRole('button', { name: 'Create game' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__DASCADE__.store.getState().room)).toBeNull();
});

test('toasts can be dismissed with their close button', async ({ page }) => {
  await createRoom(page, 'wheel', 'Toaster');
  // Copying the code shows a toast (success, or the code itself when the clipboard is blocked).
  await page.locator('.lobby-code__value').click();
  const toast = page.locator('.dc-toast').first();
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(page.locator('.dc-toast')).toHaveCount(0);
});
