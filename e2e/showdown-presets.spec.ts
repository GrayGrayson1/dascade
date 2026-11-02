/**
 * DAS Survey Showdown — event presets all year (Z1): the year-round "Event show" is listed first and
 * makes the room an event room on the question packs (crew links, the preflight, the black box), with
 * the neutral Showtime look. "Event rehearsal" brings two practice boards, and Event show then puts
 * them away.
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom, roomState } from './helpers.ts';

/** Phones show one lobby section at a time: open the one that holds `target`. */
async function showLobbySection(page: Page, tab: 'Settings' | 'Setup'): Promise<void> {
  const t = page.getByRole('tab', { name: tab });
  if (await t.isVisible().catch(() => false)) await t.click();
}

const settingsOf = async (page: Page) => JSON.parse((await roomState(page)).settingsJson) as Record<string, unknown>;

test('Event show comes first and makes an event room on the question packs, with nothing to load', async ({ page }) => {
  const host = page;
  await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  const presets = host.locator('[data-part="showdown-presets"]');
  await expect(presets.locator('.sdc-preset__title').first()).toContainText('Event show');
  await expect(presets.locator('.sdc-preset__title').nth(1)).toContainText('Event rehearsal');

  // One click: an event room on the question packs, the Showtime look, nothing to load.
  await host.getByRole('button', { name: 'Load Event show' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('event-show');
  await expect(host.locator('[data-part="showdown-event-badge"]')).toBeVisible();
  expect(await settingsOf(host)).toMatchObject({ mode: 'showcase', look: 'showtime', source: 'packs' });
  await expect(host.locator('[data-part="showdown-preset-status"]')).toContainText(
    'Event show’s settings with 4 rounds from the question packs',
  );
  await expect(host.locator('[data-part="showdown-showfile-prompt"]')).toHaveCount(0);

  // The event room's crew tools: the producer link and a preflight with the show already loaded.
  await showLobbySection(host, 'Setup');
  const crewChecks = host.locator('[data-part="showdown-crew-checks"]');
  await expect(crewChecks).toBeVisible();
  await expect(crewChecks.locator('[data-part="showdown-producer-link"]')).toBeVisible();
  const showRow = crewChecks.locator('[data-part="showdown-preflight"] [data-check="show"]');
  await expect(showRow).toHaveAttribute('data-state', 'ok');
  await expect(showRow).toContainText('4 rounds from the question packs');
});

test('Event rehearsal brings two practice boards; Event show then puts them away', async ({ page }) => {
  const host = page;
  await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  await host.getByRole('button', { name: 'Load Event rehearsal (demo answers)' }).click();
  await expect.poll(async () => (await roomState(host)).rehearsal).toBe(true);
  expect((await roomState(host)).customRounds).toBe(2);
  expect(await settingsOf(host)).toMatchObject({ look: 'showtime', source: 'custom' });
  await expect(host.locator('[data-part="showdown-preset-status"]')).toContainText('For the real show, load Event show.');

  await host.getByRole('button', { name: 'Load Event show' }).click();
  await expect.poll(async () => (await roomState(host)).rehearsal).toBe(false);
  expect((await roomState(host)).customRounds).toBe(0);
  expect(await settingsOf(host)).toMatchObject({ source: 'packs' });
  await expect(host.locator('[data-part="showdown-preset-status"]')).toContainText('from the question packs');
});
