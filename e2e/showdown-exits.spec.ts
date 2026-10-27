/**
 * DAS Survey Showdown hides the ways back to the arcade on its main screens, for now (Brian,
 * 2026-10-27; apps/web/src/shell/arcadeExit.ts, docs/SHOWDOWN.md "To revisit: leaving a show"):
 * no Leave in the top bar, the lobby bar, the results or the big screen's corner, and the invite's
 * join card centres Join game with no Arcade button. Every other game keeps its buttons.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, setName, startGame, waitForPhase } from './helpers.ts';

/** Same device profile as the running project (so mobile runs use phones for every player). */
function device(testInfo: TestInfo) {
  const use = testInfo.project.use;
  return {
    baseURL: use.baseURL,
    viewport: use.viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
  };
}

/** Every button that leaves the room for the arcade floor or the cabinet. */
const exits = (page: Page) => page.getByRole('button', { name: /^(Leave|Leave room|Back to cabinet|Arcade)$/ });

/** The invite: a fresh device opening /room/<code> (no saved name), once the room's game is known. */
async function openInvite(page: Page, code: string, testInfo: TestInfo, game: string, query = ''): Promise<Page> {
  const ctx = await page.context().browser()!.newContext(device(testInfo));
  const guest = await ctx.newPage();
  await guest.goto(`/room/${code}${query}`);
  await expect(guest.locator('[data-part="join-prompt"] .shell-crumb__game')).toHaveText(game);
  return guest;
}

test('Survey Showdown: the lobby, the show and the results have no way back to the arcade', async ({ page, browser }, testInfo) => {
  const host = page;
  const code = await createRoom(host, 'showdown', 'Host');
  const ada = await joinRoom(browser, code, 'Ada', device(testInfo));

  for (const p of [host, ada]) {
    await expect(p.locator('[data-part="lobby-actions"]')).toBeVisible();
    await expect(p.locator('[data-part="top-bar"]')).toBeVisible();
    await expect(exits(p)).toHaveCount(0);
  }
  // The phone bar keeps no empty column where Leave was.
  await expect(ada.locator('.lobby__actions-inner')).toHaveAttribute('data-leave', 'off');

  await startGame(host);
  await waitForPhase(ada, 'PLAYING');
  await expect(host.getByRole('button', { name: 'End show' })).toBeVisible();
  for (const p of [host, ada]) await expect(exits(p)).toHaveCount(0);

  await host.getByRole('button', { name: 'End show' }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'End show' }).click();
  await waitForPhase(ada, 'RESULTS');
  await expect(host.getByRole('button', { name: 'Play again' })).toBeVisible();
  await expect(ada.locator('[data-part="results-buttons"]')).toBeVisible();
  for (const p of [host, ada]) await expect(exits(p)).toHaveCount(0);

  await leaveRoom(ada);
  await leaveRoom(host);
});

test('Survey Showdown: the invite centres Join game, with no Arcade button', async ({ page }, testInfo) => {
  const code = await createRoom(page, 'showdown', 'Host');
  const guest = await openInvite(page, code, testInfo, 'DAS Survey Showdown');
  const card = guest.locator('[data-part="join-prompt"]');
  const join = card.getByRole('button', { name: 'Join game' });
  await expect(join).toBeVisible();
  await expect(exits(guest)).toHaveCount(0);

  const [button, body] = await Promise.all([join.boundingBox(), card.locator('.join-prompt__body').boundingBox()]);
  expect(button && body).toBeTruthy();
  expect(Math.abs(button!.x + button!.width / 2 - (body!.x + body!.width / 2))).toBeLessThan(2);

  await setName(guest, 'Ada');
  await join.click();
  await expect(guest.locator('[data-part="lobby-actions"]')).toBeVisible();
  await expect(exits(guest)).toHaveCount(0);
  await leaveRoom(guest);
  await leaveRoom(page);
});

test('Survey Showdown: the big screen keeps Exit big screen, with no Leave', async ({ page }, testInfo) => {
  const code = await createRoom(page, 'showdown', 'Host');
  const tv = await openInvite(page, code, testInfo, 'DAS Survey Showdown', '?screen=1');
  await expect(exits(tv)).toHaveCount(0);
  await setName(tv, 'Big Screen');
  await tv.getByRole('button', { name: 'Join game' }).click();
  await expect(tv.locator('[data-part="showdown-screen"] .sd-stage')).toBeVisible();
  await expect(tv.getByRole('button', { name: 'Exit big screen' })).toBeVisible();
  await expect(exits(tv)).toHaveCount(0);
  await leaveRoom(tv);
  await leaveRoom(page);
});

test('other games keep Leave in the lobby and Arcade on the invite', async ({ page }, testInfo) => {
  const code = await createRoom(page, 'wheel', 'Spinner');
  await expect(page.locator('[data-part="lobby-actions"]').getByRole('button', { name: 'Leave' })).toBeVisible();
  await expect(page.locator('[data-part="top-bar-left"]').getByRole('button', { name: 'Leave room' })).toBeVisible();
  const guest = await openInvite(page, code, testInfo, 'Wheel of DAStiny');
  await expect(guest.locator('[data-part="join-prompt"]').getByRole('button', { name: 'Arcade' })).toBeVisible();
  await leaveRoom(page);
});
