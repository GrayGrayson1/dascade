import { test, expect, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

const FILES = 'abcdefghij';
/** The cell of a square name ("d3": column d, row 3 from the top) on a board of `size`. */
const cellOf = (name: string, size = 8) => (Number(name.slice(1)) - 1) * size + FILES.indexOf(name[0]!);
const square = (page: Page, name: string, size = 8) => page.locator(`.rv-board [data-sq="${cellOf(name, size)}"]`);

async function sideOf(page: Page): Promise<'first' | 'second'> {
  const [state, me] = await Promise.all([roomState(page), myPlayerId(page)]);
  return state.seats[0].playerId === me ? 'first' : 'second';
}

/** Clicks a square once it's this page's turn and waits for the server to take the move. */
async function play(page: Page, name: string, size = 8): Promise<void> {
  const side = await sideOf(page);
  await expect.poll(async () => (await roomState(page)).turn).toBe(side);
  const ply = (await roomState(page)).ply;
  await square(page, name, size).click();
  await expect.poll(async () => (await roomState(page)).ply).toBeGreaterThan(ply);
}

async function openSettings(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Settings' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

async function setup(page: Page, browser: Browser, contextOptions: Parameters<Browser['newContext']>[0], variant?: RegExp) {
  const code = await createRoom(page, 'reversi', 'Ada');
  await openSettings(page);
  await page.getByRole('radio', { name: 'Host Black' }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).sides).toBe('host_first');
  if (variant) await page.getByRole('radio', { name: variant }).click();
  const guest = await joinRoom(browser, code, 'Bo', contextOptions);
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForPhase(guest, 'PLAYING');
  return { black: page, white: guest };
}

test('Reversi: Classic — legal squares marked, discs flip, a square that flips nothing is refused, resign, rematch swaps colours', async ({
  page,
  browser,
  isMobile,
  hasTouch,
  viewport,
  userAgent,
}) => {
  const { black, white } = await setup(page, browser, { isMobile, hasTouch, viewport: viewport ?? undefined, userAgent });

  await expect(black.getByTestId('reversi-status')).toHaveText('Your move');
  await expect(white.getByTestId('reversi-status')).toContainText('Waiting for');
  await expect(black.getByRole('group', { name: 'Reversi board, Classic' })).toBeVisible();
  await expect(black.getByRole('button', { name: 'd3, empty, legal move, flips 1' })).toBeVisible();
  await expect(black.locator('.rv-board [data-target="move"]')).toHaveCount(4);
  await expect(white.locator('.rv-board [data-target="move"]')).toHaveCount(0);
  await expect(black.getByRole('img', { name: 'Discs: Black 2, White 2' })).toBeVisible();

  // a1 flips nothing: nothing is sent, still Black's turn.
  await square(black, 'a1').click();
  expect((await roomState(black)).ply).toBe(0);

  await play(black, 'd3');
  await expect(white.getByRole('button', { name: /^d4, Black disc/ })).toBeVisible();
  await expect(white.getByRole('img', { name: 'Discs: Black 4, White 1' })).toBeVisible();
  await expect(white.getByTestId('reversi-status')).toHaveText('Your move');
  await play(white, 'c3');
  await expect(black.getByRole('button', { name: /^d4, White disc/ })).toBeVisible();
  await play(black, 'c4');
  const state = await roomState(black);
  expect(state.history.map((h: { notation: string }) => h.notation)).toEqual(['d3', 'c3', 'c4']);
  expect(state.lastFlips).toEqual([cellOf('d4')]);

  await white.getByRole('button', { name: 'Resign' }).click();
  await white.getByRole('button', { name: 'Confirm resign' }).click();
  await waitForPhase(black, 'RESULTS');
  expect((await roomState(black)).result).toMatchObject({ over: true, winner: 'first', reason: 'resign' });
  await expect(black.getByRole('heading', { name: /You win/ })).toBeVisible();
  await expect(white.getByRole('heading', { name: /You lost/ })).toBeVisible();

  await black.getByRole('button', { name: /^Rematch/ }).click();
  await white.getByRole('button', { name: 'Accept rematch' }).click();
  await expect.poll(async () => (await roomState(black)).gameNumber, { timeout: 15_000 }).toBe(2);
  await waitForPhase(black, 'PLAYING');
  expect(await sideOf(white)).toBe('first');
  await expect(white.getByTestId('reversi-status')).toHaveText('Your move');

  await leaveRoom(white);
  await leaveRoom(black);
});

test('Reversi: the lobby picks Mini 6×6', async ({ page, browser, isMobile, hasTouch, viewport, userAgent }) => {
  const { black, white } = await setup(page, browser, { isMobile, hasTouch, viewport: viewport ?? undefined, userAgent }, /^Mini 6×6/);
  expect((await roomState(black)).variant).toBe('mini');
  await expect(black.locator('.rv-board .br-sq')).toHaveCount(36);
  await play(black, 'c2', 6);
  await expect(white.getByRole('button', { name: /^c3, Black disc/ })).toBeVisible();
  await leaveRoom(white);
  await leaveRoom(black);
});

test('Reversi: Original — the first discs go on the centre squares', async ({ page, browser, isMobile, hasTouch, viewport, userAgent }) => {
  const { black, white } = await setup(page, browser, { isMobile, hasTouch, viewport: viewport ?? undefined, userAgent }, /^Original/);
  expect((await roomState(black)).supply).toEqual([32, 32]);
  await expect(black.getByText('Opening: the first four discs go on the four centre squares.')).toBeVisible();
  await expect(black.locator('.rv-board [data-target="move"]')).toHaveCount(4);
  await square(black, 'c3').click();
  expect((await roomState(black)).ply).toBe(0);
  await play(black, 'd4');
  await play(white, 'e4');
  await expect.poll(async () => (await roomState(black)).supply).toEqual([31, 31]);
  await expect(black.getByText('31 left').first()).toBeVisible();
  await leaveRoom(white);
  await leaveRoom(black);
});
