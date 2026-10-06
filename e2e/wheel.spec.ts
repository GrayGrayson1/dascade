import { test, expect, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers.ts';

/** The lobby collapses into tabs on narrow screens; open the settings tab when it exists. */
async function openSettings(page: Page) {
  const tab = page.getByRole('tab', { name: 'Settings' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

async function segmentLabels(page: Page): Promise<string[]> {
  const state = await roomState(page);
  return (JSON.parse(state?.settingsJson ?? '{}').segments ?? []).map((s: { label: string }) => s.label);
}

test('wheel smoke: bulk paste, join, spin together, same winner, leave', async ({ page, browser }) => {
  const code = await createRoom(page, 'wheel', 'Host');

  // Build the wheel with a bulk paste (CSV-like extras included).
  await openSettings(page);
  await page.getByRole('button', { name: 'Bulk paste' }).click();
  await page.getByLabel('Paste options').fill('Alpha\nBravo, 2, #22d3ee\n🎯 Charlie, x3');
  await page.getByRole('button', { name: 'Replace all' }).click();
  await expect.poll(() => segmentLabels(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  const settings = JSON.parse((await roomState(page)).settingsJson);
  expect(settings.segments[1]).toMatchObject({ weight: 2, color: '#22d3ee' });
  expect(settings.segments[2]).toMatchObject({ weight: 3, emoji: '🎯' });

  // Shortest spin, set through the real slider (keyboard: Home = minimum).
  const slider = page.getByRole('slider', { name: 'Spin duration' });
  await slider.focus();
  await slider.press('Home');
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).spinDurationMs).toBe(2000);

  const guest = await joinRoom(browser, code, 'Guest');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForPhase(guest, 'PLAYING');

  // Only the host may spin by default.
  await expect(guest.getByTestId('wheel-waiting')).toHaveText(/Waiting for Host to spin/);
  await expect(guest.getByRole('button', { name: 'Spin the wheel' })).toHaveCount(0);
  const spin = page.getByRole('button', { name: 'Spin the wheel' });
  await expect(spin).toBeEnabled();
  await spin.click();

  // The server publishes the whole plan (winner included) the moment the spin starts.
  await expect.poll(async () => (await roomState(page)).spin.spinId, { timeout: 10_000 }).toBe(1);
  const hostSpin = (await roomState(page)).spin;
  await expect.poll(async () => (await roomState(guest)).spin.spinId, { timeout: 10_000 }).toBe(1);
  expect((await roomState(guest)).spin).toMatchObject({
    startAt: hostSpin.startAt,
    toRotation: hostSpin.toRotation,
    winnerId: hostSpin.winnerId,
    snapshotJson: hostSpin.snapshotJson,
  });
  const winner = JSON.parse(hostSpin.snapshotJson).segments[hostSpin.winnerIndex];
  expect(['Alpha', 'Bravo', 'Charlie']).toContain(winner.label);

  // Both screens land and reveal the same winner at the same moment.
  await Promise.all([
    expect(page.getByTestId('wheel-result')).toHaveText(winner.label, { timeout: 15_000 }),
    expect(guest.getByTestId('wheel-result')).toHaveText(winner.label, { timeout: 15_000 }),
  ]);
  for (const p of [page, guest]) {
    await expect.poll(async () => (await roomState(p)).spin.status, { timeout: 10_000 }).toBe('landed');
    await expect(p.getByRole('list', { name: 'Spin results, newest first' }).getByText(winner.label)).toBeVisible();
  }

  await leaveRoom(guest);
  await leaveRoom(page);
  await expect(page).toHaveURL(/\/$/);
});

/** Starts this tab in a theme (once per tab, before any app script runs). */
async function presetTheme(page: Page, theme: string): Promise<void> {
  await page.addInitScript((id) => {
    try {
      if (!sessionStorage.getItem('wheel-theme-preset')) {
        const key = 'dascade:v1:settings';
        const prev = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(key, JSON.stringify({ ...prev, theme: id, settingsVersion: 3 }));
        sessionStorage.setItem('wheel-theme-preset', '1');
      }
    } catch {
      /* storage unavailable */
    }
  }, theme);
}

/** The pointer body's first gradient stop, as computed (themes may recolour it via --wh-pointer-*). */
async function pointerStopColor(page: Page): Promise<string> {
  const stop = page.locator('[data-part="wheel-pointer"] linearGradient stop').first();
  await expect(stop).toBeAttached();
  return stop.evaluate((el) => getComputedStyle(el).stopColor);
}

test('the wheel pointer keeps its own colours in the default theme', async ({ page }) => {
  await createRoom(page, 'wheel', 'Host');
  await openSettings(page);
  expect(await pointerStopColor(page)).toBe('rgb(255, 157, 189)');
  await leaveRoom(page);
});

test('Halloween Night pre-selects the Trick or Treat preset; the room only changes on Load', async ({ page }) => {
  await presetTheme(page, 'halloween-night');
  await createRoom(page, 'wheel', 'Host');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'halloween-night');
  await openSettings(page);

  const before = await segmentLabels(page);
  expect(before.length).toBeGreaterThan(0);
  expect(before).not.toContain('Pumpkin Jackpot');
  await expect(page.getByRole('combobox', { name: 'Presets' })).toHaveValue('builtin:trick-or-treat');
  expect(await segmentLabels(page)).toEqual(before);

  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await expect.poll(() => segmentLabels(page)).toContain('Pumpkin Jackpot');
  const settings = JSON.parse((await roomState(page)).settingsJson);
  expect(settings.sliceMode).toBe('weighted');
  expect(settings.segments.find((s: { label: string }) => s.label === 'Pumpkin Jackpot')).toMatchObject({ weight: 1, emoji: '🎃' });
  await leaveRoom(page);
});
