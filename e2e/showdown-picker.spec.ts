/**
 * DAS Survey Showdown — the picker's controls (scoring brief, PR A): Fair mode, Include / Exclude and
 * Spotlight a name. The presenter runs the console from a laptop; the moderator's crew screen runs on
 * this project's device (a desktop browser on chromium, a phone on mobile — the same screen and the
 * same functions either way); guests are on phones. Rehearsal boards only.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, roomState, setName, startGame } from './helpers.ts';

/** Phones show one lobby section at a time: open the one that holds `target`. */
async function showLobbySection(page: Page, tab: 'Settings' | 'Setup'): Promise<void> {
  const t = page.getByRole('tab', { name: tab });
  if (await t.isVisible().catch(() => false)) await t.click();
}

async function joinAs(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await setName(page, name);
  await page.getByRole('button', { name: /^Join/ }).first().click();
  await expect(page.locator('.lobby, .game-stage').first()).toBeVisible();
}

async function phone(browser: Browser, url: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await joinAs(p, url, name);
  return p;
}

const idOf = async (host: Page, name: string): Promise<string> =>
  Object.values((await roomState(host)).players as Record<string, { id: string; name: string }>).find((p) => p.name === name)!.id;

test('picker: a moderator excludes and includes from their crew screen; the presenter spotlights an excluded guest by name; Fair mode laps', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostCtx.newPage();
  const code = await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  await host.getByRole('button', { name: 'Load DAS-O-Ween rehearsal (demo answers)' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-rehearsal');
  // The setup has the picker's choices; the preset starts in Fair mode with crew out of the draw.
  await expect(host.getByRole('radio', { name: 'Fair mode' })).toBeChecked();
  await expect(host.getByRole('switch', { name: 'Crew in the random draw' })).not.toBeChecked();

  // A moderator link for Ravi, opened on this project's device.
  await showLobbySection(host, 'Setup');
  const crewPanel = host.locator('[data-part="showdown-crew-checks"] [data-part="showdown-crew-panel"]');
  await crewPanel.getByLabel('Name', { exact: true }).fill('Ravi');
  await crewPanel.getByLabel('Role').selectOption('moderator');
  await crewPanel.getByRole('button', { name: 'Create link' }).click();
  await expect(crewPanel.getByRole('button', { name: 'Copy Ravi moderator link' })).toBeVisible();
  const modLink = await host.evaluate(
    (c) =>
      (
        JSON.parse(localStorage.getItem(`dascade:showdown:crew:${c}`) ?? '{"links":[]}').links as Array<{ role: string; link: string }>
      ).find((l) => l.role === 'moderator')!.link,
    code,
  );
  const mod = page;
  await joinAs(mod, `/room/${code}#crew=${modLink}`, 'Ravi');
  await expect(mod.locator('[data-part="showdown-crew-screen"]')).toContainText('Moderator');
  await expect(mod.locator('[data-part="showdown-pool-card"]')).toContainText('You’re crew — not in the random draw');

  const ada = await phone(browser, `/room/${code}`, 'Ada');
  const ben = await phone(browser, `/room/${code}`, 'Ben');
  const adaId = await idOf(host, 'Ada');
  const benId = await idOf(host, 'Ben');
  await expect.poll(async () => Object.keys((await roomState(host)).seats ?? {}).sort()).toEqual([adaId, benId].sort());

  await startGame(host);
  await expect.poll(async () => (await roomState(host)).phase).toBe('PLAYING');
  await host
    .getByRole('button', { name: /^Start round 1/ })
    .first()
    .click();
  const strip = host.locator('[data-part="showdown-picker-strip"]');
  await expect(strip.getByRole('button', { name: 'Pick someone · 2 in the pool' })).toBeEnabled();

  // The moderator takes Ada out of the random draw from the crew screen's Picker tab.
  await mod.getByRole('tab', { name: 'Picker' }).click();
  const modPicker = mod.locator('[data-part="showdown-picker-panel"]');
  await expect(modPicker.locator('[data-part="showdown-picker-mode"]')).toHaveText('Fair mode');
  await modPicker.getByRole('button', { name: 'Exclude Ada from the random draw' }).click();
  await expect(strip.getByRole('button', { name: 'Pick someone · 1 in the pool' })).toBeEnabled();
  const card = (p: Page) => p.locator('[data-part="showdown-pool-card"]');
  await expect(card(ada)).toContainText('You’re out of the random draw for now');
  await expect(card(ada)).toContainText('The presenter can still call you up by name.');
  // Nobody else learns it: Ben's card and the public state say nothing.
  await expect(card(ben)).toContainText('You’re in the pool — you might be picked');
  expect(JSON.stringify(await roomState(ben))).not.toMatch(/exclu/i);

  // The presenter spotlights Ada by name anyway (F, type, Enter).
  await host.keyboard.press('f');
  const chooser = host.getByRole('dialog', { name: 'Spotlight a name' });
  await expect(chooser).toBeVisible();
  const search = chooser.locator('[data-part="showdown-spotlight-search"]');
  await expect(search).toBeFocused();
  await search.fill('ad');
  await search.press('Enter');
  await expect.poll(async () => (await roomState(host)).hotSeat).toBe(adaId);
  await expect(chooser).toBeHidden();
  await expect(ada.getByRole('alertdialog', { name: 'You’re up, Ada!' })).toBeVisible({ timeout: 10_000 });
  await ada.getByRole('alertdialog').getByRole('button', { name: 'Got it' }).click();
  await host.keyboard.press('d');
  await expect.poll(async () => (await roomState(host)).hotSeat).toBe('');

  // Back in the draw: Fair mode puts Ada behind Ben (one turn against none).
  await modPicker.getByRole('button', { name: 'Include Ada in the random draw' }).click();
  await expect(card(ada)).toContainText('You’ve had a turn — you’re back in once everyone has had one');
  await expect(modPicker.locator('[data-part="showdown-picker-person"][data-name="Ada"]')).toContainText('1 turn');
  await expect(strip.getByRole('button', { name: 'Pick someone · 1 in the pool' })).toBeEnabled();
  await host.keyboard.press('k');
  await expect.poll(async () => (await roomState(host)).hotSeat).toBe(benId);
  await host.keyboard.press('d');
  await expect.poll(async () => (await roomState(host)).hotSeat).toBe('');
  // Everyone has had one: the next lap opens by itself.
  await expect(strip.getByRole('button', { name: 'Pick someone · 2 in the pool' })).toBeEnabled();

  // The log names who did what.
  await host
    .getByRole('tab', { name: /Crew & log/ })
    .first()
    .click();
  const log = host.locator('[data-part="showdown-audit"]');
  await expect(log.locator('li', { hasText: 'Took Ada out of the random draw' }).first()).toContainText('Ravi');
  await expect(log.locator('li', { hasText: 'Spotlighted Ada by name' }).first()).toContainText('Marcus');
  await expect(log.locator('li', { hasText: 'Put Ada back in the random draw' }).first()).toContainText('Ravi');

  // The crew screen fits its device (no sideways scroll on a phone).
  const overflow = await mod.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await hostCtx.close();
});
