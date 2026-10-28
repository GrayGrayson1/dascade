/**
 * DAS Survey Showdown — two-tier scoring (Brian's Scoring Studio picks): a phone and a desktop tab
 * each lock guesses into spots on their Top 10; the presenter flips one and both show the same points
 * (phone/browser parity); Show standings puts the top Guessers on the stage; the presenter steps
 * through the finale; the scores download as CSV. Rehearsal boards only; the answers are read from
 * the presenter's own console at run time.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, roomState, setName, startGame, waitForPhase } from './helpers.ts';

const SHOTS = process.env.SHOTS_DIR ?? '';
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

const board = async (page: Page) => {
  const s = await roomState(page);
  return s?.boardJson ? JSON.parse(s.boardJson) : null;
};

async function loadRehearsal(page: Page): Promise<void> {
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await page.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
  await expect.poll(async () => (await roomState(page)).customRounds).toBe(2);
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).points).toBe(true);
}

/** The current board's answers, read from the presenter's sheet (the only place they exist on a client). */
async function sheetAnswers(host: Page): Promise<string[]> {
  const labels = await host
    .locator('[data-part="showdown-answer"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
  return labels.map((l) => /^(?:Reveal answer|Answer) \d+: (.*?)(?: \(special answer\).*|, revealed)?$/.exec(l)?.[1] ?? '').filter(Boolean);
}

async function joinAs(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/room/${code}`);
  await setName(page, name);
  await page.getByRole('button', { name: /^Join/ }).first().click();
  await expect(page.locator('.lobby, .game-stage').first()).toBeVisible();
}

async function desktop(browser: Browser, code: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await joinAs(p, code, name);
  return p;
}

/** Locks `text` into spot #(pos + 1) of this device's Top 10. */
async function lockIn(page: Page, pos: number, text: string): Promise<void> {
  const row = page.locator(`[data-part="showdown-scorecard-row"][data-pos="${pos}"]`);
  const input = row.locator('[data-part="showdown-scorecard-input"]');
  await input.fill(text);
  await input.press('Enter');
  await expect(row).toContainText(text);
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

test('two-tier scoring: Top 10 on a phone and a desktop tab score the same; standings; the paced finale; the CSV', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostCtx.newPage();
  const code = await createRoom(host, 'showdown', 'Marcus');
  await loadRehearsal(host);
  // The project's device (a desktop browser on chromium, a phone on mobile) and a desktop tab.
  const ada = page;
  await joinAs(ada, code, 'Ada');
  const ben = await desktop(browser, code, 'Ben');

  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await host
    .getByRole('button', { name: /^Start round 1/ })
    .first()
    .click();
  await expect.poll(async () => (await board(host))?.stage).toBe('title');
  await host
    .getByRole('button', { name: /^Show the question/ })
    .first()
    .click();
  await expect.poll(async () => (await board(ada))?.stage).toBe('live');
  const answers = await sheetAnswers(host);
  expect(answers).toHaveLength(10);

  // Both lock #1's answer into spot #1; Ben also puts #2's answer in spot #3.
  for (const p of [ada, ben]) await expect(p.locator('[data-part="showdown-scorecard"]')).toBeVisible();
  await lockIn(ada, 0, answers[0]!);
  await lockIn(ben, 0, answers[0]!);
  await lockIn(ben, 2, answers[1]!);
  await expect.poll(async () => (await roomState(host)).guessesIn).toBe(3);
  // Nothing scores (or leaks) before the flip.
  expect((await roomState(ada)).scoreJson ?? '').not.toContain(answers[0]!);

  // The presenter flips #1: a phone and a desktop tab show the same points.
  await host.getByRole('button', { name: /^Reveal answer 1:/ }).click();
  for (const p of [ada, ben]) {
    await expect(p.locator('[data-part="showdown-scorecard-summary"]')).toContainText('11');
    await expect(p.locator('[data-part="showdown-scorecard-flash"]')).toContainText('+1');
  }
  // #2 lands in Ben's spot #3: 9 points, no spot bonus.
  await host.getByRole('button', { name: /^Reveal answer 2:/ }).click();
  await expect(ben.locator('[data-part="showdown-scorecard-summary"]')).toContainText('20');
  await expect(ada.locator('[data-part="showdown-scorecard-summary"]')).toContainText('11');
  await ada.locator('[data-part="showdown-scorecard"]').scrollIntoViewIfNeeded();
  await shot(ada, 'scorecard-ada');
  await shot(ben, 'scorecard-ben-desktop');
  await shot(host, 'console-after-flips');

  // The rest of the board, then Show standings: the top Guessers on the stage.
  await host.keyboard.press('p');
  await expect.poll(async () => (await roomState(host)).clockEndsAt).toBe(0);
  await host.keyboard.press('r');
  await expect.poll(async () => (await board(host))?.stage, { timeout: 40_000 }).toBe('done');
  await host.locator('[data-part="showdown-show-standings"]').click();
  await expect.poll(async () => (await roomState(host)).card).toBe('standings');
  const standings = host.locator('[data-part="showdown-preview"] [data-part="showdown-standings"]');
  await expect(standings).toContainText('Ben');
  await expect(standings).toContainText('Ada');
  await shot(host, 'console-standings');
  const scoresTab = host.getByRole('tab', { name: /^Scores/ });
  if (await scoresTab.isVisible()) {
    await scoresTab.click();
    await shot(host, 'console-scores-tab');
  }

  // Finish the show, then step through the finale: Ben 1st, Ada 2nd.
  await host.locator('[data-part="showdown-end-show"]').click();
  await holdConfirm(host);
  await waitForPhase(host, 'RESULTS');
  const finale = JSON.parse((await roomState(host)).finaleJson);
  expect(finale.podium.map((p: { name: string; rank: number }) => [p.name, p.rank])).toEqual([
    ['Ben', 1],
    ['Ada', 2],
  ]);
  const next = host.locator('[data-part="showdown-finale-next"]');
  await next.click();
  await expect.poll(async () => (await roomState(ada)).finaleStep).toBe(1);
  await next.click();
  await expect.poll(async () => (await roomState(ada)).finaleStep).toBe(2);
  // The standings card came down with the finale: the podium is on the stage, Ben on top.
  expect((await roomState(host)).card).toBe('');
  await expect(host.locator('[data-part="showdown-finale-podium"]').first()).toContainText('Ben');
  await host.waitForTimeout(1500);
  await shot(host, 'results-finale-first');

  // The CSV: rank, name, points — and never an answer that didn't flip (they all flipped here).
  const download = host.waitForEvent('download');
  await host.locator('[data-part="showdown-scores-csv"]').first().click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const csv = (await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'))).trim();
  const lines = csv.split(/\r?\n/);
  expect(lines[0]).toMatch(/rank/i);
  expect(lines[1]).toMatch(/^1,.*Ben.*,20,/);
  expect(lines[2]).toMatch(/^2,.*Ada.*,11,/);
  await hostCtx.close();
  await ben.context().close();
});
