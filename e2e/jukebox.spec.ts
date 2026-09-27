/**
 * Jukebox E2E (global player + Room DJ). Asserts through state (window.__DASCADE_AUDIO__, exposed by
 * the audio engine in every build like window.__DASCADE__), never through audible output:
 *  - the library loads the manifest; open → play → next → seek work from the UI;
 *  - floor → cabinet → title screen → lobby → back keeps the SAME <audio> element playing
 *    (currentTime keeps increasing — no restart), and a theme switch neither restarts nor clears the queue;
 *  - a reload restores the track + approximate position (resuming after a gesture);
 *  - the collapsed dock never overlaps key controls on phones (bounding boxes), hides in immersive games;
 *  - the visualizer canvas count stays 1;
 *  - Room DJ: two clients — the host enables it and plays a track, the guest follows in sync and can vote skip.
 * Runs on every project (desktop + mobile).
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { dropConnection, joinRoom, leaveRoom, myPlayerId, setName } from './helpers';

type Snap = {
  status: string;
  tracks: number;
  currentId: string | null;
  playing: boolean;
  wantPlaying: boolean;
  needsGesture: boolean;
  queue: string[];
  source: string;
  expanded: boolean;
  t: number;
  mark: string | null;
  room: {
    enabled: boolean;
    playing: boolean;
    current: string | null;
    skipVotes: number;
    skipNeeded: number;
    allowSkipVote: boolean;
  } | null;
};

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const a = (window as any).__DASCADE_AUDIO__;
    if (!a) return null;
    const s = a.store.getState();
    const el = a.jukebox.element as (HTMLAudioElement & { __jbMark?: string }) | null;
    return {
      status: s.library.status,
      tracks: s.library.tracks.length,
      currentId: s.currentId,
      playing: s.playing,
      wantPlaying: s.wantPlaying,
      needsGesture: s.needsGesture,
      queue: [...s.queue],
      source: s.source,
      expanded: s.expanded,
      t: a.jukebox.currentTime(),
      mark: el?.__jbMark ?? null,
      room: s.room
        ? {
            enabled: s.room.enabled,
            playing: s.room.playing,
            current: s.room.current?.trackId ?? null,
            skipVotes: s.room.skipVotes,
            skipNeeded: s.room.skipNeeded,
            allowSkipVote: s.room.allowSkipVote,
          }
        : null,
    };
  }) as Promise<Snap>;
}

async function libraryReady(page: Page): Promise<number> {
  await expect.poll(async () => (await snap(page))?.status, { timeout: 15_000 }).toBe('ready');
  const n = (await snap(page)).tracks;
  expect(n).toBeGreaterThanOrEqual(1);
  return n;
}

const dock = (page: Page) => page.locator('[data-jukebox][data-dock]');
const panel = (page: Page) => page.locator('[data-jukebox] [data-part="panel"]');

async function openPlayer(page: Page): Promise<void> {
  await dock(page).locator('[data-part="mini-open"]').first().click();
  await expect(panel(page)).toBeVisible();
}

async function closePlayer(page: Page): Promise<void> {
  await panel(page).locator('[data-part="close"]').click();
  await expect(panel(page)).toBeHidden();
}

/** Plays the first library track from the UI; returns its id. */
async function playFirstTrack(page: Page): Promise<string> {
  await openPlayer(page);
  const row = panel(page).locator('[data-part="track"]').first();
  await row.locator('.jb-track__main').click();
  await expect.poll(async () => (await snap(page)).playing, { timeout: 15_000 }).toBe(true);
  const s = await snap(page);
  expect(s.currentId).toBeTruthy();
  return s.currentId!;
}

async function markElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = (window as any).__DASCADE_AUDIO__.jukebox.element;
    el.__jbMark = 'first';
  });
}

/** Same element as before, still playing, and time moved forward from `since`. */
async function expectContinuous(page: Page, since: number): Promise<number> {
  await expect.poll(async () => (await snap(page)).t, { timeout: 8_000 }).toBeGreaterThan(since + 0.2);
  const s = await snap(page);
  expect(s.mark).toBe('first');
  expect(s.playing).toBe(true);
  return s.t;
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function expectNoOverlap(target: Locator, others: Locator[]): Promise<void> {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  for (const other of others) {
    const count = await other.count();
    for (let i = 0; i < count; i++) {
      const el = other.nth(i);
      if (!(await el.isVisible())) continue;
      const ob = await el.boundingBox();
      if (!ob) continue;
      expect(boxesOverlap(box!, ob), `jukebox dock overlaps ${await el.evaluate((e) => e.outerHTML.slice(0, 120))}`).toBe(false);
    }
  }
}

async function createLobby(page: Page, gameId = 'chess', name = 'Host'): Promise<string> {
  await page.goto(`/play/${gameId}`);
  await setName(page, name);
  await page.getByRole('button', { name: 'Create game' }).click();
  await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
  await expect(page.locator('.lobby').first()).toBeVisible();
  return page.url().split('/').pop()!;
}

test.describe('jukebox', () => {
  test('library loads from the manifest; open → play → next → seek', async ({ page }) => {
    await page.goto('/');
    const n = await libraryReady(page);
    await expect(dock(page)).toHaveCount(1);
    await openPlayer(page);
    await expect(panel(page).locator('[data-part="track"]')).toHaveCount(n);
    await expect(page.locator('[data-jukebox] canvas[data-part="visualizer"]')).toHaveCount(1);
    await closePlayer(page);

    const first = await playFirstTrack(page);
    await expect(page.locator('[data-jukebox] [data-part="track-title"]')).not.toHaveText(/Nothing playing|Loading/);

    if (n > 1) {
      await page.getByRole('button', { name: 'Next track', exact: true }).first().click();
      await expect.poll(async () => (await snap(page)).currentId, { timeout: 10_000 }).not.toBe(first);
      await expect.poll(async () => (await snap(page)).playing, { timeout: 15_000 }).toBe(true);
    }

    // Keyboard seek: +5 s per arrow press.
    const before = (await snap(page)).t;
    const seek = page.locator('[data-jukebox] input[data-part="seek"]');
    await seek.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await snap(page)).t, { timeout: 8_000 }).toBeGreaterThan(before + 8);
    await expect(seek).toHaveAttribute('aria-valuetext', /seconds? of/);

    // Shuffle / repeat / mute are real toggles.
    const shuffle = page.locator('[data-jukebox] [data-part="shuffle"]');
    const pressed = await shuffle.getAttribute('aria-pressed');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
    const mute = page.locator('[data-jukebox] [data-part="mute"]');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');

    // Escape closes and the visualizer stays a single canvas across open/close cycles.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await openPlayer(page);
    await expect(page.locator('canvas[data-part="visualizer"]')).toHaveCount(1);
  });

  test('keeps playing across floor → cabinet → title screen → lobby → back, and through a theme switch', async ({ page }) => {
    // Count every AudioContext / <audio> / MediaElementSource the page ever creates: one each, ever
    // (no double playback from remounts, StrictMode effects or theme switches).
    await page.addInitScript(() => {
      const w = window as any;
      const n = (w.__audioCensus = { contexts: 0, elements: 0, sources: 0 });
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (AC) {
        const Wrapped = class extends AC {
          constructor(...args: unknown[]) {
            super(...args);
            n.contexts++;
          }
        };
        w.AudioContext = Wrapped;
        const create = AC.prototype.createMediaElementSource;
        if (create)
          AC.prototype.createMediaElementSource = function (this: AudioContext, el: HTMLMediaElement) {
            n.sources++;
            return create.call(this, el);
          };
      }
      const NativeAudio = w.Audio;
      w.Audio = function (...args: unknown[]) {
        n.elements++;
        return new NativeAudio(...args);
      };
    });
    await page.goto('/');
    await libraryReady(page);
    await playFirstTrack(page);
    await markElement(page);
    // Queue two tracks so the theme switch can prove the queue survives.
    const lib = page.locator('[data-jukebox] [data-part="track"]');
    await lib
      .nth(1)
      .getByRole('button', { name: /^Add to queue/ })
      .click();
    await lib
      .nth(2 % (await lib.count()))
      .getByRole('button', { name: /^Add to queue/ })
      .click();
    const queued = (await snap(page)).queue;
    expect(queued.length).toBe(2);
    await closePlayer(page);
    let t = (await snap(page)).t;

    // Floor → cabinet (client-side navigation through the lineup).
    for (let guard = 0; guard < 11; guard++) {
      if ((await page.locator('#plaque-title').textContent())?.trim() === 'DAS Boardroom') break;
      await page.getByRole('button', { name: 'Previous cabinet' }).click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('#plaque-title')).toHaveText('DAS Boardroom');
    await page.getByRole('button', { name: 'Open DAS Boardroom' }).click();
    await page.waitForURL(/\/cabinet\/boardroom$/);
    t = await expectContinuous(page, t);

    // Cabinet → title screen.
    await page.locator('[data-part="picker-card-link"][data-game="chess"]').first().click();
    await page.waitForURL(/\/play\/chess$/);
    t = await expectContinuous(page, t);

    // Title screen → lobby: the dock moves into the room's top bar.
    await setName(page, 'Walker');
    await page.getByRole('button', { name: 'Create game' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    await expect(page.locator('.topbar [data-jukebox][data-dock="topbar"]')).toBeVisible();
    t = await expectContinuous(page, t);

    // Theme switch mid-lobby: no restart, queue intact.
    await page.evaluate(() => (window as any).__DASCADE_THEME__.setTheme('shareware-97'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'shareware-97');
    await page.waitForTimeout(1200);
    t = await expectContinuous(page, t);
    expect((await snap(page)).queue).toEqual(queued);

    // Back out of the room (browser back), still the same playback.
    await page.goBack();
    await page.waitForURL((url) => !/\/room\//.test(url.pathname));
    t = await expectContinuous(page, t);
    await page.evaluate(() => (window as any).__DASCADE_THEME__.setTheme('delta-neon'));
    await expectContinuous(page, t);
    const census = await page.evaluate(() => (window as any).__audioCensus);
    expect(census.elements).toBe(1);
    expect(census.contexts).toBeLessThanOrEqual(1);
    expect(census.sources).toBeLessThanOrEqual(1);
  });

  test('reload restores the track and approximate position, resuming after a gesture', async ({ page }) => {
    await page.goto('/');
    await libraryReady(page);
    const id = await playFirstTrack(page);
    await page.evaluate(() => (window as any).__DASCADE_AUDIO__.jukebox.seek(30));
    await expect.poll(async () => (await snap(page)).t, { timeout: 8_000 }).toBeGreaterThan(29);
    await page.waitForTimeout(1800); // persistence is throttled (and flushed on pagehide)
    await page.reload();
    await libraryReady(page);
    await expect.poll(async () => (await snap(page)).currentId, { timeout: 10_000 }).toBe(id);
    const restored = await snap(page);
    expect(restored.wantPlaying).toBe(true);
    // Any gesture resumes it (the dock button is a convenient, harmless target).
    await dock(page).locator('[data-part="mini-open"]').first().click();
    await expect.poll(async () => (await snap(page)).playing, { timeout: 15_000 }).toBe(true);
    const after = await snap(page);
    expect(after.currentId).toBe(id);
    expect(after.t).toBeGreaterThan(25);
    expect(after.t).toBeLessThan(45);
  });

  test('the dock stays clear of key controls on phones and out of immersive games', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone viewports only');
    await page.goto('/');
    await libraryReady(page);
    // Floor: the floating dock avoids the HUD and plaque controls.
    await expect(dock(page)).toBeVisible();
    await expectNoOverlap(dock(page), [page.locator('.af-floor button, .af-floor a[href]')]);

    await playFirstTrack(page);
    await closePlayer(page);

    // Lobby: lives inside the top bar; never on Leave, the room code, the other shell buttons or the bottom dock.
    await createLobby(page, 'chess', 'Pocket');
    const inBar = page.locator('.topbar [data-jukebox][data-dock="topbar"]');
    await expect(inBar).toBeVisible();
    const topbar = page.locator('.topbar');
    await expectNoOverlap(inBar, [
      topbar.getByRole('button', { name: /Leave/ }),
      topbar.locator('.code-chip'),
      topbar.getByRole('button', { name: /^(Mute|Unmute|How to play|Settings)$/ }),
      page.locator('.lobby__actions'),
    ]);
    const barBox = await topbar.boundingBox();
    const dockBox = await inBar.boundingBox();
    expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(barBox!.x + barBox!.width + 1);
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Immersive game (Classics): no floating dock over the playfield; it lives in the shell menu.
    await page.goto('/play/snake');
    await setName(page, 'Pocket');
    await page.getByRole('button', { name: /Play solo/i }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    await expect(page.locator('.cl-shell')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-jukebox][data-dock="float"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.locator('.shell-menu [data-jukebox][data-dock="menu"]')).toBeVisible();
    await page.locator('.shell-menu [data-part="mini-open"]').click();
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('canvas[data-part="visualizer"]')).toHaveCount(1);
    await closePlayer(page);
  });
});

test.describe('room DJ', () => {
  async function guestPage(browser: Browser, code: string): Promise<Page> {
    const guest = await joinRoom(browser, code, 'Guest');
    await libraryReady(guest);
    return guest;
  }

  test('host enables Room DJ and plays a track; the guest follows in sync and can vote to skip', async ({ page, browser }) => {
    const code = await createLobby(page, 'chess', 'Host');
    await libraryReady(page);
    const guest = await guestPage(browser, code);

    // Host: Room DJ tab → switch on → allow skip vote → play the first track for the room.
    await openPlayer(page);
    await panel(page)
      .getByRole('tab', { name: /Room DJ/ })
      .click();
    const dj = panel(page).locator('[data-part="dj"]');
    await expect(dj).toBeVisible();
    await dj.getByRole('switch', { name: /^Room DJ/ }).check();
    await expect.poll(async () => (await snap(page)).room?.enabled, { timeout: 10_000 }).toBe(true);
    await dj.getByRole('switch', { name: /Allow skip vote/ }).check();
    await expect.poll(async () => (await snap(page)).room?.allowSkipVote, { timeout: 10_000 }).toBe(true);
    await dj.locator('.jb-dj__library [data-part="track"]').first().locator('.jb-track__main').click();
    await expect.poll(async () => (await snap(page)).room?.current, { timeout: 10_000 }).toBeTruthy();
    const trackId = (await snap(page)).room!.current!;

    // Guest: sees the room state, follows it (source=room, same track).
    await expect.poll(async () => (await snap(guest)).room?.current, { timeout: 10_000 }).toBe(trackId);
    await expect.poll(async () => (await snap(guest)).source, { timeout: 10_000 }).toBe('room');
    await expect.poll(async () => (await snap(guest)).currentId, { timeout: 10_000 }).toBe(trackId);
    await expect(guest.locator('.topbar [data-jukebox]')).toHaveAttribute('data-source', 'room');

    // Both elements play within ~1.5 s of each other (the engine resyncs on drift > 0.75 s).
    await expect.poll(async () => (await snap(guest)).playing, { timeout: 15_000 }).toBe(true);
    await expect
      .poll(
        async () => {
          const [h, g] = await Promise.all([snap(page), snap(guest)]);
          return Math.abs(h.t - g.t);
        },
        { timeout: 10_000 },
      )
      .toBeLessThan(1.5);

    // Guest: vote to skip with a clear threshold.
    await openPlayer(guest);
    await panel(guest)
      .getByRole('tab', { name: /Room DJ/ })
      .click();
    const gdj = panel(guest).locator('[data-part="dj"]');
    await expect(gdj.getByText(/of 2 votes to skip/)).toBeVisible();
    await gdj.getByRole('button', { name: 'Vote to skip' }).click();
    await expect.poll(async () => (await snap(guest)).room?.skipVotes ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await expect(gdj.getByRole('button', { name: 'Voted to skip' })).toBeDisabled();

    // Guest opts out: personal playback, local choice only.
    await gdj.getByRole('switch', { name: 'Listen with room' }).uncheck();
    await expect.poll(async () => (await snap(guest)).source, { timeout: 10_000 }).toBe('personal');
    expect((await snap(page)).room?.enabled).toBe(true);

    await guest.context().close();
  });
  test('owner scenario: seek / pause / late join / reconnect / host migration; local mute and opt-out always win', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const code = await createLobby(page, 'bingo', 'Host');
    await libraryReady(page);
    const muted = await guestPage(browser, code); // listens, but muted locally
    const indie = await guestPage(browser, code); // opted out, plays their own music
    const api = (p: Page, fn: string, ...args: unknown[]) =>
      p.evaluate(([f, a]) => {
        const j = (window as any).__DASCADE_AUDIO__.jukebox;
        const path = (f as string).split('.');
        const target = path.length === 2 ? j[path[0]!] : j;
        return target[path.at(-1)!](...(a as unknown[]));
      }, [fn, args] as const);
    const ids = await page.evaluate(() => (window as any).__DASCADE_AUDIO__.store.getState().library.tracks.map((t: any) => t.id) as string[]);
    test.skip(ids.length < 2, 'needs two tracks');
    const [A, B] = [ids[0]!, ids[1]!];

    await api(muted, 'toggleMute');
    await api(indie, 'setRoomOptOut', true);
    await api(indie, 'play', B);
    await expect.poll(async () => (await snap(indie)).playing, { timeout: 15_000 }).toBe(true);

    // Host enables the DJ and plays A: the listener follows (muted), the opted-out player doesn't.
    await api(page, 'dj.configure', { enabled: true });
    await expect.poll(async () => (await snap(muted)).room?.enabled, { timeout: 10_000 }).toBe(true);
    await api(page, 'dj.play', A);
    for (const p of [page, muted]) {
      await expect.poll(async () => (await snap(p)).currentId, { timeout: 10_000 }).toBe(A);
      await expect.poll(async () => (await snap(p)).playing, { timeout: 15_000 }).toBe(true);
    }
    const audible = (p: Page) => p.evaluate(() => (window as any).__DASCADE_AUDIO__.mixer.jukeboxAudible() as boolean);
    expect(await muted.evaluate(() => (window as any).__DASCADE_AUDIO__.store.getState().jukeboxMuted)).toBe(true);
    expect(await audible(muted)).toBe(false);
    expect(await snap(indie)).toMatchObject({ source: 'personal', currentId: B, playing: true });

    const inSync = async (a: Page, b: Page, tol = 1.5) =>
      expect
        .poll(
          async () => {
            const [x, y] = await Promise.all([snap(a), snap(b)]);
            return x.currentId === y.currentId ? Math.abs(x.t - y.t) : 99;
          },
          { timeout: 12_000 },
        )
        .toBeLessThan(tol);

    // Host seeks → the listener reconciles to the new position.
    await api(page, 'seek', 60);
    await expect.poll(async () => (await snap(muted)).t, { timeout: 10_000 }).toBeGreaterThan(58);
    await inSync(page, muted);

    // Host pause → everyone pauses (the host's transport drives the room); resume → everyone resumes.
    await api(page, 'toggle');
    await expect.poll(async () => (await snap(muted)).playing, { timeout: 10_000 }).toBe(false);
    await expect.poll(async () => (await snap(page)).playing, { timeout: 10_000 }).toBe(false);
    await api(page, 'toggle');
    await expect.poll(async () => (await snap(muted)).playing, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await snap(page)).playing, { timeout: 10_000 }).toBe(true);
    await inSync(page, muted);

    // Late joiner: current track at about the room position.
    const late = await guestPage(browser, code);
    await expect.poll(async () => (await snap(late)).currentId, { timeout: 10_000 }).toBe(A);
    await expect.poll(async () => (await snap(late)).playing, { timeout: 15_000 }).toBe(true);
    await inSync(page, late);

    // A dropped connection reconnects and keeps following, still muted.
    await dropConnection(muted);
    await expect
      .poll(async () => muted.evaluate(() => (window as any).__DASCADE__.store.getState().status), { timeout: 20_000 })
      .toBe('connected');
    await inSync(page, muted);
    expect(await audible(muted)).toBe(false);

    // Host leaves mid-track: the music keeps playing for everyone and control moves to the new host.
    await leaveRoom(page);
    const guests = [muted, indie, late];
    const guestIds = await Promise.all(guests.map((p) => myPlayerId(p)));
    await expect
      .poll(async () => guestIds.indexOf((await late.evaluate(() => (window as any).__DASCADE__.getState()?.hostId)) as string), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(0);
    const heirId = (await late.evaluate(() => (window as any).__DASCADE__.getState()?.hostId)) as string;
    const heir = guests[guestIds.indexOf(heirId)]!;
    await expect.poll(async () => ((await api(heir, 'djPermissions')) as { control: boolean }).control, { timeout: 10_000 }).toBe(true);
    for (const p of guests.filter((g) => g !== heir)) expect(((await api(p, 'djPermissions')) as { control: boolean }).control).toBe(false);
    expect((await snap(late)).playing).toBe(true);
    expect((await snap(muted)).playing).toBe(true);
    await heir.evaluate(() => (window as any).__DASCADE_AUDIO__.jukebox.dj.seek(20));
    await expect.poll(async () => (await snap(late)).t, { timeout: 10_000 }).toBeLessThan(24);
    await expect.poll(async () => (await snap(muted)).t, { timeout: 10_000 }).toBeLessThan(24);
    await inSync(muted, late);
    expect(await audible(muted)).toBe(false);
    // The opted-out player never moved.
    expect(await snap(indie)).toMatchObject({ source: 'personal', currentId: B, playing: true });

    for (const p of [muted, indie, late]) await p.context().close();
  });
});
