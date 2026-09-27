import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers';

async function isTouch(page: Page): Promise<boolean> {
  return page.evaluate(() => matchMedia('(pointer: coarse)').matches);
}

/** Press a control the way this device would (tap on touch, click otherwise). */
async function press(page: Page, name: string): Promise<void> {
  const button = page.getByRole('button', { name, exact: true });
  if (await isTouch(page)) await button.tap();
  else await button.click();
}

test.describe('DAS Tanks', () => {
  test('two players: aim, fire, the shell resolves on the server and the turn passes', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const code = await createRoom(page, 'tanks', 'Host');
    const guest = await joinRoom(browser, code, 'Guest');
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);
    await startGame(page);
    await waitForPhase(page, 'PLAYING', 20_000);
    await expect.poll(async () => (await roomState(page))?.battle?.stage, { timeout: 15_000 }).toBe('aim');

    const s0 = await roomState(page);
    expect(Object.keys(s0.tanks)).toHaveLength(2);
    const hostId = await myPlayerId(page);
    const shooter = s0.battle.activeId === hostId ? page : guest;
    const other = shooter === page ? guest : page;
    const shooterId = s0.battle.activeId as string;
    const turnId = s0.battle.turnId as number;

    await expect(shooter.getByRole('img', { name: 'Battlefield' })).toBeVisible();
    await expect(shooter.getByRole('img', { name: /^Wind/ })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Fire', exact: true })).toBeDisabled();

    // Aim: nudge the power up twice and the angle once — the server mirrors the live aim.
    const before = s0.tanks[shooterId];
    await press(shooter, 'More power');
    await press(shooter, 'More power');
    await press(shooter, 'Aim left (higher angle)');
    await expect.poll(async () => (await roomState(page))?.tanks?.[shooterId]?.power, { timeout: 10_000 }).toBe(before.power + 2);
    await expect.poll(async () => (await roomState(page))?.tanks?.[shooterId]?.angle, { timeout: 10_000 }).toBe(before.angle + 1);

    // Fire: the server simulates the shot, both clients see it resolve and the turn moves on.
    await press(shooter, 'Fire');
    await expect.poll(async () => (await roomState(page))?.battle?.shotSeq, { timeout: 10_000 }).toBe(1);
    const s1 = await roomState(page);
    expect(s1.tanks[shooterId].shots).toBe(1);
    await expect
      .poll(
        async () => {
          const s = await roomState(other);
          return s?.battle?.stage === 'aim' && s.battle.turnId > turnId ? s.battle.activeId : null;
        },
        { timeout: 30_000 },
      )
      .not.toBe(null);
    const s2 = await roomState(other);
    expect(s2.battle.activeId).not.toBe(shooterId);
    await expect(other.getByRole('button', { name: 'Fire', exact: true })).toBeEnabled();
    await expect(other.getByRole('region', { name: 'Tanks' })).toBeVisible();

    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });

  test('solo vs a CPU tank: the CPU gunner fires back', async ({ page }) => {
    test.setTimeout(120_000);
    await createRoom(page, 'tanks', 'Solo', { solo: true });
    await startGame(page);
    await waitForPhase(page, 'PLAYING', 20_000);
    const me = await myPlayerId(page);
    const s0 = await roomState(page);
    const cpu = Object.values(s0.tanks as Record<string, { id: string; cpu: boolean }>).find((t) => t.cpu);
    expect(cpu).toBeTruthy();
    // Keep playing (firing when it's our turn) until the CPU has fired at least once.
    await expect
      .poll(
        async () => {
          const s = await roomState(page);
          if (s?.battle?.stage === 'aim' && s.battle.activeId === me) {
            const fire = page.getByRole('button', { name: 'Fire', exact: true });
            if (await fire.isEnabled().catch(() => false)) await press(page, 'Fire');
          }
          const shots = (s?.tanks?.[cpu!.id]?.shots as number) ?? 0;
          return shots;
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBeGreaterThan(0);
    await leaveRoom(page);
  });
});
