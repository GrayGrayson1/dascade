import { expect, test, type TestInfo } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers.ts';

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

const board = async (page: import('@playwright/test').Page) => {
  const s = await roomState(page);
  return s?.boardJson ? JSON.parse(s.boardJson) : null;
};

test('DAS Survey Showdown: the presenter runs a round, the audience only ever sees revealed answers', async ({ page, browser }, testInfo) => {
  const host = page;
  const code = await createRoom(host, 'showdown', 'Host');
  const ada = await joinRoom(browser, code, 'Ada', device(testInfo));
  await expect.poll(async () => Object.keys((await roomState(host)).teams ?? {}).length).toBe(1);
  // The creator presents; Ada was put on a team.
  const state = await roomState(ada);
  expect(state.presenterId).toBe(state.hostId);
  expect(Object.values(state.teams)).toEqual([0]);

  await startGame(host);
  await waitForPhase(host, 'PLAYING');

  // Presenter console: start round 1 and bring up the question.
  await host.getByRole('button', { name: 'Start round 1' }).first().click();
  await expect.poll(async () => (await board(host))?.stage).toBe('title');
  await host.getByRole('button', { name: /Show the question/ }).first().click();
  await expect.poll(async () => (await board(ada))?.stage).toBe('live');

  // Only the presenter has the answer sheet.
  const answers = (await host.locator('.sd-answer__text').allTextContents()).map((t) => t.trim()).filter(Boolean);
  expect(answers.length).toBeGreaterThanOrEqual(3);
  const adaHtml = await ada.content();
  for (const a of answers) expect(adaHtml.toUpperCase()).not.toContain(`>${a.toUpperCase()}<`);
  expect(await ada.locator('.sd-answer').count()).toBe(0);

  // Ada locks in a private guess and cheers.
  await ada.getByRole('textbox', { name: 'Your guess' }).fill('Something unlikely');
  await ada.getByRole('button', { name: 'Lock in' }).click();
  await expect(ada.getByText('Something unlikely')).toBeVisible();
  await ada.getByRole('button', { name: /Applause/ }).click();

  // Face-off won by Team 1; reveal the top answer and strike once.
  await host.getByRole('button', { name: 'Team Delta play' }).click();
  await expect.poll(async () => (await board(host))?.control).toBe(0);
  await host.getByRole('button', { name: new RegExp(`^Reveal answer 1: `) }).click();
  await expect.poll(async () => (await board(ada))?.slots?.[0]?.revealed).toBe(true);
  await expect(ada.locator('.sd-tile').first()).toHaveAttribute('aria-label', new RegExp(answers[0]!, 'i'));
  // Answer 2 stays hidden from the audience.
  expect((await ada.content()).toUpperCase()).not.toContain(`>${answers[1]!.toUpperCase()}<`);
  await host.getByRole('button', { name: /^Strike/ }).click();
  await expect.poll(async () => (await board(ada))?.strikes).toBe(1);

  // End the show: everyone lands on the finale.
  await host.getByRole('button', { name: 'End show' }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'End show' }).click();
  await waitForPhase(ada, 'RESULTS');
  await expect.poll(async () => (await roomState(ada)).finaleJson).not.toBe('');
  await expect(host.getByRole('button', { name: 'Play again' })).toBeVisible();

  await leaveRoom(ada);
  await leaveRoom(host);
});

test('DAS Survey Showdown: a big-screen device shows the stage and joins no team', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page, 'showdown', 'Host');
  const ctx = await browser.newContext(device(testInfo));
  const tv = await ctx.newPage();
  await tv.goto(`/room/${code}?screen=1`);
  await tv.getByPlaceholder('Pick a nickname').fill('Big Screen');
  await tv.getByRole('button', { name: 'Join game' }).click();
  await expect(tv.locator('[data-part="showdown-screen"] .sd-stage')).toBeVisible();
  await expect.poll(async () => Object.keys((await roomState(page)).screens ?? {}).length).toBe(1);
  expect(Object.keys((await roomState(page)).teams ?? {})).toEqual([]);
  // The waiting marquee shows the room code for the audience.
  await expect(tv.locator('.sd-joincard__code')).toHaveAttribute('aria-label', `Room code ${code}`);
  await leaveRoom(tv);
  await leaveRoom(page);
});

test('DAS Survey Showdown: the big-screen link opened in the presenter’s own browser never shows the console', async ({ page }) => {
  const code = await createRoom(page, 'showdown', 'Host');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await page.getByRole('button', { name: 'Start round 1' }).first().click();
  await page.getByRole('button', { name: /Show the question/ }).first().click();
  await expect(page.locator('.sd-answer').first()).toBeVisible();
  // Same browser = same seat: this tab takes over the presenter's seat, but must not put the answers up.
  const tab = await page.context().newPage();
  await tab.goto(`/room/${code}?screen=1`);
  await expect(tab.locator('[data-part="showdown-screen-guard"]')).toBeVisible();
  expect(await tab.locator('.sd-answer, .sd-console').count()).toBe(0);
  // Choosing to run the show from here brings the console back (and the choice sticks).
  await tab.getByRole('button', { name: 'Use this tab as the presenter console' }).click();
  await expect(tab.locator('.sd-answer').first()).toBeVisible();
  expect(new URL(tab.url()).searchParams.has('screen')).toBe(false);
  await leaveRoom(tab);
});
