/**
 * Arcade floor E2E: the landing experience (cabinets, keyboard navigation,
 * play → cabinet title screen, join-by-code, settings / reduced motion and
 * the portrait-phone carousel). Runs on every project (desktop + mobile).
 */
import { expect, test, type Page } from '@playwright/test';
import { setName } from './helpers.ts';

const TITLES = ['DASketch', "DAS Hold'em", 'DASjack 21', 'DAS Bingo', 'Wheel of DAStiny', 'DASino', 'DASh Circuit', 'DASQuest'];
const GAME_IDS = ['dasketch', 'holdem', 'blackjack', 'bingo', 'wheel', 'dasino', 'circuit', 'quest'];

const plaqueTitle = (page: Page) => page.locator('#plaque-title');
const visibleButton = (page: Page, name: RegExp) => page.locator('button:visible').filter({ hasText: name }).first();

test.describe('arcade floor', () => {
  test('loads with all eight cabinets and the HUD', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('DASCADE');
    await expect(page.locator('.af-cab')).toHaveCount(8);
    for (const title of TITLES) {
      await expect(page.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\']/g, '.')} cabinet`) })).toBeAttached();
    }
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Mute sound|Unmute sound/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Help and how to play' })).toBeVisible();
    await expect(page.locator('.af-srv:visible')).toContainText(/Online|offline|Connecting/);
    await expect(page.getByText('Virtual chips only — no real money, ever.').first()).toBeAttached();
  });

  test('keyboard: arrows browse and select, Enter plays', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.af-cab')).toHaveCount(8);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#cabinet-dasketch')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#cabinet-dasketch')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#cabinet-holdem')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#cabinet-dasketch')).toHaveAttribute('aria-pressed', 'false');
    await expect(plaqueTitle(page)).toHaveText("DAS Hold'em");
    await page.keyboard.press('End');
    await expect(page.locator('#cabinet-quest')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#cabinet-circuit')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#cabinet-circuit')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/play\/circuit$/);
    await expect(page.getByRole('button', { name: 'Create game' })).toBeVisible();
  });

  test('Play opens the cabinet title screen, and back returns to the floor', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.locator('.af-cab')).toHaveCount(8);
    if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Show DAS Bingo' }).tap();
    else await page.locator('#cabinet-bingo').click();
    await expect(page.locator('#cabinet-bingo')).toHaveAttribute('aria-pressed', 'true');
    await expect(plaqueTitle(page)).toHaveText('DAS Bingo');
    await page.getByRole('button', { name: 'Play DAS Bingo' }).click();
    await expect(page).toHaveURL(/\/play\/bingo$/);
    await expect(page.getByRole('heading', { name: 'DAS Bingo', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create game' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play solo' })).toBeVisible();
    await expect(page.getByPlaceholder('Pick a nickname')).toBeVisible();
    await page.getByRole('button', { name: 'Arcade floor' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#cabinet-bingo')).toHaveAttribute('aria-pressed', 'true');
  });

  test('pressing a selected cabinet plays it', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'the carousel centres (selects) a cabinet before it is tapped');
    await page.goto('/');
    await page.locator('#cabinet-dasino').click();
    await expect(page).toHaveURL(/\/$/);
    await page.locator('#cabinet-dasino').click();
    await expect(page).toHaveURL(/\/play\/dasino$/);
  });

  test('join modal rejects invalid and unknown codes with friendly errors', async ({ page }) => {
    await page.goto('/');
    await visibleButton(page, /Join with code/).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Join with a code' })).toBeVisible();
    await setName(page, 'Visitor');
    const code = dialog.getByLabel('Room code');
    await code.fill('AB2');
    await dialog.getByRole('button', { name: 'Join game' }).click();
    await expect(dialog.getByText('Room codes are 5 characters.')).toBeVisible();
    await code.fill('ZZZZZ');
    await dialog.getByRole('button', { name: 'Join game' }).click();
    await expect(dialog.getByText(/Room not found|arcade is offline/)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('settings opens, and the reduced-motion toggle applies to <html>', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const before = await html.getAttribute('data-reduced-motion');
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await dialog.getByRole('tab', { name: 'Display' }).click();
    await dialog.getByText('Reduce motion (calmer animations, no screen shake)').click();
    const after = before === 'true' ? 'false' : 'true';
    await expect(html).toHaveAttribute('data-reduced-motion', after);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    // The floor still works with motion reduced.
    await page.locator('#cabinet-holdem').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#cabinet-blackjack')).toHaveAttribute('aria-pressed', 'true');
  });

  test('profile chip opens the profile editor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Set your name|Profile:/ }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Your profile' })).toBeVisible();
    await setName(page, 'Neon Nina');
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: /Profile: Neon Nina/ })).toBeVisible();
  });

  test('the floor never loads game modules or Phaser', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await page.goto('/');
    await expect(page.locator('.af-cab')).toHaveCount(8);
    await page.waitForLoadState('networkidle');
    const gameChunks = urls.filter((u) => GAME_IDS.some((id) => u.includes(`/games/${id}/`)) || /phaser/i.test(u));
    expect(gameChunks).toEqual([]);
  });
});

test.describe('portrait phone carousel', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('prev / next buttons and dots move through the cabinets', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.af-floor')).toHaveAttribute('data-mode', 'carousel');
    await expect(plaqueTitle(page)).toHaveText('DASketch');
    await expect(page.getByRole('button', { name: 'Previous cabinet' })).toBeDisabled();
    await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expect(plaqueTitle(page)).toHaveText("DAS Hold'em");
    await expect(page.locator('#cabinet-holdem')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: "Show DAS Hold'em" })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expect(plaqueTitle(page)).toHaveText('DASjack 21');
    await page.getByRole('button', { name: 'Previous cabinet' }).click();
    await expect(plaqueTitle(page)).toHaveText("DAS Hold'em");
    await page.getByRole('button', { name: 'Show DASQuest' }).click();
    await expect(plaqueTitle(page)).toHaveText('DASQuest');
    await expect(page.getByRole('button', { name: 'Next cabinet' })).toBeDisabled();
    // The selected cabinet is scrolled into view.
    await expect
      .poll(async () => {
        const box = await page.locator('#cabinet-quest').boundingBox();
        return !!box && box.x > 0 && box.x + box.width < 390;
      })
      .toBe(true);
    await page.getByRole('button', { name: 'Play DASQuest' }).click();
    await expect(page).toHaveURL(/\/play\/quest$/);
  });
});
