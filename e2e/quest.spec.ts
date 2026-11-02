import { test, expect, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers';

async function pickHero(page: Page, name: string): Promise<void> {
  // Phones show the lobby in tabs; the hero picker lives under "Your setup".
  const tab = page.getByRole('tab', { name: 'Your setup' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  await page.getByRole('radio', { name }).click();
  await expect(page.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
}

async function nodeId(page: Page): Promise<string | undefined> {
  const state = await roomState(page);
  return state?.sceneJson ? JSON.parse(state.sceneJson).nodeId : undefined;
}

test('DASQuest smoke: pick heroes, start, vote, roll a check, leave', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page, 'quest', 'Ava');
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const guest = await joinRoom(browser, code, 'Ben', { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor });

  await pickHero(page, 'Tinker');
  await pickHero(guest, 'Signal Seer');
  await expect
    .poll(async () => {
      const s = await roomState(page);
      return Object.values(s?.heroes ?? {})
        .map((h: any) => h.archetype)
        .sort()
        .join(',');
    })
    .toBe('seer,tinker');

  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await expect.poll(() => nodeId(page)).toBe('c1_start');
  await expect(page.getByRole('heading', { level: 2, name: '6:47 PM, Floor Seven' })).toBeVisible();

  // Both players vote for the copy room; the scene advances.
  await guest.getByRole('button', { name: 'Follow the noise to the copy room' }).click();
  await page.getByRole('button', { name: 'Follow the noise to the copy room' }).click();
  await expect.poll(() => nodeId(page), { timeout: 15_000 }).toBe('c1_printer');
  await expect(page.getByRole('heading', { level: 2, name: 'The Printer Has Opinions' })).toBeVisible();
  await expect(page.getByLabel('What just happened')).toContainText('2/2 votes');

  // A skill check: the server rolls and everyone sees the dice.
  await guest.getByRole('button', { name: 'Clear the paper jam' }).click();
  await page.getByRole('button', { name: 'Clear the paper jam' }).click();
  await expect(page.getByRole('dialog', { name: 'Wits check' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => nodeId(page), { timeout: 15_000 }).toMatch(/^c1_printer_(friend|angry)$/);
  const state = await roomState(page);
  expect(JSON.parse(state.rollJson)).toMatchObject({ stat: 'WITS', choiceId: 'fix' });
  expect(state.log.some((l: any) => /WITS check by Ava/.test(l.text))).toBe(true);

  await leaveRoom(guest);
  await leaveRoom(page);
});

test('DASQuest: the lobby offers Snowed In at Delta Alpha, and it plays to an ending', async ({ page }) => {
  await createRoom(page, 'quest', 'Ava');

  // The pack picker lists the winter adventure straight from the server's pack registry.
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible().catch(() => false)) await settingsTab.click();
  const adventure = page.getByLabel('Adventure');
  await expect(adventure.locator('option', { hasText: 'Snowed In at Delta Alpha' })).toHaveCount(1);
  await adventure.selectOption({ label: 'Snowed In at Delta Alpha' });
  await expect.poll(async () => (await roomState(page))?.packId).toBe('snowed-in');
  await expect(page.getByText(/The roads are closed, the heat is off/)).toBeVisible();

  await pickHero(page, 'Guardian');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await expect.poll(() => nodeId(page)).toBe('w_start');
  await expect(page.getByRole('heading', { level: 2, name: 'Away Mode' })).toBeVisible();

  // One choice per scene that is always on offer; checks may go either way, every branch is covered.
  const route: Record<string, string> = {
    w_start: 'Check the break room for anything hot',
    w_vending: 'Leave it: heat first, cocoa later',
    w_hall: 'Take the stairs down',
    w_stairs: 'Dash past the spray',
    w_boiler: 'Relight BERTHA by the book',
    w_sputter: 'Retreat upstairs and regroup',
    w_retreat: 'Build the greatest blanket fort in company history',
    w_relight: 'Head up to the potluck',
    w_potluck: 'Dig in',
  };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const s = await roomState(page);
    if (s?.phase === 'RESULTS') break;
    const id = s?.sceneJson ? JSON.parse(s.sceneJson).nodeId : undefined;
    const label = id ? route[id] : undefined;
    if (s?.stage !== 'voting' || !label) {
      await page.waitForTimeout(250);
      continue;
    }
    await page.getByRole('button', { name: label }).click();
    await expect
      .poll(
        async () => {
          const next = await roomState(page);
          return next?.phase === 'RESULTS' || next?.sceneRev !== s.sceneRev;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  }
  await waitForPhase(page, 'RESULTS');
  await expect(page.locator('#qs-ending-title')).toHaveText(/Warm Enough|Fort Delta Alpha|Office Popsicles/);

  await leaveRoom(page);
});
