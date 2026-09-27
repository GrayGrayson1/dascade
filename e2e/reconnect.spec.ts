/**
 * Reconnection UX (shared shell): a Wi-Fi blip mid-match must never cost a player their seat.
 *   RECONNECTING… (stage inert, Leave reachable) → RECONNECTED → same seat, match continues.
 *   Auto-reconnect gives up → "Connection lost" → "Rejoin my seat" (seat-token rejoin).
 *   Device offline → rejoins by itself when the network returns.
 * Uses the Wheel cabinet (solo-capable, instant start); only shared behaviour is asserted.
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom, dropConnection, joinRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

const GAME = 'wheel';

async function startMatch(page: Page): Promise<void> {
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
}

test.describe('reconnection UX mid-match', () => {
  test('a dropped socket shows RECONNECTING, then RECONNECTED, and the same seat keeps playing', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Wobbly');
    const guest = await joinRoom(browser, code, 'Watcher');
    await startMatch(page);
    await waitForPhase(guest, 'PLAYING');
    const before = await myPlayerId(page);

    await dropConnection(page, { minDelay: 3000 });

    // Prominent reconnecting state; the stage is inert but Leave stays reachable.
    const card = page.getByRole('alert').filter({ hasText: 'reconnecting you to your seat' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Reconnecting…' })).toBeVisible();
    await expect(card).toContainText(/seat is held for/);
    await expect(page.locator('main.game-stage')).toHaveAttribute('inert', '');
    await expect(card.getByRole('button', { name: 'Leave' })).toBeVisible();
    // Everyone else sees the seat as temporarily disconnected, not gone.
    await expect.poll(async () => (await roomState(guest)).players[before!]?.connected).toBe(false);

    // Clear confirmation, same seat, same match.
    await expect(page.getByRole('status').filter({ hasText: 'Reconnected!' })).toBeVisible();
    await expect(card).toBeHidden();
    await expect(page.locator('main.game-stage')).not.toHaveAttribute('inert', '');
    expect(await myPlayerId(page)).toBe(before);
    expect((await roomState(page)).phase).toBe('PLAYING');
    await expect.poll(async () => (await roomState(guest)).players[before!]?.connected).toBe(true);

    // The reconnected host can act again: the spin reaches every screen.
    await page.getByRole('button', { name: 'Spin the wheel' }).click();
    await expect.poll(async () => (await roomState(guest)).spin?.spinId, { timeout: 10_000 }).toBe(1);
    await guest.context().close();
  });

  test('when auto-reconnect gives up, "Rejoin my seat" puts the player back into the running match', async ({ page }) => {
    await createRoom(page, GAME, 'Flaky');
    await startMatch(page);
    const before = await myPlayerId(page);

    await dropConnection(page, { maxRetries: 0 });

    const lost = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Connection lost' }) });
    await expect(lost).toBeVisible();
    await expect(lost).toContainText('Wheel of DAStiny');
    await expect(lost.getByRole('button', { name: 'Back to arcade' })).toBeVisible();
    await lost.getByRole('button', { name: 'Rejoin my seat' }).click();

    await expect(page.locator('main.game-stage')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Reconnected!' })).toBeVisible();
    expect(await myPlayerId(page)).toBe(before);
    await waitForPhase(page, 'PLAYING');
    await expect(page.getByRole('button', { name: 'Spin the wheel' })).toBeEnabled();
  });

  test('going offline mid-match rejoins by itself when the network comes back', async ({ page }) => {
    await createRoom(page, GAME, 'Commuter');
    await startMatch(page);
    const before = await myPlayerId(page);

    // Let the SDK give up at once instead of retrying for the whole grace period.
    await page.evaluate(() => {
      const room = (window as any).__DASCADE__.session.room;
      room.reconnection.minUptime = 0;
      room.reconnection.maxRetries = 0;
    });
    await page.context().setOffline(true);
    // Chromium drops the socket with the network; WebKit's offline emulation keeps idle sockets open,
    // so force the drop there (a no-op when it already happened).
    await page.evaluate(() => (window as any).__DASCADE__.session.room?.connection.transport.ws.close(4010));
    const lost = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Connection lost' }) });
    await expect(lost).toBeVisible();
    await expect(lost).toContainText('You’re offline');

    // No click needed: the seat is reclaimed as soon as the device is back online.
    await page.context().setOffline(false);
    await expect(page.locator('main.game-stage')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Reconnected!' })).toBeVisible();
    expect(await myPlayerId(page)).toBe(before);
    await waitForPhase(page, 'PLAYING');
  });
});
