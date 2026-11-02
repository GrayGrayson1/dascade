/**
 * Floor HUD at tablet and narrow-window widths, in every theme (the HUD used to push Settings and Help
 * off-screen at about 700–899 px; `.af-floor { overflow-x: clip }` hid the overflow, so no scroll check
 * caught it):
 *  - Help's right edge is inside the window and Settings and Help take clicks;
 *  - the brand doesn't run under the HUD's buttons;
 *  - "Join with code" stays reachable: in the HUD on wide floors, on the floor's extras row below 1024 px.
 * Desktop viewports only (phones have their own layout; theme-a11y.spec.ts covers them).
 */
import { expect, test, type Page } from '@playwright/test';

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
  'halloween-night',
] as const;

/** iPad mini, iPad and iPad Air portrait, a narrow window, the last compact width, iPad landscape. */
const WIDTHS = [700, 744, 768, 820, 900, 1023, 1024] as const;
const SETTINGS_KEY = 'dascade:v1:settings';

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'tablet and desktop widths only');
});

async function openFloor(page: Page, theme: string): Promise<void> {
  await page.addInitScript(
    ([key, t]) => {
      try {
        const prev = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(key, JSON.stringify({ ...prev, theme: t, reducedMotion: true, settingsVersion: 3 }));
      } catch {
        /* storage unavailable */
      }
    },
    [SETTINGS_KEY, theme] as const,
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect.poll(() => page.evaluate((t) => (window as any).__DASCADE_THEME__?.skinLoaded(t) ?? false, theme)).toBe(true);
  await expect(page.locator('.theme-xfade')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('[data-part="carousel"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of THEMES) {
  test(`${theme}: Settings, Help and Join stay on screen at tablet widths`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openFloor(page, theme);
    const hud = page.locator('[data-part="arcade-header"]');
    const settings = hud.getByRole('button', { name: 'Settings' });
    const help = hud.getByRole('button', { name: 'Help and how to play' });
    const join = page.locator('button:visible').filter({ hasText: /Join with code/ });

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const at = `${theme} @ ${width}px`;
      await expect(help, at).toBeVisible();
      await expect
        .poll(
          async () => {
            const box = await help.boundingBox();
            return box ? Math.round(box.x + box.width) : Infinity;
          },
          { message: `${at}: Help's right edge` },
        )
        .toBeLessThanOrEqual(width);
      // Actionability without clicking: visible, stable, enabled and the topmost element at its centre.
      await settings.click({ trial: true, timeout: 2_000 });
      await help.click({ trial: true, timeout: 2_000 });

      // The brand (logo + tagline) ends before the first visible HUD control.
      const overlap = await page.evaluate(() => {
        const rects = [...document.querySelectorAll('.af-hud__brand *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
        const first = [...document.querySelectorAll('.af-hud__actions > *')].map((e) => e.getBoundingClientRect()).find((r) => r.width > 0);
        return first ? Math.max(...rects.map((r) => r.right)) - first.left : 0;
      });
      expect(overlap, `${at}: brand runs under the HUD controls`).toBeLessThanOrEqual(0);

      // Join with code: exactly one, fully inside the window.
      await expect(join, at).toHaveCount(1);
      const jb = await join.boundingBox();
      expect(jb, at).not.toBeNull();
      expect(jb!.x, `${at}: Join's left edge`).toBeGreaterThanOrEqual(0);
      expect(jb!.x + jb!.width, `${at}: Join's right edge`).toBeLessThanOrEqual(width);
      await join.click({ trial: true, timeout: 2_000 });
      // Where it lives: the HUD on wide floors, the extras row in the compact band.
      expect(await join.evaluate((b) => b.classList.contains('af-floor__join-mobile')), `${at}: Join on the floor row`).toBe(width < 1024);
    }

    // At a tablet width the controls really open their dialogs.
    await page.setViewportSize({ width: 768, height: 1024 });
    const dialog = page.getByRole('dialog');
    await settings.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await join.click();
    await expect(dialog.getByRole('heading', { name: 'Join with a code' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}
