import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

const stage = async (page: Page) => (await roomState(page))?.stage as string | undefined;

/** Types an answer the way a player would (story prompts have two line inputs) and hands it in. */
async function writeAnswer(page: Page, text: string, simulateKeyboard: boolean): Promise<void> {
  const area = page.getByRole('textbox', { name: 'Your answer' });
  const line1 = page.getByRole('textbox', { name: 'Your story, line 1' });
  await expect(area.or(line1)).toBeVisible();
  const submit = page.getByRole('button', { name: 'Hand it in' });
  const viewport = page.viewportSize();
  if (simulateKeyboard && viewport) {
    // An on-screen keyboard takes ~40% of a phone screen: the composer must stay usable above it.
    await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.6) });
  }
  if (await area.isVisible()) {
    await area.click();
    await area.pressSequentially(text, { delay: 5 });
    if (simulateKeyboard) await expect(area).toBeInViewport();
  } else {
    await line1.click();
    await line1.pressSequentially(text, { delay: 5 });
    await line1.press('Enter'); // moves to line two
    const line2 = page.getByRole('textbox', { name: 'Your story, line 2' });
    await expect(line2).toBeFocused();
    await line2.fill('The end.');
    if (simulateKeyboard) await expect(line2).toBeInViewport();
  }
  await expect(submit).toBeEnabled();
  if (simulateKeyboard) await expect(submit).toBeInViewport({ ratio: 0.5 });
  await submit.click();
  await expect(page.getByRole('heading', { name: 'All handed in!' })).toBeVisible();
  if (simulateKeyboard && viewport) await page.setViewportSize(viewport);
}

test('DASterpiece: 3 players write, vote anonymously, authors revealed after the vote', async ({ page, browser }, testInfo) => {
  const host = page;
  await createRoom(host, 'masterpiece', 'Host');

  // Host picks the "Favourite" voting style and a single exhibition in the lobby.
  const settingsTab = host.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible().catch(() => false)) await settingsTab.click();
  await host.getByRole('radio', { name: 'Favourite' }).click();
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).votingMode).toBe('favourite');
  await host.evaluate(() => (window as any).__DASCADE__.session.send('lobby:settings', { settings: { rounds: 1 } }));
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).rounds).toBe(1);

  const use = testInfo.project.use;
  const device = {
    baseURL: use.baseURL,
    viewport: use.viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
  };
  const code = (await roomState(host)).code as string;
  const bea = await joinRoom(browser, code, 'Bea', device);
  const cy = await joinRoom(browser, code, 'Cyrus', device);
  await expect.poll(async () => Object.keys((await roomState(host)).players).length).toBe(3);

  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(() => stage(host), { timeout: 20_000 }).toBe('write');

  // Everyone writes privately. Nobody else's text reaches anyone before voting.
  const texts = ['A spreadsheet that files its own complaints', 'Mostly glitter, legally speaking', 'The sound a stapler makes when it wins'];
  const pages = [host, bea, cy];
  for (const [i, p] of pages.entries()) await writeAnswer(p, texts[i]!, Boolean(use.isMobile));
  for (const [i, p] of pages.entries()) {
    const snapshot = JSON.stringify(await roomState(p));
    for (const [j, t] of texts.entries()) if (j !== i) expect(snapshot).not.toContain(t);
  }

  // The gallery opens: anonymous exhibits in a shuffled order.
  await expect.poll(() => stage(host), { timeout: 15_000 }).toBe('vote');
  const voting = await roomState(host);
  expect(voting.answers).toHaveLength(3);
  for (const a of voting.answers) {
    expect(a.authorId).toBe('');
    expect(a.authorName).toBe('');
  }
  const ids = await Promise.all(pages.map((p) => myPlayerId(p)));
  expect(voting.answers.map((a: { id: string }) => a.id)).not.toContain(ids[0]);

  // Own answers can't be picked; everyone votes for someone else.
  for (const p of pages) {
    await expect(p.getByText('Your answer', { exact: true })).toBeVisible();
    const choices = p.getByRole('button', { name: /^Pick Exhibit/ });
    await expect(choices).toHaveCount(2);
    await choices.first().click();
    await p.getByRole('button', { name: /^Vote for [A-C]$/ }).click();
    await expect(p.getByText('Vote locked in — waiting for everyone else.')).toBeVisible();
  }

  // All votes in → reveal with authors and totals.
  await expect.poll(() => stage(host), { timeout: 15_000 }).toBe('reveal');
  const revealed = await roomState(host);
  expect(revealed.answers.map((a: { authorId: string }) => a.authorId).sort()).toEqual([...ids].sort());
  expect(revealed.answers.reduce((n: number, a: { votes: number }) => n + a.votes, 0)).toBe(3);
  await expect(bea.getByText('(you!)')).toBeVisible();
  await expect(host.getByText('Votes counted')).toBeVisible();

  await leaveRoom(cy);
  await leaveRoom(bea);
  await leaveRoom(host);
  await expect(host).toHaveURL(/\/$/);
});
