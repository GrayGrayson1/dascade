/**
 * Theme architecture proof: a throwaway test theme (defined here, NOT shipped) registered at runtime
 * restyles the shell, lobby, buttons, dialog chrome and the multi-game picker purely through tokens —
 * and an unknown theme id falls back to Delta Neon.
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom } from './helpers.ts';

/** A "1995 desktop" test skin built from Delta Neon's token map with overrides. */
async function applyTestTheme(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__DASCADE_THEME__));
  await page.evaluate(() => {
    const api = (window as any).__DASCADE_THEME__;
    const base = api.listThemes().find((t: { id: string }) => t.id === 'delta-neon');
    const font = "Tahoma, Verdana, 'Segoe UI', sans-serif";
    const bevel = 'inset -1px -1px 0 #404040, inset 1px 1px 0 #ffffff';
    const theme = {
      id: 'test-desktop',
      name: 'Test Desktop',
      description: 'Throwaway E2E theme (not shipped).',
      colorScheme: 'light',
      metaThemeColor: '#008080',
      tokens: {
        ...base.tokens,
        '--theme-color-scheme': 'light',
        '--bg-0': '#008080',
        '--bg-1': '#c0c0c0',
        '--bg-2': '#c0c0c0',
        '--bg-3': '#d4d0c8',
        '--bg-4': '#dfdfdf',
        '--bg-5': '#808080',
        '--glass': '#c0c0c0',
        '--glass-strong': '#c0c0c0',
        '--line': '#808080',
        '--line-strong': '#404040',
        '--line-bright': '#000000',
        '--text-0': '#000000',
        '--text-1': '#111111',
        '--text-2': '#333333',
        '--text-3': '#444444',
        '--font-display': font,
        '--font-pixel': font,
        '--font-ui': font,
        '--panel-sheen': 'none',
        '--panel-radius': '0px',
        '--panel-border': '#dfdfdf',
        '--panel-border-width': '2px',
        '--panel-shadow': bevel,
        '--panel-blur': 'none',
        '--titlebar-bg': 'linear-gradient(90deg, #000080, #1084d0)',
        '--titlebar-fg': '#ffffff',
        '--titlebar-transform': 'none',
        '--titlebar-tracking': '0',
        '--titlebar-marker-size': '0px',
        '--bracket-size': '0px',
        '--button-font': font,
        '--button-tracking': '0',
        '--button-edge-width': '1px',
        '--button-bevel-hi': '#ffffff',
        '--button-bevel-lo': '#404040',
        '--button-bg': '#c0c0c0',
        '--button-bg-2': '#c0c0c0',
        '--button-fg': '#000000',
        '--button-edge': '#000000',
        '--shell-bar-bg': '#c0c0c0',
        '--shell-dock-bg': '#c0c0c0',
        '--input-bg': '#ffffff',
        '--glow-sm-full': '0 0 0 transparent',
        '--glow-md-full': '0 0 0 transparent',
        '--glow-lg-full': '0 0 0 transparent',
        '--text-glow-full': 'none',
        '--scanline-opacity-full': '0',
        '--noise-opacity': '0',
      },
      overrides: {
        '--title-shadow': 'none',
        '--button-primary-bg': '#c0c0c0',
        '--button-primary-bg-2': '#c0c0c0',
        '--button-primary-fg': '#000000',
        '--button-primary-edge': '#000000',
        '--button-primary-glow': 'transparent',
        '--control-accent': '#000080',
        '--control-accent-ink': '#ffffff',
        '--game-backdrop': '#008080',
      },
      renderer: { ...base.renderer, background: '#008080', surface: '#c0c0c0', text: '#000000', glow: 0, glowSoft: 0 },
    };
    api.registerTheme(theme);
    api.setTheme('test-desktop');
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'test-desktop');
}

const css = (page: Page, selector: string, prop: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

test('a registered theme restyles shell, lobby, buttons, dialogs and the cabinet picker; unknown ids fall back', async ({ page }) => {
  await createRoom(page, 'wheel', 'Themer');
  const before = {
    page: await css(page, 'body', 'background-color'),
    bar: await css(page, '.topbar', 'background-image'),
    start: await css(page, '.lobby__start', 'background-image'),
    panel: await css(page, '.lobby__players', 'border-radius'),
  };
  expect(before.page).toBe('rgb(5, 4, 11)');

  await applyTestTheme(page);
  // Shell + lobby.
  expect(await css(page, 'body', 'background-color')).toBe('rgb(0, 128, 128)');
  expect(await css(page, '.topbar', 'background-color')).toBe('rgb(192, 192, 192)');
  expect(await css(page, '.topbar', 'background-image')).not.toBe(before.bar);
  expect(await css(page, '.lobby__players', 'border-radius')).toBe('0px');
  expect(await css(page, '.lobby__players', 'border-radius')).not.toBe(before.panel);
  // Buttons (the game accent recipe is replaced by the theme's fixed primary).
  expect(await css(page, '.lobby__start', 'background-image')).toContain('rgb(192, 192, 192)');
  expect(await css(page, '.lobby__start', 'font-family')).toContain('Tahoma');
  expect(await css(page, '.lobby__start', 'background-image')).not.toBe(before.start);

  // Dialog / window chrome.
  await page.locator('.topbar').getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  expect(await css(page, '.dc-modal .dc-panel__header', 'background-image')).toContain('rgb(0, 0, 128)');
  expect(await css(page, '.dc-modal .dc-panel__title', 'color')).toBe('rgb(255, 255, 255)');
  await dialog.getByRole('tab', { name: 'Display' }).click();
  await expect(dialog.getByText('Theme: Test Desktop')).toBeVisible();
  await page.keyboard.press('Escape');

  // Multi-game cabinet picker (client-side navigation keeps the runtime-registered theme).
  await page.evaluate(() => (window as any).__DASCADE__.session.leaveRoom());
  await page.evaluate(() => {
    history.pushState({}, '', '/cabinet/boardroom');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/cabinet\/boardroom$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'test-desktop');
  expect(await css(page, 'body', 'background-color')).toBe('rgb(0, 128, 128)');

  // After a reload the test theme is no longer registered: the stored id falls back to Delta Neon.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'delta-neon');
  expect(await css(page, 'body', 'background-color')).toBe('rgb(5, 4, 11)');
  await expect(page.locator('#dc-theme')).toHaveCount(0);
});
