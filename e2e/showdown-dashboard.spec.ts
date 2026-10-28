/**
 * DAS Survey Showdown — the presenter console's Dashboard layout (the default; the other specs drive
 * the Classic drawer, see playwright.config.ts). Every tool is open at once beside the show, the
 * console fills the window, nothing scrolls sideways and the page itself never scrolls; on a big,
 * tall screen the statuses and logs sit under the answer sheet and the small tools under the rail.
 * A tool folds and stays folded; the scene strip's Cards brings its tool into view; the bar's switch
 * goes to Classic (and back), remembered across a reload.
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, roomState, startGame, waitForPhase } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'The presenter runs the show from a laptop or a desk screen.');

/** Elements in the console that scroll sideways, and whether the page itself scrolls. */
async function scrolling(page: Page): Promise<{ sideways: string[]; page: boolean }> {
  return page.evaluate(() => {
    const sideways: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-part="showdown-console"] *')) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) sideways.push(String(el.className));
    }
    const doc = document.documentElement;
    return { sideways, page: doc.scrollHeight > innerHeight + 1 || doc.scrollWidth > innerWidth + 1 };
  });
}

test('the Dashboard: every tool open beside the show, no sideways scroll, folds remembered, Classic one switch away', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  // This spec starts from the app's own default (the config pins Classic for the others) — once, so a
  // reload keeps what the test switched to.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e:dashboard')) return;
    sessionStorage.setItem('e2e:dashboard', '1');
    localStorage.removeItem('dascade:showdown:console-layout');
    localStorage.removeItem('dascade:showdown:console-folded');
  });
  await page.setViewportSize({ width: 2560, height: 1440 });
  const code = await createRoom(page, 'showdown', 'Host');
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await page.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).mode).toBe('showcase');
  const guest = await joinRoom(browser, code, 'Priya S.');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');

  const consoleEl = page.locator('[data-part="showdown-console"]');
  await expect(consoleEl).toHaveAttribute('data-layout', 'dashboard');
  await expect(page.locator('[data-part="showdown-layout"] [data-layout="dashboard"]')).toHaveAttribute('aria-pressed', 'true');
  // No tabs: every tool is a panel of its own.
  await expect(page.locator('[data-part="showdown-drawer"]')).toHaveCount(0);
  for (const id of ['picker', 'sound', 'cards', 'cinema', 'awards', 'fix', 'guesses', 'scores', 'names', 'crew', 'preflight']) {
    await expect(page.locator(`[data-part="showdown-tool"][data-tool="${id}"] .sdc-tool__body`)).toBeVisible();
  }

  // A big, tall screen: the whole window, three tool columns, statuses and logs under the answer sheet,
  // small tools under the rail.
  const width = await consoleEl.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(2560 * 0.95);
  await expect(page.locator('[data-part="showdown-tools"]')).toHaveAttribute('data-columns', '3');
  await expect(page.locator('[data-under="sheet"] [data-tool="guesses"]')).toBeVisible();
  await expect(page.locator('[data-under="rail"] [data-tool="fix"]')).toBeVisible();
  // The live controls are on screen.
  for (const part of ['showdown-wrong', 'showdown-clock', 'showdown-sweep', 'showdown-next', 'showdown-preview']) {
    await expect(page.locator(`[data-part="${part}"]`)).toBeInViewport();
  }

  for (const size of [
    { width: 2560, height: 1440 },
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    expect(await scrolling(page), `${size.width}×${size.height}`).toEqual({ sideways: [], page: false });
  }
  // 1920×1080: two columns; nothing goes under the sheet there (no room).
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('[data-part="showdown-tools"]')).toHaveAttribute('data-columns', '2');
  await expect(page.locator('[data-part="showdown-tools-under"]')).toHaveCount(0);
  await expect(page.locator('[data-part="showdown-tools"] [data-tool="guesses"]')).toHaveCount(1);

  // Fold a tool: its title bar stays, its panel goes — and stays folded after a reload.
  const sound = page.locator('[data-tool="sound"]');
  await sound.locator('.sdc-tool__fold').click();
  await expect(sound.locator('.sdc-tool__fold')).toHaveAttribute('aria-expanded', 'false');
  await expect(sound.locator('.sdc-tool__body')).toHaveCount(0);

  // The scene strip's Cards unfolds the Cards tool and brings it into view.
  const cards = page.locator('[data-tool="cards"]');
  await cards.locator('.sdc-tool__fold').click();
  await expect(cards.locator('.sdc-tool__body')).toHaveCount(0);
  await page.locator('[data-part="showdown-scenes"] [data-scene="cards"]').click();
  await expect(cards.locator('.sdc-tool__body')).toBeVisible();
  await expect(cards.locator('[data-part="showdown-join-qr"]').first()).toBeInViewport();

  // Classic: the tabbed drawer under the preview, the console back to its width; kept after a reload.
  await page.locator('[data-part="showdown-layout"] [data-layout="classic"]').click();
  await expect(consoleEl).toHaveAttribute('data-layout', 'classic');
  await expect(page.locator('[data-part="showdown-drawer"]')).toBeVisible();
  await expect(page.locator('[data-part="showdown-tool"]')).toHaveCount(0);
  await page.reload();
  await waitForPhase(page, 'PLAYING');
  await expect(consoleEl).toHaveAttribute('data-layout', 'classic');
  await expect(page.getByRole('tab', { name: /^Picker/ })).toBeVisible();

  // And back: the folded tool is still folded.
  await page.locator('[data-part="showdown-layout"] [data-layout="dashboard"]').click();
  await expect(consoleEl).toHaveAttribute('data-layout', 'dashboard');
  await expect(page.locator('[data-tool="sound"] .sdc-tool__body')).toHaveCount(0);
  await expect(page.locator('[data-tool="picker"] .sdc-tool__body')).toBeVisible();
  await guest.context().close();
});
