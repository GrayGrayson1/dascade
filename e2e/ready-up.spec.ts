/**
 * The lobby's ready-up switch (Room panel, host only). On: guests ready up and Start game asks
 * "Start anyway?" while someone isn't ready. Off: no Ready up button, no Ready / Not ready labels,
 * and Start game starts at once. A new room takes its game's default: on for the Wheel, off for
 * DAS Survey Showdown (an audience show the presenter starts when they like).
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createRoom, joinRoom, roomState } from './helpers.ts';

/** Same device profile as the running project (so mobile runs use phones for every player). */
function device(testInfo: TestInfo) {
  const use = testInfo.project.use;
  return {
    baseURL: use.baseURL,
    viewport: use.viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
  };
}

/** Phones show one lobby section at a time. */
async function showSection(page: Page, name: 'Players' | 'Settings'): Promise<void> {
  const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
  if (await tab.isVisible()) await tab.click();
}

const readySwitch = (page: Page) => page.getByRole('switch', { name: 'Players ready up before the start' });

test('the host switches ready-up off: no Ready up anywhere, and Start game starts at once', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page, 'wheel', 'Hosty');
  const guest = await joinRoom(browser, code, 'Guesty', device(testInfo));

  // On (the Wheel's default): the guest can ready up, and the host is asked before starting without them.
  await expect(guest.getByRole('button', { name: 'Ready up' })).toBeVisible();
  await showSection(page, 'Players');
  await expect(page.locator('.player-list')).toContainText('Not ready');
  await page.getByRole('button', { name: 'Start game' }).click();
  const confirm = page.getByRole('dialog', { name: 'Start anyway?' });
  await expect(confirm).toContainText('Guesty');
  await confirm.getByRole('button', { name: 'Wait' }).click();
  await expect(confirm).toBeHidden();

  // Off.
  await showSection(page, 'Settings');
  await expect(readySwitch(page)).toBeChecked();
  await page.getByText('Players ready up before the start').click();
  await expect.poll(async () => (await roomState(page)).readyUp).toBe(false);
  await expect(readySwitch(page)).not.toBeChecked();
  await expect(guest.getByRole('button', { name: /^Ready/ })).toHaveCount(0);
  await expect(guest.getByText('Waiting for host to start')).toBeVisible();
  // A guest has the switch too, but only the host can flip it.
  await showSection(guest, 'Settings');
  await expect(readySwitch(guest)).toBeDisabled();
  await showSection(page, 'Players');
  await expect(page.locator('.player-list')).toContainText('Guesty');
  await expect(page.locator('.ready-pill:not(.ready-pill--host)')).toHaveCount(0);

  await page.getByRole('button', { name: 'Start game' }).click();
  await expect.poll(async () => (await roomState(page)).phase).not.toBe('LOBBY');
  await expect(confirm).toHaveCount(0);
  await guest.context().close();
});

test('Survey Showdown starts with ready-up off: no Ready up on phones, the presenter just starts', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page, 'showdown', 'Presenter');
  const phone = await joinRoom(browser, code, 'Fan', device(testInfo));
  await expect.poll(async () => (await roomState(page)).readyUp).toBe(false);
  await expect.poll(async () => Object.keys((await roomState(page)).players ?? {}).length).toBe(2);
  await expect(phone.getByRole('button', { name: /^Ready/ })).toHaveCount(0);
  await expect(phone.getByText('Waiting for host to start')).toBeVisible();
  await showSection(page, 'Settings');
  await expect(readySwitch(page)).not.toBeChecked();

  await page.getByRole('button', { name: 'Start game' }).click();
  await expect.poll(async () => (await roomState(page)).phase).not.toBe('LOBBY');
  await expect(page.getByRole('dialog', { name: 'Start anyway?' })).toHaveCount(0);
  await phone.context().close();
});
