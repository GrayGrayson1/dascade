/**
 * DAS Survey Showdown — the sound station (AUD-02 C) in a DAS-O-Ween event room: the presenter loads
 * the rehearsal, a big screen joins, and exactly one device plays the show's sound. The console's
 * badge names where the sound is; the station moves to the big screen (only it plays now); the big
 * screen goes away and the console takes the sound back within ~5 s and says so.
 *
 * "Plays" is measured on the shared AudioContext itself: every oscillator and buffer source a page
 * creates is counted (theme music and the arcade's game music are off, so after a presenter cue
 * only show sound makes nodes).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

/** Counts the audio nodes this page creates (window.__sdNodes); the show's theme music stays off unless `music`. */
async function instrument(target: Page | BrowserContext, music = false): Promise<void> {
  await target.addInitScript((on) => {
    try {
      localStorage.setItem('dascade:showdown:music', on ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
    const w = window as unknown as { __sdNodes: number };
    w.__sdNodes = 0;
    const proto =
      (window as unknown as { BaseAudioContext?: { prototype: BaseAudioContext } }).BaseAudioContext?.prototype ?? AudioContext.prototype;
    for (const name of ['createOscillator', 'createBufferSource'] as const) {
      const orig = proto[name] as (...args: unknown[]) => AudioNode;
      (proto as unknown as Record<string, unknown>)[name] = function (this: BaseAudioContext, ...args: unknown[]) {
        w.__sdNodes++;
        return orig.apply(this, args);
      };
    }
  }, music);
}

const nodes = (page: Page) => page.evaluate(() => (window as unknown as { __sdNodes: number }).__sdNodes);
const resetNodes = (page: Page) => page.evaluate(() => ((window as unknown as { __sdNodes: number }).__sdNodes = 0));
const send = (page: Page, type: string, payload: unknown) =>
  page.evaluate(
    ([t, p]) =>
      (window as unknown as { __DASCADE__: { session: { send: (t: string, p: unknown) => void } } }).__DASCADE__.session.send(t, p),
    [type, payload] as const,
  );

/** The presenter's "Ding" cue, then how many audio nodes each device made for it. */
async function cueAndCount(host: Page, others: Page[]): Promise<number[]> {
  const pages = [host, ...others];
  for (const p of pages) await resetNodes(p);
  await send(host, 'showdown:cue', { cue: 'ding' });
  await host.waitForTimeout(1200);
  return Promise.all(pages.map(nodes));
}

test('DAS-O-Ween sound station: one device plays the show, and the console takes the sound back when a big screen drops', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop.');
  test.setTimeout(120_000);
  const host = page;
  await instrument(host);
  const code = await createRoom(host, 'showdown', 'Host');

  // The DAS-O-Ween rehearsal makes this an event room.
  const settingsTab = host.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await host.getByRole('button', { name: 'Load DAS-O-Ween rehearsal (demo answers)' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-rehearsal');

  // A big screen on another device (a TV laptop).
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await instrument(tvCtx);
  const tv = await tvCtx.newPage();
  await tv.goto(`/room/${code}?screen=1`);
  await tv.getByPlaceholder('Pick a nickname').fill('Stage TV');
  await tv.getByRole('button', { name: 'Join game' }).click();
  await expect(tv.locator('[data-part="showdown-screen"] .sd-stage')).toBeVisible();
  await expect.poll(async () => Object.keys((await roomState(host)).screens ?? {}).length).toBe(1);
  const hostId = (await myPlayerId(host))!;
  const tvId = (await myPlayerId(tv))!;

  await startGame(host);
  await waitForPhase(host, 'PLAYING');

  // The console holds the sound: its badge names it, and its heartbeat reaches the server (✓ heard).
  const badge = host.locator('[data-part="showdown-station-badge"]');
  await expect(badge).toHaveAttribute('data-holder', hostId);
  await expect(badge).toHaveAttribute('data-mine', 'true');
  await expect(badge).toContainText('this console');
  await expect(badge).toHaveAttribute('data-state', 'ok');
  await expect(badge).toContainText('✓');
  // Both report their audio (1 = can play).
  await expect.poll(async () => (await roomState(host)).audio?.[tvId]).toBe(1);
  await expect.poll(async () => (await roomState(host)).audio?.[hostId]).toBe(1);
  // The big screen is silent and says where the sound is.
  const tvBadge = tv.locator('[data-part="showdown-station-badge"]');
  await expect(tvBadge).toHaveAttribute('data-mine', 'false');
  await expect(tvBadge).toContainText('Silent — the sound plays on the presenter’s console');
  await host.screenshot({ path: '.scratch/decision-build/shots/audio/e2e-console-station.png' });

  // Exactly one device plays a cue: the console.
  let [atHost, atTv] = await cueAndCount(host, [tv]);
  expect(atHost).toBeGreaterThan(0);
  expect(atTv).toBe(0);

  // The crew moves the sound to the big screen (the Sound panel does this; here, straight to the server).
  await send(host, 'showdown:station', { playerId: tvId });
  await expect.poll(async () => (await roomState(host)).soundStation).toBe(tvId);
  await expect(badge).toHaveAttribute('data-holder', tvId);
  await expect(badge).toHaveAttribute('data-mine', 'false');
  await expect(badge).toContainText('Stage TV');
  await expect(badge).toHaveAttribute('data-state', 'ok');
  await expect(tvBadge).toHaveAttribute('data-mine', 'true');
  await expect(tvBadge).toContainText('This screen plays the show’s sound');
  await tv.locator('.sd-stage__corner').hover();
  await tv.screenshot({ path: '.scratch/decision-build/shots/audio/e2e-screen-station.png' });

  // Now only the big screen plays.
  [atHost, atTv] = await cueAndCount(host, [tv]);
  expect(atHost).toBe(0);
  expect(atTv).toBeGreaterThan(0);

  // The big screen goes away: within ~5 s the sound is back on the console, and the console says so.
  const droppedAt = Date.now();
  await tvCtx.close();
  await expect(badge).toHaveAttribute('data-holder', hostId, { timeout: 7_000 });
  expect(Date.now() - droppedAt).toBeLessThan(6_500);
  await expect(badge).toHaveAttribute('data-mine', 'true');
  await expect(badge).toContainText('this console');
  await expect(
    host.locator('[data-part="toast"]', { hasText: 'Sound moved back to your console: Stage TV stopped answering' }),
  ).toBeVisible();
  await host.screenshot({ path: '.scratch/decision-build/shots/audio/e2e-console-failover.png' });
  [atHost] = await cueAndCount(host, []);
  expect(atHost).toBeGreaterThan(0);

  await leaveRoom(host);
});

test('outside event rooms nothing changes: no station badge, and the console and a big screen both play the show', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop.');
  test.setTimeout(90_000);
  const host = page;
  await instrument(host);
  const code = await createRoom(host, 'showdown', 'Host');
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await instrument(tvCtx);
  const tv = await tvCtx.newPage();
  await tv.goto(`/room/${code}?screen=1`);
  await tv.getByPlaceholder('Pick a nickname').fill('Big Screen');
  await tv.getByRole('button', { name: 'Join game' }).click();
  await expect(tv.locator('[data-part="showdown-screen"] .sd-stage')).toBeVisible();
  await expect.poll(async () => Object.keys((await roomState(host)).screens ?? {}).length).toBe(1);
  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  expect((await roomState(host)).event ?? '').toBe('');
  await expect(host.getByRole('button', { name: /Start round 1/ }).first()).toBeVisible();
  await expect(host.locator('[data-part="showdown-station-badge"]')).toHaveCount(0);
  await expect(tv.locator('[data-part="showdown-station-badge"]')).toHaveCount(0);
  const [atHost, atTv] = await cueAndCount(host, [tv]);
  expect(atHost).toBeGreaterThan(0);
  expect(atTv).toBeGreaterThan(0);
  await tvCtx.close();
  await leaveRoom(host);
});

/** The presenter's own jukebox (window.__DASCADE_AUDIO__): its intent, and the show's hold on it. */
const jukebox = (page: Page) =>
  page.evaluate(() => {
    const a = (
      window as unknown as { __DASCADE_AUDIO__: { store: { getState(): { wantPlaying: boolean; library: { tracks: unknown[] } } } } }
    ).__DASCADE_AUDIO__;
    const s = a.store.getState();
    let held = '';
    try {
      held = sessionStorage.getItem('dascade:jukebox:show-paused') ?? '';
    } catch {
      /* storage unavailable */
    }
    return { want: s.wantPlaying, tracks: s.library.tracks.length, held };
  });
const jukeboxDo = (page: Page, action: 'play' | 'pause') =>
  page.evaluate(
    (a) => (window as unknown as { __DASCADE_AUDIO__: { jukebox: Record<string, () => void> } }).__DASCADE_AUDIO__.jukebox[a]!(),
    action,
  );

test('DAS-O-Ween music: the jukebox pauses while a question is live and comes back in the breaks — only what the show paused', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop.');
  test.setTimeout(90_000);
  const host = page;
  await instrument(host, true);
  const code = await createRoom(host, 'showdown', 'Host');
  const settingsTab = host.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await host.getByRole('button', { name: 'Load DAS-O-Ween rehearsal (demo answers)' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-rehearsal');
  await expect.poll(async () => (await jukebox(host)).tracks).toBeGreaterThan(0);
  /** Audio nodes made over 1.5 s with no cue: only the theme bed makes any. */
  const bedNodes = async () => {
    await host.waitForTimeout(1200);
    await resetNodes(host);
    await host.waitForTimeout(1500);
    return nodes(host);
  };

  // The DAS-O-Ween record plays while people arrive and through the opening.
  await jukeboxDo(host, 'play');
  await expect.poll(async () => (await jukebox(host)).want).toBe(true);
  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await host
    .getByRole('button', { name: /^Start round 1/ })
    .first()
    .click();
  await expect.poll(async () => JSON.parse((await roomState(host)).boardJson).stage).toBe('title');
  expect((await jukebox(host)).want).toBe(true);
  // One music source per segment: the theme bed yields to the jukebox on the title card.
  expect(await bedNodes()).toBe(0);

  // The question goes live: the show pauses it (and remembers that it did).
  await host
    .getByRole('button', { name: /^Show the question/ })
    .first()
    .click();
  await expect.poll(async () => JSON.parse((await roomState(host)).boardJson).stage).toBe('live');
  await expect.poll(async () => await jukebox(host)).toMatchObject({ want: false, held: code });

  // A holding card is a break: the show gives the music back.
  await send(host, 'showdown:card', { card: 'break' });
  await expect.poll(async () => await jukebox(host)).toMatchObject({ want: true, held: '' });
  // Back to the question: paused again.
  await send(host, 'showdown:card', { card: '' });
  await expect.poll(async () => await jukebox(host)).toMatchObject({ want: false, held: code });

  // The presenter pauses it on purpose in the next break: the show never overrides that.
  await send(host, 'showdown:card', { card: 'break' });
  await expect.poll(async () => (await jukebox(host)).want).toBe(true);
  await jukeboxDo(host, 'pause');
  await send(host, 'showdown:card', { card: '' });
  await host.waitForTimeout(600);
  expect(await jukebox(host)).toMatchObject({ want: false, held: '' });
  await send(host, 'showdown:card', { card: 'break' });
  await host.waitForTimeout(600);
  expect(await jukebox(host)).toMatchObject({ want: false, held: '' });

  // And pressing play during a live question is theirs too: the next break leaves it as it is.
  await send(host, 'showdown:card', { card: '' });
  await expect.poll(async () => (await roomState(host)).card).toBe('');
  await host.waitForTimeout(300);
  await jukeboxDo(host, 'play');
  await expect.poll(async () => (await jukebox(host)).want).toBe(true);
  expect((await jukebox(host)).held).toBe('');
  await jukeboxDo(host, 'pause');
  await send(host, 'showdown:card', { card: 'break' });
  await host.waitForTimeout(600);
  expect((await jukebox(host)).want).toBe(false);
  // With the jukebox off, the holding card gets the theme bed again.
  expect(await bedNodes()).toBeGreaterThan(0);

  await leaveRoom(host);
});
