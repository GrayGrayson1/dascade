import { expect, test, type Page } from '@playwright/test';
import { createRoom, dropConnection, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers';

const square = (page: Page, sq: string) => page.locator(`[data-sq="${sq}"]`);

/** Pointer drag from one square to another (works for mouse and touch-emulating projects). */
async function drag(page: Page, from: string, to: string): Promise<void> {
  const a = await square(page, from).boundingBox();
  const b = await square(page, to).boundingBox();
  if (!a || !b) throw new Error('square not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 6, a.y + a.height / 2 - 6, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('DAS Chess: two players move by click and by drag, resign → results, leave', async ({ page, browser }) => {
  const code = await createRoom(page, 'chess', 'Hostess');
  // Host plays White (set through the lobby settings UI; phones show the settings in a tab).
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible().catch(() => false)) await settingsTab.click();
  await page.getByRole('radio', { name: 'Host White' }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).sides).toBe('host_first');
  const guest = await joinRoom(browser, code, 'Guest');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForPhase(guest, 'PLAYING');

  const board = page.getByRole('group', { name: 'Chess board' });
  await expect(board).toBeVisible();
  await expect(page.getByRole('button', { name: 'e2, white pawn' })).toBeVisible();

  // White: click the pawn, see its legal targets, click e4.
  await square(page, 'e2').click();
  await expect(square(page, 'e4')).toHaveAttribute('data-target', 'move');
  await expect(square(page, 'e3')).toHaveAttribute('data-target', 'move');
  await square(page, 'e4').click();
  await expect.poll(async () => (await roomState(page)).ply).toBe(1);
  expect((await roomState(guest)).moves[0].san).toBe('e4');
  await expect(guest.getByRole('button', { name: 'e4, white pawn' })).toBeVisible();

  // Black: drag e7 → e5 (the guest's board is flipped: Black at the bottom).
  await drag(guest, 'e7', 'e5');
  await expect.poll(async () => (await roomState(guest)).ply).toBe(2);
  const s = await roomState(page);
  expect(s.moves.map((m: { san: string }) => m.san)).toEqual(['e4', 'e5']);
  expect(s.turn).toBe('first');
  await expect(page.getByRole('list', { name: 'Moves' })).toContainText('e5');
  await expect(page.locator('.ch-status')).toContainText('Your move');

  // An illegal click-move does nothing (and nothing is sent).
  await square(page, 'e4').click();
  await expect(square(page, 'e5')).not.toHaveAttribute('data-target', /./);
  await square(page, 'e5').click();
  await page.waitForTimeout(300);
  expect((await roomState(page)).ply).toBe(2);

  // Black resigns (two-step confirm) → results for both.
  await guest.getByRole('button', { name: 'Resign' }).click();
  await guest.getByRole('button', { name: 'Confirm resign' }).click();
  await waitForPhase(page, 'RESULTS');
  const done = await roomState(page);
  expect(done.result).toMatchObject({ over: true, winner: 'first', reason: 'resign' });
  expect(done.pgn).toMatch(/1\. e4 \{\[%clk 0:1\d:\d\d\]\} e5 \{\[%clk 0:1\d:\d\d\]\} 1-0/);
  expect(done.pgn).toContain('[Result "1-0"]');
  await expect(page.locator('.br-result')).toContainText('You win!');
  await expect(guest.locator('.br-result')).toContainText('You lost');
  await expect(page.getByRole('button', { name: /Rematch/ })).toBeVisible();

  await leaveRoom(guest);
  await leaveRoom(page);
  await expect(page).toHaveURL(/\/$/);
});

test('DAS Chess: a second finger landing during a touch drag never breaks the board', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Multi-touch is driven through the Chromium DevTools protocol');
  const touch = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
  const page = await (await browser.newContext(touch)).newPage();
  const code = await createRoom(page, 'chess', 'Twofinger');
  await page.evaluate(() => (window as any).__DASCADE__.session.lobby.settings({ sides: 'host_first' }));
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).sides).toBe('host_first');
  const guest = await joinRoom(browser, code, 'Guest', touch);
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await expect(square(page, 'e2')).toBeVisible();

  const centre = async (sq: string) => {
    const b = (await square(page, sq).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const from = await centre('e2');
  const to = await centre('e4');
  // The stray touch lands on another piece (touch-action: none there, so the browser starts no pinch/pan).
  const stray = await centre('a2');
  const cdp = await page.context().newCDPSession(page);
  const point = (id: number, p: { x: number; y: number }) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 });
  const touchEvent = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: ReturnType<typeof point>[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  // Finger 1 picks up the e-pawn and starts dragging…
  await touchEvent('touchStart', [point(1, from)]);
  for (let i = 1; i <= 5; i++) await touchEvent('touchMove', [point(1, { x: from.x, y: from.y - i * 8 })]);
  const mid = { x: from.x, y: from.y - 40 };
  // …a second finger (or palm) comes down on the board and rests there…
  await touchEvent('touchStart', [point(1, mid), point(2, stray)]);
  // …while finger 1 carries on and drops the pawn on e4 (both fingers lift at the end).
  for (let i = 1; i <= 5; i++) await touchEvent('touchMove', [point(1, { x: to.x, y: mid.y + ((to.y - mid.y) * i) / 5 }), point(2, stray)]);
  await touchEvent('touchEnd', []);
  await cdp.detach();

  await expect.poll(async () => (await roomState(page)).ply).toBe(1);
  expect((await roomState(page)).moves[0].san).toBe('e4');
  await expect(page.locator('.br-ghost[data-active]')).toHaveCount(0);
  await expect(page.locator('[data-dragging]')).toHaveCount(0);

  await leaveRoom(guest);
  await leaveRoom(page);
});

/** Host plays White (lobby setting), a guest joins, the game starts. */
async function whiteVsBlack(page: Page, browser: import('@playwright/test').Browser, name: string) {
  const code = await createRoom(page, 'chess', name);
  await page.evaluate(() => (window as any).__DASCADE__.session.lobby.settings({ sides: 'host_first' }));
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).sides).toBe('host_first');
  const guest = await joinRoom(browser, code, 'Guest');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForPhase(guest, 'PLAYING');
  return guest;
}

test('DAS Chess: a move lost on a half-open connection never locks the player out', async ({ page, browser }) => {
  const guest = await whiteVsBlack(page, browser, 'Halfopen');
  await expect(square(page, 'e2')).toBeVisible();
  // The socket silently swallows the next message (a dead mobile connection nobody noticed yet)…
  await page.evaluate(() => {
    const ws = (window as any).__DASCADE__.session.room.connection.transport.ws;
    ws.send = () => undefined;
  });
  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await page.waitForTimeout(300);
  expect((await roomState(page)).ply).toBe(0);
  // …then the drop is detected and the seat reconnects.
  await dropConnection(page);
  await expect.poll(() => page.evaluate(() => (window as any).__DASCADE__.store.getState().status), { timeout: 15_000 }).toBe('connected');
  // The unconfirmed move is dropped (server position is authoritative) and White can move again.
  await expect(page.getByRole('button', { name: 'e2, white pawn' })).toBeVisible({ timeout: 10_000 });
  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await expect.poll(async () => (await roomState(page)).ply).toBe(1);
  expect((await roomState(guest)).moves[0].san).toBe('e4');
  await leaveRoom(guest);
  await leaveRoom(page);
});

test('DAS Chess: a take-back cancels the queued premove (it never fires in a position nobody planned)', async ({ page, browser }) => {
  const guest = await whiteVsBlack(page, browser, 'Premover');
  await square(page, 'e2').click();
  await square(page, 'e4').click();
  await expect.poll(async () => (await roomState(page)).ply).toBe(1);
  // Black to move: White queues a premove d2-d4…
  await square(page, 'd2').click();
  await square(page, 'd4').click();
  await expect(square(page, 'd4')).toHaveAttribute('data-premove', /.*/);
  // …then asks to take e4 back; Black accepts. It is White's turn again, and the premove must NOT fire.
  await page.getByRole('button', { name: 'Take back' }).click();
  await guest.getByRole('button', { name: 'Accept take-back' }).click();
  await expect.poll(async () => (await roomState(page)).ply).toBe(0);
  await page.waitForTimeout(800);
  const s = await roomState(page);
  expect(s.ply).toBe(0);
  expect(s.moves).toHaveLength(0);
  await expect(page.locator('[data-premove]')).toHaveCount(0);
  await leaveRoom(guest);
  await leaveRoom(page);
});
