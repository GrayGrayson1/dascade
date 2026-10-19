/**
 * DAS Survey Showdown — the Presenter Tour (/tutorial/showdown and the console's "Tour" dialog): it
 * plays a demo show on the real stage with no connection at all, steps through stills under reduced
 * motion, and opening it from a live console leaves the live show exactly as it was.
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom, presetSettings, roomState, startGame, waitForPhase } from './helpers.ts';

const CHAPTERS = [
  'Big picture',
  'Getting ready',
  'Start the show',
  'Right answer',
  'Wrong answer',
  'Number 5',
  'Clock & reveal',
  'Next round',
  'Finish & cards',
  'Safety net',
];

/** Every WebSocket the page opens, except the dev server's own (Vite HMR). */
function watchSockets(page: Page): string[] {
  const sockets: string[] = [];
  page.on('websocket', (ws) => {
    if (!/[?&]token=|vite/.test(ws.url())) sockets.push(ws.url());
  });
  return sockets;
}

const caption = (page: Page) => page.locator('[data-part="showdown-tour-caption"] p');
const tourStage = (page: Page) => page.locator('[data-part="showdown-tour"] .sd-stage').first();

test('the tour page plays the show on a demo stage, with no connection', async ({ page }) => {
  test.setTimeout(90_000);
  const sockets = watchSockets(page);
  const matchmaking: string[] = [];
  page.on('request', (r) => {
    if (/matchmake|\/api\/rooms/.test(r.url())) matchmaking.push(r.url());
  });
  await page.goto('/tutorial/showdown?chapter=4');
  const tour = page.locator('[data-part="showdown-tour"]');
  await expect(tour).toBeVisible();
  // Chapter 4: Ada names Candy Corn in the chat, the cursor clicks #2, the tile flips on the stage.
  await expect(page.getByText('candy corn!!')).toBeVisible({ timeout: 10_000 });
  await expect(tourStage(page).locator('.sd-tile[data-revealed]').first()).toBeVisible({ timeout: 10_000 });
  await expect(tourStage(page).getByLabel(/Answer 2: Candy Corn/)).toBeVisible();
  await expect(caption(page)).toContainText('Answer sheet');

  // Every chapter, from the rail.
  const chips = page.locator('.tour__chip');
  await expect(chips).toHaveCount(CHAPTERS.length);
  for (let i = 0; i < CHAPTERS.length; i++) {
    await chips.nth(i).click();
    await expect(chips.nth(i)).toHaveAttribute('aria-current', 'step');
    await expect(caption(page)).not.toHaveText('', { timeout: 6_000 });
    if (i === 0) await expect(page.locator('.tour-big')).toBeVisible();
    else await expect(tourStage(page)).toBeVisible();
  }

  // Space pauses and plays; the arrows change chapters.
  await chips.nth(4).click();
  // (Space on a focused button presses that button: aim the key at the page.)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect(page.locator('[data-part="showdown-tour-play"]')).toHaveText(/Play/);
  await page.keyboard.press('ArrowRight');
  await expect(chips.nth(5)).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('ArrowLeft');
  await expect(chips.nth(4)).toHaveAttribute('aria-current', 'step');

  expect(sockets).toEqual([]);
  expect(matchmaking).toEqual([]);
});

test('under reduced motion the tour is stills the viewer steps through', async ({ page }) => {
  await presetSettings(page, { reducedMotion: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sockets = watchSockets(page);
  await page.goto('/tutorial/showdown');
  await expect(caption(page)).toContainText('two windows');
  // Nothing plays by itself.
  await page.waitForTimeout(5_000);
  await expect(caption(page)).toContainText('two windows');
  await expect(page.locator('[data-part="showdown-tour-play"]')).toHaveCount(0);
  await page.locator('[data-part="showdown-tour-next-step"]').click();
  await expect(caption(page)).toContainText('presenter console');
  await page.locator('[data-part="showdown-tour-prev-step"]').click();
  await expect(caption(page)).toContainText('two windows');
  // Space steps too.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Space');
  await expect(caption(page)).toContainText('presenter console');
  expect(sockets).toEqual([]);
});

test('opening the tour from a live console leaves the show alone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop.');
  test.setTimeout(120_000);
  await createRoom(page, 'showdown', 'Host');
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await page.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
  await expect.poll(async () => (await roomState(page)).rehearsal).toBe(true);

  // The lobby's setup card offers the tour.
  const setupTab = page.getByRole('tab', { name: 'Your setup' });
  if (await setupTab.isVisible()) await setupTab.click();
  await expect(page.getByRole('button', { name: 'Watch the presenter tour' })).toBeVisible();

  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await page
    .getByRole('button', { name: /^Start round 1/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^Show the question/ })
    .first()
    .click();
  await expect.poll(async () => JSON.parse((await roomState(page)).boardJson).stage).toBe('live');
  await page.getByRole('button', { name: /^Reveal answer 1:/ }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).boardJson).slots[0].revealed).toBe(true);
  const before = (await roomState(page)).boardJson;

  await page.locator('[data-part="showdown-tour-open"]').click();
  const dialog = page.locator('[data-part="showdown-tour-dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-part="showdown-tour"]')).toBeVisible();
  await dialog.locator('.tour__chip').nth(4).click();
  // The console's shortcut keys rest while the tour is open: X, 2 and N do nothing to the show.
  await page.keyboard.press('x');
  await page.keyboard.press('2');
  await page.keyboard.press('n');
  await page.waitForTimeout(4_000);
  // The tour's own stage flipped tiles and buzzed; the live board didn't move.
  expect((await roomState(page)).boardJson).toBe(before);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await roomState(page)).boardJson).toBe(before);
  await expect(page.locator('[data-part="showdown-console"]').getByText(/wrong this round/)).toHaveCount(0);
  await expect(page.locator('[data-part="showdown-sheet"]')).toContainText('1/10');
});
