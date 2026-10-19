/**
 * DAS Survey Showdown — Presenter Showcase (the DAS-O-Ween show): the presenter loads the preset in the
 * lobby, runs a round from the console (a found answer, the special #5, wrong answers, the clock,
 * Reveal remaining), moves on, finishes and puts up a stage card — while a phone in the audience never
 * has an unrevealed answer in its page and no answer of the show is in the JavaScript the site serves.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
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

const board = async (page: Page) => {
  const s = await roomState(page);
  return s?.boardJson ? JSON.parse(s.boardJson) : null;
};

/** Answers of round 1 that must never be on an audience page before they flip (titles, not single words). */
const ROUND_1_SECRETS = ['Monster Mash', 'This Is Halloween', 'Somebody’s Watching Me', 'Werewolves of London', 'Purple People Eater'];

async function loadDasoween(page: Page): Promise<void> {
  // Phones show one lobby section at a time.
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await page.getByRole('button', { name: 'Load DAS-O-Ween 2026' }).click();
  await expect.poll(async () => (await roomState(page)).customRounds).toBe(2);
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).mode).toBe('showcase');
}

test('DAS-O-Ween: the presenter runs a showcase round; the audience only ever sees what flipped', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop.');
  test.setTimeout(120_000);
  const host = page;
  const code = await createRoom(host, 'showdown', 'Host');
  await loadDasoween(host);
  const phone = await joinRoom(browser, code, 'Ada', {
    ...device(testInfo),
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  // A showcase has no teams.
  await expect.poll(async () => Object.keys((await roomState(host)).players ?? {}).length).toBe(2);
  expect(Object.keys((await roomState(host)).teams ?? {})).toEqual([]);

  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await host
    .getByRole('button', { name: /^Start round 1/ })
    .first()
    .click();
  await expect.poll(async () => (await board(host))?.stage).toBe('title');
  await expect.poll(async () => (await board(phone))?.title).toBe('Halloween Songs');
  await host
    .getByRole('button', { name: /^Show the question/ })
    .first()
    .click();
  await expect.poll(async () => (await board(phone))?.stage).toBe('live');
  // The clock started with the question.
  await expect.poll(async () => (await roomState(host)).clockEndsAt).toBeGreaterThan(0);

  // Nothing unrevealed is anywhere on the phone's page.
  const phoneHtml = async () => (await phone.content()).replace(/&#x27;|&#39;/g, '’');
  for (const s of ROUND_1_SECRETS) expect(await phoneHtml()).not.toContain(s);

  // The crowd names "Thriller" (#1) and the special #5.
  await host.getByRole('button', { name: /^Reveal answer 1: Thriller/ }).click();
  await expect.poll(async () => (await board(phone))?.slots?.[0]?.text).toBe('Thriller');
  await host.getByRole('button', { name: /^Reveal answer 5: .*\(special answer\)/ }).click();
  await expect.poll(async () => (await board(phone))?.slots?.[4]?.revealed).toBe(true);
  expect((await board(phone)).special).toBe(4);

  // Wrong answers: the button and the X key both buzz; a double click is one miss.
  const wrong = host.getByRole('button', { name: /^Wrong answer \(buzzer/ });
  await wrong.dblclick();
  await expect(host.getByText(/1 wrong this round/)).toBeVisible();
  await host.locator('body').click({ position: { x: 5, y: 5 } });
  await host.waitForTimeout(500);
  await host.keyboard.press('x');
  await expect(host.getByText(/2 wrong this round/)).toBeVisible();
  // Still no unrevealed answer on the phone, and no refusal toasts on the console.
  for (const s of ROUND_1_SECRETS) expect(await phoneHtml()).not.toContain(s);
  await expect(host.locator('[data-part="toast"][data-kind="error"]')).toHaveCount(0);

  // Pause the clock and give it a minute more.
  await host.locator('[data-part="showdown-clock"]').getByRole('button', { name: /Pause/ }).click();
  await expect.poll(async () => (await roomState(host)).clockEndsAt).toBe(0);
  const left = (await roomState(host)).clockLeft as number;
  await host.getByRole('button', { name: 'Add one minute' }).click();
  await expect.poll(async () => (await roomState(host)).clockLeft).toBe(left + 60_000);

  // Reveal remaining: the server flips the rest from #10 up (the special answer is already showing).
  await host
    .getByRole('button', { name: /^Reveal remaining/ })
    .first()
    .click();
  const dialog = host.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /^Reveal remaining/ }).click();
  await expect.poll(async () => (await board(phone))?.stage, { timeout: 30_000 }).toBe('done');
  const done = await board(phone);
  expect(done.slots.map((s: { late: boolean }) => s.late)).toEqual([false, true, true, true, false, true, true, true, true, true]);
  expect(done.results).toEqual([{ index: 0, winner: -1, points: 0, how: 'none', found: 2, total: 10 }]);

  // On to round 2, then finish (a confirm: answers would stay hidden).
  await host
    .getByRole('button', { name: /^Next round/ })
    .first()
    .click();
  await expect.poll(async () => (await board(phone))?.title).toBe('Halloween Movies');
  await host
    .getByRole('button', { name: /^Finish show/ })
    .first()
    .click();
  await host
    .getByRole('dialog')
    .getByRole('button', { name: /^Finish show/ })
    .click();
  await waitForPhase(phone, 'RESULTS');
  const finale = JSON.parse((await roomState(phone)).finaleJson);
  expect(finale).toMatchObject({ mode: 'showcase', winner: -1 });

  // After the show: the Prize time card goes up on every stage.
  await host
    .getByRole('button', { name: /Prize time/ })
    .first()
    .click();
  await expect.poll(async () => (await roomState(phone)).card).toBe('prizes');

  await leaveRoom(phone);
  await leaveRoom(host);
});

test('DAS-O-Ween: a phone in the audience gets the mini board and cheers, no team pick', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page, 'showdown', 'Host');
  await loadDasoween(page);
  const phone = await joinRoom(browser, code, 'Ada', device(testInfo));
  await expect(phone.getByText(/in the audience/i).first()).toBeVisible();
  await expect(phone.getByRole('radiogroup', { name: 'Your team' })).toHaveCount(0);
  await startGame(page);
  await waitForPhase(phone, 'PLAYING');
  // Cheering works without a team, and big reactions reach the stage feed.
  await phone
    .getByRole('button', { name: /Applause/ })
    .first()
    .click();
  await expect.poll(async () => Object.keys((await roomState(page)).teams ?? {}).length).toBe(0);
  await leaveRoom(phone);
  await leaveRoom(page);
});

test('DAS-O-Ween: the site never serves an answer of the show in its JavaScript', async ({ page }) => {
  await createRoom(page, 'showdown', 'Host');
  await loadDasoween(page);
  // Every script the page loaded (the app, the lazily loaded game chunk…).
  const urls = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => /\.(m?js|tsx?)(\?|$)/.test(u)),
  );
  expect(urls.length).toBeGreaterThan(0);
  const answers = [...ROUND_1_SECRETS, 'Hocus Pocus', 'Beetlejuice', 'A Nightmare on Elm Street', 'The Addams Family'];
  for (const url of urls) {
    const body = await (await page.request.get(url)).text();
    for (const a of answers) expect(body.includes(a), `${a} in ${url}`).toBe(false);
  }
  await leaveRoom(page);
});
