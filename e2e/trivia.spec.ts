import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

const settingsOf = async (page: Page) => JSON.parse((await roomState(page)).settingsJson) as { types: string[] };

/** Turns a question-type toggle off in the lobby and waits for the server to confirm it. */
async function disableType(host: Page, label: string, id: string) {
  const toggle = host.getByRole('button', { name: label, exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect.poll(async () => (await settingsOf(host)).types.includes(id)).toBe(false);
}

test('Trivia: host + player answer privately, reveal, scores, leave', async ({ page, browser }, testInfo) => {
  const host = page;
  const code = await createRoom(host, 'trivia', 'Host');

  // Multiple choice + true/false only (big answer buttons for this smoke path).
  const settingsTab = host.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible().catch(() => false)) await settingsTab.click();
  await disableType(host, 'Type the answer', 'text');
  await disableType(host, 'Closest number', 'number');
  await disableType(host, 'Put in order', 'order');
  expect((await settingsOf(host)).types.sort()).toEqual(['mc', 'tf']);

  const use = testInfo.project.use;
  const guest = await joinRoom(browser, code, 'Guest', {
    baseURL: use.baseURL,
    viewport: use.viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
  });
  await expect.poll(async () => Object.keys((await roomState(host)).players).length).toBe(2);
  const guestId = (await myPlayerId(guest))!;

  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(async () => (await roomState(guest)).stage, { timeout: 20_000 }).toBe('question');

  // The question is public; the answer key is not.
  const live = await roomState(guest);
  const view = JSON.parse(live.questionJson) as { prompt: string; options: string[]; seq: number };
  expect(live.revealJson).toBe('');
  expect(live.questionJson).not.toMatch(/correct|accept/);
  await expect(guest.getByRole('heading', { name: view.prompt })).toBeVisible();

  // Big, accessible answer buttons (≥ 56px tall, also on phones).
  const guestAnswers = guest.getByRole('group', { name: 'Answer options' }).getByRole('button');
  await expect(guestAnswers).toHaveCount(view.options.length);
  const box = (await guestAnswers.first().boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(56);

  // Guest locks in privately: the host only learns THAT they answered.
  await guestAnswers.first().click();
  await expect(guest.getByText(/Locked in!/)).toBeVisible();
  await expect(guestAnswers.first()).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await roomState(host)).seats[guestId]?.answered).toBe(true);
  await expect(host.getByRole('status', { name: '1 of 2 locked in' })).toBeVisible();
  expect((await roomState(host)).revealJson).toBe('');

  // Host answers → everyone has answered → reveal with results for both.
  await host.getByRole('group', { name: 'Answer options' }).getByRole('button').nth(1).click();
  await expect.poll(async () => (await roomState(guest)).stage).toBe('reveal');
  const reveal = JSON.parse((await roomState(guest)).revealJson) as {
    answeredCount: number;
    results: Record<string, { answered: boolean }>;
    correctText: string;
  };
  expect(reveal.answeredCount).toBe(2);
  expect(Object.keys(reveal.results).sort()).toEqual([guestId, (await myPlayerId(host))!].sort());
  await expect(guest.getByRole('status').filter({ hasText: /Correct!|Not quite/ })).toBeVisible();
  await expect(
    guest.getByRole('button', { name: new RegExp(`${reveal.correctText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*correct answer`) }),
  ).toBeVisible();

  // Score reveal: the leaderboard animates in.
  await expect.poll(async () => (await roomState(host)).stage, { timeout: 15_000 }).toBe('scores');
  await expect(host.getByRole('region', { name: 'Leaderboard' })).toBeVisible();
  await expect(guest.getByRole('region', { name: 'Leaderboard' })).toBeVisible();

  await leaveRoom(guest);
  await leaveRoom(host);
});
