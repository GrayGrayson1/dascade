import { test, expect, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

/** Playable squares are buttons named "Square 11, Dark man, can move", "Square 15, empty"… */
const square = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Square ${n},`) });

async function sideOf(page: Page): Promise<'first' | 'second'> {
  const [state, me] = await Promise.all([roomState(page), myPlayerId(page)]);
  return state.seats[0].playerId === me ? 'first' : 'second';
}

/** Taps a path square by square (a forced multi-jump completes itself) and waits for the server. */
async function play(page: Page, path: number[]): Promise<void> {
  // This page must have caught up with the opponent's last move before it can move.
  const side = await sideOf(page);
  await expect.poll(async () => (await roomState(page)).turn).toBe(side);
  const ply = (await roomState(page)).ply;
  for (const sq of path) {
    if ((await roomState(page)).ply > ply) break;
    await square(page, sq).click();
  }
  await expect.poll(async () => (await roomState(page)).ply).toBeGreaterThan(ply);
}

async function setup(page: Page, browser: Browser, contextOptions: Parameters<Browser['newContext']>[0]) {
  const code = await createRoom(page, 'checkers', 'Ada');
  const guest = await joinRoom(browser, code, 'Bo', contextOptions);
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForPhase(guest, 'PLAYING');
  const dark = (await sideOf(page)) === 'first' ? page : guest;
  const light = dark === page ? guest : page;
  return { code, guest, dark, light };
}

test('checkers: two players move, a forced capture, resign, rematch with colours swapped, leave', async ({ page, browser, isMobile, hasTouch, viewport, userAgent }) => {
  const { dark, light } = await setup(page, browser, { isMobile, hasTouch, viewport: viewport ?? undefined, userAgent });

  await expect(dark.getByTestId('checkers-status')).toHaveText('Your move');
  await expect(light.getByTestId('checkers-status')).toContainText('Waiting for');
  // Light may not move on Dark's turn: none of its pieces are offered.
  await expect(square(light, 22)).not.toHaveAccessibleName(/can move/);
  await expect(square(dark, 11)).toHaveAccessibleName(/Dark man, can move/);
  // Each player sees their own colour at the bottom; Flip board turns it around.
  await expect(dark.getByRole('group', { name: 'Checkers board, Dark at the bottom' })).toBeVisible();
  await expect(light.getByRole('group', { name: 'Checkers board, Light at the bottom' })).toBeVisible();
  await light.getByRole('button', { name: 'Flip board' }).click();
  await expect(light.getByRole('group', { name: 'Checkers board, Dark at the bottom' })).toBeVisible();
  await light.getByRole('button', { name: 'Flip board' }).click();

  await play(dark, [11, 15]);
  await play(light, [22, 18]);

  // Dark must jump: the status says so and only the capturing man is offered.
  await expect(dark.getByText('Capture required')).toBeVisible();
  await expect(square(dark, 15)).toHaveAccessibleName(/must capture/);
  await expect(square(dark, 9)).not.toHaveAccessibleName(/must capture|can move/);
  await play(dark, [15, 22]);

  const state = await roomState(dark);
  expect(state.history.map((h: { notation: string }) => h.notation)).toEqual(['11-15', '22-18', '15x22']);
  expect(state.board[17]).toBe('.'); // the light man on 18 was captured
  expect(state.board[21]).toBe('d');
  await expect.poll(async () => (await roomState(light)).board).toBe(state.board);
  await expect(light.getByRole('list', { name: 'Move history' })).toContainText('15x22');

  // Light recaptures (two legal captures; it picks 26x17).
  await play(light, [26, 17]);
  expect((await roomState(light)).history.at(-1).notation).toBe('26x17');

  // Resign → result card → rematch with colours swapped.
  await light.getByRole('button', { name: 'Resign' }).click();
  await light.getByRole('button', { name: 'Confirm resign' }).click();
  await waitForPhase(dark, 'RESULTS');
  expect((await roomState(dark)).result).toMatchObject({ over: true, winner: 'first', reason: 'resign' });
  await expect(dark.getByRole('heading', { name: /You win/ })).toBeVisible();
  await expect(light.getByRole('heading', { name: /You lost/ })).toBeVisible();

  await dark.getByRole('button', { name: /^Rematch/ }).click();
  await light.getByRole('button', { name: 'Accept rematch' }).click();
  await expect.poll(async () => (await roomState(dark)).gameNumber, { timeout: 15_000 }).toBe(2);
  await waitForPhase(dark, 'PLAYING');
  expect(await sideOf(dark)).toBe('second');
  expect(await sideOf(light)).toBe('first');
  await expect(light.getByTestId('checkers-status')).toHaveText('Your move');

  await leaveRoom(light);
  await leaveRoom(dark);
});

test('checkers: a forced double jump completes from its first landing and a man is crowned', async ({ page, browser, isMobile, hasTouch, viewport, userAgent }) => {
  const { dark, light } = await setup(page, browser, { isMobile, hasTouch, viewport: viewport ?? undefined, userAgent });
  // A legal line: 15x24 and 27x20 are forced single jumps, 9x18x27 a forced double jump
  // (tapping 9 then 18 plays the whole chain), and 27-32 crowns Dark's man.
  const line = ['10-15', '24-19', '15-24', '27-20', '9-13', '28-24', '6-9', '32-28', '13-17', '21-14', '9-18', '22-17', '27-32'];
  for (let i = 0; i < line.length; i++) {
    await play(i % 2 === 0 ? dark : light, line[i]!.split('-').map(Number));
  }
  const state = await roomState(dark);
  expect(state.history.map((h: { notation: string }) => h.notation)).toEqual([
    '10-15', '24-19', '15x24', '27x20', '9-13', '28-24', '6-9', '32-28', '13-17', '21x14', '9x18x27', '22-17', '27-32',
  ]);
  expect(state.history[10]).toMatchObject({ captures: 2, crowned: false });
  expect(state.history[12]).toMatchObject({ crowned: true });
  expect(state.board[31]).toBe('D'); // a dark king on 32
  await expect(square(light, 32)).toHaveAccessibleName(/Dark king/);
  await expect(light.getByRole('region', { name: /^Dark · 1 king: / })).toBeVisible();

  await leaveRoom(light);
  await leaveRoom(dark);
});
