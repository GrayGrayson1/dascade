/**
 * Reconnection UX (shared shell): a Wi-Fi blip must never cost a player their seat.
 *   RECONNECTING… (stage inert, Leave reachable) → RECONNECTED → same seat, match continues.
 *   Auto-reconnect gives up → the seat is taken back by token by itself → RECONNECTED.
 *   That fails too (offline) → "Connection lost" → "Rejoin my seat", and by itself once back online.
 *   Half-open drops (the network died, the server still sees the socket; the Oct 29 drops), in ordinary
 *   rooms and in an event room.
 * Mid-match cases use the Wheel cabinet (solo-capable, instant start); only shared behaviour is asserted.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  createRoom,
  dropConnection,
  joinRoom,
  myPlayerId,
  mySessionId,
  roomState,
  startGame,
  tapSockets,
  waitForPhase,
} from './helpers.ts';

const GAME = 'wheel';

async function startMatch(page: Page): Promise<void> {
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
}

const reconnectingCard = (page: Page) => page.getByRole('alert').filter({ hasText: 'reconnecting you to your seat' });
const reconnectedFlash = (page: Page) => page.getByRole('status').filter({ hasText: 'Reconnected!' });
const rawReconnectToast = (page: Page) => page.locator('[data-part="toast"]').filter({ hasText: /failed to reconnect/i });

test.describe('reconnection UX mid-match', () => {
  test('a dropped socket shows RECONNECTING, then RECONNECTED, and the same seat keeps playing', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Wobbly');
    const guest = await joinRoom(browser, code, 'Watcher');
    await startMatch(page);
    await waitForPhase(guest, 'PLAYING');
    const before = await myPlayerId(page);

    await dropConnection(page, { minDelay: 3000 });

    // Prominent reconnecting state; the stage is inert but Leave stays reachable.
    const card = reconnectingCard(page);
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Reconnecting…' })).toBeVisible();
    await expect(card).toContainText(/seat is held for/);
    await expect(page.locator('main.game-stage')).toHaveAttribute('inert', '');
    await expect(card.getByRole('button', { name: 'Leave' })).toBeVisible();
    // Everyone else sees the seat as temporarily disconnected, not gone.
    await expect.poll(async () => (await roomState(guest)).players[before!]?.connected).toBe(false);

    // Clear confirmation, same seat, same match.
    await expect(reconnectedFlash(page)).toBeVisible();
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

  test('when auto-reconnect gives up, the seat is taken back by itself and the match carries on', async ({ page }) => {
    await createRoom(page, GAME, 'Flaky');
    await startMatch(page);
    const before = await myPlayerId(page);

    await dropConnection(page, { maxRetries: 0 });

    // No "Connection lost" stop and no click: the seat token brings the same seat back.
    await expect(reconnectedFlash(page)).toBeVisible();
    await expect(page.locator('main.game-stage')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connection lost' })).toHaveCount(0);
    expect(await myPlayerId(page)).toBe(before);
    await waitForPhase(page, 'PLAYING');
    await expect(page.getByRole('button', { name: 'Spin the wheel' })).toBeEnabled();
  });

  test('going offline mid-match shows "Connection lost", and rejoins by itself when the network comes back', async ({ page }) => {
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
    // The automatic seat rejoin can't reach the server either: "Connection lost", not "The arcade is offline".
    const lost = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Connection lost' }) });
    await expect(lost).toBeVisible();
    await expect(lost).toContainText('You’re offline');
    await expect(lost).toContainText('Wheel of DAStiny');
    await expect(lost.getByRole('button', { name: 'Back to arcade' })).toBeVisible();

    // "Rejoin my seat" while still offline fails gently: the same screen, still ready to retry.
    await lost.getByRole('button', { name: 'Rejoin my seat' }).click();
    await expect(lost.getByRole('button', { name: 'Rejoin my seat' })).toBeEnabled();
    await expect(lost).toContainText('You’re offline');

    // No click needed: the seat is reclaimed as soon as the device is back online.
    await page.context().setOffline(false);
    await expect(page.locator('main.game-stage')).toBeVisible();
    await expect(reconnectedFlash(page)).toBeVisible();
    expect(await myPlayerId(page)).toBe(before);
    await waitForPhase(page, 'PLAYING');
  });
});

test.describe('half-open drops (the network died, the server still sees the socket)', () => {
  test('an ordinary lobby gets the same session back once the server ends the stale socket', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const tap = await tapSockets(page);
    const code = await createRoom(page, 'chess', 'Wobbly');
    const guest = await joinRoom(browser, code, 'Watcher');
    const playerId = await myPlayerId(page);
    const sessionId = await mySessionId(page);
    await expect.poll(async () => Object.keys((await roomState(guest)).players ?? {}).length).toBe(2);

    const drop = await tap.dropHalfOpen();
    await expect(reconnectingCard(page)).toBeVisible();
    // The auto-reconnect is parked until the server lets go of the old socket. Wait past Colyseus' default
    // seat reservation (15 s), which used to refuse it (close 4003) and strand the player.
    await page.waitForTimeout(16_000);
    await expect(reconnectingCard(page)).toBeVisible();
    await drop.endServerSide(); // what the heartbeat does 15–20 s after a real network dies

    await expect(reconnectedFlash(page)).toBeVisible();
    // The same session, not a seat rejoin: nothing remounted.
    expect(await mySessionId(page)).toBe(sessionId);
    expect(await myPlayerId(page)).toBe(playerId);
    await expect(rawReconnectToast(page)).toHaveCount(0);
    await expect.poll(async () => (await roomState(guest)).players[playerId!]?.connected).toBe(true);
    expect(Object.keys((await roomState(guest)).players)).toHaveLength(2);
    await guest.context().close();
  });

  test('when the server never notices, the seat comes back by token by itself (no stranger, no spectator)', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const tap = await tapSockets(page);
    const code = await createRoom(page, 'bingo', 'Faraway');
    const guest = await joinRoom(browser, code, 'Watcher');
    const playerId = await myPlayerId(page);
    await expect.poll(async () => Object.keys((await roomState(guest)).players ?? {}).length).toBe(2);

    // Never ended: as if a proxy kept the server's side of the socket alive.
    await tap.dropHalfOpen();
    await expect(reconnectingCard(page)).toBeVisible();

    // The parked reconnect is refused after the seat reservation (30 s); the seat comes back by token.
    await expect(reconnectedFlash(page)).toBeVisible({ timeout: 45_000 });
    expect(await myPlayerId(page)).toBe(playerId);
    await expect(rawReconnectToast(page)).toHaveCount(0);
    await expect(page.locator('.lobby')).toBeVisible();
    await expect.poll(async () => (await roomState(guest)).players[playerId!]?.connected).toBe(true);
    const players = Object.values((await roomState(guest)).players) as Array<{ spectator: boolean }>;
    expect(players).toHaveLength(2);
    expect(players.some((p) => p.spectator)).toBe(false);
    await guest.context().close();
  });

  test('an event room still comes back through its own recovery screen, as before', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop console.');
    test.setTimeout(90_000);
    const tap = await tapSockets(page);
    await createRoom(page, 'showdown', 'Host');
    // Load the event preset: the room becomes an event room this device waits for.
    const settingsTab = page.getByRole('tab', { name: 'Settings' });
    if (await settingsTab.isVisible()) await settingsTab.click();
    await page.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
    await expect.poll(async () => (await roomState(page)).event).toBe('dasoween-rehearsal');
    const playerId = await myPlayerId(page);
    const sessionId = await mySessionId(page);

    await tap.dropHalfOpen();
    await expect(reconnectingCard(page)).toBeVisible();
    // Event rooms fall back to their seat after about 10 s, through the show's recovery screen (ShowRecovery):
    // well before the 35 s safety net other rooms use, so this is still the event path.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const d = (window as any).__DASCADE__;
            return d.store.getState().status === 'connected' ? (d.session.room?.sessionId ?? null) : null;
          }),
        { timeout: 25_000 },
      )
      .not.toBeNull();
    expect(await mySessionId(page)).not.toBe(sessionId);
    expect(await myPlayerId(page)).toBe(playerId);
    expect((await roomState(page)).event).toBe('dasoween-rehearsal');
  });
});
