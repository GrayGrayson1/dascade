/**
 * DAS Survey Showdown — the join QR (Production Desk, QR A). The link in capitals (/R/CODE) opens
 * the join screen; the stage window and big screens show the ticket on Welcome and the lobby, and
 * the QR there encodes exactly that link (checked module by module against the same encoder);
 * phones never show it; J puts the Join pop-up over the board on the stage window and big screens;
 * Copy QR image puts a PNG on the clipboard. Rehearsal boards only.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generate, correction } from 'lean-qr';
import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, roomState, setName, startGame, waitForPhase } from './helpers.ts';

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

/** The QR's modules as drawn on a canvas (one pixel per module, quiet zone included): true = dark. */
async function canvasModules(page: Page, selector: string): Promise<boolean[][]> {
  return page
    .locator(selector)
    .first()
    .evaluate((c: HTMLCanvasElement) => {
      const g = c.getContext('2d')!;
      const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
      const rows: boolean[][] = [];
      for (let y = 0; y < height; y++) {
        const row: boolean[] = [];
        for (let x = 0; x < width; x++) row.push(data[(y * width + x) * 4]! < 128);
        rows.push(row);
      }
      return rows;
    });
}

/** The modules the same encoder makes for `text`, with the 4-module quiet zone. */
function expectedModules(text: string): boolean[][] {
  const code = generate(text, { minCorrectionLevel: correction.M, maxCorrectionLevel: correction.M });
  const n = code.size + 8;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => code.get(x - 4, y - 4)));
}

test('the join link in capitals (/R/CODE) opens the join screen', async ({ page, browser }) => {
  const code = await createRoom(page, 'showdown', 'Host');
  await loadRehearsal(page);
  // The lookup the join link uses (room metadata, flushed about once a second).
  await expect
    .poll(() => page.evaluate((c) => (window as any).__DASCADE__.session.lookup(c).then((r: { event?: string }) => r.event ?? ''), code), {
      timeout: 15_000,
    })
    .toBe('dasoween-rehearsal');
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(`/R/${code}`);
  await expect(guest.locator('[data-part="event-join"]')).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Join the show' })).toBeVisible();
  await ctx.close();
});

test.describe('the join QR on the stage', () => {
  test.skip(({ isMobile }) => isMobile, 'The presenter runs the show (and its stage window) from a laptop; the phone is checked here too.');

  test('the ticket on Welcome and the lobby encodes the link in capitals; J pops it over the board; never on phones; Copy QR image', async ({
    page,
    browser,
  }) => {
    test.setTimeout(150_000);
    const host = page;
    await host.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await host.setViewportSize({ width: 1280, height: 800 });
    const code = await createRoom(host, 'showdown', 'Host');
    await loadRehearsal(host);
    const origin = new URL(host.url()).origin;
    const text = `${origin}/r/${code}`.toUpperCase();

    const [stageWin] = await Promise.all([host.waitForEvent('popup'), host.locator('[data-part="showdown-stage-window"]').first().click()]);
    await stageWin.setViewportSize({ width: 1280, height: 720 });
    const ticket = stageWin.locator('[data-part="showdown-join-ticket"]');
    await expect(ticket).toBeVisible();
    await expect(ticket.locator('canvas.sd-qr')).toHaveAttribute('data-ready', 'true');
    await expect(ticket.locator('canvas.sd-qr')).toHaveAttribute('data-qr', text);
    expect(await canvasModules(stageWin, '[data-part="showdown-join-ticket"] canvas.sd-qr')).toEqual(expectedModules(text));
    // Version 2 (25×25) + the quiet zone: the capitals keep the code small.
    expect(await ticket.locator('canvas.sd-qr').evaluate((c: HTMLCanvasElement) => c.width)).toBe(33);
    // About 40 % of the stage's height.
    const qrBox = await ticket.locator('canvas.sd-qr').boundingBox();
    expect(qrBox!.height / 720).toBeGreaterThan(0.36);
    await expect(ticket).toContainText(code);
    await shot(stageWin, 'qr-lobby');

    // The Welcome card carries it too; a phone never draws one.
    await send(host, 'showdown:card', { card: 'welcome' });
    await expect(stageWin.locator('[data-card="welcome"] [data-part="showdown-join-ticket"]')).toBeVisible();
    await stageWin.waitForTimeout(1400); // the scene curtain opens first
    await shot(stageWin, 'qr-welcome');
    const tv = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await tv.goto(`/room/${code}?screen=1`);
    await setName(tv, 'Lobby TV');
    await tv.getByRole('button', { name: 'Join game' }).click();
    await expect(tv.locator('[data-part="showdown-screen"] [data-part="showdown-join-ticket"]')).toBeVisible();
    const phone = await joinRoom(browser, code, 'Ada', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    // Copy QR image: a PNG on the clipboard (the console's Cards tab has it too).
    await host.locator('[data-part="showdown-copy-qr"]').first().click();
    await expect(host.locator('[data-part="showdown-join-qr"]').first()).toContainText('QR image copied');
    const types = await host.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => [...i.types]));
    expect(types).toContain('image/png');

    // The show: no ticket during a round (the status line's text only), until J.
    await startGame(host);
    await waitForPhase(host, 'PLAYING');
    await expect.poll(async () => (await board(host))?.stage).toBe('intro');
    await send(host, 'showdown:act', { a: 'begin', rev: (await board(host)).rev });
    await expect.poll(async () => (await board(host))?.stage).toBe('title');
    await send(host, 'showdown:act', { a: 'question', rev: (await board(host)).rev });
    await expect.poll(async () => (await board(host))?.stage).toBe('live');
    await expect(stageWin.locator('[data-part="showdown-join-ticket"]')).toHaveCount(0);
    await host.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await host.keyboard.press('j');
    const pop = (p: Page) => p.locator('[data-part="showdown-join-pop"] [data-part="showdown-join-ticket"]');
    await expect(pop(stageWin)).toBeVisible();
    await expect(pop(tv)).toBeVisible();
    await expect(stageWin.locator('.sd-board, [data-part="showdown-board"]').first()).toBeVisible();
    await stageWin.waitForTimeout(800);
    await shot(stageWin, 'qr-join-popup');
    expect(await phone.locator('canvas.sd-qr, [data-part="showdown-join-ticket"]').count()).toBe(0);
    // Phones never even fetch the encoder (its own chunk); the stage window did.
    const fetched = (p: Page) => p.evaluate(() => performance.getEntriesByType('resource').some((e) => /lean-qr/.test(e.name)));
    expect(await fetched(phone)).toBe(false);
    expect(await fetched(host)).toBe(true);
    // J again takes it down (it would slide away by itself after 20 s).
    await host.keyboard.press('j');
    await expect(pop(stageWin)).toHaveCount(0);
    await expect(pop(tv)).toHaveCount(0);

    // Between rounds: the medium ticket beside Be right back.
    await send(host, 'showdown:card', { card: 'break' });
    await expect(stageWin.locator('[data-card="break"] [data-part="showdown-join-ticket"][data-size="medium"]')).toBeVisible();
    await stageWin.waitForTimeout(1400); // the scene curtain opens first
    await shot(stageWin, 'qr-break');
    expect(await phone.locator('canvas.sd-qr').count()).toBe(0);
    await tv.context().close();
    await phone.context().close();
  });
});
