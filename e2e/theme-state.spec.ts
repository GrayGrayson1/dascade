/**
 * Themes are presentation only: switching theme (with the themed transition) mid-match must never
 * touch the game. For a representative set — chess mid-game, a party game mid-round, a Phaser game
 * mid-battle, a casino game mid-hand, a Classics run and a Tournament Center match — this cycles the
 * page through all twelve themes and proves:
 *  - the synchronized room state is identical before and after (and the private view, where shown);
 *  - the page sent the server nothing but its clock pings while switching;
 *  - same room, same session, same socket: no reconnect, no status flicker, no remounted game stage;
 *  - no console errors; and the game still takes input afterwards (nothing left over the controls).
 */
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, myPlayerId, roomState, setName, startGame, waitForPhase } from './helpers.ts';

const THEMES = [
  'shareware-97',
  'corporate-98',
  'cyber-cafe-01',
  'mall-arcade-92',
  'vhs-after-dark',
  'space-casino-2088',
  'lan-party',
  'saturday-morning',
  'executive',
  'neon-noir',
  'halloween-night',
  'delta-neon',
] as const;

/** Guests use the project's device profile (so "mobile" really plays on phones). */
function deviceOptions(): BrowserContextOptions {
  const use = test.info().project.use as Record<string, unknown>;
  const pick = ['viewport', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'baseURL', 'locale'] as const;
  const out: Record<string, unknown> = {};
  for (const k of pick) if (use[k] !== undefined) out[k] = use[k];
  return out as BrowserContextOptions;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    // WebKit reports the Colyseus SDK's deliberate, caught `new WebSocket(url, { headers })` probe
    // (it retries with the browser signature) as a page error. Not ours; see the SDK's WebSocketTransport.
    if (/Wrong protocol for WebSocket/.test(e.message)) return;
    errors.push(`pageerror: ${e.message}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource|net::ERR_|favicon|WebSocket|ERR_CONNECTION|status of 40[134]/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

/** Arms probes on the live room: outgoing message types, status changes, socket + stage identity, transition sightings. */
async function armProbe(page: Page, stageSelector: string): Promise<void> {
  await page.evaluate((selector) => {
    const w = window as any;
    const d = w.__DASCADE__;
    const room = d.session.room;
    const probe = {
      sent: [] as string[],
      statuses: [] as string[],
      room,
      ws: room.connection.transport.ws,
      stage: document.querySelector(selector),
      overlaySeen: 0,
      unsub: () => undefined as unknown,
      mo: null as MutationObserver | null,
    };
    for (const method of ['send', 'sendUnreliable', 'sendBytes'] as const) {
      const original = room[method].bind(room);
      room[method] = (type: string | number, ...rest: unknown[]) => {
        probe.sent.push(String(type));
        return original(type, ...rest);
      };
    }
    probe.unsub = d.store.subscribe((s: { status: string }, prev: { status: string }) => {
      if (s.status !== prev.status) probe.statuses.push(s.status);
    });
    probe.mo = new MutationObserver(() => {
      if (document.querySelector('.theme-xfade')) probe.overlaySeen++;
    });
    probe.mo.observe(document.body, { childList: true, subtree: true });
    w.__themeProbe = probe;
  }, stageSelector);
}

interface ProbeResult {
  sent: string[];
  statuses: string[];
  sameRoom: boolean;
  sameSocket: boolean;
  socketOpen: boolean;
  sameStage: boolean;
  stageConnected: boolean;
  overlaySeen: number;
  status: string;
}

async function readProbe(page: Page, stageSelector: string): Promise<ProbeResult> {
  return page.evaluate((selector) => {
    const w = window as any;
    const d = w.__DASCADE__;
    const p = w.__themeProbe;
    p.mo?.disconnect();
    p.unsub();
    const room = d.session.room;
    return {
      sent: p.sent.filter((t: string) => t !== 'sys:time'),
      statuses: p.statuses,
      sameRoom: room === p.room,
      sameSocket: room?.connection?.transport?.ws === p.ws,
      socketOpen: room?.connection?.transport?.ws?.readyState === 1,
      sameStage: p.stage !== null && document.querySelector(selector) === p.stage,
      stageConnected: p.stage?.isConnected ?? false,
      overlaySeen: p.overlaySeen,
      status: d.store.getState().status,
    };
  }, stageSelector);
}

/** Cycles through all twelve themes with the transition and asserts nothing about the match moved. */
async function cycleThemesAndAssertUntouched(page: Page, opts: { stage: string; privateView?: string }): Promise<void> {
  const errors = watchErrors(page);
  const before = await roomState(page);
  expect(before, 'room state is exposed').toBeTruthy();
  const privateBefore = opts.privateView ? await page.locator(opts.privateView).first().innerText() : null;
  await armProbe(page, opts.stage);

  for (const id of THEMES) {
    await page.evaluate((t) => (window as any).__DASCADE_THEME__.switchTheme(t), id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', id);
  }
  await expect(page.locator('.theme-xfade')).toHaveCount(0, { timeout: 5_000 });

  const after = await roomState(page);
  const probe = await readProbe(page, opts.stage);
  expect(after, 'synchronized state is untouched by twelve theme switches').toEqual(before);
  if (opts.privateView) expect(await page.locator(opts.privateView).first().innerText()).toBe(privateBefore);
  expect(probe.sent, 'theme switching sends the server nothing').toEqual([]);
  expect(probe.statuses, 'no reconnect / status flicker').toEqual([]);
  expect(probe).toMatchObject({ sameRoom: true, sameSocket: true, socketOpen: true, sameStage: true, stageConnected: true, status: 'connected' });
  expect(probe.overlaySeen, 'the themed transition actually ran').toBeGreaterThan(0);
  expect(errors).toEqual([]);
}

/** Tap on touch devices, click otherwise. */
async function press(page: Page, name: string | RegExp): Promise<void> {
  const button = page.getByRole('button', { name, exact: typeof name === 'string' });
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await button.tap();
  else await button.click();
}

async function hostSettings(host: Page, patch: Record<string, unknown>): Promise<void> {
  await host.evaluate((p) => (window as any).__DASCADE__.session.lobby.settings(p), patch);
  await expect
    .poll(async () => {
      const s = JSON.parse((await roomState(host)).settingsJson) as Record<string, unknown>;
      return Object.entries(patch).every(([k, v]) => JSON.stringify(s[k]) === JSON.stringify(v));
    })
    .toBe(true);
}

test.describe('theme switching never alters game state', () => {
  test('chess mid-game', async ({ page, browser }) => {
    const code = await createRoom(page, 'chess', 'White');
    await hostSettings(page, { sides: 'host_first' });
    const guest = await joinRoom(browser, code, 'Black', deviceOptions());
    await startGame(page);
    await waitForPhase(page, 'PLAYING');
    await page.locator('[data-sq="e2"]').click();
    await page.locator('[data-sq="e4"]').click();
    await expect.poll(async () => (await roomState(guest)).ply).toBe(1);
    await guest.locator('[data-sq="e7"]').click();
    await guest.locator('[data-sq="e5"]').click();
    await expect.poll(async () => (await roomState(page)).ply).toBe(2);

    await cycleThemesAndAssertUntouched(page, { stage: '.game-stage' });

    // The board still takes input under the last theme.
    await page.locator('[data-sq="g1"]').click();
    await page.locator('[data-sq="f3"]').click();
    await expect.poll(async () => (await roomState(guest)).ply).toBe(3);
    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });

  test('party game mid-round (Trivia question, answer kept private)', async ({ page, browser }) => {
    const code = await createRoom(page, 'trivia', 'Host');
    await hostSettings(page, { answerSeconds: 90, types: ['mc', 'tf'] });
    const guest = await joinRoom(browser, code, 'Guest', deviceOptions());
    await expect.poll(async () => Object.keys((await roomState(page)).players).length).toBe(2);
    await startGame(page);
    await waitForPhase(page, 'PLAYING');
    await expect.poll(async () => (await roomState(guest)).stage, { timeout: 20_000 }).toBe('question');
    const answers = guest.getByRole('group', { name: 'Answer options' }).getByRole('button');
    await expect(answers.first()).toBeVisible();

    await cycleThemesAndAssertUntouched(guest, { stage: '.game-stage' });

    // Answering still works and stays private until the reveal.
    const guestId = (await myPlayerId(guest))!;
    await answers.first().click();
    await expect(guest.getByText(/Locked in!/)).toBeVisible();
    await expect.poll(async () => (await roomState(page)).seats[guestId]?.answered).toBe(true);
    expect((await roomState(page)).revealJson).toBe('');
    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });

  test('Phaser game mid-battle (Tanks aiming)', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const code = await createRoom(page, 'tanks', 'Host');
    await hostSettings(page, { turnSeconds: 90 });
    const guest = await joinRoom(browser, code, 'Guest', deviceOptions());
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);
    await startGame(page);
    await waitForPhase(page, 'PLAYING', 20_000);
    await expect.poll(async () => (await roomState(page))?.battle?.stage, { timeout: 15_000 }).toBe('aim');
    const s0 = await roomState(page);
    const shooter = s0.battle.activeId === (await myPlayerId(page)) ? page : guest;
    await expect(shooter.getByRole('img', { name: 'Battlefield' })).toBeVisible();

    await cycleThemesAndAssertUntouched(shooter, { stage: '.game-stage' });

    // Controls still reach the server.
    const power = s0.tanks[s0.battle.activeId].power as number;
    await press(shooter, 'More power');
    await expect.poll(async () => (await roomState(page))?.tanks?.[s0.battle.activeId]?.power, { timeout: 10_000 }).toBe(power + 1);
    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });

  test('casino game mid-hand (DASjack 21 decision)', async ({ page }) => {
    test.setTimeout(150_000);
    // Solo table with the longest decision timer: twelve themed transitions (slow on WebKit under
    // load) must finish before the server's auto-stand, or the hand legitimately moves on.
    await page.goto('/play/blackjack');
    await setName(page, 'Player');
    const code = await page.evaluate(() =>
      (window as any).__DASCADE__.session.createRoom('blackjack', { solo: true, settings: { decisionSeconds: 60 } }),
    );
    expect(code, 'solo blackjack room created').toBeTruthy();
    await page.evaluate((c) => {
      history.pushState({}, '', `/room/${c}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, code);
    await waitForPhase(page, 'PLAYING');
    const seat = async () =>
      page.evaluate(() => {
        const d = (window as any).__DASCADE__;
        return d.getState()?.seats?.[d.store.getState().playerId];
      });
    // Deal until a hand needs a decision (naturals / dealer blackjacks settle at once).
    const deadline = Date.now() + 100_000;
    for (;;) {
      if (Date.now() > deadline) throw new Error('never reached a decision');
      const s = await roomState(page);
      const me = await seat();
      if (s?.stage === 'PLAYING' && me?.actions?.length) break;
      if (s?.stage === 'BETTING' && me && !me.locked) {
        const chip = page.getByRole('button', { name: 'Add 5 chip' });
        if ((me.bet ?? 0) < 10) await chip.click({ timeout: 2_000 }).catch(() => undefined);
        else await page.getByRole('button', { name: /^Deal/ }).click({ timeout: 2_000 }).catch(() => undefined);
      } else if (s?.stage === 'INSURANCE') {
        await page.getByRole('button', { name: /No insurance|No thanks/ }).click({ timeout: 1_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(200);
    }
    await expect(page.getByRole('button', { name: /^Stand/ })).toBeVisible();

    await cycleThemesAndAssertUntouched(page, { stage: '.game-stage' });

    await page.getByRole('button', { name: /^Stand/ }).click();
    await expect.poll(async () => (await seat())?.actions?.length ?? 0, { timeout: 10_000 }).toBe(0);
    await leaveRoom(page);
  });

  test('Classics run (Neon Snake, paused mid-run)', async ({ page }) => {
    await createRoom(page, 'snake', 'Solo', { solo: true });
    await page.getByRole('button', { name: 'Start run' }).click();
    await expect.poll(async () => (await roomState(page))?.match?.status, { timeout: 10_000 }).toBe('running');
    await page.evaluate(() => (window as any).__DASCADE__.session.send('snake:pause', { paused: true }));
    await expect.poll(async () => (await roomState(page))?.match?.paused).toBe(true);

    await cycleThemesAndAssertUntouched(page, { stage: '.game-stage' });

    await page.getByRole('button', { name: 'Resume', exact: true }).first().click();
    await expect.poll(async () => (await roomState(page))?.match?.paused).toBe(false);
    await leaveRoom(page);
  });

  test('Tournament Center match (chess)', async ({ page, browser }) => {
    test.setTimeout(150_000);
    await page.goto('/tournaments');
    await page.getByRole('button', { name: 'Create tournament' }).first().click();
    await page.getByRole('radio', { name: /DAS CHESS/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Tournament name').fill('Theme Cup');
    await setName(page, 'Orga');
    await page.getByRole('button', { name: 'Create tournament' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    const code = page.url().split('/').pop()!;
    await page.getByRole('button', { name: 'Open registration' }).click();
    await expect.poll(async () => (await roomState(page))?.status).toBe('REGISTRATION');

    const players: Page[] = [];
    for (const name of ['Ada', 'Bo']) players.push(await joinKiosk(browser, code, name));
    for (const p of players) {
      await p.getByRole('button', { name: 'Register', exact: true }).click();
      await expect(p.getByRole('heading', { name: 'You’re registered' })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Start tournament' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start tournament' }).click();
    await expect.poll(async () => (await roomState(page))?.status).toBe('IN_PROGRESS');
    for (const p of players) {
      await expect(p.getByRole('button', { name: 'Play match' })).toBeVisible({ timeout: 20_000 });
      await p.getByRole('button', { name: 'Play match' }).click();
      await p.waitForURL((u) => /^\/room\/[A-Z0-9]{5}$/.test(u.pathname) && !u.pathname.endsWith(code), { timeout: 20_000 });
    }
    const [ada, bo] = players as [Page, Page];
    await waitForPhase(ada, 'PLAYING', 30_000);
    await waitForPhase(bo, 'PLAYING', 10_000);

    // The organizer's live bracket and a participant's match both switch through every theme untouched.
    await cycleThemesAndAssertUntouched(ada, { stage: '.game-stage' });
    await cycleThemesAndAssertUntouched(page, { stage: '.tk' });

    // The match still plays: resign → the bracket completes.
    await ada.getByRole('button', { name: 'Resign' }).click();
    await ada.getByRole('button', { name: 'Confirm resign' }).click();
    await waitForPhase(ada, 'RESULTS', 15_000);
    await expect.poll(async () => (await roomState(page))?.status, { timeout: 20_000 }).toBe('COMPLETE');
    await ada.context().close();
    await bo.context().close();
  });
});

async function joinKiosk(browser: Browser, code: string, name: string): Promise<Page> {
  const page = await (await browser.newContext(deviceOptions())).newPage();
  await page.goto(`/room/${code}`);
  await setName(page, name);
  await page.getByRole('button', { name: 'Join game' }).click();
  await expect(page.locator('.tk')).toBeVisible();
  return page;
}
