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
