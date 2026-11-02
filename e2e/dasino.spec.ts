import { test, expect, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, presetSettings, roomState, startGame, waitForPhase } from './helpers';

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

async function myId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__DASCADE__.store.getState().playerId as string);
}

/** Waits for an open betting window with enough time left to click. */
async function waitForBetting(page: Page, table: 'roulette' | 'dice', minLeftMs = 2500): Promise<number> {
  await expect
    .poll(
      async () => {
        const s = await roomState(page);
        const t = s?.[table];
        return Boolean(t && t.phase === 'BETTING' && t.endsAt - Date.now() > minLeftMs);
      },
      { timeout: 45_000, message: `${table} betting window` },
    )
    .toBe(true);
  return (await roomState(page))[table].round as number;
}

test('DASino smoke: roulette, slots and dice with two players', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const code = await createRoom(page, 'dasino', 'Host');
  await page.evaluate(() => (window as any).__DASCADE__.session.lobby.settings({ rouletteBettingSeconds: 5, diceBettingSeconds: 5 }));
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).rouletteBettingSeconds).toBe(5);

  const guest = await joinRoom(browser, code, 'Guest');
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await expect(page.getByRole('heading', { name: 'DASino' })).toBeVisible();
  await expect(page.getByText('Virtual chips only').first()).toBeVisible();
  const me = await myId(page);
  const guestId = await myId(guest);
  await expect.poll(async () => (await roomState(page)).seats[me]?.balance).toBe(10_000);

  // --- Roulette: bet on red and watch it settle -----------------------------
  await page.getByRole('button', { name: 'Play roulette' }).click();
  await expect(page.getByRole('heading', { name: 'European Roulette' })).toBeVisible();
  await page.getByRole('radio', { name: '25 chip' }).click();
  const round = await waitForBetting(page, 'roulette');
  await page.getByRole('button', { name: /^Red, pays 1 to 1/ }).click();
  await expect.poll(async () => (await roomState(page)).seats[me].inPlay).toBe(25);
  // The guest sees the host's chips on the shared felt.
  await expect.poll(async () => (await roomState(guest)).roulette.bets.some((b: any) => b.playerId === me && b.spot === 'red')).toBe(true);
  await expect
    .poll(
      async () => {
        const s = await roomState(page);
        return s.roulette.round === round && s.roulette.phase === 'RESULT';
      },
      { timeout: 40_000, message: 'roulette settlement' },
    )
    .toBe(true);
  const settled = await roomState(page);
  const won = RED.has(settled.roulette.result);
  expect(settled.seats[me].balance).toBe(10_000 - 25 + (won ? 50 : 0));
  expect(settled.seats[me].inPlay).toBe(0);
  await expect(page.locator('.dn-wheel-result')).toContainText(String(settled.roulette.result));
  await expect(page.locator('.dn-status').first()).toContainText(won ? 'You won 50' : 'You lost 25');

  // --- Slots: one spin, settled by the server --------------------------------
  await page.getByRole('button', { name: 'Slots', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pull the lever to spin' }).or(page.getByRole('button', { name: /^Spin for/ })).first()).toBeVisible();
  const beforeSpin = (await roomState(page)).seats[me].balance as number;
  await page.getByRole('button', { name: /^Spin for/ }).click();
  await expect.poll(async () => (await roomState(page)).seats[me].spins).toBe(1);
  const afterSpin = (await roomState(page)).seats[me];
  expect(afterSpin.wagered).toBe(25 + 25); // roulette 25 + default 5 lines × 5
  expect(afterSpin.balance).toBe(beforeSpin - 25 + (afterSpin.returned - (won ? 50 : 0)));
  await expect(page.getByRole('button', { name: /^Spin for/ })).toBeEnabled({ timeout: 10_000 });

  // --- Dice: bet on an open pick and see the roll settle --------------------
  await page.getByRole('button', { name: 'Dice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dice High / Low' })).toBeVisible();
  const diceRound = await waitForBetting(page, 'dice');
  await page.getByRole('button', { name: /^(Higher|Same|Lower): pays/ }).first().click();
  await expect.poll(async () => (await roomState(page)).dice.bets.some((b: any) => b.playerId === me)).toBe(true);
  await expect
    .poll(
      async () => {
        const s = await roomState(page);
        return s.dice.round === diceRound && s.dice.phase === 'RESULT';
      },
      { timeout: 30_000, message: 'dice settlement' },
    )
    .toBe(true);
  const diceState = await roomState(page);
  expect(diceState.seats[me].inPlay).toBe(0);
  expect(diceState.dice.history.at(-1).round).toBe(diceRound);

  // Guest is still seated with an untouched balance.
  expect(diceState.seats[guestId].balance).toBe(10_000);

  await leaveRoom(guest);
  await leaveRoom(page);
  await expect(page).toHaveURL(/\/$/);
});

/** Relative luminance of the first colour in a computed background (colour or gradient). */
async function surfaceLuminance(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    // A solid panel colour wins (glass panels add a faint white sheen gradient on top); else the gradient.
    const solid = !/rgba\([^)]*,\s*0\)$/.test(cs.backgroundColor) && cs.backgroundColor !== 'transparent';
    const src = solid ? cs.backgroundColor : cs.backgroundImage.slice(cs.backgroundImage.indexOf('linear-gradient'));
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(src);
    if (!m) return -1;
    const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(+m[1]!) + 0.7152 * lin(+m[2]!) + 0.0722 * lin(+m[3]!);
  });
}

for (const [theme, light] of [
  ['corporate-98', true],
  ['delta-neon', false],
] as const) {
  test(`DASino chrome follows the theme: ${theme} panels are ${light ? 'light' : 'the dark violet originals'}`, async ({ page }) => {
    await presetSettings(page, { theme });
    await createRoom(page, 'dasino', 'Host');
    await startGame(page);
    await waitForPhase(page, 'PLAYING');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const part of ['.dn-card', '.dn-balance', '.dn-glass']) {
      const l = await surfaceLuminance(page, part);
      if (light) expect(l, part).toBeGreaterThan(0.4);
      else expect(l, part).toBeLessThan(0.05);
    }
    await leaveRoom(page);
  });
}
