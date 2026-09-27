/** Shared E2E helpers for the DAScade Classics games (kit owner: classics-a). */
import { expect, type Page } from '@playwright/test';
import { roomState, setName } from './helpers';

/** From the Classics picker, open a game's title screen and start a solo room. Returns the room code. */
export async function openSoloFromPicker(page: Page, title: RegExp, gameId: string, name = 'E2E'): Promise<string> {
  await page.goto('/cabinet/classics');
  const link = page.getByRole('link', { name: title }).first();
  if (await link.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await link.click();
    await page.waitForURL(new RegExp(`/play/${gameId}`));
  } else {
    // Picker not available: fall back to the title screen directly.
    await page.goto(`/play/${gameId}`);
  }
  await setName(page, name);
  await page.getByRole('button', { name: /Play solo/i }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
  await expect(page.locator('.cl-shell')).toBeVisible({ timeout: 15_000 });
  return page.url().split('/').pop()!;
}

export async function myId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__DASCADE__.store.getState().playerId as string);
}

export async function myStanding(page: Page): Promise<any> {
  const [s, id] = await Promise.all([roomState(page), myId(page)]);
  return s?.standings?.[id];
}

/** Presses Start on the instructions card. */
export async function pressStart(page: Page): Promise<void> {
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeVisible({ timeout: 15_000 });
  await start.click();
  await expect.poll(async () => (await myStanding(page))?.status, { timeout: 10_000 }).toBe('playing');
}

/** Back to Classics from the header; lands on the picker. */
export async function backToClassics(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Back to Classics' }).first().click();
  const leave = page.getByRole('button', { name: 'Leave', exact: true });
  if (await leave.isVisible({ timeout: 800 }).catch(() => false)) await leave.click();
  await page.waitForURL(/\/cabinet\/classics$/, { timeout: 15_000 });
}
