/**
 * DAS Survey Showdown — the Presenter Showcase stage's pick moments and display profiles (DAS-O-Ween):
 *   - PCK-01 D: the Spotlight picker lands on the person the server drew (the lit seat and the landing
 *     card are the broadcast winner, never a guess), with no spoiler during the sweep;
 *   - VIS-02 C: the hot-seat podium holds the name for the turn; the "called by" credit appears on a
 *     tile only once it's revealed; Boo thanks them by name when the turn counts;
 *   - a screen that arrives after the landing replays nothing; reduced motion gets one still spot;
 *   - DSP-02 C: big screens are Projector, `&display=stream` / the stage window are Stream-safe, at
 *     1280×720 and 960×540, with the show's fonts whatever the viewer's theme;
 *   - PRS-05 C: the stage window is titled "… — STAGE (share this)".
 * Runs on the rehearsal preset (practice boards only), driving the show over the presenter's session.
 */
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { createRoom, joinRoom, presetSettings, roomState, setName, startGame, waitForPhase } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'The stage is a big screen and the presenter runs the show from a laptop.');

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
  await expect.poll(async () => (await roomState(host)).rehearsal).toBe(true);
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).mode).toBe('showcase');
}

/** A big screen (`?screen=1…`) at this size, optionally with reduced motion or a DASCADE theme. */
async function bigScreen(
  browser: Browser,
  code: string,
  name: string,
  opts: { width: number; height: number; query?: string; reduced?: boolean; theme?: string },
): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height } });
  const tv = await ctx.newPage();
  const settings: Record<string, unknown> = {};
  if (opts.reduced) settings.reducedMotion = true;
  if (opts.theme) settings.theme = opts.theme;
  if (Object.keys(settings).length) await presetSettings(tv, settings);
  await tv.goto(`/room/${code}?screen=1${opts.query ?? ''}`);
  await setName(tv, name);
  await tv.getByRole('button', { name: 'Join game' }).click();
  await expect(tv.locator('[data-part="showdown-screen"] .sd-stage').first()).toBeVisible();
  return tv;
}

/** Starts the show and puts round 1's question up (over the presenter's session, not the console UI). */
async function toQuestion(host: Page): Promise<void> {
  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(async () => (await board(host))?.stage).toBe('intro');
  await send(host, 'showdown:act', { a: 'begin', rev: (await board(host)).rev });
  await expect.poll(async () => (await board(host))?.stage).toBe('title');
  await send(host, 'showdown:act', { a: 'question', rev: (await board(host)).rev });
  await expect.poll(async () => (await board(host))?.stage).toBe('live');
}

/** Draws someone; returns the winner as the room sees them. */
async function pick(host: Page): Promise<{ id: string; name: string; drawNo: number; landAt: number }> {
  const before = await roomState(host);
  await send(host, 'showdown:pick', { a: 'pick', round: (await board(host)).round, drawNo: before.drawNo });
  await expect.poll(async () => (await roomState(host)).drawNo).toBe(before.drawNo + 1);
  const s = await roomState(host);
  expect(s.hotSeat).not.toBe('');
  return { id: s.hotSeat, name: s.players[s.hotSeat].name, drawNo: s.drawNo, landAt: s.landAt };
}

const stage = (tv: Page) => tv.locator('[data-part="showdown-screen"] .sd-stage').first();
const spotlight = (tv: Page) => tv.locator('[data-part="showdown-spotlight"]');
const podium = (tv: Page) => tv.locator('[data-part="showdown-hotseat"]');

async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

test('the spotlight lands on the drawn winner; the podium holds the name; the credit waits for the reveal', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const host = page;
  const code = await createRoom(host, 'showdown', 'Host');
  await loadRehearsal(host);
  const phones: Page[] = [];
  for (const name of ['Ada', 'Ben', 'Cyd'])
    phones.push(await joinRoom(browser, code, name, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
  const tv = await bigScreen(browser, code, 'Stage TV', { width: 1280, height: 720, query: '&display=stream' });
  await expect.poll(async () => Object.keys((await roomState(host)).seats ?? {}).length).toBe(3);
  await toQuestion(host);
  await expect(stage(tv)).toHaveAttribute('data-display', 'stream');

  const winner = await pick(host);
  // The sweep: the overlay is up, nobody is marked yet (no spoiler before the landing).
  await expect(spotlight(tv)).toHaveAttribute('data-phase', 'sweep');
  await expect(spotlight(tv).locator('.sd-pick__house .sd-seat')).toHaveCount(3);
  await expect(spotlight(tv).locator('.sd-seat[data-state="hot"]')).toHaveCount(0);
  await expect(spotlight(tv).locator('.sd-pick__card')).toHaveCount(0);
  await snap(tv, testInfo, 'sweep-stream-1280');

  // The landing: the lit seat and the card are the server's winner.
  await expect(spotlight(tv)).toHaveAttribute('data-phase', 'card', { timeout: 6000 });
  await expect(spotlight(tv)).toHaveAttribute('data-winner', winner.id);
  await expect(spotlight(tv).locator('.sd-pick__lit .sd-seat[data-win]')).toHaveCount(1);
  await expect(spotlight(tv).locator('.sd-pick__lit .sd-seat[data-win] .sd-seat__name')).toHaveText(winner.name);
  await expect(spotlight(tv).locator('.sd-pick__name')).toHaveText(winner.name);
  await expect(spotlight(tv).locator('.sd-seat[data-state="hot"] .sd-seat__tag').first()).toHaveText(/hot seat/i);
  await expect(tv.locator('.sd-sc-host__bubble')).toContainText(winner.name);
  await snap(tv, testInfo, 'landed-stream-1280');

  // Then the overlay leaves and the podium holds the name, with the turn timer in words.
  await expect(spotlight(tv)).toHaveCount(0, { timeout: 6000 });
  await expect(podium(tv)).toBeVisible();
  await expect(podium(tv).locator('.sd-hotseat__name')).toHaveText(winner.name);
  await expect(podium(tv)).toContainText(/answering · \d:\d\d/);
  await expect(stage(tv)).toHaveAttribute('data-hotseat', 'true');
  // It sits in the host's column: it never covers the board.
  const frame = await tv.locator('.sd-sc__frame').boundingBox();
  const seat = await podium(tv).boundingBox();
  expect(frame && seat && seat.x + seat.width <= frame.x + 1).toBe(true);

  // No credit anywhere until a tile flips; then that tile (only) is credited, on every screen.
  await expect(tv.locator('.sd-tile__credit')).toHaveCount(0);
  for (const s of (await board(phones[0]!)).slots) expect(s.calledBy).toBeUndefined();
  await send(host, 'showdown:act', { a: 'reveal', round: (await board(host)).round, slot: 2 });
  await expect.poll(async () => (await board(phones[0]!)).slots[2].calledBy).toBe(winner.name);
  for (const [i, s] of (await board(phones[0]!)).slots.entries()) if (i !== 2) expect(s.calledBy).toBeUndefined();
  await expect(tv.locator('.sd-tile__credit')).toHaveCount(1);
  await expect(tv.locator('.sd-tile[data-credit] .sd-tile__credit')).toContainText(`called by ${winner.name}`);
  await expect(podium(tv)).toContainText(/Called it!/);
  await expect(podium(tv)).toContainText('#3 found');
  await snap(tv, testInfo, 'called-it-stream-1280');

  // A screen that arrives now (after the landing) replays nothing: the podium is simply there.
  const late = await bigScreen(browser, code, 'Late TV', { width: 960, height: 540 });
  await expect(podium(late).locator('.sd-hotseat__name')).toHaveText(winner.name);
  await expect(spotlight(late)).toHaveCount(0);
  await late.waitForTimeout(800);
  await expect(spotlight(late)).toHaveCount(0);

  // Mark done: the podium leaves, Boo comes back and thanks them by name; the credit stays on the tile.
  await send(host, 'showdown:pick', { a: 'done', drawNo: winner.drawNo });
  await expect(podium(tv)).toHaveCount(0);
  await expect(stage(tv)).not.toHaveAttribute('data-hotseat', 'true');
  await expect(tv.locator('.sd-sc-host__bubble')).toContainText(winner.name);
  await expect(tv.locator('.sd-tile__credit')).toContainText(winner.name);
  // Their seat now says so in words.
  const next = await pick(host);
  expect(next.id).not.toBe(winner.id);
  // (the overlay draws every seat twice: the dark house and its lit copy)
  const done = spotlight(tv).locator('.sd-pick__house .sd-seat[data-state="done"]');
  await expect(done).toHaveCount(1);
  await expect(done.locator('.sd-seat__tag')).toHaveText(/done/i);
  await expect(done.locator('.sd-seat__name')).toHaveText(winner.name);
});

test('reduced motion: one still spot on the winner; both profiles at 1280×720 and 960×540; the show’s fonts', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const host = page;
  const code = await createRoom(host, 'showdown', 'Host');
  await loadRehearsal(host);
  for (const name of ['Ada', 'Ben', 'Cyd', 'Dee'])
    await joinRoom(browser, code, name, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const still = await bigScreen(browser, code, 'Still TV', { width: 1280, height: 720, query: '&display=stream', reduced: true });
  const screens = {
    'projector-1280': await bigScreen(browser, code, 'Room 1280', { width: 1280, height: 720, theme: 'corporate-98' }),
    'projector-960': await bigScreen(browser, code, 'Room 960', { width: 960, height: 540 }),
    'stream-960': await bigScreen(browser, code, 'Share 960', { width: 960, height: 540, query: '&display=stream' }),
  };
  await toQuestion(host);
  await expect(stage(screens['projector-1280'])).toHaveAttribute('data-display', 'projector');
  await expect(stage(screens['projector-960'])).toHaveAttribute('data-display', 'projector');
  await expect(stage(screens['stream-960'])).toHaveAttribute('data-display', 'stream');
  await expect(stage(still)).toHaveAttribute('data-motion', 'off');

  // The show's fonts, even on a screen whose DASCADE theme uses Tahoma.
  const font = await screens['projector-1280'].locator('.sd-sc__prompt').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toMatch(/^"?Inter Variable/);
  expect(font).not.toMatch(/Tahoma/);

  for (const [name, tv] of Object.entries(screens)) await snap(tv, testInfo, `board-${name}`);

  const maskOf = (tv: Page) =>
    tv
      .locator('.sd-pick__lit')
      .evaluate((el) => (el as HTMLElement).style.maskImage || (el as HTMLElement).style.getPropertyValue('-webkit-mask-image'));
  const winner = await pick(host);
  // Full motion: three spotlights sweep the room.
  await expect(spotlight(screens['stream-960'])).toHaveAttribute('data-sweep', 'true');
  await expect.poll(async () => (await maskOf(screens['stream-960'])).match(/radial-gradient/g)?.length ?? 0).toBe(3);
  // Reduced motion: no sweep — nothing lit while the room waits…
  await expect(spotlight(still)).toHaveAttribute('data-phase', 'sweep');
  await expect(spotlight(still)).not.toHaveAttribute('data-sweep', 'true');
  expect(await maskOf(still)).not.toContain('radial-gradient');
  // …then one still spot on the chosen seat, and the card.
  await expect(spotlight(still)).toHaveAttribute('data-phase', 'card', { timeout: 6000 });
  expect((await maskOf(still)).match(/radial-gradient/g)?.length).toBe(1);
  await expect(spotlight(still).locator('.sd-pick__name')).toHaveText(winner.name);
  await expect(spotlight(still).locator('.sd-pick__lit .sd-seat[data-win] .sd-seat__name')).toHaveText(winner.name);
  await snap(still, testInfo, 'landed-reduced-1280');
  for (const [name, tv] of Object.entries(screens)) {
    await expect(spotlight(tv).locator('.sd-pick__name')).toHaveText(winner.name);
    await snap(tv, testInfo, `landed-${name}`);
  }
  // Then the podium, on every screen (still and moving alike).
  await expect(podium(still)).toBeVisible({ timeout: 6000 });
  await expect(podium(still).locator('.sd-hotseat__name')).toHaveText(winner.name);
  for (const [name, tv] of Object.entries(screens)) {
    await expect(podium(tv).locator('.sd-hotseat__name')).toHaveText(winner.name);
    await snap(tv, testInfo, `podium-${name}`);
  }
});

test('the stage window is titled for sharing, Stream-safe, in the show’s fonts', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const host = page;
  await presetSettings(host, { theme: 'corporate-98' });
  await createRoom(host, 'showdown', 'Host');
  await loadRehearsal(host);
  await toQuestion(host);
  // The console's own preview shows what the share looks like: Stream-safe too.
  await expect(host.locator('.sd-stage[data-mode="showcase"]').first()).toHaveAttribute('data-display', 'stream');
  const [popup] = await Promise.all([
    host.waitForEvent('popup'),
    host
      .getByRole('button', { name: /Stage window/ })
      .first()
      .click(),
  ]);
  await popup.setViewportSize({ width: 1280, height: 720 });
  await expect(popup.locator('.sd-stage').first()).toBeVisible();
  await expect.poll(() => popup.title()).toBe('DAS-O-Ween Rehearsal — STAGE (share this)');
  await expect(popup.locator('.sd-stage').first()).toHaveAttribute('data-display', 'stream');
  const font = await popup.locator('.sd-sc__prompt').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toMatch(/^"?Inter Variable/);
  await snap(popup, testInfo, 'stage-window-1280');
});
