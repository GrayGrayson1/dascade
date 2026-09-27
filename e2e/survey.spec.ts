import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

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

async function openSettings(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Settings' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

async function waitForStage(page: Page, stage: string, timeout = 20_000): Promise<void> {
  await expect.poll(async () => (await roomState(page))?.stage, { timeout }).toBe(stage);
}

test('DAS Survey: three players answer anonymously, predict the majority and see the reveal', async ({ page, browser }, testInfo) => {
  const host = page;
  const code = await createRoom(host, 'survey', 'Host');
  await openSettings(host);
  await host.getByRole('radio', { name: /^Majority Mind/ }).click();
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).mode).toBe('majority');

  const ada = await joinRoom(browser, code, 'Ada', device(testInfo));
  const ben = await joinRoom(browser, code, 'Ben', device(testInfo));
  await expect.poll(async () => Object.keys((await roomState(host)).players).length).toBe(3);

  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await waitForStage(host, 'answer');
  const players = [host, ada, ben];

  // Everyone answers with one tap (Host + Ada pick A, Ben picks B).
  for (const [i, p] of players.entries()) {
    const grid = p.getByRole('group', { name: 'Your answer' });
    await expect(grid).toBeVisible();
    await grid
      .getByRole('button')
      .nth(i === 2 ? 1 : 0)
      .click();
    await expect(p.getByText('Your answer:')).toBeVisible();
  }
  await expect.poll(async () => (await roomState(host)).answersIn).toBe(3);

  // Public state says who answered, never what.
  const mid = await roomState(ben);
  for (const prog of Object.values(mid.progress) as Array<Record<string, unknown>>)
    expect(Object.keys(prog).sort()).toEqual(['answered', 'predicted']);
  expect(mid.resultJson).toBe('');

  // Everyone predicts the majority (A).
  for (const p of players) {
    const grid = p.getByRole('group', { name: 'Predict the majority' });
    await expect(grid).toBeVisible();
    await grid.getByRole('button').first().click();
  }

  await waitForStage(host, 'reveal');
  const result = JSON.parse((await roomState(host)).resultJson);
  expect(result).toMatchObject({ voided: false, respondents: 3, counts: [2, 1, ...Array(result.counts.length - 2).fill(0)], leaders: [0] });
  for (const p of players) {
    await expect(p.getByRole('region', { name: 'Your points' })).toBeVisible();
    await expect(p.getByText('You read the room!', { exact: true })).toBeVisible();
  }
  const scored = await roomState(host);
  for (const p of players) expect(scored.players[(await myPlayerId(p))!].score).toBe(1000);
  // Small-room anonymity note is shown with fewer than 5 answers.
  await expect(ada.getByText(/Small room: only totals are shown/)).toBeVisible();

  await leaveRoom(ben);
  await leaveRoom(ada);
  await leaveRoom(host);
  await expect(host).toHaveURL(/\/$/);
});

test('DAS Survey: host writes a custom survey; players rank the room and guess the percentage', async ({ page, browser }, testInfo) => {
  const host = page;
  const code = await createRoom(host, 'survey', 'Host');
  await openSettings(host);
  await host.getByRole('radio', { name: /^Custom Survey/ }).click();
  await host.getByRole('button', { name: 'Write survey' }).click();

  const editor = host.getByRole('dialog', { name: 'Custom Survey' });
  await expect(editor).toBeVisible();
  // Q1: a percentage question (Yes / No are pre-filled).
  await editor.getByRole('radio', { name: 'Percent' }).first().click();
  await editor.getByRole('textbox', { name: 'Question 1 text' }).fill('Do you like pineapple on pizza?');
  // Q2: a ranking question.
  await editor.getByRole('button', { name: 'Rank' }).click();
  await editor.getByRole('textbox', { name: 'Question 2 text' }).fill('Best office snack?');
  await editor.getByRole('textbox', { name: 'Question 2 option A' }).fill('Cookies');
  await editor.getByRole('textbox', { name: 'Question 2 option B' }).fill('Fruit');
  await editor.getByRole('textbox', { name: 'Question 2 option C' }).fill('Crisps');
  await editor.getByRole('button', { name: 'Save survey' }).click();
  await expect.poll(async () => (await roomState(host)).customCount).toBe(2);
  await editor.getByRole('button', { name: 'Close' }).last().click();
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).mode).toBe('custom');

  const ada = await joinRoom(browser, code, 'Ada', device(testInfo));
  const ben = await joinRoom(browser, code, 'Ben', device(testInfo));
  // Players never receive the host's questions before they are asked.
  expect(JSON.stringify(await roomState(ada))).not.toContain('pineapple');
  await expect.poll(async () => Object.keys((await roomState(host)).players).length).toBe(3);

  await startGame(host);
  await waitForStage(host, 'answer');
  const players = [host, ada, ben];

  // Q1 — Guess the Percentage: two say Yes, one says No → 66.7%.
  for (const [i, p] of players.entries()) {
    await p
      .getByRole('group', { name: 'Your answer' })
      .getByRole('button', { name: i === 2 ? /^B: No/ : /^A: Yes/ })
      .click();
  }
  for (const p of players) {
    await p.getByRole('button', { name: '75%' }).click();
    await p.getByRole('button', { name: 'Decrease by 5' }).click();
    await p.getByRole('button', { name: 'Lock in 70%' }).click();
  }
  await waitForStage(host, 'reveal');
  const r1 = JSON.parse((await roomState(host)).resultJson);
  expect(r1).toMatchObject({ actual: 66.7, respondents: 3 });
  await expect(ada.getByRole('region', { name: 'Percentage result' })).toBeVisible();
  await expect(ada.getByText('3.3 points off', { exact: true })).toBeVisible();

  // Host skips ahead to Q2.
  await host.getByRole('button', { name: 'Next question' }).click();
  await expect.poll(async () => (await roomState(host)).round).toBe(2);
  await waitForStage(host, 'answer');

  // Q2 — Rank the Room: Cookies ×2, Fruit ×1.
  for (const [i, p] of players.entries()) {
    await p
      .getByRole('group', { name: 'Your answer' })
      .getByRole('button', { name: i === 2 ? /^B: Fruit/ : /^A: Cookies/ })
      .click();
  }
  for (const p of players) {
    await p.getByRole('button', { name: /^Cookies: tap to place 1/ }).click();
    await p.getByRole('button', { name: /^Fruit: tap to place 2/ }).click();
    await p.getByRole('button', { name: 'Lock in order' }).click();
  }
  await waitForStage(host, 'reveal');
  const r2 = JSON.parse((await roomState(host)).resultJson);
  expect(r2.ranking.map((s: { option: number }) => s.option)).toEqual([0, 1, 2]);
  await expect(ben.getByText('Perfect order!', { exact: true })).toBeVisible();

  // Last question → final results with podium and awards.
  await host.getByRole('button', { name: 'Final results' }).click();
  await waitForPhase(host, 'RESULTS');
  await expect(ada.getByRole('region', { name: 'Podium' })).toBeVisible();
  // Everyone predicted the same, so no award singles anyone out; the room recap still shows.
  await expect(ada.getByRole('region', { name: 'Your room in numbers' })).toBeVisible();
  await expect(ada.getByText('Most united')).toBeVisible();
  await expect(host.getByRole('button', { name: 'Play again' })).toBeVisible();

  await leaveRoom(ben);
  await leaveRoom(ada);
  await leaveRoom(host);
});
