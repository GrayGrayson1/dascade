/**
 * Shared shell polish: cabinet context in the lobby, clear room status, results → "Back to cabinet",
 * dismissible toasts. Only shared shell behaviour is asserted.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createRoom, roomState, setName, startGame, waitForPhase } from './helpers.ts';

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

test('tabs name their panels: Settings, Profile and the phone lobby', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  const sound = dialog.getByRole('tab', { name: 'Sound' });
  await expect(dialog.getByRole('tabpanel', { name: 'Sound' })).toBeVisible();
  const panelId = await sound.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  expect(await dialog.getByRole('tabpanel').getAttribute('id')).toBe(panelId);
  await dialog.getByRole('tab', { name: 'Display' }).click();
  await expect(dialog.getByRole('tabpanel', { name: 'Display' })).toBeVisible();
  // Only the shown panel is in the page, so only the selected tab points at one.
  expect(await sound.getAttribute('aria-controls')).toBeNull();
  await dialog.getByRole('tab', { name: 'Profile' }).click();
  await expect(dialog.getByRole('tabpanel', { name: 'Profile' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // The profile modal's Profile / Stats tabs.
  await page.getByRole('button', { name: /Set your name|Profile:/ }).click();
  const profile = page.getByRole('dialog');
  await expect(profile.getByRole('tabpanel', { name: 'Profile' })).toBeVisible();
  await profile.getByRole('tab', { name: 'Stats' }).click();
  await expect(profile.getByRole('tabpanel', { name: 'Stats' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(profile).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await createRoom(page, 'wheel', 'Tabber');
  const lobbyTabs = page.getByRole('tablist', { name: 'Lobby sections' });
  await expect(page.getByRole('tabpanel', { name: /^Players/ })).toBeVisible();
  for (const name of ['Settings', 'Chat']) {
    const t = lobbyTabs.getByRole('tab', { name: new RegExp(`^${name}`) });
    const controls = await t.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    await expect(page.locator(`[id="${controls}"]`)).toHaveAttribute('role', 'tabpanel');
    await t.click();
    await expect(page.getByRole('tabpanel', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
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

test('the site is installable and its preview image is served', async ({ page, browserName, request }) => {
  test.skip(browserName !== 'chromium', 'Installability is read from Chromium (DevTools protocol).');
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(manifest.headers()['content-type']).toMatch(/^application\/manifest\+json/);
  for (const path of ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/og-image.png']) {
    const res = await request.get(path);
    expect(res.ok(), path).toBe(true);
    expect(res.headers()['content-type']).toBe('image/png');
  }
  // The page's CSP lets the manifest load (manifest-src falls back to default-src 'self').
  const html = await request.get('/');
  expect(html.headers()['content-security-policy']).toContain("default-src 'self'");

  await page.goto('/');
  await expect(page.locator('[data-arcade-floor]')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  const { url, errors } = (await cdp.send('Page.getAppManifest')) as { url: string; errors: Array<{ message: string }> };
  expect(new URL(url).pathname).toBe('/manifest.webmanifest');
  expect(errors).toEqual([]);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as { installabilityErrors: Array<{ errorId: string }> };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
});

test('pasting a whole invite link into a code box gives its code, not "HTTPS"', async ({ page: guest, browser }) => {
  // The guest is this project's page (so mobile runs paste on a phone); the host has its own context.
  const host = await (await browser.newContext()).newPage();
  const code = await createRoom(host, 'wheel', 'Host');
  const origin = new URL(host.url()).origin;
  // insertText is what a paste does: the whole text arrives in one input event.
  const paste = async (box: Locator, text: string) => {
    await box.click();
    await guest.keyboard.insertText(text);
  };

  // The cabinet title screen's box, with chatter around the link.
  await guest.goto('/play/wheel');
  await setName(guest, 'Paster');
  await guest.getByRole('button', { name: 'Join with code' }).click();
  const titleBox = guest.getByRole('textbox', { name: 'Room code' });
  await paste(titleBox, `Join me! ${origin}/room/${code.toLowerCase()} see you`);
  await expect(titleBox).toHaveValue(code);

  // The Tournament Center's box, with the short /r/ link.
  await guest.goto('/tournaments');
  const tcBox = guest.locator('#tc-join-code');
  await paste(tcBox, `${origin}/r/${code}`);
  await expect(tcBox).toHaveValue(code);

  // The floor's Join modal, all the way into the room.
  await guest.goto('/');
  await guest
    .locator('button:visible')
    .filter({ hasText: /Join with code/ })
    .first()
    .click();
  const dialog = guest.getByRole('dialog');
  const modalBox = dialog.getByRole('textbox', { name: 'Room code' });
  await paste(modalBox, `${origin}/room/${code}`);
  await expect(modalBox).toHaveValue(code);
  await dialog.getByRole('button', { name: 'Join game' }).click();
  await guest.waitForURL((url) => url.pathname === `/room/${code}`);
  await expect(guest.locator('.lobby')).toBeVisible();
  await expect(host.locator('.player-list')).toContainText('Paster');
  await host.context().close();
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

test.describe('keyboard shortcuts', () => {
  test.skip(({ isMobile }) => isMobile, 'Hardware-keyboard shortcuts; phones have the on-screen buttons.');
  /** Keys go to the page, not a field (title screens focus their name box). */
  const unfocus = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  test('? opens Help with the shortcuts listed, M mutes and unmutes, never while typing', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-arcade-floor]')).toBeVisible();
    await unfocus(page);

    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Welcome to DASCADE')).toBeVisible();
    await expect(dialog.locator('[data-part="help-shortcuts"]')).toContainText('mutes or unmutes everything');
    // Keys stand aside while a pop-up is open; Esc closes it.
    await page.keyboard.press('m');
    await expect(page.locator('.dc-toast')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const muted = () => page.evaluate(() => JSON.parse(localStorage.getItem('dascade:v1:settings') ?? '{}').muted);
    await page.keyboard.press('m');
    await expect(page.locator('.dc-toast').filter({ hasText: 'Sound off' })).toBeVisible();
    await expect.poll(muted).toBe(true);
    await page.keyboard.press('M');
    await expect(page.locator('.dc-toast').filter({ hasText: 'Sound on' })).toBeVisible();
    await expect.poll(muted).toBe(false);

    // Typing an "m" in a name is just typing.
    await page.goto('/play/wheel');
    const name = page.getByPlaceholder('Pick a nickname');
    await name.fill('');
    await name.pressSequentially('Mim');
    await expect(name).toHaveValue('Mim');
    expect(await muted()).toBe(false);
    // ? on a title screen opens that game's page.
    await unfocus(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog').getByRole('heading', { name: /Wheel of DAStiny/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('Esc goes back from a title screen and out of the Tournament Center, and puts its title back', async ({ page }) => {
    await page.goto('/play/wheel');
    await expect(page.locator('[data-part="title-screen"]')).toBeVisible();
    await unfocus(page);
    await page.keyboard.press('Escape');
    await page.waitForURL((url) => !url.pathname.startsWith('/play/'));

    await page.goto('/tournaments');
    await expect(page).toHaveTitle('Tournament Center · DASCADE');
    await unfocus(page);
    await page.keyboard.press('Escape');
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page).toHaveTitle('DASCADE — Delta Alpha Sierra Arcade');
  });
});
