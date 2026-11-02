/**
 * Opening a room link shows what joining would do (the room's phase and seats, a warning before a
 * newcomer is seated as a spectator, and "Watch instead"), and the browser tab names the room.
 */
import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, setName, startGame, waitForPhase } from './helpers.ts';

test('a game in progress: its status, "Watch instead", and tab titles that follow the room', async ({ page, browser }) => {
  const code = await createRoom(page, 'wheel', 'Host');
  await expect(page).toHaveTitle(`${code} · Wheel of DAStiny · Lobby`);
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await expect(page).toHaveTitle(`${code} · Wheel of DAStiny · In progress`);

  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await visitor.goto(`/room/${code}`);
  await expect(visitor.locator('[data-part="join-status"]')).toHaveText(/^In progress · 1\/\d+ players$/);
  // Wheel takes late players, so joining seats them: no warning, but watching is on offer.
  await expect(visitor.locator('[data-part="join-warning"]')).toHaveCount(0);
  await setName(visitor, 'Onlooker');
  await visitor.getByRole('button', { name: 'Watch instead' }).click();
  await expect(visitor.locator('.lobby, .game-stage').first()).toBeVisible();
  const me = await myPlayerId(visitor);
  await expect.poll(async () => (await roomState(visitor)).players[me!]?.spectator).toBe(true);
  await expect(visitor).toHaveTitle(`${code} · Wheel of DAStiny · In progress`);
  await ctx.close();

  // Leaving gives the tab its old title back.
  await leaveRoom(page);
  await expect(page).not.toHaveTitle(new RegExp(code));
});

test('a full room says so, and that a newcomer will watch, before they join', async ({ page, browser }) => {
  const code = await createRoom(page, 'chess', 'Hostess');
  const guest = await joinRoom(browser, code, 'Guest');

  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await visitor.goto(`/room/${code}`);
  await expect(visitor.locator('[data-part="join-status"]')).toHaveText('Full · 2/2 players');
  await expect(visitor.locator('[data-part="join-warning"]')).toContainText('you’ll join as a spectator');
  await expect(visitor.getByRole('button', { name: 'Join game' })).toBeVisible();
  await ctx.close();
  await guest.context().close();
});
