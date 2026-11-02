import { expect, type Browser, type Page, type WebSocketRoute } from '@playwright/test';

/** Sets the nickname on a cabinet entry / join prompt. */
export async function setName(page: Page, name: string): Promise<void> {
  const input = page.getByPlaceholder('Pick a nickname');
  await input.fill(name);
  await input.blur();
}

/**
 * Presets this browser's settings (theme, reduced motion…) before the app boots — once per tab, so a
 * reload keeps whatever the page changed since (a theme switched in the test stays switched).
 */
export async function presetSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, settings]) => {
      try {
        if (!sessionStorage.getItem('dascade-e2e-settings-preset')) {
          const prev = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
          localStorage.setItem(key, JSON.stringify({ ...prev, ...settings, settingsVersion: 3 }));
          sessionStorage.setItem('dascade-e2e-settings-preset', '1');
        }
      } catch {
        /* storage unavailable */
      }
    },
    ['dascade:v1:settings', patch] as const,
  );
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
  // "Start anyway?" only appears when someone isn't ready. isVisible() never waits, so race the
  // dialog against the match leaving the lobby instead of guessing a delay (slow machines lose).
  const outcome = await Promise.race([
    confirm.waitFor({ state: 'visible', timeout: 8_000 }).then(() => 'confirm' as const),
    expect
      .poll(async () => (await roomState(host))?.phase, { timeout: 8_000 })
      .not.toBe('LOBBY')
      .then(() => 'started' as const),
  ]).catch(() => 'unknown' as const);
  if (outcome !== 'confirm') return;
  // Let the dialog's pop-in animation settle so the click isn't rejected as "not stable".
  await confirm
    .evaluate((el) => {
      const root = el.closest('dialog') ?? el;
      const finite = root.getAnimations({ subtree: true }).filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
      return Promise.race([Promise.all(finite.map((a) => a.finished)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    })
    .catch(() => undefined);
  await confirm.click();
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

/** The Colyseus session id of this page's room connection (it survives an auto-reconnect, not a seat rejoin). */
export async function mySessionId(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as any).__DASCADE__.session.room?.sessionId ?? null);
}

export interface SocketTap {
  /**
   * Cuts the page's live room socket the way a dead network does (the Oct 29 drops): the page sees an
   * abnormal close (1006) and starts reconnecting, while the server's side stays open. That side keeps
   * answering the server's pings, so it only goes away when the test calls `endServerSide()` (what the
   * server's heartbeat does 15–20 s after a real network dies) or when the client's seat-token rejoin
   * pushes it out (as when a proxy keeps the server's side alive).
   */
  dropHalfOpen(): Promise<{ endServerSide: () => Promise<void> }>;
}

/**
 * Routes this page's room sockets through Playwright, passing everything through, so a test can cut one
 * half-open (unlike `dropConnection`, which closes cleanly and lets the server notice at once). Call it
 * before the page connects.
 */
export async function tapSockets(page: Page): Promise<SocketTap> {
  type Link = { page: WebSocketRoute; server: WebSocketRoute; cut: boolean; closed: boolean };
  const links: Link[] = [];
  await page.routeWebSocket(/[?&]sessionId=/, (ws) => {
    const server = ws.connectToServer();
    const link: Link = { page: ws, server, cut: false, closed: false };
    links.push(link);
    // Forward closes by hand (a handler turns Playwright's forwarding off) so a cut link keeps its server side.
    ws.onClose((code, reason) => {
      link.closed = true;
      if (!link.cut) void server.close({ code, reason });
    });
    server.onClose((code, reason) => {
      link.closed = true;
      void ws.close({ code, reason });
    });
  });
  // The Colyseus SDK first tries Node's `new WebSocket(url, { headers, protocols })` and relies on the
  // browser throwing to fall back to `new WebSocket(url, protocols)`. Playwright's routing mock accepts
  // the object (and the real connection then fails), so give it the browser's check.
  await page.addInitScript(() => {
    const Routed = globalThis.WebSocket;
    globalThis.WebSocket = class WebSocket extends Routed {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols !== undefined && typeof protocols !== 'string' && !Array.isArray(protocols)) {
          throw new SyntaxError("Failed to construct 'WebSocket': The subprotocol is invalid.");
        }
        super(url, protocols);
      }
    };
  });
  return {
    async dropHalfOpen() {
      const link = [...links].reverse().find((l) => !l.closed);
      if (!link) throw new Error('no open room socket to drop');
      // As in dropConnection: a room joined under 1.5 s ago would skip the auto-reconnect.
      await page.evaluate(() => {
        const room = (window as any).__DASCADE__?.session.room;
        if (room) room.reconnection.minUptime = 0;
      });
      link.cut = true;
      link.closed = true;
      await link.page.close({ code: 1006, reason: 'network lost' });
      return { endServerSide: () => link.server.close() };
    },
  };
}
