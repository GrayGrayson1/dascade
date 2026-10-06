/**
 * The claw machine: the floor machine at the right end of the row (desktop) or the quick Claw button
 * (phones) opens its close-up; you operate it (keys / joystick / the big button); a try ends in a
 * result; a win drops a plush out of the prize door onto your shelf and out of the shared pile;
 * closing settles or cancels a try cleanly. Wins are made deterministic with the close-up's test hook
 * (`__dascadeClaw.rig()`, only present with `?clawSeed=`: dead over the best grip, an absurdly strong
 * coil — a guaranteed win).
 */
import { expect, test, type Page } from '@playwright/test';
import { presetSettings } from './helpers.ts';

const CABINETS = 11;

async function openFloor(page: Page, query = '?clawSeed=7'): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('.af-cab')).toHaveCount(CABINETS);
  await expect(page.locator('.af-cab[aria-current="true"]')).toHaveCount(1);
}

const machine = (page: Page) => page.getByRole('button', { name: /^Claw machine — step up and play/ });
const closeup = (page: Page) => page.getByRole('dialog', { name: 'Claw machine' });
const status = (page: Page) => page.locator('[data-part="claw-status"]');
const go = (page: Page) => page.locator('[data-part="claw-go"]');
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('dascade:v2:claw') ?? 'null'));
const hook = (page: Page) => page.waitForFunction(() => !!(window as unknown as { __dascadeClaw?: unknown }).__dascadeClaw);
const rig = (page: Page) => page.evaluate(() => (window as unknown as { __dascadeClaw: { rig: () => boolean } }).__dascadeClaw.rig());
const gx = async (page: Page) => Number(await closeup(page).getAttribute('data-gx'));
const gz = async (page: Page) => Number(await closeup(page).getAttribute('data-gz'));

/** Opens the close-up the way this viewport offers it: the machine on the floor, or the quick button. */
async function walkUp(page: Page, isMobile: boolean): Promise<void> {
  if (isMobile) await page.locator('[data-part="claw-quick"]:visible').first().click();
  else await machine(page).click();
  await expect(closeup(page)).toBeVisible();
  await hook(page);
  // The machine zooms out of the one on the floor: wait for that (finite) animation before measuring
  // anything (the marquee's endless chasers don't count).
  await page.waitForFunction(() => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) return false;
    return dialog
      .getAnimations({ subtree: true })
      .every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity);
  });
}

/** A drop straight after the token is ignored (a double click can't insert and drop at once). */
const settle = (page: Page) => page.waitForTimeout(450);

async function winOnce(page: Page, won = /^You won a (blob|bunny|star|cube bot) plush!/): Promise<void> {
  await go(page).click();
  await expect(go(page)).toHaveAttribute('data-mode', 'drop');
  expect(await rig(page)).toBe(true);
  await settle(page);
  await go(page).click();
  await expect(page.locator('[data-part="claw-prize"]')).toBeVisible({ timeout: 30_000 });
  await expect(status(page)).toHaveText(won);
  await expect(closeup(page)).toHaveAttribute('data-phase', 'idle', { timeout: 15_000 });
}

test.describe('the claw machine', () => {
  test('stands at the right end of the row, clear of the cabinets', async ({ page, isMobile }) => {
    test.skip(isMobile, 'phones have no free floor ends');
    await openFloor(page);
    const box = (await machine(page).boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThan(vp.width * 0.7);
    const cabinets = page.locator('.af-slot');
    for (let i = 0; i < (await cabinets.count()); i++) {
      const slot = cabinets.nth(i);
      if (Number(await slot.evaluate((e) => getComputedStyle(e).opacity)) < 0.05) continue;
      const front = (await slot.locator('[data-part="cabinet-front"]').boundingBox())!;
      expect(front.x + front.width, `cabinet ${i} runs into the claw machine`).toBeLessThanOrEqual(box.x);
    }
    const plaque = (await page.locator('[data-part="plaque"]').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(plaque.y);
    await expect(page.locator('[data-part="claw-machine"] .clw-toy')).toHaveCount(22);
    // The floor shows the machine, so no quick button.
    await expect(page.locator('[data-part="claw-quick"]:visible')).toHaveCount(0);
  });

  test('walk up, move the claw with the keys, drop, see a result; Esc returns to the floor', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard path on desktop');
    await openFloor(page);
    await machine(page).focus();
    await page.keyboard.press('Enter');
    await expect(closeup(page)).toBeVisible();
    await hook(page);
    await expect(go(page)).toBeFocused();
    await expect(page.locator('[data-part="claw-sign"]')).toHaveText('INSERT TOKEN');
    await page.keyboard.press('Space');
    await expect(go(page)).toHaveAttribute('data-mode', 'drop');
    await expect(status(page)).toContainText('Token in');
    const x0 = await gx(page);
    const z0 = await gz(page);
    // Held keys drive the gantry (it accelerates, so give it a moment on a busy machine).
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowUp');
    await expect.poll(() => gx(page)).toBeGreaterThan(x0 + 10);
    await expect.poll(() => gz(page)).toBeGreaterThan(z0 + 5);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Space');
    await expect(status(page)).toHaveText(/Claw dropped/);
    await expect(status(page)).toHaveText(/You won|So close|Missed|Just a shove|wouldn't come up/, { timeout: 30_000 });
    await expect(closeup(page)).toHaveAttribute('data-phase', 'idle', { timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(closeup(page)).toHaveCount(0);
    await expect(machine(page)).toBeFocused();
    // The floor never moved.
    await expect(page).toHaveURL(/\/(\?clawSeed=7)?$/);
  });

  test('a win: the plush pops out of the prize door, lands on the shelf, leaves the pile, and is kept', async ({ page, isMobile }) => {
    await openFloor(page);
    await walkUp(page, isMobile);
    await expect(page.locator('[data-part="claw-shelf"]')).toHaveAttribute('aria-label', 'Prize shelf: 0 plushies won');
    await winOnce(page);
    await expect(page.locator('[data-part="claw-shelf"]')).toHaveAttribute('aria-label', 'Prize shelf: 1 plush won');
    const inv = await stored(page);
    expect(inv.v).toBe(2);
    expect(inv.won).toBe(1);
    expect(inv.pile).toHaveLength(21);
    await page.getByRole('button', { name: 'Leave the claw machine' }).click();
    await expect(closeup(page)).toHaveCount(0);
    if (!isMobile) {
      await expect(machine(page)).toHaveAccessibleName('Claw machine — step up and play (1 prize won)');
      await expect(page.locator('[data-part="claw-machine"] .clw-toy')).toHaveCount(21 + 1); // + the prize at its door
      await expect(page.locator('[data-part="claw-machine"] .clw-prize')).toBeVisible();
    } else await expect(page.locator('[data-part="claw-quick"]:visible')).toHaveAccessibleName('Claw machine (1 prize won)');
    // Kept across a reload.
    await page.reload();
    await walkUp(page, isMobile);
    await expect(page.locator('[data-part="claw-shelf"]')).toHaveAttribute('aria-label', 'Prize shelf: 1 plush won');
    expect((await stored(page)).pile).toHaveLength(21);
  });

  test('Halloween Night dresses the plushies up; underneath they are the same plushies', async ({ page, isMobile }) => {
    const theme = (id: string) => page.evaluate((t) => (window as any).__DASCADE_THEME__.setTheme(t), id);
    const shelfNames = () =>
      page.locator('[data-part="claw-shelf"] [role="img"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.split(':')[0]));
    await presetSettings(page, { theme: 'halloween-night' });
    await openFloor(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'halloween-night');
    await expect.poll(() => page.evaluate(() => (window as any).__DASCADE_THEME__?.skinLoaded('halloween-night') ?? false)).toBe(true);
    await walkUp(page, isMobile);
    expect(await shelfNames()).toEqual(['ghost', 'black cat', 'candy', 'pumpkin']);
    if (!isMobile) await expect(page.locator('.clwx__plate-big')).toHaveText('TREAT!');
    await expect(page.locator('[data-part="claw-sign"]')).toHaveText('INSERT TOKEN');
    await winOnce(page, /^You won a (ghost|black cat|candy|pumpkin) plush!/);
    await expect(page.locator('[data-part="claw-shelf"]')).toHaveAttribute('aria-label', 'Prize shelf: 1 plush won');
    // Back to the house theme with the machine still open: the same plushies, in their own clothes.
    await theme('delta-neon');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'delta-neon');
    await expect.poll(shelfNames).toEqual(['blob', 'bunny', 'star', 'cube bot']);
    await expect(page.locator('[data-part="claw-shelf"]')).toHaveAttribute('aria-label', 'Prize shelf: 1 plush won');
    const inv = await stored(page);
    expect(inv.won).toBe(1);
    expect(inv.pile).toHaveLength(21);
    // Dressed up again, across a reload: the win is kept.
    await theme('halloween-night');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'halloween-night');
    await walkUp(page, isMobile);
    await expect(page.locator('[data-part="claw-shelf"]')).toHaveAttribute('aria-label', 'Prize shelf: 1 plush won');
    expect(await shelfNames()).toEqual(['ghost', 'black cat', 'candy', 'pumpkin']);
    expect((await stored(page)).pile).toHaveLength(21);
  });

  test('closing mid-try settles it (the prize is never lost); closing while aiming hands the token back', async ({ page, isMobile }) => {
    await openFloor(page);
    await walkUp(page, isMobile);
    // Aiming, then leave: nothing happened.
    await go(page).click();
    await expect(go(page)).toHaveAttribute('data-mode', 'drop');
    await page.getByRole('button', { name: 'Leave the claw machine' }).click();
    await expect(closeup(page)).toHaveCount(0);
    expect(await stored(page)).toBeNull();
    // A sure win, dropped, then leave straight away: it plays out off-screen and the prize is kept.
    await walkUp(page, isMobile);
    await go(page).click();
    await expect(go(page)).toHaveAttribute('data-mode', 'drop');
    await rig(page);
    await settle(page);
    await go(page).click();
    await expect(closeup(page)).toHaveAttribute('data-phase', /drop|close/);
    await page.getByRole('button', { name: 'Leave the claw machine' }).click();
    await expect(closeup(page)).toHaveCount(0);
    const inv = await stored(page);
    expect(inv.won).toBe(1);
    expect(inv.pile).toHaveLength(21);
    // Reopen: a fresh try is ready.
    await walkUp(page, isMobile);
    await expect(go(page)).toHaveAttribute('data-mode', 'start');
    await expect(page.locator('[data-part="claw-shelf"]')).toHaveAttribute('aria-label', 'Prize shelf: 1 plush won');
  });

  test('the joystick moves the claw by pointer and springs back', async ({ page, isMobile }) => {
    await openFloor(page);
    await walkUp(page, isMobile);
    await go(page).click();
    const stick = page.locator('[data-part="claw-joystick"]');
    const b = (await stick.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(56);
    expect((await go(page).boundingBox())!.width).toBeGreaterThanOrEqual(56);
    const x0 = await gx(page);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width, b.y + b.height / 2, { steps: 4 });
    await expect.poll(() => gx(page)).toBeGreaterThan(x0 + 8);
    await page.mouse.up();
    const x1 = await gx(page);
    await page.waitForTimeout(500);
    // Sprung back: the claw coasts to a stop instead of running on to the wall.
    expect(await gx(page)).toBeLessThan(x1 + 6);
  });

  test('reduced motion: opens instantly, plays, no confetti', async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFloor(page);
    await walkUp(page, isMobile);
    await winOnce(page);
    await expect(page.locator('.clwx-confetti')).toHaveCount(0);
  });

  test('the glass renders at full resolution even with the opening zoom (motion on)', async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openFloor(page);
    await walkUp(page, isMobile);
    await page.waitForTimeout(700); // past the zoom
    const res = await page.locator('.clwx__view').evaluate((c: HTMLCanvasElement) => ({
      w: c.width,
      want: c.clientWidth * Math.min(2, window.devicePixelRatio || 1),
    }));
    expect(res.want).toBeGreaterThan(100);
    expect(Math.abs(res.w - res.want)).toBeLessThanOrEqual(2);
  });

  test('says on the machine why a try missed, and a held key never inserts and drops at once', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard path on desktop');
    await openFloor(page);
    await walkUp(page, isMobile);
    const led = page.locator('[data-part="claw-led"]');
    await expect(led).toHaveText('FREE PLAY · PRESS START');
    // Hold Enter on the focused big button: the token goes in, the repeats don't drop.
    await expect(go(page)).toBeFocused();
    await page.keyboard.down('Enter');
    for (let i = 0; i < 6; i++) await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(closeup(page)).toHaveAttribute('data-phase', 'aim');
    await page.waitForTimeout(500);
    await expect(closeup(page)).toHaveAttribute('data-phase', 'aim');
    await expect(led).toHaveText('RING = WHERE THE PRONGS LAND');
    // Drop straight over the chute (nothing there): the LED says why.
    await settle(page);
    await page.keyboard.press('Enter');
    await expect(closeup(page)).toHaveAttribute('data-phase', 'idle', { timeout: 30_000 });
    await expect(led).toHaveText(/MISSED — NOTHING TO GRAB|CAUGHT A NEIGHBOUR|ONE PRONG/);
    await expect(status(page)).toHaveText(/^Missed\./);
  });

  test('a second thumb can drop while the first holds the joystick; clicking the room leaves', async ({ page, isMobile }) => {
    await openFloor(page);
    await walkUp(page, isMobile);
    await go(page).click();
    await expect(go(page)).toHaveAttribute('data-mode', 'drop');
    await settle(page);
    // A non-primary touch never gets a click: the button acts on pointer-down.
    await go(page).dispatchEvent('pointerdown', { isPrimary: false, pointerType: 'touch', button: 0, pointerId: 7 });
    await expect(closeup(page)).not.toHaveAttribute('data-phase', 'aim');
    await expect(closeup(page)).toHaveAttribute('data-phase', 'idle', { timeout: 30_000 });
    // Outside the machine (the room around it) leaves.
    const vp = page.viewportSize()!;
    await page.mouse.click(4, vp.height - 4);
    await expect(closeup(page)).toHaveCount(0);
  });

  test('if the close-up cannot load, it says so in place and can try again (the floor stays)', async ({ page, isMobile }) => {
    await openFloor(page);
    let block = true;
    await page.route('**/*ClawCloseup*', (route) => (block ? route.abort() : route.continue()));
    if (isMobile) await page.locator('[data-part="claw-quick"]:visible').first().click();
    else await machine(page).click();
    const oops = page.locator('[data-part="claw-unavailable"]');
    await expect(oops).toBeVisible();
    await expect(page.locator('.af-cab')).toHaveCount(CABINETS);
    block = false;
    await oops.getByRole('button', { name: 'Try again' }).click();
    await expect(closeup(page)).toBeVisible();
    await expect(page).toHaveURL(/clawSeed=7/);
  });

  test('mid-width floors: a speck of a machine is replaced by the quick button', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop widths');
    await page.setViewportSize({ width: 900, height: 700 });
    await openFloor(page);
    await expect(page.locator('[data-part="claw-machine"]:visible')).toHaveCount(0);
    const quick = page.locator('[data-part="claw-quick"]:visible');
    await expect(quick).toHaveCount(1);
    await quick.click();
    await expect(closeup(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(closeup(page)).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(machine(page)).toBeVisible();
    const box = (await machine(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(120);
    await expect(page.locator('[data-part="claw-quick"]:visible')).toHaveCount(0);
  });

  test('phones: no floor machine, a quick Claw button opens the close-up and it fits the screen', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone viewports only');
    await openFloor(page);
    await expect(page.locator('[data-part="claw-machine"]')).toHaveCount(0);
    const quick = page.locator('[data-part="claw-quick"]:visible');
    await expect(quick).toHaveCount(1);
    await quick.click();
    await expect(closeup(page)).toBeVisible();
    const vp = page.viewportSize()!;
    for (const sel of ['.clwx__marquee', '.clwx__case', '[data-part="claw-joystick"]', '[data-part="claw-go"]']) {
      const r = (await page.locator(sel).boundingBox())!;
      expect(r.x, sel).toBeGreaterThanOrEqual(0);
      expect(r.y, sel).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width, sel).toBeLessThanOrEqual(vp.width + 0.5);
      expect(r.y + r.height, sel).toBeLessThanOrEqual(vp.height + 0.5);
    }
    // Tap to play: the big button starts it.
    await go(page).tap();
    await expect(go(page)).toHaveAttribute('data-mode', 'drop');
    await page.getByRole('button', { name: 'Leave the claw machine' }).tap();
    await expect(closeup(page)).toHaveCount(0);
    await expect(quick).toBeFocused();
  });
});
