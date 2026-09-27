/**
 * Themes end to end:
 *  - all eleven shipped themes render the core shell (floor, a cabinet picker, a title screen, a lobby,
 *    Settings) with their data-theme + structural skin and no console errors;
 *  - switching through the picker never reloads the page and never leaks styles/overlays/environments;
 *  - switching mid-lobby keeps the connection, room and state; the choice persists across a reload;
 *    corrupt storage falls back to Delta Neon;
 *  - architecture proof: a throwaway runtime-registered theme restyles the shell purely through tokens.
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom, leaveRoom, roomState } from './helpers.ts';

const THEMES = [
  'delta-neon',
  'shareware-97',
  'corporate-98',
  'cyber-cafe-01',
  'mall-arcade-92',
  'vhs-after-dark',
  'space-casino-2088',
  'lan-party',
  'saturday-morning',
  'executive',
  'neon-noir',
] as const;

const SETTINGS_KEY = 'dascade:v1:settings';

/** Console errors / page errors, minus network noise unrelated to theming. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    // WebKit-only SDK noise on every room *connect*: @colyseus/sdk's WebSocketTransport first tries the Node
    // signature `new WebSocket(url, { headers, protocols })`, which WebKit rejects (and logs) before the SDK's
    // catch retries with the browser signature. The connection succeeds; unrelated to themes.
    if (/Wrong protocol for WebSocket/.test(e.message)) return;
    errors.push(`pageerror: ${e.message}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource|net::ERR_|favicon|WebSocket|ERR_CONNECTION|status of 40[134]/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

async function presetTheme(page: Page, id: string): Promise<void> {
  await page.addInitScript(
    ([key, theme]) => {
      try {
        if (!sessionStorage.getItem('theme-preset-done')) {
          const prev = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
          localStorage.setItem(key, JSON.stringify({ ...prev, theme, settingsVersion: 3 }));
          sessionStorage.setItem('theme-preset-done', '1');
        }
      } catch {
        /* storage unavailable */
      }
    },
    [SETTINGS_KEY, id] as const,
  );
}

async function expectThemed(page: Page, id: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', id);
  await expect.poll(() => page.evaluate((t) => (window as any).__DASCADE_THEME__?.skinLoaded(t) ?? false, id)).toBe(true);
  await expect(page.locator('[data-part="theme-environment"]')).toHaveCount(1);
}

/** Opens Settings → Display and returns the dialog. */
async function openDisplaySettings(page: Page) {
  const scope = (await page.locator('.topbar').count()) ? page.locator('.topbar') : page.locator('[data-part="arcade-header"]');
  await scope.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Display' }).click();
  return dialog;
}

async function pickTheme(page: Page, name: string, id: string): Promise<void> {
  const dialog = await openDisplaySettings(page);
  const group = dialog.getByRole('radiogroup', { name: 'Theme' });
  await group.getByRole('radio', { name, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', id);
  await expect(page.locator('.theme-xfade')).toHaveCount(0, { timeout: 5_000 });
  await expect(group.getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

for (const id of THEMES) {
  test(`${id}: floor, cabinet picker, title screen, lobby and settings render themed without errors`, async ({ page }) => {
    const errors = watchErrors(page);
    await presetTheme(page, id);

    await page.goto('/');
    await expectThemed(page, id);
    await expect(page.locator('[data-part="arcade-floor"]')).toBeVisible();
    await expect(page.locator('[data-part="carousel"]')).toBeVisible();
    // The lineup arrows take real clicks in every skin (skins' pressed-button `transform` once replaced
    // the arrows' centring, so they jumped off the pointer on mousedown and the click hit the track).
    const centred = () => page.locator('.af-cab[aria-current="true"]').getAttribute('data-cabinet');
    const start = await centred();
    await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expect.poll(centred).not.toBe(start);
    await page.getByRole('button', { name: 'Previous cabinet' }).click();
    await expect.poll(centred).toBe(start);
    const dialog = await openDisplaySettings(page);
    await expect(dialog.locator(`[data-theme-option="${id}"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator(`[data-theme-preview="${id}"]`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    await page.goto('/cabinet/boardroom');
    await expectThemed(page, id);
    await expect(page.locator('[data-part="cabinet-picker"]')).toBeVisible();

    await page.goto('/play/chess');
    await expectThemed(page, id);
    await expect(page.locator('[data-part="title-screen"]')).toBeVisible();

    await createRoom(page, 'wheel', 'Themer');
    await expectThemed(page, id);
    await expect(page.locator('[data-part="lobby"]')).toBeVisible();
    await expect(page.locator('[data-part="player-row"]').first()).toBeVisible();
    await leaveRoom(page);

    expect(errors).toEqual([]);
  });
}

test('switching through the picker never reloads, never leaks, and persists across a reload', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expectThemed(page, 'delta-neon');
  await page.evaluate(() => ((window as any).__noReload = 'still-here'));
  const styleCount = () => page.evaluate(() => document.querySelectorAll('style').length);

  // Warm every skin once (each skin's CSS is injected at most once, ever).
  await pickTheme(page, 'Neon Noir', 'neon-noir');
  for (const id of THEMES) {
    await page.evaluate((t) => (window as any).__DASCADE_THEME__.switchTheme(t), id);
  }
  await expect(page.locator('.theme-xfade')).toHaveCount(0);
  const baseline = await styleCount();

  // Rapid switching: one overlay at most, no accumulating <style>, one environment layer.
  await page.evaluate(
    async (ids) => {
      const api = (window as any).__DASCADE_THEME__;
      const all: Promise<void>[] = [];
      for (let round = 0; round < 3; round++) for (const t of ids) all.push(api.switchTheme(t));
      await Promise.all(all);
    },
    [...THEMES],
  );
  await expect(page.locator('.theme-xfade')).toHaveCount(0);
  expect(await styleCount()).toBe(baseline);
  await expect(page.locator('[data-part="theme-environment"]')).toHaveCount(1);
  await expect(page.locator('#dc-theme-previews')).toHaveCount(0); // picker closed → preview CSS removed

  await pickTheme(page, "Shareware Casino '97", 'shareware-97');
  expect(await page.evaluate(() => (window as any).__noReload)).toBe('still-here');
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);

  await page.reload();
  await expectThemed(page, 'shareware-97');
  expect(errors).toEqual([]);
});

test('switching theme mid-lobby keeps the connection, the room and its state', async ({ page }) => {
  const errors = watchErrors(page);
  const code = await createRoom(page, 'wheel', 'Switcher');
  const before = await page.evaluate(() => {
    const d = (window as any).__DASCADE__;
    return { roomId: d.session.room?.roomId, sessionId: d.session.room?.sessionId };
  });
  const stateBefore = await roomState(page);
  expect(before.roomId).toBeTruthy();

  await pickTheme(page, 'Executive Edition', 'executive');
  await pickTheme(page, 'Cyber Café 2001', 'cyber-cafe-01');

  await expect(page).toHaveURL(new RegExp(`/room/${code}$`));
  await expect(page.locator('[data-part="lobby"]')).toBeVisible();
  const after = await page.evaluate(() => {
    const d = (window as any).__DASCADE__;
    return { roomId: d.session.room?.roomId, sessionId: d.session.room?.sessionId, open: d.session.room?.connection?.isOpen };
  });
  expect(after.roomId).toBe(before.roomId);
  expect(after.sessionId).toBe(before.sessionId);
  expect(after.open).toBe(true);
  const stateAfter = await roomState(page);
  expect(stateAfter.phase).toBe(stateBefore.phase);
  expect(Object.keys(stateAfter.players ?? {})).toEqual(Object.keys(stateBefore.players ?? {}));
  await expect(page.locator('[data-part="room-code-chip"]')).toContainText(code);
  await leaveRoom(page);
  expect(errors).toEqual([]);
});

test('corrupt or unknown stored themes render Delta Neon', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('corrupt-done')) {
      localStorage.setItem(key, '{"theme": "shareware-97", oops');
      sessionStorage.setItem('corrupt-done', '1');
    }
  }, SETTINGS_KEY);
  await page.goto('/');
  await expectThemed(page, 'delta-neon');
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ theme: 'windows-2000', settingsVersion: 3 })), SETTINGS_KEY);
  await page.reload();
  await expectThemed(page, 'delta-neon');
  await expect(page.locator('#dc-theme')).toHaveCount(0);
});

/** A "1995 desktop" test skin built from Delta Neon's token map with overrides. */
async function applyTestTheme(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__DASCADE_THEME__));
  await page.evaluate(() => {
    const api = (window as any).__DASCADE_THEME__;
    const base = api.listThemes().find((t: { id: string }) => t.id === 'delta-neon');
    const font = "Tahoma, Verdana, 'Segoe UI', sans-serif";
    const bevel = 'inset -1px -1px 0 #404040, inset 1px 1px 0 #ffffff';
    const noir = api.listThemes().find((t: { id: string }) => t.id === 'neon-noir');
    const theme = {
      id: 'test-desktop',
      name: 'Test Desktop',
      description: 'Throwaway E2E theme (not shipped).',
      meta: { era: 'Test', tagline: 'Throwaway', swatches: ['#008080', '#c0c0c0', '#000080', '#ffffff'], family: 'retro-desktop' },
      materials: noir.materials,
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
  await expect(dialog.getByRole('radio', { name: 'Test Desktop' })).toHaveAttribute('aria-checked', 'true');
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
