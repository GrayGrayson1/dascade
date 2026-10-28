/**
 * DAS Survey Showdown — the Presenter Showcase console (DAS-O-Ween decisions PRS-01 A, PRS-02 D,
 * PRS-03 D, PRS-05 C), on the rehearsal preset:
 *
 *   - Command Center: at 1280×720 and 1440×900 the sheet, WRONG, the clock, Reveal remaining, Undo,
 *     Next, the picker and the stage preview are all on screen without scrolling (with the PRIVATE band).
 *   - Share-safe: the console tab is "🔒 PRESENTER — don't share", with a lock favicon and a PRIVATE band.
 *   - The special #5 arms and needs Take special (Space); every other answer flips on the first click.
 *   - End show can't happen from one click or key: two steps, then a 1.2 s hold.
 *   - Next with answers hidden acts at once and offers an Undo for at least 10 seconds.
 *   - Reveal remaining while the clock runs is a press-and-hold (button or R).
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers.ts';

const board = async (page: Page) => {
  const s = await roomState(page);
  return s?.boardJson ? JSON.parse(s.boardJson) : null;
};
const revealed = async (page: Page, slot: number): Promise<boolean> => Boolean((await board(page))?.slots?.[slot]?.revealed);

/** A showcase room on the rehearsal boards, round 1's question up (the clock running). */
async function liveConsole(page: Page): Promise<string> {
  const code = await createRoom(page, 'showdown', 'Host');
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await page.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
  await expect.poll(async () => (await roomState(page)).rehearsal).toBe(true);
  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await page
    .getByRole('button', { name: /^Start round 1/ })
    .first()
    .click();
  await expect.poll(async () => (await board(page))?.stage).toBe('title');
  await page
    .getByRole('button', { name: /^Show the question/ })
    .first()
    .click();
  await expect.poll(async () => (await board(page))?.stage).toBe('live');
  await expect.poll(async () => (await roomState(page)).clockEndsAt).toBeGreaterThan(0);
  return code;
}

/** Aims keys at the page (not at whichever button was clicked last). */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Every part fully inside the window, and the page not scrolled. */
async function expectAllOnScreen(page: Page, parts: Record<string, string>): Promise<void> {
  const report = await page.evaluate((sel) => {
    const out: Record<string, string> = {};
    for (const [name, css] of Object.entries(sel)) {
      const el = document.querySelector(css);
      if (!el) {
        out[name] = 'missing';
        continue;
      }
      const r = el.getBoundingClientRect();
      const inside = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5 && r.height > 0;
      out[name] = inside ? 'ok' : `out of view (${Math.round(r.top)}–${Math.round(r.bottom)} / ${innerHeight})`;
    }
    out.scrollY = String(scrollY);
    return out;
  }, parts);
  const expected = Object.fromEntries([...Object.keys(parts).map((k) => [k, 'ok']), ['scrollY', '0']]);
  expect(report).toEqual(expected);
}

/** How many rows the elements matching `selector` sit on. */
async function rows(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluateAll((els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size);
}

const LIVE_PARTS = {
  'PRIVATE band': '[data-part="showdown-private-band"]',
  'answer sheet (#1)': '[data-part="showdown-answer"][data-slot="0"]',
  'answer sheet (#5)': '[data-part="showdown-answer"][data-slot="4"]',
  'answer sheet (#10)': '[data-part="showdown-answer"][data-slot="9"]',
  WRONG: '[data-part="showdown-wrong"]',
  clock: '[data-part="showdown-clock"]',
  'Reveal remaining': '[data-part="showdown-sweep"]',
  Undo: '[data-part="showdown-undo"]',
  Next: '[data-part="showdown-next"]',
  picker: '[data-part="showdown-picker-strip"]',
  'stage preview': '[data-part="showdown-preview"]',
  'End show': '[data-part="showdown-end-show"]',
};

test.describe('Presenter Showcase console', () => {
  test.skip(({ isMobile }) => isMobile, 'The presenter runs the show from a laptop.');

  test('Command Center: every live control fits 1280×720 and 1440×900, and the console is marked private', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const code = await liveConsole(page);

    // PRS-05 C: the tab's title and icon, and the band.
    await expect(page).toHaveTitle("🔒 PRESENTER — don't share");
    const icon = await page.evaluate(() => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href') ?? '');
    expect(icon.startsWith('data:image/svg+xml')).toBe(true);
    await expect(page.locator('[data-part="showdown-private-band"]')).toContainText('PRIVATE');
    await expect(page.locator('[data-part="showdown-private-band"]')).toContainText('STAGE');

    for (const size of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      await expectAllOnScreen(page, LIVE_PARTS);
      // The scene strip, the drawer's tabs and the keys legend each keep to one row.
      for (const sel of ['[data-part="showdown-scenes"] > button', '.sdc-drawer__tab', 'footer.sdc-keys > span']) {
        expect(await rows(page, sel), `${sel} at ${size.width}×${size.height}`).toBe(1);
      }
    }

    // Someone in the hot seat: the picker's Mark done / No answer are on screen too.
    const guest = await joinRoom(browser, code, 'Priya S.');
    await expect.poll(async () => (await roomState(page)).poolSize, { timeout: 10_000 }).toBe(1);
    await blur(page);
    await page.keyboard.press('k');
    await expect.poll(async () => (await roomState(page)).hotSeat).not.toBe('');
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      await expectAllOnScreen(page, {
        ...LIVE_PARTS,
        'Mark done': '[data-part="showdown-pick-done"]',
        'No answer': '[data-part="showdown-pick-noanswer"]',
      });
    }

    // The drawer is a real tablist: arrows move between tabs and pick them.
    const picker = page.getByRole('tab', { name: /^Picker/ });
    await picker.click();
    await expect(picker).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    const sound = page.getByRole('tab', { name: /^Sound/ });
    await expect(sound).toHaveAttribute('aria-selected', 'true');
    await expect(sound).toBeFocused();
    await expect(page.getByRole('tabpanel')).toContainText('Sound cues');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');

    // Leaving the console gives the tab its own title back.
    await leaveRoom(guest);
    await leaveRoom(page);
    await expect(page).not.toHaveTitle(/PRESENTER/);
  });

  test('the special #5 needs Take special; every other answer flips on the first click', async ({ page }) => {
    test.setTimeout(90_000);
    await liveConsole(page);

    // #2: one click, at once.
    await page.getByRole('button', { name: /^Reveal answer 2:/ }).click();
    await expect.poll(() => revealed(page, 1), { timeout: 3_000 }).toBe(true);

    // #5: a click arms it — nothing reaches the stage.
    const special = page.getByRole('button', { name: /^Reveal answer 5: .*\(special answer\)/ });
    await special.click();
    await expect(page.locator('[data-part="showdown-next-step"]')).toContainText('Special armed');
    await expect(page.locator('[data-part="showdown-take-special"]')).toBeVisible();
    await expect(page.locator('[data-part="showdown-console-announce"]')).toContainText('armed');
    await page.waitForTimeout(1_200);
    expect(await revealed(page, 4)).toBe(false);
    // Its key, and a double click, still only arm it.
    await blur(page);
    await page.keyboard.press('5');
    await page.locator('[data-part="showdown-answer"][data-slot="4"]').dblclick();
    await page.waitForTimeout(1_000);
    expect(await revealed(page, 4)).toBe(false);

    // Space on Disarm presses Disarm — it never takes the special.
    const take = page.locator('[data-part="showdown-take-special"]');
    await page.locator('[data-part="showdown-disarm-special"]').focus();
    await page.keyboard.press('Space');
    await expect(take).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(await revealed(page, 4)).toBe(false);
    // Armed again: Space on Pause pauses the clock, Space on a drawer tab picks the tab — no reveal.
    await blur(page);
    await page.keyboard.press('5');
    await expect(take).toBeVisible();
    await page.locator('[data-part="showdown-clock"]').getByRole('button', { name: 'Pause clock' }).focus();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await roomState(page)).clockEndsAt).toBe(0);
    await page.getByRole('tab', { name: /^Sound/ }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('tab', { name: /^Sound/ })).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(800);
    expect(await revealed(page, 4)).toBe(false);
    await expect(take).toBeVisible();

    // Esc disarms.
    await blur(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-part="showdown-take-special"]')).toHaveCount(0);
    expect(await revealed(page, 4)).toBe(false);

    // The key 5 arms it again; Space takes it — even with another answer's button focused, which
    // Space must not press.
    await blur(page);
    await page.keyboard.press('5');
    await expect(page.locator('[data-part="showdown-take-special"]')).toBeVisible();
    await page.getByRole('button', { name: /^Reveal answer 3:/ }).focus();
    await page.keyboard.press('Space');
    await expect.poll(() => revealed(page, 4), { timeout: 3_000 }).toBe(true);
    await page.waitForTimeout(500);
    expect(await revealed(page, 2)).toBe(false);
    await expect(page.locator('[data-part="showdown-take-special"]')).toHaveCount(0);

    // Every other slot, by key, at once.
    await blur(page);
    await page.keyboard.press('7');
    await expect.poll(() => revealed(page, 6), { timeout: 3_000 }).toBe(true);
    await page.getByRole('button', { name: /^Reveal answer 10:/ }).click();
    await expect.poll(() => revealed(page, 9), { timeout: 3_000 }).toBe(true);
    await leaveRoom(page);
  });

  test('End show takes two steps and a hold: no single click or key ends it', async ({ page }) => {
    test.setTimeout(90_000);
    await liveConsole(page);
    const endShow = page.locator('[data-part="showdown-end-show"]');
    const panel = page.locator('[data-part="showdown-end-panel"]');
    const confirm = panel.locator('[data-part="showdown-end-confirm"]');

    await endShow.click();
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    // It names what's still hidden (no modal: the console stays usable).
    await expect(panel).toContainText('10 answers are still hidden');
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // A click on the confirm button, and a quick Enter on it, do nothing.
    await confirm.click();
    await page.waitForTimeout(1_800);
    expect((await roomState(page)).phase).toBe('PLAYING');
    await confirm.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.waitForTimeout(1_800);
    expect((await roomState(page)).phase).toBe('PLAYING');
    // A press that lets go after 0.6 s does nothing either.
    await page.keyboard.down('Enter');
    await page.waitForTimeout(600);
    await page.keyboard.up('Enter');
    await page.waitForTimeout(1_200);
    expect((await roomState(page)).phase).toBe('PLAYING');

    // A screen reader's click (detail 0) asks to press again; one alone ends nothing.
    await confirm.dispatchEvent('click');
    await expect(confirm).toContainText('Press again to confirm');
    await page.waitForTimeout(1_500);
    expect((await roomState(page)).phase).toBe('PLAYING');

    // Esc closes the panel, focus goes back to End show.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(endShow).toBeFocused();
    expect((await roomState(page)).phase).toBe('PLAYING');

    // The keyboard path: open it, Tab to the hold button, hold Enter 1.2 s.
    await page.keyboard.press('Enter');
    await expect(panel).toBeFocused();
    for (let i = 0; i < 5; i++) {
      if (await confirm.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(confirm).toBeFocused();
    await page.keyboard.down('Enter');
    await page.waitForTimeout(1_500);
    await page.keyboard.up('Enter');
    await waitForPhase(page, 'RESULTS');
    await leaveRoom(page);
  });

  test('Next with answers hidden acts at once, and its Undo stays up for at least 10 seconds', async ({ page }) => {
    test.setTimeout(90_000);
    // Count the console's capture-phase keyup listener (it must mount once, whatever the undo offer does).
    await page.addInitScript(() => {
      const w = window as unknown as { __keyupCapture: number };
      w.__keyupCapture = 0;
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (
        type: string,
        fn: EventListenerOrEventListenerObject | null,
        opts?: boolean | AddEventListenerOptions,
      ) {
        if (this === window && type === 'keyup' && (opts === true || (typeof opts === 'object' && opts?.capture))) w.__keyupCapture++;
        return add.call(this, type, fn, opts);
      };
    });
    const keyupListeners = () => page.evaluate(() => (window as unknown as { __keyupCapture: number }).__keyupCapture);
    await liveConsole(page);
    const listenersBefore = await keyupListeners();
    expect(listenersBefore).toBeGreaterThan(0);
    await page.getByRole('button', { name: /^Reveal answer 1:/ }).click();
    await expect.poll(() => revealed(page, 0)).toBe(true);

    await page.locator('[data-part="showdown-next"]').click();
    // No dialog: round 2's title card at once.
    await expect.poll(async () => (await board(page))?.round).toBe(1);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    const toast = page.locator('[data-part="showdown-undo-toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Moved on to round 2');
    // Pointer away from the toast (pointing at it would pause its countdown).
    await page.mouse.move(5, 5);
    await page.waitForTimeout(10_200);
    await expect(toast).toBeVisible();

    await toast.getByRole('button', { name: /^Undo:/ }).click();
    await expect.poll(async () => (await board(page))?.round).toBe(0);
    expect(await revealed(page, 0)).toBe(true);
    await expect(toast).toHaveCount(0);
    // The offer came and went; the key listeners never re-subscribed (an R hold can't lose its keyup).
    expect(await keyupListeners()).toBe(listenersBefore);

    // Restart round is a press-and-hold in the drawer's Fix tab, then the same toast.
    await page.getByRole('tab', { name: /^Fix/ }).click();
    const restart = page.locator('[data-part="showdown-restart-round"]');
    await restart.click();
    await page.waitForTimeout(1_200);
    expect((await board(page))?.stage).toBe('live');
    const box = (await restart.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1_100);
    await page.mouse.up();
    await expect.poll(async () => (await board(page))?.stage).toBe('title');
    await expect(toast).toContainText('Round 1 restarted');

    // Screen readers: two activations (clicks with detail 0) within 4 s restart the show; one alone doesn't.
    const restartShow = page.locator('[data-part="showdown-restart-show"]');
    await restartShow.dispatchEvent('click');
    await expect(restartShow).toContainText('Press again to confirm');
    await page.waitForTimeout(1_200);
    expect((await board(page))?.stage).toBe('title');
    await restartShow.dispatchEvent('click');
    await expect.poll(async () => (await board(page))?.stage).toBe('intro');
    await leaveRoom(page);
  });

  test('a dialog — native or ARIA (the jukebox player) — rests the console’s keys', async ({ page }) => {
    test.setTimeout(60_000);
    await liveConsole(page);
    // A visible aria-modal dialog (as the jukebox player is).
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'fake-player';
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-modal', 'true');
      d.textContent = 'Jukebox';
      d.style.cssText = 'position:fixed;left:8px;top:8px;width:200px;height:80px;background:#000;z-index:9999';
      document.body.appendChild(d);
    });
    await blur(page);
    for (const key of ['2', 'n', 'x']) await page.keyboard.press(key);
    await page.waitForTimeout(800);
    expect(await revealed(page, 1)).toBe(false);
    expect((await board(page))?.round).toBe(0);
    await expect(page.getByText(/wrong this round/)).toHaveCount(0);
    // A non-modal ARIA dialog: keys typed inside it rest too.
    await page.evaluate(() => {
      const d = document.getElementById('fake-player')!;
      d.removeAttribute('aria-modal');
      const b = document.createElement('button');
      b.id = 'in-player';
      b.textContent = 'Play';
      d.appendChild(b);
    });
    await page.locator('#in-player').focus();
    await page.keyboard.press('2');
    await page.waitForTimeout(800);
    expect(await revealed(page, 1)).toBe(false);
    // Closed: the keys work again.
    await page.evaluate(() => document.getElementById('fake-player')?.remove());
    await blur(page);
    await page.keyboard.press('2');
    await expect.poll(() => revealed(page, 1), { timeout: 3_000 }).toBe(true);
    await leaveRoom(page);
  });

  test('End show’s “Reveal remaining first” is a hold too while the clock runs', async ({ page }) => {
    test.setTimeout(60_000);
    await liveConsole(page);
    const started = async () =>
      Boolean((await roomState(page)).sweep) || (await board(page))?.slots?.some((s: { late: boolean }) => s.late);
    await page.locator('[data-part="showdown-end-show"]').click();
    const first = page.locator('[data-part="showdown-end-reveal-first"]');
    await first.click();
    await page.waitForTimeout(1_300);
    expect(await started()).toBe(false);
    await expect(page.locator('[data-part="showdown-end-panel"]')).toBeVisible();
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1_100);
    await page.mouse.up();
    await expect.poll(started, { timeout: 5_000 }).toBe(true);
    await expect(page.locator('[data-part="showdown-end-panel"]')).toHaveCount(0);
    expect((await roomState(page)).phase).toBe('PLAYING');
    await leaveRoom(page);
  });

  test('Reveal remaining while the clock runs is a press-and-hold (the button or R)', async ({ page }) => {
    test.setTimeout(90_000);
    await liveConsole(page);
    const sweep = page.locator('[data-part="showdown-sweep"]');
    const started = async () =>
      Boolean((await roomState(page)).sweep) || (await board(page))?.slots?.some((s: { late: boolean }) => s.late);

    await sweep.click();
    await page.waitForTimeout(1_500);
    expect(await started()).toBe(false);
    await blur(page);
    await page.keyboard.press('r');
    await page.waitForTimeout(1_500);
    expect(await started()).toBe(false);

    await page.keyboard.down('r');
    await page.waitForTimeout(1_100);
    await page.keyboard.up('r');
    await expect.poll(started, { timeout: 5_000 }).toBe(true);
    await leaveRoom(page);
  });
});
