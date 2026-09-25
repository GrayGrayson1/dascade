import { expect, type Browser, type Page } from '@playwright/test';

/** Sets the nickname on a cabinet entry / join prompt. */
export async function setName(page: Page, name: string): Promise<void> {
  const input = page.getByPlaceholder('Pick a nickname');
  await input.fill(name);
  await input.blur();
}

/** Opens a cabinet and creates a room. Returns the room code. */
export async function createRoom(page: Page, gameId: string, name = 'Host', opts: { solo?: boolean } = {}): Promise<string> {
  await page.goto(`/play/${gameId}`);
  await setName(page, name);
  const label = opts.solo ? /Play solo|Solo time trial/ : 'Create game';
  await page.getByRole('button', { name: label }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
  const code = page.url().split('/').pop()!;
  await expect(page.locator('.lobby, .game-stage').first()).toBeVisible();
  return code;
}

/** Opens a fresh browser context and joins a room by link. */
export async function joinRoom(browser: Browser, code: string, name: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Page> {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  await page.goto(`/room/${code}`);
  await setName(page, name);
  await page.getByRole('button', { name: 'Join game' }).click();
  await expect(page.locator('.lobby, .game-stage').first()).toBeVisible();
  return page;
}

/** Host presses Start (confirming "start anyway" if some players aren't ready). */
export async function startGame(host: Page): Promise<void> {
  await host.getByRole('button', { name: 'Start game' }).click();
  const confirm = host.getByRole('button', { name: 'Start now' });
  if (await confirm.isVisible({ timeout: 800 }).catch(() => false)) await confirm.click();
}

/** Reads the synchronized room state snapshot exposed for tests. */
export async function roomState<T = any>(page: Page): Promise<T> {
  return page.evaluate(() => (window as any).__DASCADE__?.getState()) as Promise<T>;
}

export async function waitForPhase(page: Page, phase: string, timeout = 15_000): Promise<void> {
  await expect.poll(async () => (await roomState(page))?.phase, { timeout }).toBe(phase);
}

/** Leaves the room via the shell and lands back on the arcade floor. */
export async function leaveRoom(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__DASCADE__?.session.leaveRoom());
  await page.goto('/');
}

/**
 * Simulates the network dropping the room's WebSocket (as a flaky Wi-Fi would). `reconnect`
 * tunes the SDK's auto-reconnect first (e.g. `{ maxRetries: 0 }` to make it give up at once,
 * `{ minDelay: 1500 }` to keep the "reconnecting" state visible for a moment).
 */
export async function dropConnection(page: Page, reconnect: { maxRetries?: number; minDelay?: number } = {}): Promise<void> {
  await page.evaluate((opts) => {
    const room = (window as any).__DASCADE__.session.room;
    room.reconnection.minUptime = 0;
    if (opts.minDelay !== undefined) {
      room.reconnection.delay = opts.minDelay;
      room.reconnection.minDelay = opts.minDelay;
      room.reconnection.maxDelay = Math.max(opts.minDelay, room.reconnection.maxDelay);
    }
    if (opts.maxRetries !== undefined) room.reconnection.maxRetries = opts.maxRetries;
    room.connection.transport.ws.close(4010);
  }, reconnect);
}

/** The logical player id of this page's session. */
export async function myPlayerId(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as any).__DASCADE__.store.getState().playerId);
}
