/**
 * Platform E2E: the shared lobby / room lifecycle that every cabinet relies on.
 * Uses the Wheel cabinet's lobby, but only exercises shared behaviour.
 */
import { expect, test } from '@playwright/test';
import { createRoom, dropConnection, joinRoom, myPlayerId, roomState, setName } from './helpers.ts';

const GAME = 'wheel';

test.describe('shared room lifecycle', () => {
  test('create, share code, join, see each other, ready up', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Hosty');
    await expect(page.locator('.lobby-code__value')).toContainText(code.split('').join(''));
    const guest = await joinRoom(browser, code, 'Guesty');
    await expect(page.locator('.player-list')).toContainText('Guesty');
    await expect(guest.locator('.player-list')).toContainText('Hosty');
    await guest.getByRole('button', { name: 'Ready up' }).click();
    await expect(page.locator('.player-list__item.is-ready')).toContainText('Guesty');
    await guest.context().close();
  });

  test('refreshing the page resumes the same seat', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Hosty');
    const guest = await joinRoom(browser, code, 'Refresher');
    const before = await guest.evaluate(() => (window as any).__DASCADE__.store.getState().playerId);
    await guest.reload();
    await expect(guest.locator('.lobby')).toBeVisible();
    await expect.poll(() => guest.evaluate(() => (window as any).__DASCADE__.store.getState().playerId)).toBe(before);
    const state = await roomState(page);
    expect(Object.keys(state.players)).toHaveLength(2);
    await guest.context().close();
  });

  test('host leaving migrates host to the next player', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'OldHost');
    const guest = await joinRoom(browser, code, 'NextHost');
    await page.evaluate(() => (window as any).__DASCADE__.session.leaveRoom());
    await expect(guest.getByRole('button', { name: /Start game|Need/ })).toBeVisible();
    const state = await roomState(guest);
    const me = await guest.evaluate(() => (window as any).__DASCADE__.store.getState().playerId);
    expect(state.hostId).toBe(me);
    await guest.context().close();
  });

  test('host can remove a player, who sees a friendly screen', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Boss');
    const guest = await joinRoom(browser, code, 'Kickme');
    await page.getByRole('button', { name: 'Manage Kickme' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(guest.getByText('Removed from room')).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Back to arcade' })).toBeVisible();
    await guest.context().close();
  });

  test('locked rooms reject newcomers with a friendly error', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Locker');
    if ((page.viewportSize()?.width ?? 1000) < 760) await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByText('Room open to new players').click();
    await expect.poll(async () => (await roomState(page)).locked).toBe(true);
    const ctx = await browser.newContext();
    const late = await ctx.newPage();
    await late.goto(`/room/${code}`);
    await setName(late, 'Latecomer');
    await late.getByRole('button', { name: 'Join game' }).click();
    await expect(late.getByText('Room is locked')).toBeVisible();
    await ctx.close();
  });

  test('bad and unknown room codes are handled gracefully', async ({ page }) => {
    await page.goto('/room/0O1IL');
    await expect(page.getByText('That code doesn’t look right')).toBeVisible();
    await page.goto('/room/ZZZZZ');
    await setName(page, 'Wanderer');
    await expect(page.getByText('No room is using this code right now.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join game' })).toBeDisabled();
  });

  test('room chat works in the lobby', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Chatter');
    const guest = await joinRoom(browser, code, 'Listener');
    const isMobile = (page.viewportSize()?.width ?? 1000) < 760;
    if (isMobile) await page.getByRole('tab', { name: 'Chat' }).click();
    await page.getByLabel('Chat message').fill('hello team <b>bold</b>');
    await page.getByRole('button', { name: 'Send message' }).click();
    if (isMobile) await guest.getByRole('tab', { name: 'Chat' }).click();
    await expect(guest.getByRole('log', { name: 'Room chat' })).toContainText('hello team <b>bold</b>');
    await guest.context().close();
  });
});

test.describe('connection loss and error states', () => {
  test('a dropped connection shows the banner, freezes the stage, then resumes the same seat', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Wobbly');
    const guest = await joinRoom(browser, code, 'Watcher');
    const before = await myPlayerId(page);
    await dropConnection(page, { minDelay: 1500 });
    await expect(page.getByRole('alert').filter({ hasText: 'reconnecting you to your seat' })).toBeVisible();
    await expect(page.locator('main.game-stage')).toHaveAttribute('inert', '');
    await expect(guest.locator('.player-list')).toContainText('Reconnecting');
    await expect(page.getByText('Reconnected!')).toBeVisible();
    await expect(page.locator('main.game-stage')).not.toHaveAttribute('inert', '');
    expect(await myPlayerId(page)).toBe(before);
    expect(Object.keys((await roomState(guest)).players)).toHaveLength(2);
    await guest.context().close();
  });

  test('when auto-reconnect gives up, "Try again" reclaims the same seat without a reload', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Host');
    const guest = await joinRoom(browser, code, 'Flaky');
    const before = await myPlayerId(guest);
    await dropConnection(guest, { maxRetries: 0 });
    await expect(guest.getByText('Connection lost')).toBeVisible();
    await guest.getByRole('button', { name: 'Try again' }).click();
    await expect(guest.locator('.lobby')).toBeVisible();
    expect(await myPlayerId(guest)).toBe(before);
    await expect.poll(async () => Object.keys((await roomState(page)).players).length).toBe(2);
    await guest.context().close();
  });

  test('leaving while reconnecting is immediate', async ({ page }) => {
    await createRoom(page, GAME, 'Quitter');
    await dropConnection(page, { minDelay: 20_000 });
    await expect(page.getByRole('alert').filter({ hasText: 'reconnecting' })).toBeVisible();
    const started = Date.now();
    await page.locator('.topbar').getByRole('button', { name: 'Leave room' }).click();
    await page.locator('.topbar').getByRole('button', { name: 'Leave room' }).click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 5000 });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test('server unavailable when creating is explained and recoverable', async ({ page }) => {
    await page.route('**/matchmake/**', (route) => route.abort('connectionrefused'));
    await page.goto(`/play/${GAME}`);
    await setName(page, 'Offline');
    await page.getByRole('button', { name: 'Create game' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'The arcade is offline' })).toBeVisible();
    await page.unroute('**/matchmake/**');
    await page.getByRole('button', { name: 'Create game' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    await expect(page.locator('.lobby')).toBeVisible();
  });

  test('a full room without spectators gives a friendly, retryable error', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Solo');
    await page.evaluate(() => (window as any).__DASCADE__.session.lobby.room({ maxPlayers: 1, allowSpectators: false }));
    await expect.poll(async () => (await roomState(page)).allowSpectators).toBe(false);
    const ctx = await browser.newContext();
    const late = await ctx.newPage();
    await late.goto(`/room/${code}`);
    await setName(late, 'Late');
    await late.getByRole('button', { name: 'Join game' }).click();
    await expect(late.getByText('Room is full')).toBeVisible();
    await expect(late.getByRole('button', { name: 'Try again' })).toBeVisible();
    await late.getByRole('button', { name: 'Back to arcade' }).click();
    await expect(late).toHaveURL(/\/$/);
    await ctx.close();
  });

  test('when the host closes the room everyone sees why, and the code stops working', async ({ page, browser }) => {
    const code = await createRoom(page, GAME, 'Closer');
    const guest = await joinRoom(browser, code, 'Bystander');
    await page.evaluate(() => (window as any).__DASCADE__.session.lobby.close());
    await expect(guest.getByText('Room closed')).toBeVisible();
    await expect(guest.getByText('The host closed this room.')).toBeVisible();
    await guest.getByRole('button', { name: 'Back to arcade' }).click();
    await expect(guest).toHaveURL(/\/$/);
    // The room disposes a moment after closing; the code then resolves to "no room".
    await expect(async () => {
      await guest.goto(`/room/${code}`);
      await expect(guest.getByText('No room is using this code right now.')).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 10_000 });
    await guest.context().close();
  });

  test('browsers missing required features get a clear message', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      delete (window as any).WebSocket;
    });
    await page.goto('/');
    await expect(page.getByText(/missing features the arcade needs \(WebSockets\)/)).toBeVisible();
    await ctx.close();
  });
});

test.describe('keyboard and screen-reader basics', () => {
  test('settings modal: named dialog, arrow-key tabs move focus, Esc closes and restores focus', async ({ page }) => {
    await createRoom(page, GAME, 'Keys');
    const opener = page.locator('.topbar').getByRole('button', { name: 'Settings' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: 'Sound' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('tab', { name: 'Display' })).toBeFocused();
    await expect(dialog.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(dialog.getByRole('tab', { name: 'Account' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(dialog.getByRole('tab', { name: 'Sound' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused(); // focus returns to what opened the modal
  });

  test('avatar picker is one tab stop with arrow-key selection', async ({ page }) => {
    await page.goto(`/play/${GAME}`);
    const group = page.getByRole('radiogroup', { name: 'Avatar' });
    const checked = group.getByRole('radio', { checked: true });
    await checked.focus();
    const first = await checked.getAttribute('aria-label');
    await page.keyboard.press('ArrowRight');
    const now = group.getByRole('radio', { checked: true });
    await expect(now).toBeFocused();
    expect(await now.getAttribute('aria-label')).not.toBe(first);
    await expect(group.locator('[role="radio"][tabindex="0"]')).toHaveCount(1);
  });
});

