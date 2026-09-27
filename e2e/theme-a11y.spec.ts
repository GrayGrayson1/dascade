/**
 * Themes × accessibility / motion (a11y review regressions):
 *  - reduced motion: in every theme the floor and the open, playing jukebox are still — no running CSS
 *    animations, no canvas repaints and no requestAnimationFrame loop (the seek bar used to tick at 60 Hz);
 *  - phones: in every theme the floor has no horizontal scroll and the jukebox transport keeps ≥ 40px targets
 *    (Shareware's compact 36px buttons are desktop-only);
 *  - the jukebox sheet (phones) keeps Tab inside it and Escape returns focus to the dock;
 *  - themed decoration never changes the accessibility tree (CSS generated content is silent).
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
] as const;

const SETTINGS_KEY = 'dascade:v1:settings';

async function preset(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, s]) => {
      try {
        if (!sessionStorage.getItem('a11y-preset')) {
          const prev = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
          localStorage.setItem(key, JSON.stringify({ ...prev, ...s, settingsVersion: 3 }));
          sessionStorage.setItem('a11y-preset', '1');
        }
      } catch {
        /* storage unavailable */
      }
    },
    [SETTINGS_KEY, settings] as const,
  );
  // Count rAF callbacks from boot on.
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      orig((t) => {
        w.__raf++;
        cb(t);
      });
  });
}

async function themed(page: Page, id: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', id);
  await expect.poll(() => page.evaluate((t) => (window as any).__DASCADE_THEME__?.skinLoaded(t) ?? false, id)).toBe(true);
  await expect(page.locator('.theme-xfade')).toHaveCount(0, { timeout: 5_000 });
}

/** Running animations, rAF callbacks and canvases whose pixels changed over `ms`. */
async function motionOver(page: Page, ms: number): Promise<{ anims: string[]; raf: number; canvases: number }> {
  return page.evaluate(async (ms) => {
    const snap = () =>
      [...document.querySelectorAll('canvas')].map((c) => {
        try {
          return c.width && c.height ? c.toDataURL() : '';
        } catch {
          return '';
        }
      });
    const w = window as unknown as { __raf: number };
    const c0 = snap();
    const r0 = w.__raf;
    await new Promise((r) => setTimeout(r, ms));
    const c1 = snap();
    const anims = document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .filter((a) => {
        const t = a.effect?.getComputedTiming();
        return t?.iterations === Infinity || (typeof t?.duration === 'number' && t.duration > 50);
      })
      .map((a) => (a as CSSAnimation).animationName ?? 'waapi');
    return { anims, raf: w.__raf - r0, canvases: c1.filter((d, i) => d !== c0[i]).length };
  }, ms);
}

/**
 * Waits until no canvas changes over a 500 ms window (max ~6 s). Still screens repaint once when
 * late fonts / the lazy skin change their size; a genuinely animating canvas never settles, so the
 * measurement that follows still catches it.
 */
async function canvasesSettled(page: Page): Promise<void> {
  await expect
    .poll(async () => (await motionOver(page, 500)).canvases, { timeout: 6_000, intervals: [0] })
    .toBe(0)
    .catch(() => undefined);
}

async function libraryReady(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as any).__DASCADE_AUDIO__?.store.getState().library.status), { timeout: 15_000 })
    .toBe('ready');
}

for (const id of THEMES) {
  test(`${id}: reduced motion keeps the floor and the playing jukebox still`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preset(page, { theme: id, reducedMotion: true, fx: 'high' });
    await page.goto('/');
    await themed(page, id);
    await expect(page.locator('[data-part="carousel"]')).toBeVisible();
    await libraryReady(page);
    await page.evaluate(() => document.fonts.ready);
    await canvasesSettled(page);

    const floor = await motionOver(page, 1200);
    expect(floor.anims, 'running animations on the floor').toEqual([]);
    expect(floor.canvases, 'canvases repainting on the floor').toBe(0);
    expect(floor.raf, 'rAF callbacks on the floor').toBeLessThan(5);

    // Open the jukebox and play a track: the visualizer, the eq bars and the seek bar all stay still.
    await page.locator('[data-jukebox][data-dock] [data-part="mini-open"]').first().click();
    const panel = page.locator('[data-jukebox] [data-part="panel"]');
    await expect(panel).toBeVisible();
    await panel.locator('[data-part="track"] .jb-track__main').first().click();
    await expect.poll(() => page.evaluate(() => (window as any).__DASCADE_AUDIO__.store.getState().wantPlaying)).toBe(true);
    await page.waitForTimeout(800);
    await canvasesSettled(page);
    const jb = await motionOver(page, 1200);
    expect(jb.anims, 'running animations with the jukebox open').toEqual([]);
    expect(jb.canvases, 'canvases repainting with the jukebox open').toBe(0);
    expect(jb.raf, 'rAF callbacks with the jukebox open').toBeLessThan(5);
  });
}

test.describe('phones', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, 'phone viewports only');
  });

  test('every theme: no horizontal scroll on the floor, ≥ 40px jukebox transport targets', async ({ page }) => {
    test.setTimeout(150_000);
    await preset(page, { theme: 'delta-neon' });
    await page.goto('/');
    await themed(page, 'delta-neon');
    await libraryReady(page);
    for (const id of THEMES) {
      await page.evaluate((t) => (window as any).__DASCADE_THEME__.setTheme(t), id);
      await themed(page, id);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${id}: horizontal overflow`).toBeLessThanOrEqual(1);
      await page.locator('[data-jukebox][data-dock] [data-part="mini-open"]').first().click();
      const panel = page.locator('[data-jukebox] [data-part="panel"]');
      await expect(panel).toBeVisible();
      for (const part of ['shuffle', 'prev', 'play', 'next', 'repeat', 'mute', 'close']) {
        const box = await panel.locator(`[data-part="${part}"]`).first().boundingBox();
        expect(box, `${id}: ${part}`).not.toBeNull();
        expect(Math.min(box!.width, box!.height), `${id}: ${part} target`).toBeGreaterThanOrEqual(39.5);
      }
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  });

  test('the jukebox sheet keeps Tab inside and Escape returns focus to the dock', async ({ page }) => {
    await preset(page, { theme: 'corporate-98' });
    await page.goto('/');
    await themed(page, 'corporate-98');
    await libraryReady(page);
    const open = page.locator('[data-jukebox][data-dock] [data-part="mini-open"]').first();
    await open.focus();
    await page.keyboard.press('Enter');
    const panel = page.locator('[data-jukebox] [data-part="panel"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-part="panel"]')), `Tab ${i + 1} left the sheet`).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-part="panel"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(open).toBeFocused();
  });
});

test('themed decoration never changes the floor heading or the plaque text for assistive tech', async ({ page }) => {
  await preset(page, { theme: 'delta-neon', reducedMotion: true });
  await page.goto('/');
  await themed(page, 'delta-neon');
  const names = async () =>
    [
      await page.getByRole('heading', { level: 1 }).first().ariaSnapshot(),
      await page.locator('[data-part="plaque"]').first().ariaSnapshot(),
    ]
      .join('\n')
      .replace(/\d+/g, 'N');
  const base = await names();
  for (const id of ['corporate-98', 'executive', 'vhs-after-dark']) {
    await page.evaluate((t) => (window as any).__DASCADE_THEME__.setTheme(t), id);
    await themed(page, id);
    expect(await names(), id).toBe(base);
  }
});
