/**
 * Tournament Center E2E: an organizer creates a chess tournament in the wizard, two players register
 * and check in from their own browsers, the organizer starts it, a player launches the match from the
 * kiosk, the match resolves by resignation, and the bracket crowns the champion. A Classics match
 * (Memory Matrix) starts by itself, and leaving a match room leads back to the kiosk.
 */
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { dropConnection, myPlayerId, roomState, setName, waitForPhase } from './helpers.ts';

/** Participants use the same device profile as the project (so "mobile" really plays on phones). */
function deviceOptions(): BrowserContextOptions {
  const use = test.info().project.use as Record<string, unknown>;
  const pick = ['viewport', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'baseURL', 'locale'] as const;
  const out: Record<string, unknown> = {};
  for (const k of pick) if (use[k] !== undefined) out[k] = use[k];
  return out as BrowserContextOptions;
}

async function joinKiosk(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext(deviceOptions());
  const page = await ctx.newPage();
  await page.goto(`/room/${code}`);
  await setName(page, name);
  await page.getByRole('button', { name: 'Join game' }).click();
  await expect(page.locator('.tk')).toBeVisible();
  return page;
}

async function kioskStatus(page: Page): Promise<string | undefined> {
  return (await roomState<{ status?: string }>(page))?.status;
}

test.describe('Tournament Center', () => {
  test('create → register → check in → start → play from the bracket → champion', async ({ page, browser }) => {
    test.setTimeout(180_000);

    // --- Organizer: landing + wizard -----------------------------------------------------------
    await page.goto('/tournaments');
    await expect(page.getByRole('heading', { name: 'Tournament Center' })).toBeVisible();
    await page.getByRole('button', { name: 'Create tournament' }).first().click();
    await page.getByRole('radio', { name: /DAS CHESS/ }).click();
    await expect(page.getByRole('radio', { name: /Single elimination/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByText('Require check-in', { exact: true }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Tournament name').fill('E2E Cup');
    await setName(page, 'Orga');
    await page.getByRole('button', { name: 'Create tournament' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    const code = page.url().split('/').pop()!;
    await expect(page.locator('.tk-head__name')).toHaveText('E2E Cup');
    await expect.poll(() => kioskStatus(page)).toBe('DRAFT');

    await page.getByRole('button', { name: 'Open registration' }).click();
    await expect.poll(() => kioskStatus(page)).toBe('REGISTRATION');

    // --- Two players register from their own browsers --------------------------------------------
    const ada = await joinKiosk(browser, code, 'Ada');
    const bo = await joinKiosk(browser, code, 'Bo');
    for (const p of [ada, bo]) {
      await p.getByRole('button', { name: 'Register', exact: true }).click();
      await expect(p.getByRole('heading', { name: 'You’re registered' })).toBeVisible();
    }
    await expect
      .poll(async () => Object.keys((await roomState<{ participants: Record<string, unknown> }>(page)).participants ?? {}).length)
      .toBe(2);

    // --- Check-in ---------------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Open check-in' }).first().click();
    await expect.poll(() => kioskStatus(page)).toBe('CHECK_IN');
    for (const p of [ada, bo]) {
      await p.getByRole('button', { name: 'Check in', exact: true }).click();
      await expect(p.getByRole('heading', { name: /Checked in/ })).toBeVisible();
    }

    // --- Organizer starts ---------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Start tournament' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start tournament' }).click();
    await expect.poll(() => kioskStatus(page)).toBe('IN_PROGRESS');
    await expect(page.locator('.tc-match, .tc-canvas').first()).toBeVisible();

    // --- Players launch their match from the kiosk --------------------------------------------------
    for (const p of [ada, bo]) {
      await expect(p.getByRole('button', { name: 'Play match' })).toBeVisible({ timeout: 20_000 });
      await p.getByRole('button', { name: 'Play match' }).click();
      await p.waitForURL((u) => /^\/room\/[A-Z0-9]{5}$/.test(u.pathname) && !u.pathname.endsWith(code), { timeout: 20_000 });
    }
    await expect(ada.locator('.tb')).toContainText('E2E Cup');
    await waitForPhase(ada, 'PLAYING', 30_000);

    // --- A participant whose seat token no longer matches (e.g. it expired during a long outage)
    //     gets the seat back with the ticket remembered alongside it — not a spectator's view. ---------
    const adaId = (await myPlayerId(ada))!;
    const matchCode = new URL(ada.url()).pathname.split('/').pop()!;
    await ada.evaluate((key) => {
      for (const store of [sessionStorage, localStorage]) {
        const seat = JSON.parse(store.getItem(key) ?? 'null');
        if (seat) store.setItem(key, JSON.stringify({ ...seat, seatToken: 'expired-seat-token-0000', reconnectionToken: undefined }));
      }
    }, `dascade:seat:${matchCode}`);
    await dropConnection(ada, { maxRetries: 0 });
    await ada.getByRole('button', { name: 'Rejoin my seat' }).click();
    await expect.poll(() => myPlayerId(ada)).toBe(adaId);
    await expect.poll(async () => (await roomState(ada)).players?.[adaId]?.spectator).toBe(false);

    // --- Resolve: Ada resigns ------------------------------------------------------------------------
    await ada.getByRole('button', { name: 'Resign' }).click();
    await ada.getByRole('button', { name: 'Confirm resign' }).click();
    await waitForPhase(ada, 'RESULTS', 15_000);

    // --- Back to the tournament: the bracket crowns Bo ------------------------------------------------
    await expect(bo.getByRole('button', { name: 'Back to tournament' })).toBeVisible({ timeout: 15_000 });
    await bo.getByRole('button', { name: 'Back to tournament' }).click();
    await bo.waitForURL(new RegExp(`/room/${code}$`));
    await expect.poll(() => kioskStatus(bo), { timeout: 15_000 }).toBe('COMPLETE');
    await expect(bo.locator('.tk-champ')).toContainText('Bo');
    await expect(bo.getByRole('heading', { name: 'You are the champion!' })).toBeVisible();
    await expect(page.locator('.tk-champ')).toContainText('Bo');

    await ada.context().close();
    await bo.context().close();
  });

  test('a Classics match (Memory Matrix) starts by itself; leaving through the shell returns to the kiosk', async ({ page, browser }) => {
    test.setTimeout(150_000);
    await page.goto('/tournaments');
    await page.getByRole('button', { name: 'Create tournament' }).first().click();
    await page.getByRole('radio', { name: /MEMORY MATRIX/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Tournament name').fill('Memory Cup');
    await setName(page, 'Orga');
    await page.getByRole('button', { name: 'Create tournament' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    const code = page.url().split('/').pop()!;
    await page.getByRole('button', { name: 'Open registration' }).click();
    await expect.poll(() => kioskStatus(page)).toBe('REGISTRATION');

    const ada = await joinKiosk(browser, code, 'Ada');
    const bo = await joinKiosk(browser, code, 'Bo');
    for (const p of [ada, bo]) {
      await p.getByRole('button', { name: 'Register', exact: true }).click();
      await expect(p.getByRole('heading', { name: 'You’re registered' })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Start tournament' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start tournament' }).click();
    await expect.poll(() => kioskStatus(page)).toBe('IN_PROGRESS');

    // Both players launch the match from the kiosk: nobody presses Start — the game begins by itself.
    for (const p of [ada, bo]) {
      await expect(p.getByRole('button', { name: 'Play match' })).toBeVisible({ timeout: 20_000 });
      await p.getByRole('button', { name: 'Play match' }).click();
      await p.waitForURL((u) => /^\/room\/[A-Z0-9]{5}$/.test(u.pathname) && !u.pathname.endsWith(code), { timeout: 20_000 });
    }
    await expect(ada.locator('.tb')).toContainText('Memory Cup');
    await waitForPhase(ada, 'PLAYING', 30_000);
    await waitForPhase(bo, 'PLAYING', 10_000);
    await expect(ada.locator('.cl-stage').first()).toBeVisible();

    // Ada walks out through the shell's Leave (the immersive game's menu): she lands back on the kiosk,
    // not on the arcade floor.
    await ada.getByRole('button', { name: 'Open menu' }).click();
    await ada.locator('.shell-menu').getByRole('button', { name: 'Leave', exact: true }).click();
    await ada.locator('.shell-menu').getByRole('button', { name: 'Leave match' }).click();
    await ada.waitForURL(new RegExp(`/room/${code}$`), { timeout: 15_000 });
    await expect(ada.locator('.tk')).toBeVisible();

    // Leaving forfeits: Bo wins at once and heads back to the kiosk from the results.
    await waitForPhase(bo, 'RESULTS', 15_000);
    await expect(bo.getByText(/This match is over/)).toBeVisible();
    await bo.locator('.cl-results').getByRole('button', { name: 'Back to tournament' }).click();
    await bo.waitForURL(new RegExp(`/room/${code}$`));
    await expect.poll(() => kioskStatus(bo), { timeout: 15_000 }).toBe('COMPLETE');
    await expect(bo.getByRole('heading', { name: 'You are the champion!' })).toBeVisible();

    // Leaving the kiosk goes to the Tournament Center landing.
    await ada.locator('.topbar').getByRole('button', { name: 'Leave room' }).click();
    await ada.locator('.topbar').getByRole('button', { name: 'Leave room' }).click();
    await ada.waitForURL(/\/tournaments$/);
    await expect(ada.getByRole('heading', { name: 'Tournament Center' })).toBeVisible();

    await ada.context().close();
    await bo.context().close();
  });

  test('the landing lists live tournaments and filters by game', async ({ page }) => {
    await page.goto('/tournaments?game=checkers');
    await expect(page.getByRole('button', { name: /Checkers/, pressed: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create a DAS Checkers tournament' })).toBeVisible();
    await page.getByRole('button', { name: 'All games' }).click();
    await expect(page).toHaveURL(/\/tournaments\??$/);
  });
});
