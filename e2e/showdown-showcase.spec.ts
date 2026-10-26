/**
 * DAS Survey Showdown — Presenter Showcase (the DAS-O-Ween show), on the rehearsal boards: the presenter
 * loads the preset in the lobby and runs a round from the console (a found answer, the special #5
 * armed then taken, wrong answers, the clock, Reveal remaining), moves on, finishes through the
 * two-step panel and puts up a stage card — while a phone in the audience never has an unrevealed
 * answer in its page and no answer of the show is in the JavaScript the site serves.
 *
 * The real DAS-O-Ween boards are never in the repo (ADM-01): they load from the presenter's show file.
 * The answers this spec guards are read from the presenter's own console at run time.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers';

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

async function loadRehearsal(page: Page): Promise<void> {
  // Phones show one lobby section at a time.
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await page.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
  await expect.poll(async () => (await roomState(page)).customRounds).toBe(2);
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).mode).toBe('showcase');
  await expect.poll(async () => (await roomState(page)).event).toBe('dasoween-rehearsal');
}

/** The current board's answers, read from the presenter's sheet (the only place they exist on a client). */
async function sheetAnswers(host: Page): Promise<string[]> {
  const labels = await host.locator('[data-part="showdown-answer"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  return labels.map((l) => /^(?:Reveal answer|Answer) \d+: (.*?)(?: \(special answer\).*|, revealed)?$/.exec(l)?.[1] ?? '').filter(Boolean);
}

/** A 1.2 s press-and-hold on the End show / Finish show panel's confirm button. */
async function holdConfirm(page: Page): Promise<void> {
  const box = await page.locator('[data-part="showdown-end-confirm"]').boundingBox();
  if (!box) throw new Error('no end-show confirm button');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
}

test('DAS-O-Ween: the presenter runs a showcase round; the audience only ever sees what flipped', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop console.');
  test.setTimeout(120_000);
  const host = page;
  await host.setViewportSize({ width: 1280, height: 720 });
  const code = await createRoom(host, 'showdown', 'Host');
  await loadRehearsal(host);
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
  await expect.poll(async () => (await board(phone))?.title).toBeTruthy();
  await host
    .getByRole('button', { name: /^Show the question/ })
    .first()
    .click();
  await expect.poll(async () => (await board(phone))?.stage).toBe('live');
  // The clock started with the question.
  await expect.poll(async () => (await roomState(host)).clockEndsAt).toBeGreaterThan(0);

  // Nothing unrevealed is anywhere on the phone (page or synced state).
  const answers = await sheetAnswers(host);
  expect(answers).toHaveLength(10);
  const phoneHtml = async () => (await phone.content()).replace(/&#x27;|&#39;/g, "'");
  const phoneState = async () => JSON.stringify(await roomState(phone));
  const noLeak = async (hiddenSlots: number[]) => {
    const html = await phoneHtml();
    const state = await phoneState();
    for (const i of hiddenSlots) {
      expect(state).not.toContain(`"${answers[i]}"`);
      // Short single words ("Ghost") can appear in decor and copy; the page check uses the distinctive ones.
      if (answers[i]!.length >= 8) expect(html).not.toContain(answers[i]);
    }
  };
  await noLeak([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // The crowd names #1: it flips on the first click.
  await host.getByRole('button', { name: /^Reveal answer 1:/ }).click();
  await expect.poll(async () => (await board(phone))?.slots?.[0]?.revealed).toBe(true);
  // #5, the special answer: a click only arms it; Take special reveals it.
  await host.getByRole('button', { name: /^Reveal answer 5: .*\(special answer\)/ }).click();
  await host.waitForTimeout(500);
  expect((await board(phone)).slots[4].revealed).toBe(false);
  await host.locator('[data-part="showdown-take-special"]').click();
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
  // Still nothing hidden on the phone, and no refusal toasts on the console.
  await noLeak([1, 2, 3, 5, 6, 7, 8, 9]);
  await expect(host.locator('[data-part="toast"][data-kind="error"]')).toHaveCount(0);

  // Pause the clock and give it a minute more.
  await host.getByRole('button', { name: 'Pause clock' }).click();
  await expect.poll(async () => (await roomState(host)).clockEndsAt).toBe(0);
  const left = (await roomState(host)).clockLeft as number;
  await host.getByRole('button', { name: 'Add one minute' }).click();
  await expect.poll(async () => (await roomState(host)).clockLeft).toBe(left + 60_000);

  // Reveal remaining (the clock is paused, so a plain click): the server flips the rest from #10 up.
  await host
    .getByRole('button', { name: /^Reveal remaining/ })
    .first()
    .click();
  await expect.poll(async () => (await board(phone))?.stage, { timeout: 30_000 }).toBe('done');
  const done = await board(phone);
  expect(done.slots.map((s: { late: boolean }) => s.late)).toEqual([false, true, true, true, false, true, true, true, true, true]);
  expect(done.results).toEqual([{ index: 0, winner: -1, points: 0, how: 'none', found: 2, total: 10 }]);

  // On to round 2, then finish: two steps and a hold (a single click on the confirm does nothing).
  await host
    .getByRole('button', { name: /^Next round/ })
    .first()
    .click();
  await expect.poll(async () => (await board(phone))?.round).toBe(1);
  await host
    .getByRole('button', { name: /^Finish show/ })
    .first()
    .click();
  await expect(host.locator('[data-part="showdown-end-panel"]')).toBeVisible();
  await host.locator('[data-part="showdown-end-confirm"]').click();
  await host.waitForTimeout(400);
  expect((await roomState(host)).phase).toBe('PLAYING');
  await holdConfirm(host);
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

test('a Presenter Showcase audience has no teams and cheers from the phone', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page, 'showdown', 'Host');
  await loadRehearsal(page);
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

test('the served JavaScript never contains the show’s answers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop console.');
  await page.setViewportSize({ width: 1280, height: 720 });
  await createRoom(page, 'showdown', 'Host');
  await loadRehearsal(page);
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await page
    .getByRole('button', { name: /^Start round 1/ })
    .first()
    .click();
  await expect(page.locator('[data-part="showdown-answer"]')).toHaveCount(10);
  // The practice answers reach this console only as a private message: never in a script.
  const answers = (await sheetAnswers(page)).filter((a) => a.length >= 8);
  expect(answers.length).toBeGreaterThan(0);
  const urls = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => /\.(m?js|tsx?)(\?|$)/.test(u)),
  );
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    const body = await (await page.request.get(url)).text();
    for (const a of answers) expect(body.includes(a), `${url} contains an answer`).toBe(false);
  }
  await leaveRoom(page);
});
