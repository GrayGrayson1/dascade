import { test, expect, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

const cell = (page: Page, n: number) => page.locator(`.tt-board [data-cell="${n}"]`);

async function sideOf(page: Page): Promise<'first' | 'second'> {
  const [state, me] = await Promise.all([roomState(page), myPlayerId(page)]);
  return state.seats[0].playerId === me ? 'first' : 'second';
}

/** Clicks a square once it's this page's turn and waits for the server to take the move. */
async function play(page: Page, n: number): Promise<void> {
  const side = await sideOf(page);
  await expect.poll(async () => (await roomState(page)).turn).toBe(side);
  const ply = (await roomState(page)).ply;
  await cell(page, n).click();
  await expect.poll(async () => (await roomState(page)).ply).toBeGreaterThan(ply);
}

async function openSettings(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Settings' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

async function setup(
  page: Page,
  browser: Browser,
  contextOptions: Parameters<Browser['newContext']>[0],
  variant?: RegExp,
  entry: { gameId: string; hostFirst: string } = { gameId: 'tictactoe', hostFirst: 'Host X' },
) {
  const code = await createRoom(page, entry.gameId, 'Ada');
  await openSettings(page);
  await page.getByRole('radio', { name: entry.hostFirst }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).sides).toBe('host_first');
  if (variant) await page.getByRole('radio', { name: variant }).click();
  const guest = await joinRoom(browser, code, 'Bo', contextOptions);
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForPhase(guest, 'PLAYING');
  return { x: page, o: guest };
}

test('tic-tac-toe: Classic to three in a row, an occupied square refused, keys 1–9, rematch swaps sides, leave', async ({
  page,
  browser,
  isMobile,
  hasTouch,
  viewport,
  userAgent,
}) => {
  const { x, o } = await setup(page, browser, { isMobile, hasTouch, viewport: viewport ?? undefined, userAgent });

  await expect(x.getByTestId('tictactoe-status')).toHaveText('Your move');
  await expect(o.getByTestId('tictactoe-status')).toContainText('Waiting for');
  await expect(x.getByRole('group', { name: 'Classic board' }).first()).toBeVisible();
  await expect(x.getByRole('button', { name: 'b2, empty' })).toBeVisible();

  await play(x, 4);
  await expect(o.getByRole('button', { name: 'b2, X' })).toBeVisible();
  // O can't take X's square (it's announced as unavailable): nothing is sent, still O's turn.
  await expect(cell(o, 4)).toHaveAttribute('aria-disabled', 'true');
  await cell(o, 4).click({ force: true });
  expect((await roomState(o)).ply).toBe(1);
  await play(o, 0);
  await play(x, 2);
  await play(o, 6);
  // Keys 1–9 play the squares in reading order: 4 = the middle row's left square (a2).
  await expect.poll(async () => (await roomState(x)).turn).toBe('first');
  await x.keyboard.press('4');
  await expect.poll(async () => (await roomState(o)).ply).toBe(5);
  await play(o, 8);
  await play(x, 3 + 2); // c2: X now has a2-b2-c2

  await waitForPhase(x, 'RESULTS');
  const state = await roomState(x);
  expect(state.result).toMatchObject({ over: true, winner: 'first', reason: 'line' });
  expect(state.winLine).toEqual([3, 4, 5]);
  expect(state.history.map((h: { notation: string }) => h.notation)).toEqual(['b2', 'a3', 'c3', 'a1', 'a2', 'c1', 'c2']);
  await expect(x.getByRole('heading', { name: /You win/ })).toBeVisible();
  await expect(o.getByRole('heading', { name: /You lost/ })).toBeVisible();
  await expect(x.getByRole('button', { name: 'b2, X, winning line' })).toBeVisible();

  await x.getByRole('button', { name: /^Rematch/ }).click();
  await o.getByRole('button', { name: 'Accept rematch' }).click();
  await expect.poll(async () => (await roomState(x)).gameNumber, { timeout: 15_000 }).toBe(2);
  await waitForPhase(x, 'PLAYING');
  expect(await sideOf(o)).toBe('first');
  await expect(o.getByTestId('tictactoe-status')).toHaveText('Your move');

  await leaveRoom(o);
  await leaveRoom(x);
});

test('tic-tac-toe: Ultimate sends you to the matching board', async ({ page, browser, isMobile, hasTouch, viewport, userAgent }) => {
  const { x, o } = await setup(page, browser, { isMobile, hasTouch, viewport: viewport ?? undefined, userAgent }, /^Ultimate/);
  expect((await roomState(x)).variant).toBe('ultimate');
  await expect(x.locator('.tt-ultimate__board')).toHaveCount(9);

  // X plays the centre of the top-left board, which sends O to the centre board.
  await play(x, 4);
  await expect.poll(async () => (await roomState(o)).active).toBe(4);
  await expect(o.locator('.tt-ultimate__board[data-play]')).toHaveCount(1);
  await expect(o.getByText('Play in board 5')).toBeVisible();
  // Outside the board O was sent to: unavailable and refused, still O's turn.
  await expect(cell(o, 0)).toHaveAttribute('aria-disabled', 'true');
  await cell(o, 0).click({ force: true });
  expect((await roomState(o)).ply).toBe(1);
  await play(o, 36);
  expect((await roomState(o)).active).toBe(0);

  await leaveRoom(o);
  await leaveRoom(x);
});

test('Four in a Row: its own tile opens tic-tac-toe on the rack, discs drop to the bottom, keys 1–7 pick a column', async ({
  page,
  browser,
  isMobile,
  hasTouch,
  viewport,
  userAgent,
}) => {
  // /play/fourinarow is the Boardroom tile (tic-tac-toe's 'gravity' variant); the room starts on it.
  const { x, o } = await setup(page, browser, { isMobile, hasTouch, viewport: viewport ?? undefined, userAgent }, undefined, {
    gameId: 'fourinarow',
    hostFirst: 'Host Pink',
  });
  const start = await roomState(x);
  expect(start.variant).toBe('gravity');
  expect(start.cells).toHaveLength(42);
  await expect(x.getByRole('group', { name: 'Four in a Row board' }).first()).toBeVisible();

  await play(x, 3);
  const after = await roomState(x);
  expect(after.cells[38]).toBe('x');
  expect(after.lastCell).toBe(38);
  expect(after.history[0].notation).toBe('d1');
  await expect(o.getByRole('button', { name: 'd1, Pink disc' })).toBeVisible();

  // Blue drops into column 5 from the keyboard: it lands on e1.
  await expect.poll(async () => (await roomState(o)).turn).toBe('second');
  await o.keyboard.press('5');
  await expect.poll(async () => (await roomState(o)).cells[39]).toBe('o');
  await expect(x.getByRole('button', { name: 'e1, Blue disc' })).toBeVisible();

  await leaveRoom(o);
  await leaveRoom(x);
});
