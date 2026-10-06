/**
 * October's Halloween Night invite (apps/web/src/themes/seasonal.ts):
 *  - the invite shows on the arcade floor only, in season, and waits while anything else is open;
 *  - "Turn on Halloween" switches the theme and remembers the previous one; "Not now" stops it for the
 *    season; "Exit Halloween" (HUD on wide floors, Settings → Display, the Themes sheet) goes back;
 *  - after October an invite-activated Halloween Night goes back by itself (a hand-picked one stays);
 *  - phones, keyboard, reduced motion, contrast and the floor's accessibility tree stay right.
 *
 * Every context starts with the season override 'off' (playwright.config.ts); these tests opt in with
 * `?season=<local date>` (kept in sessionStorage across navigations in the tab).
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom } from './helpers';

const SETTINGS_KEY = 'dascade:v1:settings';
const HN = 'halloween-night';
const IN_SEASON = '2026-10-15';
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

const invite = (page: Page) => page.locator('[data-part="seasonal-invite"]');
const status = (page: Page) => page.locator('[data-part="seasonal-status"]');
const hudExit = (page: Page) => page.locator('.af-hud [data-part="exit-halloween"]');
const themeButton = (page: Page) => page.locator('.af-hud [data-part="theme-button"]');

/** Seeds the settings blob once per tab (later reloads keep whatever the app saved). */
async function preset(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, s]) => {
      try {
        if (!sessionStorage.getItem('seasonal-preset')) {
          const prev = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
          localStorage.setItem(key, JSON.stringify({ ...prev, ...s, settingsVersion: 3 }));
          sessionStorage.setItem('seasonal-preset', '1');
        }
      } catch {
        /* storage unavailable */
      }
    },
    [SETTINGS_KEY, settings] as const,
  );
}

async function themed(page: Page, id: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', id);
  await expect(page.locator('.theme-xfade')).toHaveCount(0, { timeout: 5_000 });
}

/** The arcade floor with the season pinned to `season` (a local date, or 'off' / 'live'). */
async function floorOn(page: Page, season: string): Promise<void> {
  await page.goto(`/?season=${encodeURIComponent(season)}`);
  await expect(page.locator('[data-part="carousel"]')).toBeVisible();
}

async function inviteShown(page: Page): Promise<void> {
  await expect(status(page)).toHaveAttribute('data-state', 'shown');
  await expect(invite(page)).toBeVisible();
}

async function stored(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate((key) => {
    const blob = JSON.parse(localStorage.getItem(key) ?? '{}') as { seasonal?: { halloween?: Record<string, unknown> } };
    return blob.seasonal?.halloween;
  }, SETTINGS_KEY);
}

async function openSettingsDisplay(page: Page) {
  await page.locator('[data-part="arcade-header"]').getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Display' }).click();
  return dialog;
}

/** WCAG contrast of an element's text against a background (any CSS colour syntax, via a canvas). */
async function contrastOf(page: Page, textSelector: string, bgSelector: string): Promise<number> {
  return page.evaluate(
    ([textSel, bgSel]) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      const rgb = (css: string): [number, number, number, number] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!, d[3]!];
      };
      const lum = ([r, g, b]: number[]) => {
        const c = [r!, g!, b!].map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
      };
      const fg = rgb(getComputedStyle(document.querySelector(textSel)!).color);
      const bg = rgb(getComputedStyle(document.querySelector(bgSel)!).backgroundColor);
      if (bg[3] < 255) return -1; // must be an opaque surface
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (a! + 0.05) / (b! + 0.05);
    },
    [textSelector, bgSelector] as const,
  );
}

test.describe('the October invite', () => {
  test('shows on the floor; "Turn on Halloween" switches, remembers and persists', async ({ page }) => {
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    // Never steals focus.
    expect(await invite(page).evaluate((el) => el.contains(document.activeElement))).toBe(false);
    await invite(page).getByRole('button', { name: 'Turn on Halloween' }).click();
    await themed(page, HN);
    await expect(invite(page)).toHaveCount(0);
    await expect(page.locator('[data-part="toast"]').filter({ hasText: 'Halloween Night is on!' })).toBeVisible();
    await expect.poll(() => stored(page)).toEqual({ via: 'invite', prev: 'delta-neon', year: 2026 });
    await page.reload();
    await themed(page, HN);
    await expect(status(page)).toHaveAttribute('data-state', 'ineligible');
    await expect(invite(page)).toHaveCount(0);
  });

  test('"Not now" stops it for this season (but not next October)', async ({ page }) => {
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    await invite(page).getByRole('button', { name: 'Not now' }).click();
    await expect(invite(page)).toHaveCount(0);
    await expect.poll(() => stored(page)).toEqual({ year: 2026, dismissed: true });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'delta-neon');
    await page.reload();
    await expect(status(page)).toHaveAttribute('data-state', 'ineligible');
    await floorOn(page, '2027-10-02');
    await inviteShown(page);
  });

  test('never outside the floor: cabinets, title screens, the Tournament Center, lobbies, games', async ({ page }) => {
    test.setTimeout(120_000);
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    for (const path of ['/cabinet/boardroom', '/tournaments', '/play/chess']) {
      await page.goto(path);
      await expect(status(page), path).toHaveAttribute('data-state', 'ineligible');
      await expect(invite(page), path).toHaveCount(0);
    }
    await createRoom(page, 'wheel', 'Host');
    await expect(status(page)).toHaveAttribute('data-state', 'ineligible');
    await expect(invite(page)).toHaveCount(0);
    await createRoom(page, 'snake', 'Solo', { solo: true });
    await page.getByRole('button', { name: 'Start run' }).click();
    await expect(page.locator('canvas.sn-canvas')).toBeVisible();
    await expect(status(page)).toHaveAttribute('data-state', 'ineligible');
    await expect(invite(page)).toHaveCount(0);
  });

  test('waits while Settings, the Themes sheet, the claw machine or the jukebox is open', async ({ page, isMobile }) => {
    test.setTimeout(120_000);
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    const openers: Array<[string, () => Promise<void>]> = [
      ['settings', () => page.locator('[data-part="arcade-header"]').getByRole('button', { name: 'Settings' }).click()],
      ['themes', () => themeButton(page).click()],
      [
        'claw',
        () =>
          isMobile
            ? page.locator('[data-part="claw-quick"]:visible').first().click()
            : page.getByRole('button', { name: /^Claw machine — step up and play/ }).click(),
      ],
      ['jukebox', () => page.locator('[data-jukebox][data-dock] [data-part="mini-open"]').first().click()],
    ];
    for (const [name, open] of openers) {
      await open();
      await expect(status(page), name).toHaveAttribute('data-state', 'blocked');
      await expect(invite(page), name).toHaveCount(0);
      // Escape closes it (a press that lands during the opening animation can be swallowed: retry).
      await expect(async () => {
        await page.keyboard.press('Escape');
        await expect(status(page)).not.toHaveAttribute('data-state', 'blocked', { timeout: 1_500 });
      }, name).toPass({ timeout: 20_000 });
      await inviteShown(page);
    }
  });

  test('keyboard: Tab reaches it, Enter turns Halloween on, focus lands on the theme button', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard path on desktop');
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    const turnOn = invite(page).getByRole('button', { name: 'Turn on Halloween' });
    for (let i = 0; i < 80 && !(await turnOn.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(turnOn).toBeFocused();
    await page.keyboard.press('Enter');
    await themed(page, HN);
    await expect(themeButton(page)).toBeFocused();
  });

  test('reduced motion: the invite (and the Exit confirm) never animate', async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preset(page, { reducedMotion: true, fx: 'high' });
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    const running = (sel: string) =>
      page.locator(sel).evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === 'running')
            .filter((a) => {
              const t = a.effect?.getComputedTiming();
              return t?.iterations === Infinity || (typeof t?.duration === 'number' && t.duration > 50);
            }).length,
      );
    expect(await running('[data-part="seasonal-invite"]')).toBe(0);
    if (isMobile) return;
    await invite(page).getByRole('button', { name: 'Turn on Halloween' }).click();
    await themed(page, HN);
    await hudExit(page).getByRole('button', { name: 'Exit Halloween' }).click();
    await expect(hudExit(page).getByRole('group')).toBeVisible();
    expect(await running('.af-hud [data-part="exit-halloween"]')).toBe(0);
  });

  test('phones: no horizontal scroll, 44px targets, the plaque and the arrows stay usable', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone viewports only');
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    const box = (await invite(page).boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
    for (const name of ['Turn on Halloween', 'Not now']) {
      const b = (await invite(page).getByRole('button', { name }).boundingBox())!;
      expect(Math.min(b.width, b.height), name).toBeGreaterThanOrEqual(43.5);
    }
    // The card never sits on top of the floor's controls.
    for (const sel of ['.af-plaque__play', '.af-lineup__arrow--next', '.af-lineup__arrow--prev']) {
      const target = page.locator(sel).first();
      // A disabled arrow (first/last cabinet) is invisible and lets clicks through by design.
      if (!(await target.isVisible()) || (await target.isDisabled())) continue;
      await target.scrollIntoViewIfNeeded();
      const hit = await target.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === el || el.contains(top));
      });
      expect(hit, sel).toBe(true);
    }
    // With Halloween Night on, the phone HUD keeps Help on screen and has no Exit button (it's in the sheet).
    await invite(page).getByRole('button', { name: 'Turn on Halloween' }).click();
    await themed(page, HN);
    const help = (await page.locator('[data-part="arcade-header"]').getByRole('button', { name: 'Help and how to play' }).boundingBox())!;
    expect(help.x + help.width).toBeLessThanOrEqual(vp.width + 0.5);
    await expect(hudExit(page)).toBeHidden();
  });

  test('readable in every theme it can appear in (text ≥ 4.5:1 on an opaque card)', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'one engine is enough');
    test.setTimeout(120_000);
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    for (const id of THEMES) {
      await page.evaluate((t) => (window as any).__DASCADE_THEME__.setTheme(t), id);
      await themed(page, id);
      await inviteShown(page);
      for (const sel of ['.ssn-invite__title', '.ssn-invite__body']) {
        expect(await contrastOf(page, sel, '[data-part="seasonal-invite"]'), `${id} ${sel}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('the floor heading and plaque read the same for assistive tech with the invite up', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'one engine is enough');
    const names = async () =>
      [
        await page.getByRole('heading', { level: 1 }).first().ariaSnapshot(),
        await page.locator('[data-part="plaque"]').first().ariaSnapshot(),
      ]
        .join('\n')
        .replace(/\d+/g, 'N');
    await floorOn(page, 'off');
    await expect(status(page)).toHaveAttribute('data-state', 'off');
    const base = await names();
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    expect(await names()).toBe(base);
  });
});

test.describe('Exit Halloween', () => {
  test('HUD pumpkin: confirm, "Stay spooky", then Exit back to the previous theme', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the HUD button is for wide floors');
    await preset(page, { theme: 'neon-noir' });
    await floorOn(page, IN_SEASON);
    await themed(page, 'neon-noir');
    await inviteShown(page);
    await invite(page).getByRole('button', { name: 'Turn on Halloween' }).click();
    await themed(page, HN);
    const trigger = hudExit(page).getByRole('button', { name: 'Exit Halloween' });
    await trigger.click();
    const confirm = hudExit(page).getByRole('group', { name: 'Back to Neon Noir?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Stay spooky' }).click();
    await expect(confirm).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('data-theme', HN);
    await trigger.click();
    await hudExit(page).getByRole('group', { name: 'Back to Neon Noir?' }).getByRole('button', { name: 'Exit', exact: true }).click();
    await themed(page, 'neon-noir');
    await expect(page.locator('[data-part="toast"]').filter({ hasText: 'Back to Neon Noir.' })).toBeVisible();
    await expect.poll(() => stored(page)).toEqual({ year: 2026, dismissed: true });
    await page.reload();
    await themed(page, 'neon-noir');
    await expect(status(page)).toHaveAttribute('data-state', 'ineligible');
  });

  test('Settings → Display: back to Delta Neon when the remembered theme no longer exists', async ({ page }) => {
    await preset(page, { theme: HN, seasonal: { halloween: { via: 'invite', year: 2026, prev: 'windows-2000' } } });
    await floorOn(page, IN_SEASON);
    await themed(page, HN);
    const dialog = await openSettingsDisplay(page);
    const panel = dialog.locator('[data-part="exit-halloween"]');
    await panel.getByRole('button', { name: 'Exit Halloween' }).click();
    const confirm = panel.getByRole('group', { name: 'Back to Delta Neon?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Exit', exact: true }).click();
    await themed(page, 'delta-neon');
    await expect(dialog.locator('[data-part="exit-halloween"]')).toHaveCount(0);
    await expect(dialog.getByRole('radio', { name: 'Delta Neon', exact: true })).toBeFocused();
  });

  test('phones: the Themes sheet has the way back', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone viewports only');
    await preset(page, { theme: HN, seasonal: { halloween: { via: 'picker', prev: 'lan-party' } } });
    await floorOn(page, IN_SEASON);
    await themed(page, HN);
    await themeButton(page).click();
    const sheet = page.getByRole('dialog', { name: 'Themes' });
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-part="exit-halloween"]').getByRole('button', { name: 'Exit Halloween' }).click();
    await sheet.getByRole('group', { name: 'Back to Basement LAN Party?' }).getByRole('button', { name: 'Exit', exact: true }).click();
    await themed(page, 'lan-party');
  });

  test('the HUD fits with the pumpkin, which only shows on wide floors', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'viewport sweep on one engine');
    test.setTimeout(120_000);
    await preset(page, { theme: HN });
    for (const [width, height] of [
      [768, 1024],
      [1024, 768],
      [1280, 800],
      [1440, 900],
      [1920, 1080],
      [844, 390],
    ] as const) {
      await page.setViewportSize({ width, height });
      await floorOn(page, 'off');
      await themed(page, HN);
      const label = `${width}×${height}`;
      if (width >= 1024 && height >= 541) {
        await expect(hudExit(page), label).toBeVisible();
        // Where the pumpkin shows, it must not push the HUD's last button off screen. (Narrower tablet
        // floors already clip the HUD's last icons in every theme, Delta Neon included; the pumpkin never
        // shows there.)
        const help = (await page
          .locator('[data-part="arcade-header"]')
          .getByRole('button', { name: 'Help and how to play' })
          .boundingBox())!;
        expect(help, label).not.toBeNull();
        expect(help.x + help.width, `${label}: Help on screen`).toBeLessThanOrEqual(width + 0.5);
      } else await expect(hudExit(page), label).toBeHidden();
    }
  });
});

test.describe('the season’s end', () => {
  test('an invite-activated Halloween Night goes back after October 31', async ({ page }) => {
    await floorOn(page, '2026-10-31T23:58');
    await inviteShown(page);
    await invite(page).getByRole('button', { name: 'Turn on Halloween' }).click();
    await themed(page, HN);
    await expect.poll(() => stored(page)).toMatchObject({ via: 'invite', year: 2026 });
    await floorOn(page, '2026-11-01T00:01');
    await themed(page, 'delta-neon');
    await expect(
      page.locator('[data-part="toast"]').filter({ hasText: 'Halloween’s over — the arcade is back to Delta Neon.' }),
    ).toBeVisible();
    await expect.poll(() => stored(page)).toEqual({ year: 2026 });
  });

  test('a hand-picked Halloween Night stays', async ({ page }) => {
    await floorOn(page, '2026-10-20');
    await page.evaluate((t) => (window as any).__DASCADE_THEME__.setTheme(t), HN);
    await themed(page, HN);
    await expect.poll(() => stored(page)).toMatchObject({ via: 'picker' });
    await floorOn(page, '2026-11-02');
    await expect(status(page)).toHaveAttribute('data-state', 'ineligible');
    await themed(page, HN);
    await expect(page.locator('[data-part="toast"]').filter({ hasText: 'Halloween’s over' })).toHaveCount(0);
  });

  test('also checked when the tab comes back', async ({ page }) => {
    await floorOn(page, IN_SEASON);
    await inviteShown(page);
    await invite(page).getByRole('button', { name: 'Turn on Halloween' }).click();
    await themed(page, HN);
    await page.evaluate(() => {
      sessionStorage.setItem('dascade:qa:season', '2026-11-01T09:00');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await themed(page, 'delta-neon');
  });

  test('the real clock in October shows the invite too', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'one engine is enough');
    await page.clock.setFixedTime(new Date(2026, 9, 15, 12, 0));
    await floorOn(page, 'live');
    await inviteShown(page);
  });
});
