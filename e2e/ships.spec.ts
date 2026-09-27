import { expect, test, type Locator, type Page } from '@playwright/test';
import { createRoom, dropConnection, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers';

const COLS = 'ABCDEFGHIJKL';

async function waitForStage(page: Page, stage: string, timeout = 15_000): Promise<void> {
  await expect.poll(async () => (await roomState(page))?.stage, { timeout }).toBe(stage);
}

/** Drag with real pointer events (works for mouse and touch-emulated projects alike). */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

/** The enemy grid, switching to it first on phones (one grid at a time there). */
async function enemyBoard(page: Page): Promise<Locator> {
  const board = page.getByTestId('ships-enemy-board');
  // Only phones have the switch. On desktop the grid can be briefly absent (e.g. re-rendering after a
  // reconnect): wait for it below instead of an unbounded click on a radio that never appears, which
  // would outlive the caller's expect.poll timeout and hang the test.
  const toggle = page.getByRole('radio', { name: /Enemy waters/ });
  if (!(await board.isVisible()) && (await toggle.count()) > 0) await toggle.click({ timeout: 5_000 });
  await expect(board).toBeVisible();
  return board;
}

/** Whoever's turn it is fires one shot at an untouched square (tap-to-aim + confirm on touch screens). */
async function fireOnce(pages: Page[]): Promise<void> {
  const state = await roomState(pages[0]!);
  for (const page of pages) {
    if ((await myPlayerId(page)) !== state.turnId) continue;
    const target = state.sides.find((s: any) => s.playerId !== state.turnId);
    const idx = [...target.board].findIndex((c: string, i: number) => c === '.' && (i * 7) % 3 === 0);
    const cell = `${COLS[idx % state.gridSize]}${Math.floor(idx / state.gridSize) + 1}`;
    const board = await enemyBoard(page);
    await board.getByRole('button', { name: new RegExp(`^(Fire at|Aim at) ${cell}$`) }).click();
    const confirm = page.getByRole('button', { name: `Fire at ${cell}`, exact: true }).and(page.locator('.dc-btn'));
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect.poll(async () => (await roomState(page)).turnSeq).toBeGreaterThan(state.turnSeq);
    return;
  }
  throw new Error('nobody to fire');
}

test('DAS Ships: deploy (tap, drag, randomize), trade shots, resign → results, rematch', async ({ page, browser }) => {
  const code = await createRoom(page, 'ships', 'Ada');
  const guest = await joinRoom(browser, code, 'Bo');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await waitForStage(page, 'placement');

  // --- Deployment: tap-to-place, drag from the dock, randomize, lock in ---------------------------
  const deploy = page.getByTestId('ships-deploy-board');
  await expect(deploy).toBeVisible();
  // The Arcology is selected first: tap a square to place it.
  await deploy.getByRole('button', { name: 'Place Arcology at A1', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Arcology, 5 squares, deployed/ })).toBeVisible();
  // Drag the Riptide from the dock onto the grid.
  await drag(
    page,
    page.getByRole('button', { name: /^Riptide, 3 squares/ }),
    deploy.getByRole('button', { name: 'Place Tidebreaker at E6', exact: true }),
  );
  await expect(page.getByRole('button', { name: /^Riptide, 3 squares, deployed/ })).toBeVisible();
  await expect(deploy.getByRole('button', { name: /^E6, Riptide/ })).toBeVisible();
  // Select the placed Riptide and turn it with the Rotate button: it now runs down from E6.
  await deploy.getByRole('button', { name: /^E6, Riptide/ }).click();
  await page.getByRole('button', { name: /^Rotate/ }).click();
  await expect(deploy.getByRole('button', { name: /^E7, Riptide/ })).toBeVisible();
  // Not complete yet: Ready is disabled.
  await expect(page.getByRole('button', { name: /more vessel/ })).toBeDisabled();
  // Randomize deploys the rest around the vessels placed by hand.
  await page.getByRole('button', { name: 'Fill the rest', exact: true }).click();
  await page.getByRole('button', { name: 'Ready — lock in fleet', exact: true }).click();
  const hostId = await myPlayerId(page);
  await expect.poll(async () => (await roomState(page)).sides.find((s: any) => s.playerId === hostId)?.ready).toBe(true);

  await guest.getByRole('button', { name: 'Randomize', exact: true }).click();
  await guest.getByRole('button', { name: 'Ready — lock in fleet', exact: true }).click();
  await waitForStage(page, 'battle');

  // Nothing about either fleet is in the synchronized state while the battle is live.
  const live = await roomState(page);
  expect(JSON.stringify(live)).not.toMatch(/arcology|tidebreaker|lanternfish|riptide|glowdart/i);
  expect(live.sides.every((s: any) => s.revealed.length === 0 && s.board === '.'.repeat(100))).toBe(true);
  // Your own fleet is drawn from the private message.
  const hostOwn = page.getByTestId('ships-own-board');
  if (!(await hostOwn.isVisible())) await page.getByRole('radio', { name: /Your fleet/ }).click();
  await expect(hostOwn.getByRole('button', { name: /^A1, your Arcology/ })).toBeVisible();
  await expect(hostOwn.getByRole('button', { name: /^E8, your Riptide/ })).toBeVisible();

  // --- Battle: four alternating shots ------------------------------------------------------------
  const pages = [page, guest];
  for (let i = 0; i < 4; i++) await fireOnce(pages);
  const mid = await roomState(page);
  expect(mid.sides.map((s: any) => s.shots)).toEqual([2, 2]);
  expect(mid.sides.every((s: any) => s.board.replace(/\./g, '').length === 2)).toBe(true);
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Battle log' })).toContainText(/fired at [A-J]\d+/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Battle log' })).toHaveCount(0);

  // --- Resign → results with both fleets revealed ----------------------------------------------
  await guest.getByRole('button', { name: 'Resign', exact: true }).click();
  await guest.getByRole('dialog').getByRole('button', { name: 'Resign', exact: true }).click();
  await waitForPhase(page, 'RESULTS');
  await expect(page.getByRole('heading', { name: 'Victory' })).toBeVisible();
  await expect(guest.getByRole('heading', { name: 'Defeat' })).toBeVisible();
  const end = await roomState(page);
  expect(end.endReason).toBe('resign');
  expect(end.sides.every((s: any) => s.revealed.length === 5)).toBe(true);

  // --- Rematch: both agree → a fresh deployment ---------------------------------------------------
  await page.getByRole('button', { name: 'Rematch', exact: true }).click();
  await expect(guest.getByText('Ada wants a rematch!')).toBeVisible();
  await guest.getByRole('button', { name: 'Accept rematch', exact: true }).click();
  await expect.poll(async () => (await roomState(page)).matchNo, { timeout: 15_000 }).toBe(end.matchNo + 1);
  await waitForStage(page, 'placement');

  await leaveRoom(guest);
  await leaveRoom(page);
  await expect(page).toHaveURL(/\/$/);
});

test('DAS Ships: salvo mode fires one shot per surviving vessel; phones switch grids', async ({ page, browser }) => {
  const code = await createRoom(page, 'ships', 'Host');
  const guest = await joinRoom(browser, code, 'Guest');
  // Phones show the lobby in tabs.
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await page.getByRole('radio', { name: 'Salvo', exact: true }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).firing).toBe('salvo');
  await startGame(page);
  await waitForStage(page, 'placement');
  for (const p of [page, guest]) {
    await p.getByRole('button', { name: 'Randomize', exact: true }).click();
    await p.getByRole('button', { name: 'Ready — lock in fleet', exact: true }).click();
  }
  await waitForStage(page, 'battle');
  const s = await roomState(page);
  expect(s.shotsAllowed).toBe(5);
  const shooter = (await myPlayerId(page)) === s.turnId ? page : guest;
  const board = await enemyBoard(shooter);
  const fire = shooter.getByRole('button', { name: /^Fire salvo/ });
  await expect(fire).toHaveText(/0\/5/);
  for (const cell of ['A1', 'C3', 'E5', 'G7', 'I9'])
    await board.getByRole('button', { name: `Mark ${cell} for the salvo`, exact: true }).click();
  await expect(fire).toHaveText(/5\/5/);
  await fire.click();
  await expect.poll(async () => (await roomState(page)).turnSeq).toBeGreaterThan(s.turnSeq);
  const after = await roomState(page);
  expect(after.sides.find((x: any) => x.playerId === s.turnId).shots).toBe(5);
  expect(after.lastShots).toHaveLength(5);

  // One grid at a time on phones: the switch shows each grid on demand.
  const other = shooter === page ? guest : page;
  const toggle = other.getByRole('radio', { name: /Your fleet/ });
  if (await toggle.isVisible()) {
    await toggle.click();
    await expect(other.getByTestId('ships-own-board')).toBeVisible();
    await expect(other.getByTestId('ships-enemy-board')).toHaveCount(0);
    await other.getByRole('radio', { name: /Enemy waters/ }).click();
    await expect(other.getByTestId('ships-enemy-board')).toBeVisible();
  } else {
    await expect(other.getByTestId('ships-own-board')).toBeVisible();
    await expect(other.getByTestId('ships-enemy-board')).toBeVisible();
  }

  await leaveRoom(guest);
  await leaveRoom(page);
});

test('DAS Ships: keyboard only — arrows + Enter place, R turns, Enter fires', async ({ page, browser, isMobile }) => {
  test.skip(isMobile, 'keyboard flow is for desktop browsers');
  const code = await createRoom(page, 'ships', 'Keys');
  const guest = await joinRoom(browser, code, 'Mouse');
  await startGame(page);
  await waitForStage(page, 'placement');
  const deploy = page.getByTestId('ships-deploy-board');
  await deploy.getByRole('button', { name: 'Place Arcology at A1', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(deploy.getByRole('button', { name: /^C1, Arcology/ })).toBeVisible();
  // R turns the next vessel before it is placed.
  await page.keyboard.press('r');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(deploy.getByRole('button', { name: /^C6, Tidebreaker/ })).toBeVisible();
  await page.getByRole('button', { name: 'Fill the rest', exact: true }).click();
  await page.getByRole('button', { name: 'Ready — lock in fleet', exact: true }).click();
  await guest.getByRole('button', { name: 'Randomize', exact: true }).click();
  await guest.getByRole('button', { name: 'Ready — lock in fleet', exact: true }).click();
  await waitForStage(page, 'battle');
  const s = await roomState(page);
  const shooter = (await myPlayerId(page)) === s.turnId ? page : guest;
  const board = shooter.getByTestId('ships-enemy-board');
  await board.getByRole('button', { name: 'Fire at A1', exact: true }).focus();
  await shooter.keyboard.press('ArrowDown');
  await shooter.keyboard.press('Enter');
  await expect.poll(async () => (await roomState(page)).turnSeq).toBeGreaterThan(s.turnSeq);
  const after = await roomState(page);
  expect(after.lastShots[0]).toMatchObject({ x: 0, y: 1 });
  await leaveRoom(guest);
  await leaveRoom(page);
});

test('DAS Ships: a volley lost on a half-open connection never locks the captain out', async ({ page, browser }) => {
  const code = await createRoom(page, 'ships', 'Host');
  const guest = await joinRoom(browser, code, 'Guest');
  await startGame(page);
  await waitForStage(page, 'placement');
  for (const p of [page, guest]) {
    await p.getByRole('button', { name: 'Randomize', exact: true }).click();
    await p.getByRole('button', { name: 'Ready — lock in fleet', exact: true }).click();
  }
  await waitForStage(page, 'battle');
  const s = await roomState(page);
  const shooter = (await myPlayerId(page)) === s.turnId ? page : guest;
  const aimAndFire = async (cell: string) => {
    const board = await enemyBoard(shooter);
    await board.getByRole('button', { name: new RegExp(`^(Fire at|Aim at) ${cell}$`) }).click({ timeout: 2000 });
    const confirm = shooter.getByRole('button', { name: `Fire at ${cell}`, exact: true }).and(shooter.locator('.dc-btn'));
    if (await confirm.isVisible().catch(() => false)) await confirm.click({ timeout: 2000 });
  };
  // The socket silently swallows the shot (a dead mobile connection nobody noticed yet)…
  await shooter.evaluate(() => {
    const ws = (window as any).__DASCADE__.session.room.connection.transport.ws;
    ws.send = () => undefined;
  });
  await aimAndFire('B2');
  await shooter.waitForTimeout(300);
  expect((await roomState(shooter)).turnSeq).toBe(s.turnSeq);
  // …the drop is detected, the seat reconnects, and the captain can fire again (same turn).
  await dropConnection(shooter);
  await expect.poll(() => shooter.evaluate(() => (window as any).__DASCADE__.store.getState().status), { timeout: 15_000 }).toBe('connected');
  await expect
    .poll(
      async () => {
        // Keep trying the same shot until it lands (the unconfirmed one is dropped after a few seconds).
        if ((await roomState(shooter)).turnSeq === s.turnSeq) await aimAndFire('B2').catch(() => undefined);
        return (await roomState(shooter)).turnSeq;
      },
      { timeout: 12_000, intervals: [1000] },
    )
    .toBeGreaterThan(s.turnSeq);
  await leaveRoom(guest);
  await leaveRoom(page);
});
