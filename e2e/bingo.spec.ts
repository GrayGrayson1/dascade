import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers.ts';

/** On phones the lobby shows one section at a time; open the settings tab when it exists. */
async function openSettings(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Settings' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

/** True when this player's BINGO button says the pattern is complete. */
async function isReady(page: Page): Promise<boolean> {
  return (await page.locator('.bg-bingo-btn[data-ready="true"]').count()) > 0;
}

test('DAS Bingo: set up a quick text game, call squares by hand, claim and see the winner', async ({ page, browser }) => {
  const code = await createRoom(page, 'bingo', 'Host');

  // Lobby: pick the quick 3×3 text setup and switch to the manual caller.
  await openSettings(page);
  await page.getByRole('button', { name: /Quick 3×3 party/ }).click();
  await page.getByRole('radio', { name: 'Manual (host calls)' }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).callerMode).toBe('manual');
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).mode).toBe('text');

  const guest = await joinRoom(browser, code, 'Guest');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForPhase(guest, 'PLAYING');

  // Both players get their own card and see the required pattern.
  await expect(page.getByRole('group', { name: 'Your bingo card' })).toBeVisible();
  await expect(guest.getByRole('group', { name: 'Your bingo card' })).toBeVisible();
  await expect(guest.getByRole('region', { name: 'Winning pattern' }).getByText('Any line')).toBeVisible();

  // Host calls until someone's card completes a line, then that player claims.
  let claimer: Page | null = null;
  for (let i = 0; i < 12 && !claimer; i++) {
    const before = ((await roomState(page)).calls as number[]).length;
    await page.getByRole('button', { name: 'Call next' }).click();
    await expect.poll(async () => ((await roomState(page)).calls as number[]).length).toBe(before + 1);
    await page.waitForTimeout(150);
    if (await isReady(guest)) claimer = guest;
    else if (await isReady(page)) claimer = page;
  }
  expect(claimer).not.toBeNull();
  await claimer!.getByRole('button', { name: 'BINGO!' }).click();

  // The server verifies the claim and shows the results with the winner and pattern.
  await waitForPhase(page, 'RESULTS');
  const state = await roomState(page);
  expect(state.winners.length).toBeGreaterThanOrEqual(1);
  const winner = state.winners[0].name as string;
  expect(['Host', 'Guest']).toContain(winner);
  await expect(guest.getByRole('region', { name: 'Game results' }).getByText(winner, { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: `${winner}'s winning card` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();

  await leaveRoom(guest);
  await leaveRoom(page);
});

test('DAS Bingo: a false claim is rejected by the server', async ({ page, browser }) => {
  const code = await createRoom(page, 'bingo', 'Host');
  await openSettings(page);
  await page.getByRole('radio', { name: 'Manual (host calls)' }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).callerMode).toBe('manual');
  const guest = await joinRoom(browser, code, 'Eager');
  await startGame(page);
  await waitForPhase(guest, 'PLAYING');
  await guest.getByRole('button', { name: 'BINGO!' }).click();
  await expect(guest.getByText('False alarm')).toBeVisible();
  await expect.poll(async () => {
    const s = await roomState(page);
    const eager = Object.values(s.players as Record<string, { id: string; name: string }>).find((p) => p.name === 'Eager')!;
    return s.bingo[eager.id]?.falseClaims ?? 0;
  }).toBe(1);
  expect((await roomState(page)).winners).toHaveLength(0);
  await leaveRoom(guest);
  await leaveRoom(page);
});
