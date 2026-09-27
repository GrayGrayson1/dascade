import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers';

async function waitForPlay(page: Page, holeIndex = 0): Promise<void> {
  await expect
    .poll(async () => {
      const s = await roomState(page);
      return s?.phase === 'PLAYING' && s?.holeStatus === 'play' && s?.holeIndex === holeIndex;
    }, { timeout: 25_000 })
    .toBe(true);
}

/**
 * Slingshot putt: press on the course, drag back, release. Desktop uses the mouse; touch
 * devices get real touch-type pointer events (Playwright can only tap with its touchscreen).
 */
async function dragPutt(page: Page, touch: boolean, dx: number, dy: number): Promise<void> {
  const canvas = page.getByRole('img', { name: /Mini golf course/ });
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  if (!touch) {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + dx, y0 + dy, { steps: 8 });
    await page.mouse.up();
    return;
  }
  const at = (x: number, y: number, buttons = 1) => ({ pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, buttons, bubbles: true });
  await canvas.dispatchEvent('pointerdown', at(x0, y0));
  for (let i = 1; i <= 8; i++) await canvas.dispatchEvent('pointermove', at(x0 + (dx * i) / 8, y0 + (dy * i) / 8));
  await canvas.dispatchEvent('pointerup', at(x0 + dx, y0 + dy, 0));
}

async function golfer(page: Page, id: string) {
  return (await roomState(page))?.golfers?.[id];
}

test.describe('DAS Putt', () => {
  test('two players: drag to putt, take turns, strokes are server-counted', async ({ page, browser, isMobile, hasTouch }) => {
    test.setTimeout(120_000);
    const code = await createRoom(page, 'putt', 'Host');
    const hostId = (await myPlayerId(page))!;
    const guest = await joinRoom(browser, code, 'Guest', isMobile ? { viewport: page.viewportSize() ?? undefined, hasTouch, isMobile } : {});
    const guestId = (await myPlayerId(guest))!;
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);

    await startGame(page);
    await waitForPhase(page, 'PLAYING', 20_000);
    await waitForPlay(page);
    const s0 = await roomState(page);
    expect(s0.route).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(s0.turnId).toBe(hostId);
    await expect(page.getByRole('img', { name: /Mini golf course — hole 1/ })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Putt controls' })).toBeVisible();

    // The host pulls back and releases: the client sends only an intent; the server simulates.
    // Pull back away from the cup (east on hole 1). On portrait phones the hole is drawn rotated
    // (east = up the screen), so read the camera's orientation instead of guessing.
    const rotated = await page.evaluate(() => Boolean((window as any).__PUTT__?.renderer.cam.rotated));
    await dragPutt(page, hasTouch, rotated ? 0 : -140, rotated ? 140 : 0);
    await expect.poll(async () => (await roomState(page))?.shotSeq, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => (await golfer(page, hostId))?.moving === false && (await golfer(page, hostId))?.lastSeq === 1, { timeout: 30_000 }).toBe(true);
    expect((await golfer(page, hostId)).strokes).toBeGreaterThanOrEqual(1);
    expect((await golfer(page, hostId)).x).not.toBe(s0.golfers[hostId].x);

    // Now it is the guest's turn (unless the host aced it — then the guest is still up).
    await expect.poll(async () => (await roomState(page))?.turnId, { timeout: 10_000 }).toBe(guestId);
    // The guest putts with the accessible controls instead of dragging.
    await guest.getByRole('button', { name: 'Aim right' }).click();
    const putt = guest.getByRole('button', { name: 'Putt', exact: true });
    await expect(putt).toBeEnabled();
    await putt.click();
    await expect.poll(async () => (await roomState(guest))?.shotSeq, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => (await golfer(guest, guestId))?.lastSeq, { timeout: 30_000 }).toBe(2);
    await expect(guest.getByRole('complementary', { name: 'Leaderboard' })).toBeVisible();

    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });

  test('solo practice: keyboard/tap putt, pick up, hole summary', async ({ page, hasTouch }) => {
    test.setTimeout(90_000);
    await createRoom(page, 'putt', 'Solo', { solo: true });
    const me = (await myPlayerId(page))!;
    await waitForPlay(page);
    const s0 = await roomState(page);
    expect(s0.solo).toBe(true);
    expect(s0.golfers[me].deadline).toBe(0);
    if (hasTouch) {
      await page.getByRole('button', { name: 'Putt', exact: true }).tap();
    } else {
      await page.locator('body').click({ position: { x: 5, y: 300 } });
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');
    }
    await expect.poll(async () => (await roomState(page))?.shotSeq, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => (await golfer(page, me))?.moving === false && (await golfer(page, me))?.strokes >= 1, { timeout: 30_000 }).toBe(true);
    const holed = (await golfer(page, me)).holed;
    if (!holed) {
      await page.getByRole('button', { name: 'Pick up' }).click();
      await page.getByRole('button', { name: /^Pick up \(/ }).click();
    }
    await waitForPhase(page, 'INTERMISSION', 15_000);
    await expect(page.getByRole('dialog', { name: 'Launch Pad' })).toBeVisible();
    await expect(page.getByText('Hole 1 complete')).toBeVisible();
    expect((await golfer(page, me)).card[0]).toBeGreaterThanOrEqual(1);
    await waitForPlay(page, 1);
    await leaveRoom(page);
  });

  test('landscape phone: Pick up stays reachable in the slim dock', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout');
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await createRoom(page, 'putt', 'Solo', { solo: true });
    const me = (await myPlayerId(page))!;
    await waitForPlay(page);
    await page.getByRole('button', { name: 'Putt', exact: true }).tap();
    await expect.poll(async () => (await golfer(page, me))?.moving === false && (await golfer(page, me))?.strokes >= 1, { timeout: 30_000 }).toBe(true);
    test.skip((await golfer(page, me)).holed, 'holed in one — nothing to pick up');
    const pickUp = page.getByRole('button', { name: 'Pick up', exact: true });
    await expect(pickUp).toBeInViewport();
    await pickUp.tap();
    const confirm = page.getByRole('button', { name: /^Pick up \(/ });
    await expect(confirm).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Keep playing' })).toBeInViewport();
    await confirm.tap();
    await waitForPhase(page, 'INTERMISSION', 15_000);
    expect((await golfer(page, me)).card[0]).toBeGreaterThanOrEqual(1);
    await leaveRoom(page);
  });
});
