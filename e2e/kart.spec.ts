/**
 * DASphalt GP smoke paths: cabinet → title → Play solo → the solo lobby (racer, mode, laps, bots) →
 * race vs bots (countdown, keyboard driving with server-side progress, pause + resume, a full 1-lap
 * race finished by the server's test autopilot, results), a two-player room, touch controls on
 * phones, and exit + re-enter.
 *
 * The autopilot is the server's `kart:test` hook (the game's own bot drives our kart), which the
 * server registers only with DASCADE_RELAXED_LIMITS=1 and NODE_ENV ≠ production. Run against a build
 * with `SERVE_WEB=1 DASCADE_RELAXED_LIMITS=1 node apps/game-server/dist/index.js` (no NODE_ENV).
 * The client forwards it only when the page opted in (the `kart-test` session flag).
 */
import { expect, test, type Page } from '@playwright/test';
import { joinRoom, leaveRoom, myPlayerId, roomState, setName, startGame, waitForPhase } from './helpers';

async function optIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('kart-test', '1');
    } catch {
      /* storage unavailable */
    }
  });
}

/** The player id arrives with the server's welcome, a moment after the room URL: wait for it. */
async function waitForMe(page: Page): Promise<string> {
  await expect.poll(() => myPlayerId(page), { timeout: 15_000 }).not.toBeNull();
  return (await myPlayerId(page))!;
}

/** The start sequence is only 4 s: record what the lights showed instead of racing to catch it. */
async function watchStartLights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__kartLights = [];
    const seen = w.__kartLights as string[];
    const obs = new MutationObserver(() => {
      const phase = document.querySelector('[data-part="start-lights"]')?.getAttribute('data-phase');
      if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
  });
}

async function phaseIsOneOf(page: Page, phases: string[], timeout = 20_000): Promise<void> {
  await expect.poll(async () => phases.includes((await roomState(page))?.phase), { timeout }).toBe(true);
}

async function distance(page: Page, id: string): Promise<number> {
  const s = await roomState(page);
  const r = s?.racers?.[id];
  return r ? r.distance + r.lap * 100_000 : -1e9;
}

async function openKartFromCabinet(page: Page): Promise<void> {
  await page.goto('/cabinet/circuit');
  await expect(page.getByRole('heading', { name: 'DAS Raceway', level: 1 })).toBeVisible();
  const menu = page.locator('.cp__list');
  await expect(menu.getByRole('link', { name: /^DASh Circuit — / })).toBeVisible();
  const kart = menu.getByRole('link', { name: /^DASphalt GP — / });
  await expect(kart).toBeVisible();
  await kart.click();
  await expect(page).toHaveURL(/\/play\/kart$/);
  await expect(page.getByRole('heading', { name: 'DASphalt GP', level: 1 })).toBeVisible();
}

/** Shows a lobby section (on phones the lobby is tabbed; desktop shows every section). */
async function showLobbySection(page: Page, tabName: RegExp, section: string) {
  const panel = page.locator(section);
  const tab = page.getByRole('tab', { name: tabName });
  // The tab row can re-render while the game module finishes loading: retry until it sticks.
  await expect(async () => {
    if (!(await panel.isVisible())) await tab.first().click({ timeout: 2_000 });
    await expect(panel).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  return panel;
}

/** Opens the settings panel (a tab on phones) and returns its scope. */
async function settingsPanel(page: Page) {
  return showLobbySection(page, /^Settings/, '[data-part="kart-settings"]');
}

async function setStepper(page: Page, label: 'Laps' | 'Bots', value: number): Promise<void> {
  const panel = await settingsPanel(page);
  const key = label === 'Laps' ? 'laps' : 'bots';
  for (let i = 0; i < 12; i++) {
    const cur = JSON.parse((await roomState(page))?.settingsJson ?? '{}')[key];
    if (cur === value) return;
    await panel.getByRole('button', { name: `${cur > value ? 'Fewer' : 'More'} ${label.toLowerCase()}` }).click();
    await expect.poll(async () => JSON.parse((await roomState(page))?.settingsJson ?? '{}')[key]).not.toBe(cur);
  }
  throw new Error(`could not set ${label}`);
}

test.describe('DASphalt GP', () => {
  test('solo: lobby first (racer, mode, race setup), then countdown, keyboard driving, finish, results, exit and re-enter', async ({
    page,
    isMobile,
  }) => {
    test.setTimeout(240_000);
    await optIn(page);
    await openKartFromCabinet(page);
    await setName(page, 'Zed');
    // Play solo opens a private room of one in the lobby: nothing starts until we press Start.
    await page.getByRole('button', { name: 'Play solo' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    await expect(page.locator('.lobby').first()).toBeVisible();
    const me = await waitForMe(page);
    const s = await roomState(page);
    expect(s.phase).toBe('LOBBY');
    expect(s.race.solo).toBe(true);
    expect(JSON.parse(s.settingsJson)).toMatchObject({ mode: 'race', bots: 5, botSkill: 'normal' });

    // Lobby: pick a racer…
    await showLobbySection(page, /^Your setup/, '[data-part="kart-setup"]');
    await page.getByRole('radio', { name: /^Mochi, Drifter$/ }).click();
    await expect.poll(async () => (await roomState(page))?.looks?.[me]?.racer, { timeout: 10_000 }).toBe('mochi');
    // …every mode is offered solo (Time Trial included)…
    const mode = (await settingsPanel(page)).getByRole('radiogroup', { name: 'Mode' });
    await mode.getByRole('radio', { name: 'Time Trial' }).click();
    await expect.poll(async () => JSON.parse((await roomState(page))?.settingsJson ?? '{}').mode).toBe('timetrial');
    await mode.getByRole('radio', { name: 'Race' }).click();
    await expect.poll(async () => JSON.parse((await roomState(page))?.settingsJson ?? '{}').mode).toBe('race');
    // …and set up a short race against two bots.
    await setStepper(page, 'Laps', 1);
    await setStepper(page, 'Bots', 2);
    expect((await roomState(page))?.phase).toBe('LOBBY');

    await watchStartLights(page);
    await startGame(page);
    // The countdown is 4 s: by the time we look it may already be over.
    await phaseIsOneOf(page, ['COUNTDOWN', 'PLAYING']);
    await expect(page.getByRole('img', { name: 'Race view' })).toBeVisible({ timeout: 30_000 });
    await waitForPhase(page, 'PLAYING', 20_000);
    // Our own start sequence (big numbers and GO), not the shared overlay.
    await expect
      .poll(() => page.evaluate(() => (window as any).__kartLights as string[]), { timeout: 5_000 })
      .toEqual(expect.arrayContaining([expect.stringMatching(/count|go/)]));
    await expect(page.locator('.countdown-overlay')).toHaveCount(0);
    const s0 = await roomState(page);
    expect(Object.keys(s0.racers)).toHaveLength(3);

    // Drive with the keyboard: the server's validated progress moves.
    const before = await distance(page, me);
    await page
      .locator('body')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => undefined);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');
    await expect.poll(async () => (await distance(page, me)) - before, { timeout: 20_000 }).toBeGreaterThan(10);
    // Our kart is predicted locally from its exact own-state stream (kart:own), not just interpolated.
    await expect.poll(() => page.evaluate(() => (window as any).__KART__?.controller.net.predicting), { timeout: 10_000 }).toBe(true);
    await expect(page.locator('[data-part="scoreboard"]')).toBeVisible();
    await expect(page.getByRole('img', { name: /Track map/ })).toBeVisible();
    if (isMobile) {
      // A key press hid the touch controls; touching the screen brings them back.
      await page.touchscreen.tap(20, 200);
      await expect(page.locator('[data-part="controls"]')).toBeVisible();
    }

    // Solo races pause: the menu takes focus, the race freezes, Esc resumes.
    if (isMobile) await page.getByRole('button', { name: 'Pause race' }).click();
    else await page.keyboard.press('Escape');
    const menu = page.getByRole('dialog', { name: 'Paused' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Resume' })).toBeFocused();
    await expect.poll(async () => (await roomState(page))?.race?.paused).toBe(true);
    if (isMobile) await menu.getByRole('button', { name: 'Resume' }).click();
    else await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect.poll(async () => (await roomState(page))?.race?.paused).toBe(false);

    // Finish the lap with the server's test autopilot (the game's bot drives our kart).
    expect(await page.evaluate(() => (window as any).__KART__?.test({ action: 'autopilot', on: true }))).toBe(true);
    await waitForPhase(page, 'RESULTS', 150_000);
    const results = page.locator('[data-part="results"]');
    await expect(results).toBeVisible();
    await expect(results.getByRole('table', { name: 'Race classification' })).toBeVisible();
    await expect(results.getByRole('row').filter({ hasText: 'Zed' }).first()).toBeVisible();
    const end = await roomState(page);
    expect(end.racers[me].lap).toBeGreaterThanOrEqual(1);

    // Exit to the cabinet, then come back in.
    await results.getByRole('button', { name: 'Back to cabinet' }).click();
    await expect(page).toHaveURL(/\/cabinet\/circuit$/);
    await page
      .locator('.cp__list')
      .getByRole('link', { name: /^DASphalt GP — / })
      .click();
    await expect(page).toHaveURL(/\/play\/kart$/);
    await page.getByRole('button', { name: 'Create game' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    await expect(page.locator('.lobby').first()).toBeVisible();
    await leaveRoom(page);
  });

  test('two players race in one room', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await page.goto('/play/kart');
    await setName(page, 'Host');
    await page.getByRole('button', { name: 'Create game' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    const code = page.url().split('/').pop()!;
    const hostId = await waitForMe(page);
    await setStepper(page, 'Bots', 0);
    const guest = await joinRoom(browser, code, 'Guest');
    const guestId = await waitForMe(guest);
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);

    await startGame(page);
    await waitForPhase(page, 'PLAYING', 30_000);
    await expect(guest.getByRole('img', { name: 'Race view' })).toBeVisible();
    const s = await roomState(guest);
    expect(Object.keys(s.racers).sort()).toEqual([hostId, guestId].sort());

    const before = await distance(guest, hostId);
    await page
      .locator('body')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => undefined);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(2500);
    await page.keyboard.up('ArrowUp');
    // The guest sees the host's validated progress.
    await expect.poll(async () => (await distance(guest, hostId)) - before, { timeout: 20_000 }).toBeGreaterThan(10);
    await expect(guest.locator('[data-part="position"]')).toBeVisible();

    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });

  test('touch controls steer, drift and toggle auto-gas on phones', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phones only');
    test.setTimeout(120_000);
    await optIn(page);
    await page.goto('/play/kart');
    await setName(page, 'Thumbs');
    await page.getByRole('button', { name: 'Create game' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    await setStepper(page, 'Bots', 0);
    await startGame(page);
    await waitForPhase(page, 'PLAYING', 30_000);
    const controls = page.locator('[data-part="controls"]');
    await expect(controls).toBeVisible();
    const drift = controls.getByRole('button', { name: 'Drift (hold)' });
    const brake = controls.getByRole('button', { name: 'Brake / reverse' });
    for (const b of [drift, brake]) {
      const box = (await b.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Auto-gas is on by default on touch: the kart pulls away without touching anything.
    await expect(controls.getByRole('button', { name: /Auto-gas on/ })).toHaveAttribute('aria-pressed', 'true');
    const me = await waitForMe(page);
    const before = await distance(page, me);
    await expect.poll(async () => (await distance(page, me)) - before, { timeout: 20_000 }).toBeGreaterThan(5);

    // Steering pad: a sideways drag steers (analog), releasing centres.
    const zone = controls.getByRole('slider', { name: /Steering/ });
    const zb = (await zone.boundingBox())!;
    const x0 = zb.x + zb.width * 0.4;
    const y0 = zb.y + zb.height * 0.6;
    await zone.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: x0, clientY: y0, isPrimary: true, buttons: 1 });
    await zone.dispatchEvent('pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: x0 - 50,
      clientY: y0,
      isPrimary: true,
      buttons: 1,
    });
    await expect.poll(() => page.evaluate(() => (window as any).__KART__.controller.sampler.touch.steer)).toBeGreaterThan(0.5);
    await zone.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: x0 - 50, clientY: y0, isPrimary: true });
    await expect.poll(() => page.evaluate(() => (window as any).__KART__.controller.sampler.touch.steer)).toBe(0);

    // Drift is a hold button.
    await drift.dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch', isPrimary: false, buttons: 1 });
    await expect.poll(() => page.evaluate(() => (window as any).__KART__.controller.sampler.touch.drift)).toBe(true);
    await drift.dispatchEvent('pointerup', { pointerId: 8, pointerType: 'touch', isPrimary: false });
    await expect.poll(() => page.evaluate(() => (window as any).__KART__.controller.sampler.touch.drift)).toBe(false);

    // The page never scrolls or zooms while racing.
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.kr')!).touchAction)).toBe('none');
    await leaveRoom(page);
  });
});
