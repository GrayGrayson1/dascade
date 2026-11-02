/**
 * DAS Survey Showdown — the DAS-O-Ween presets out of season (Z1): outside October they wait in a
 * collapsed "Seasonal: DAS-O-Ween" group below the year-round presets, one click away (never
 * removed), and loading one keeps the group open. In October the group is open.
 *
 * Each test pins the season with the `?season=` QA date (sessionStorage), so the spec doesn't change
 * with the calendar.
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom, roomState } from './helpers.ts';
import { loadPreset } from './showdown-presets.ts';

/** Phones show one lobby section at a time: open the one that holds `target`. */
async function showLobbySection(page: Page, tab: 'Settings' | 'Setup'): Promise<void> {
  const t = page.getByRole('tab', { name: tab });
  if (await t.isVisible().catch(() => false)) await t.click();
}

const pinSeason = (page: Page, date: string) => page.addInitScript((d) => sessionStorage.setItem('dascade:qa:season', d), date);
const settingsOf = async (page: Page) => JSON.parse((await roomState(page)).settingsJson) as Record<string, unknown>;

test('in November DAS-O-Ween waits, collapsed, under Seasonal: one click opens it, and a loaded one keeps it open', async ({ page }) => {
  const host = page;
  await pinSeason(host, '2026-11-15');
  await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  const presets = host.locator('[data-part="showdown-presets"]');
  // The year-round pair is first and visible.
  await expect(host.getByRole('button', { name: 'Load Event show' })).toBeVisible();
  const seasonal = presets.locator('[data-part="showdown-seasonal-presets"]');
  await expect(seasonal.locator('summary')).toContainText('Seasonal: DAS-O-Ween');
  await expect(seasonal.locator('summary')).toContainText('Up front in October');
  await expect(seasonal).not.toHaveAttribute('open', /.*/);
  await expect(host.getByRole('button', { name: 'Load DAS-O-Ween 2026' })).toBeHidden();

  await seasonal.locator('summary').click();
  await expect(seasonal).toHaveAttribute('open', /.*/);
  await host.getByRole('button', { name: 'Load DAS-O-Ween 2026' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-2026');
  expect(await settingsOf(host)).toMatchObject({ look: 'halloween', source: 'custom', title: 'DAS-O-Ween Trivia' });
  await expect(host.locator('[data-part="showdown-showfile-prompt"]')).toContainText('Now load your show file.');
  await expect(seasonal).toHaveAttribute('open', /.*/);

  // Back to the year-round show: DAS-O-Ween's names go with it.
  await loadPreset(host, 'Load Event show');
  await expect.poll(async () => (await settingsOf(host)).look).toBe('showtime');
  expect(await settingsOf(host)).toMatchObject({ title: '', eventName: '', source: 'packs' });
});

test('in October the DAS-O-Ween group is open, below the year-round presets', async ({ page }) => {
  const host = page;
  await pinSeason(host, '2026-10-15');
  await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  const presets = host.locator('[data-part="showdown-presets"]');
  await expect(presets.locator('.sdc-preset__title').first()).toContainText('Event show');
  const seasonal = presets.locator('[data-part="showdown-seasonal-presets"]');
  await expect(seasonal).toHaveAttribute('open', /.*/);
  await expect(seasonal.locator('summary')).not.toContainText('Up front in');
  await expect(seasonal.locator('.sdc-preset__title').first()).toContainText('DAS-O-Ween 2026');
});
