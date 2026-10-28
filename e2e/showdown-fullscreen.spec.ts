/**
 * DAS Survey Showdown — full screen for the stage window (the browser bar off the Teams share). A
 * popup's address bar can't be hidden; full screen hides it. In the stage window: F toggles full
 * screen (the key press there is the gesture the browser asks for), the Full screen button sits in a
 * chrome layer above every scene — the Cinema layer included — and a hint says how when the window
 * opens. Both hide themselves (they come back when the mouse moves), so they stay out of the show;
 * with reduced motion they appear and go without a fade. Leaving full screen leaves the window
 * working; the big-screen page keeps its own corner button. Rehearsal boards only.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createRoom, presetSettings, roomState, setName, startGame, waitForPhase } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'The presenter runs the show (and its stage window) from a laptop.');

const SHOTS = process.env.SHOTS_DIR ?? '';
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const send = (page: Page, type: string, payload: Record<string, unknown>) =>
  page.evaluate(([t, p]) => (window as any).__DASCADE__.session.send(t, p), [type, payload] as const);

const board = async (page: Page) => {
  const s = await roomState(page);
  return s?.boardJson ? JSON.parse(s.boardJson) : null;
};

async function loadRehearsal(host: Page): Promise<void> {
  const settingsTab = host.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await host.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).mode).toBe('showcase');
}

async function openStageWindow(host: Page): Promise<Page> {
  const [stageWin] = await Promise.all([host.waitForEvent('popup'), host.locator('[data-part="showdown-stage-window"]').first().click()]);
  await stageWin.setViewportSize({ width: 1280, height: 720 });
  await expect(stageWin.locator('.sd-stage').first()).toBeVisible();
  return stageWin;
}

/** A short test video (moving colour), recorded in a blank page of this browser. */
async function makeClip(ctx: BrowserContext): Promise<Buffer> {
  const gen = await ctx.newPage();
  const b64 = await gen.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const g = canvas.getContext('2d')!;
    const rec = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    let n = 0;
    const draw = setInterval(() => {
      g.fillStyle = `hsl(${(n++ * 25) % 360} 70% 45%)`;
      g.fillRect(0, 0, 320, 240);
    }, 66);
    rec.start(250);
    await new Promise((r) => setTimeout(r, 2000));
    const done = new Promise((r) => (rec.onstop = r));
    rec.stop();
    await done;
    clearInterval(draw);
    const bytes = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  await gen.close();
  return Buffer.from(b64, 'base64');
}

const isFull = (p: Page) => p.evaluate(() => document.fullscreenElement !== null);
const opacity = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).opacity));
/** A mouse move over the stage window (what wakes the chrome). */
async function nudge(p: Page): Promise<void> {
  await p.mouse.move(500, 400);
  await p.mouse.move(520, 420, { steps: 3 });
}
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test('the stage window: F toggles full screen; the hint and button hide themselves; the button works over Cinema', async ({ page }) => {
  test.setTimeout(150_000);
  const host = page;
  await host.setViewportSize({ width: 1280, height: 720 });
  await createRoom(host, 'showdown', 'Host');
  await loadRehearsal(host);
  const stageWin = await openStageWindow(host);
  const hint = stageWin.locator('[data-part="showdown-fullscreen-hint"]');
  const button = stageWin.locator('[data-part="showdown-fullscreen"]');

  // The window opens with the hint up and the button showing; the stage itself has no corner button now.
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('press F for full screen');
  await expect(hint).toContainText('browser bar');
  await expect.poll(() => opacity(button)).toBe(1);
  await expect(button).toHaveAccessibleName(/^Full screen/);
  await expect(stageWin.locator('.sd-stage__corner')).toHaveCount(0);
  await stageWin.waitForTimeout(400); // the fade-in
  await shot(stageWin, 'fullscreen-hint');

  // Then both go (out of the show), and come back when the mouse moves.
  await expect(hint).toBeHidden({ timeout: 12_000 });
  await expect.poll(() => opacity(button)).toBe(0);
  expect(await isFull(stageWin)).toBe(false);
  await nudge(stageWin);
  await expect(hint).toBeVisible();
  await expect.poll(() => opacity(button)).toBe(1);
  // Hovering the corner shows the button too, whatever the timer says.
  await expect(hint).toBeHidden({ timeout: 6000 });
  await button.hover();
  await expect.poll(() => opacity(button)).toBe(1);

  // F: full screen, with nothing left on the picture.
  await stageWin.mouse.move(640, 360);
  const consoleButton = host.locator('[data-part="showdown-stage-window"]').first();
  await expect(consoleButton).toHaveAttribute('data-fullscreen', 'false');
  await stageWin.keyboard.press('f');
  await expect.poll(() => isFull(stageWin)).toBe(true);
  // The console's Stage window button says so too.
  await expect(consoleButton).toHaveAttribute('data-fullscreen', 'true');
  await expect(hint).toHaveCount(0);
  await expect.poll(() => opacity(button)).toBe(0);
  await shot(stageWin, 'fullscreen-on');
  // A mouse move brings the button back to leave it; F again leaves.
  await nudge(stageWin);
  await expect.poll(() => opacity(button)).toBe(1);
  await expect(button).toHaveAccessibleName(/^Exit full screen/);
  await stageWin.keyboard.press('F');
  await expect.poll(() => isFull(stageWin)).toBe(false);

  // Esc (the browser leaves full screen) leaves the window working: F and the button still toggle it.
  await stageWin.keyboard.press('f');
  await expect.poll(() => isFull(stageWin)).toBe(true);
  await stageWin.evaluate(() => document.exitFullscreen());
  await expect.poll(() => isFull(stageWin)).toBe(false);
  await expect(stageWin.locator('.sd-stage').first()).toBeVisible();
  await nudge(stageWin);
  await expect(hint).toBeVisible(); // out of full screen again: the hint is back on a mouse move
  await expect(button).toHaveAccessibleName(/^Full screen/);
  await button.click();
  await expect.poll(() => isFull(stageWin)).toBe(true);
  await stageWin.keyboard.press('f');
  await expect.poll(() => isFull(stageWin)).toBe(false);
  // Ctrl+F (find) never toggles it.
  await stageWin.keyboard.press('Control+f');
  await stageWin.waitForTimeout(300);
  expect(await isFull(stageWin)).toBe(false);

  // The show: the board, then Cinema with a video playing over the whole stage.
  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(async () => (await board(host))?.stage).toBe('intro');
  await send(host, 'showdown:act', { a: 'begin', rev: (await board(host)).rev });
  await expect.poll(async () => (await board(host))?.stage).toBe('title');
  await send(host, 'showdown:act', { a: 'question', rev: (await board(host)).rev });
  await expect.poll(async () => (await board(host))?.stage).toBe('live');
  await expect(stageWin.locator('.sd-sc__frame')).toBeVisible();
  await stageWin.waitForTimeout(1400); // the scene curtain opens first
  await nudge(stageWin);
  await expect.poll(() => opacity(button)).toBe(1);
  await stageWin.waitForTimeout(400); // the fade-in
  await shot(stageWin, 'fullscreen-board-hint');
  // Full screen on the board: a mouse move shows only the button (to leave), never the hint.
  await stageWin.keyboard.press('f');
  await expect.poll(() => isFull(stageWin)).toBe(true);
  await nudge(stageWin);
  await expect.poll(() => opacity(button)).toBe(1);
  await expect(hint).toHaveCount(0);
  await stageWin.waitForTimeout(400);
  await shot(stageWin, 'fullscreen-board-exit');
  await stageWin.keyboard.press('f');
  await expect.poll(() => isFull(stageWin)).toBe(false);

  await blur(host);
  await host.keyboard.press('v'); // nothing loaded: opens the Cinema tab
  await expect(host.locator('[data-part="showdown-cinema-panel"]')).toBeVisible();
  const clip = await makeClip(host.context());
  await host
    .locator('[data-part="showdown-cinema-file"]')
    .setInputFiles({ name: 'cartoon-break.webm', mimeType: 'video/webm', buffer: clip });
  await expect(host.locator('[data-part="showdown-cinema-status"]')).toContainText('cartoon-break.webm');
  await blur(host);
  await host.keyboard.press('v');
  await expect.poll(async () => (await roomState(host)).card).toBe('cinema');
  const cinema = stageWin.locator('[data-part="showdown-cinema"]');
  await expect(cinema).toBeVisible();
  await host.locator('[data-part="showdown-cinema-play"]').click();
  await expect(cinema).toHaveAttribute('data-playing', 'true', { timeout: 10_000 });

  // Over the Cinema layer: the button is the top element where it sits, and it works.
  await stageWin.waitForTimeout(1500); // the curtain opens
  await nudge(stageWin);
  await expect.poll(() => opacity(button)).toBe(1);
  const box = (await button.boundingBox())!;
  const onTop = await stageWin.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x!, y!)?.closest('[data-part="showdown-fullscreen"]')),
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(onTop).toBe(true);
  await stageWin.waitForTimeout(300);
  await shot(stageWin, 'fullscreen-over-cinema');
  await button.click();
  await expect.poll(() => isFull(stageWin)).toBe(true);
  await expect(cinema).toBeVisible();
  await stageWin.keyboard.press('f');
  await expect.poll(() => isFull(stageWin)).toBe(false);

  // Back to the show: the board, and the window still answers F.
  await blur(host);
  await host.keyboard.press('b');
  await expect.poll(async () => (await roomState(host)).card).toBe('');
  await expect(cinema).toBeHidden();
  await stageWin.keyboard.press('f');
  await expect.poll(() => isFull(stageWin)).toBe(true);
  await stageWin.keyboard.press('f');
  await expect.poll(() => isFull(stageWin)).toBe(false);
});

test('reduced motion: the hint appears and goes without a fade; the big screen keeps its own corner button', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const host = page;
  await presetSettings(host, { reducedMotion: true });
  await host.setViewportSize({ width: 1280, height: 720 });
  const code = await createRoom(host, 'showdown', 'Host');
  await loadRehearsal(host);
  const stageWin = await openStageWindow(host);
  await expect(stageWin.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  const hint = stageWin.locator('[data-part="showdown-fullscreen-hint"]');
  await expect(hint).toBeVisible();
  // No fade (DASCADE's reduced-motion rule leaves transitions at 1 ms at most).
  const durations = await hint.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(durations.split(',').every((d) => parseFloat(d) <= 0.001)).toBe(true);
  await shot(stageWin, 'fullscreen-hint-reduced');
  await expect(hint).toBeHidden({ timeout: 12_000 });

  // A big screen (TV) has no stage-window chrome: its Full screen button stays in the stage's corner.
  const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await tv.goto(`/room/${code}?screen=1`);
  await setName(tv, 'Lobby TV');
  await tv.getByRole('button', { name: 'Join game' }).click();
  await expect(tv.locator('[data-part="showdown-screen"] .sd-stage__corner')).toHaveCount(1);
  await expect(tv.locator('[data-part="showdown-screen"] .sd-stage__corner').getByRole('button', { name: 'Full screen' })).toHaveCount(1);
  await expect(tv.locator('[data-part="showdown-stage-chrome"]')).toHaveCount(0);
  await tv.context().close();
});
