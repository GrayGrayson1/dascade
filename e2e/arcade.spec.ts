/**
 * Arcade floor E2E: the cabinet lineup (buttons, keys, wheel, drag, touch
 * swipe, clicking neighbours), multi-game cabinet pickers, title screens,
 * direct links, back navigation, DASino table deep links and the HUD (the
 * claw machine has its own spec: claw.spec.ts). Runs on every project (desktop + mobile).
 */
import { expect, test, type Page } from '@playwright/test';
import { roomState, setName } from './helpers';

const CABINETS = ['dasketch', 'bingo', 'wheel', 'dasino', 'boardroom', 'stravaganza', 'putt', 'tanks', 'classics', 'circuit', 'quest'];
const TITLES: Record<string, string> = {
  dasketch: 'DASketch',
  bingo: 'DAS Bingo',
  wheel: 'Wheel of DAStiny',
  dasino: 'DASino',
  boardroom: 'DAS Boardroom',
  stravaganza: 'DAStravaganza',
  putt: 'DAS Putt',
  tanks: 'DAS Tanks',
  classics: 'DAScade Classics',
  circuit: 'DAS Raceway',
  quest: 'DASQuest',
};
const GAME_DIRS = [
  'dasketch',
  'holdem',
  'blackjack',
  'bingo',
  'wheel',
  'dasino',
  'circuit',
  'kart',
  'quest',
  'chess',
  'checkers',
  'ships',
  'trivia',
  'deception',
  'masterpiece',
  'words',
  'survey',
  'putt',
  'tanks',
  'paddle',
  'snake',
  'bricks',
  'asteroids',
  'memory',
  'blocks',
  'tournament',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function openFloor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.af-cab')).toHaveCount(CABINETS.length);
  await expect(page.locator('.af-cab[aria-current="true"]')).toHaveCount(1);
}

/** Waits for any cabinet zoom (View Transition) to finish: pages ignore input while one runs. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.documentElement.dataset.vt, undefined, { timeout: 5_000 });
}

async function active(page: Page): Promise<string> {
  return (await page.locator('.af-cab[aria-current="true"]').getAttribute('data-cabinet')) ?? '';
}

async function expectActive(page: Page, id: string): Promise<void> {
  await expect(page.locator('.af-cab[aria-current="true"]')).toHaveAttribute('data-cabinet', id);
  await expect(page.locator('#plaque-title')).toHaveText(TITLES[id]!);
}

/** Moves the lineup with the on-screen arrows until `id` is centred. */
async function browseTo(page: Page, id: string): Promise<void> {
  for (let guard = 0; guard < CABINETS.length && (await active(page)) !== id; guard++) {
    const dir = CABINETS.indexOf(id) > CABINETS.indexOf(await active(page)) ? 'Next cabinet' : 'Previous cabinet';
    await page.getByRole('button', { name: dir }).click();
  }
  await expectActive(page, id);
}

/** A horizontal touch swipe across the lineup (real touches via CDP on Chromium, pointer events elsewhere). */
async function swipe(page: Page, browserName: string, dx: number): Promise<void> {
  const stage = (await page.locator('.af-lineup').boundingBox())!;
  const y = Math.round(stage.y + stage.height * 0.62);
  const x0 = Math.round(stage.x + stage.width / 2 - dx / 2);
  const steps = 10;
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / steps, y }] });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.evaluate(
      async ([x, yy, d, n]) => {
        const target = document.elementFromPoint(x, yy)!;
        const fire = (type: string, cx: number) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 41,
              pointerType: 'touch',
              isPrimary: true,
              clientX: cx,
              clientY: yy,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
            }),
          );
        fire('pointerdown', x);
        for (let i = 1; i <= n; i++) {
          await new Promise((r) => setTimeout(r, 20));
          fire('pointermove', x + (d * i) / n);
        }
        fire('pointerup', x + d);
      },
      [x0, y, dx, steps] as const,
    );
  }
}

test.describe('arcade lineup', () => {
  test('home loads with all eleven cabinets, the kiosk and the HUD', async ({ page }) => {
    await openFloor(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('DASCADE');
    for (const id of CABINETS) {
      await expect(page.getByRole('button', { name: new RegExp(`^${escape(TITLES[id]!)} — `) })).toBeAttached();
    }
    // Multi-game cabinets say what's inside without walking in.
    await expect(page.getByRole('button', { name: /^DASino — Cards & Casino, 1–30 players, 5 games$/ })).toBeAttached();
    await expect(page.locator('#cabinet-dasino')).toHaveAccessibleDescription(/Texas Hold'em, Blackjack, Roulette, Slots, High\/Low/);
    await expect(
      page.getByRole('region', { name: 'Arcade cabinets' }).or(page.locator('[aria-roledescription="carousel"]')).first(),
    ).toBeVisible();
    await expect(page.locator('[data-kiosk]:visible')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /Tournament Center/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Mute sound|Unmute sound/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Help and how to play' })).toBeVisible();
    await expect(page.getByText('Virtual chips only — no real money, ever.').first()).toBeAttached();
    // Fresh visitors land on the middle of the lineup.
    await expectActive(page, 'stravaganza');
    await expect(page.locator('.af-plaque__games li')).toHaveText([
      'DAStravaganza Trivia',
      'DASception',
      'DASterpiece',
      'DASwords',
      'DAS Survey',
    ]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('prev/next buttons and ←/→/Home/End keys move one cabinet at a time', async ({ page }) => {
    await openFloor(page);
    await expectActive(page, 'stravaganza');
    await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expectActive(page, 'putt');
    await page.getByRole('button', { name: 'Previous cabinet' }).click();
    await page.getByRole('button', { name: 'Previous cabinet' }).click();
    await expectActive(page, 'boardroom');
    // Keyboard (focus the centred cabinet, then browse with roving focus).
    await page.locator('#cabinet-boardroom').focus();
    await page.keyboard.press('ArrowRight');
    await expectActive(page, 'stravaganza');
    await expect(page.locator('#cabinet-stravaganza')).toBeFocused();
    await page.keyboard.press('Home');
    await expectActive(page, 'dasketch');
    await expect(page.getByRole('button', { name: 'Previous cabinet' })).toBeDisabled();
    await page.keyboard.press('End');
    await expectActive(page, 'quest');
    await expect(page.getByRole('button', { name: 'Next cabinet' })).toBeDisabled();
    await page.keyboard.press('ArrowLeft');
    await expectActive(page, 'circuit');
    await expect(page.locator('#cabinet-circuit')).toBeFocused();
    // Enter opens the centred cabinet (DAS Raceway holds two games → its picker).
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/cabinet\/circuit$/);
    await expect(page.getByRole('heading', { name: 'DAS Raceway', level: 1 })).toBeVisible();
  });

  test('clicking a neighbour centres it; clicking the centred cabinet opens it', async ({ page, isMobile }) => {
    await openFloor(page);
    const neighbour = page.locator('#cabinet-boardroom');
    const box = (await neighbour.boundingBox())!;
    const centre = (await page.locator('#cabinet-stravaganza').boundingBox())!;
    // A spot on the neighbour that the centred cabinet and the arrow buttons don't cover.
    const x = Math.max(60, Math.min(box.x + box.width * 0.45, centre.x - 12));
    const y = box.y + box.height * 0.72;
    if (isMobile) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await expectActive(page, 'boardroom');
    await expect(page).toHaveURL(/\/$/);
    await page.locator('#cabinet-boardroom').click();
    await expect(page).toHaveURL(/\/cabinet\/boardroom$/);
    await settled(page);
    await expect(page.getByRole('heading', { name: 'DAS Boardroom', level: 1 })).toBeVisible();
  });

  test('touch swipe moves the lineup and snaps to a cabinet', async ({ page, browserName, isMobile }) => {
    test.skip(!isMobile, 'touch swipes are exercised on the mobile projects');
    await openFloor(page);
    await expectActive(page, 'stravaganza');
    // A swipe of about two thirds of the spacing between two cabinets moves exactly one.
    const a = (await page.locator('#cabinet-stravaganza').boundingBox())!;
    const b = (await page.locator('#cabinet-putt').boundingBox())!;
    const step = Math.round(b.x + b.width / 2 - (a.x + a.width / 2));
    const dx = Math.round(step * 0.66);
    await swipe(page, browserName, -dx);
    await expect.poll(() => active(page)).toBe('putt');
    await expect(page).toHaveURL(/\/$/); // a swipe never opens a cabinet
    await page.waitForTimeout(700); // let it settle
    await swipe(page, browserName, dx);
    await expect.poll(() => active(page)).toBe('stravaganza');
    // Snapped: the centred cabinet sits in the middle of the stage.
    const stage = (await page.locator('.af-lineup').boundingBox())!;
    await expect
      .poll(async () => {
        const b = (await page.locator('#cabinet-stravaganza').boundingBox())!;
        return Math.abs(b.x + b.width / 2 - (stage.x + stage.width / 2));
      })
      .toBeLessThan(4);
  });

  test('mouse wheel and drag browse on desktop', async ({ page, isMobile }) => {
    test.skip(isMobile, 'wheel and mouse drag are desktop inputs');
    await openFloor(page);
    const stage = (await page.locator('.af-lineup').boundingBox())!;
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.wheel(0, 120);
    await expectActive(page, 'putt');
    await page.waitForTimeout(400); // a new gesture
    await page.mouse.wheel(-100, 0);
    await expectActive(page, 'stravaganza');
    // Drag left by about one cabinet and release slowly: it snaps to the next one without opening it.
    const y = stage.y + stage.height * 0.6;
    const x0 = stage.x + stage.width / 2 + 60;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(x0 - (190 * i) / 12, y);
      await page.waitForTimeout(24);
    }
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => active(page)).not.toBe('stravaganza');
    expect(CABINETS.indexOf(await active(page))).toBeGreaterThan(CABINETS.indexOf('stravaganza'));
    await expect(page).toHaveURL(/\/$/);
  });

  test('the floor never loads game modules or Phaser', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await openFloor(page);
    await page.getByRole('button', { name: 'Next cabinet' }).click();
    await page.waitForLoadState('networkidle');
    const gameChunks = urls.filter((u) => GAME_DIRS.some((id) => u.includes(`/games/${id}/`)) || /phaser/i.test(u));
    expect(gameChunks, gameChunks.join('\n')).toEqual([]);
  });

  test('reduced motion: the lineup still browses (instantly)', async ({ page }) => {
    await openFloor(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Display' }).click();
    const html = page.locator('html');
    if ((await html.getAttribute('data-reduced-motion')) !== 'true')
      await dialog.getByText('Reduce motion (calmer animations, no screen shake)').click();
    await expect(html).toHaveAttribute('data-reduced-motion', 'true');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Next cabinet' }).click();
    await expectActive(page, 'putt');
    // No 3D sweep: the neighbours carry no rotateY.
    const transform = await page.locator('.af-slot[data-index="5"]').evaluate((el) => (el as HTMLElement).style.transform);
    expect(transform).not.toContain('rotateY');
  });
});

test.describe('cabinets, pickers and title screens', () => {
  test('a multi-game cabinet opens its picker, which launches a title screen; Back returns to the right place', async ({ page }) => {
    await openFloor(page);
    await browseTo(page, 'dasino');
    await page.getByRole('button', { name: 'Open DASino' }).click();
    await expect(page).toHaveURL(/\/cabinet\/dasino$/);
    await expect(page.getByRole('heading', { name: 'DASino', level: 1 })).toBeVisible();
    await settled(page);
    const menu = page.locator('.cp__list');
    await expect(menu.getByRole('link')).toHaveCount(5);
    await expect(page.getByText('Virtual chips only — no real money, purchases or cash-out, ever.')).toBeVisible();
    await menu.getByRole('link', { name: /^Roulette — / }).click();
    await expect(page).toHaveURL(/\/play\/dasino\?table=roulette$/);
    await expect(page.getByRole('heading', { name: 'Roulette', level: 1 })).toBeVisible();
    await settled(page);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(/Arcade.*DASino.*Roulette/);
    await expect(page.getByRole('button', { name: 'Create game' })).toBeVisible();
    // Back → the DASino picker (Roulette remembered), then back → the floor centred on DASino.
    await page.getByRole('button', { name: 'Back to DASino' }).click();
    await expect(page).toHaveURL(/\/cabinet\/dasino$/);
    await expect(menu.getByRole('link', { name: /^Roulette — / })).toHaveClass(/is-selected/);
    await settled(page);
    await page.getByRole('button', { name: 'Arcade floor' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectActive(page, 'dasino');
  });

  test('the racing cabinet lists DASh Circuit and DASphalt GP, and DASh Circuit still launches from it', async ({ page }) => {
    await openFloor(page);
    await browseTo(page, 'circuit');
    await page.getByRole('button', { name: 'Open DAS Raceway' }).click();
    await expect(page).toHaveURL(/\/cabinet\/circuit$/);
    await expect(page.getByRole('heading', { name: 'DAS Raceway', level: 1 })).toBeVisible();
    await settled(page);
    const menu = page.locator('.cp__list');
    await expect(menu.getByRole('link')).toHaveCount(2);
    await expect(menu.getByRole('link', { name: /^DASh Circuit — / })).toBeVisible();
    await expect(menu.getByRole('link', { name: /^DASphalt GP — / })).toBeVisible();
    await menu.getByRole('link', { name: /^DASh Circuit — / }).click();
    await expect(page).toHaveURL(/\/play\/circuit$/);
    await expect(page.getByRole('heading', { name: 'DASh Circuit', level: 1 })).toBeVisible();
    await settled(page);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(/Arcade.*DAS Raceway.*DASh Circuit/);
    await expect(page.getByRole('button', { name: 'Create game' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to DAS Raceway' }).click();
    await expect(page).toHaveURL(/\/cabinet\/circuit$/);
    await menu.getByRole('link', { name: /^DASphalt GP — / }).click();
    await expect(page).toHaveURL(/\/play\/kart$/);
    await expect(page.getByRole('heading', { name: 'DASphalt GP', level: 1 })).toBeVisible();
  });

  test('a single-game cabinet opens its title screen and Back returns to the floor centred on it', async ({ page }) => {
    await openFloor(page);
    await browseTo(page, 'putt');
    await page.getByRole('button', { name: 'Play DAS Putt' }).click();
    await expect(page).toHaveURL(/\/play\/putt$/);
    await expect(page.getByRole('heading', { name: 'DAS Putt', level: 1 })).toBeVisible();
    await settled(page);
    await page.getByRole('button', { name: 'Back to the arcade floor' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expectActive(page, 'putt');
  });

  test('direct links and refreshes work', async ({ page }) => {
    await page.goto('/cabinet/boardroom');
    await expect(page.getByRole('heading', { name: 'DAS Boardroom', level: 1 })).toBeVisible();
    await expect(page.locator('.cp__list').getByRole('link')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Tournament Center' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'DAS Boardroom', level: 1 })).toBeVisible();
    await page
      .locator('.cp__list')
      .getByRole('link', { name: /^DAS Chess — / })
      .click();
    await expect(page).toHaveURL(/\/play\/chess$/);

    await page.goto('/play/chess');
    await expect(page.getByRole('heading', { name: 'DAS Chess', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(/DAS Boardroom/);
    await expect(page.getByRole('button', { name: /Tournament Center/ })).toBeVisible();

    await page.goto('/play/roulette');
    await expect(page).toHaveURL(/\/play\/dasino\?table=roulette$/);
    await expect(page.getByRole('heading', { name: 'Roulette', level: 1 })).toBeVisible();

    await page.goto('/cabinet/dasino');
    await expect(page.getByRole('heading', { name: 'DASino', level: 1 })).toBeVisible();

    // The Tournament Center kiosk isn't a cabinet game: its title-screen URL lands on the Center.
    await page.goto('/play/tournament');
    await expect(page).toHaveURL(/\/tournaments$/);

    // Single-game cabinets skip the picker; unknown cabinets explain themselves.
    await page.goto('/cabinet/putt');
    await expect(page).toHaveURL(/\/play\/putt$/);
    await page.goto('/cabinet/pinball');
    await expect(page.getByRole('heading', { name: 'No cabinet here' })).toBeVisible();
    await page.getByRole('link', { name: /Back to the arcade/ }).click();
    await expect(page).toHaveURL(/\/$/);

    // The legacy aliases still land on their title screens.
    await page.goto('/play/holdem');
    await expect(page.getByRole('heading', { name: "DAS Hold'em", level: 1 })).toBeVisible();
    await page.goto('/play/blackjack');
    await expect(page.getByRole('heading', { name: 'DASjack 21', level: 1 })).toBeVisible();
    await page.goto('/play/dasino');
    await expect(page.getByRole('heading', { name: 'DASino', level: 1 })).toBeVisible();
  });

  test('picker keyboard: arrows choose, Enter plays, Escape walks back', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard navigation of the picker is a desktop path');
    await page.goto('/cabinet/classics');
    const list = page.locator('.cp__list');
    await list.getByRole('link').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(list.getByRole('link', { name: /^Neon Snake — / })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Play Neon Snake' })).toBeVisible();
    await page.keyboard.press('End');
    await expect(list.getByRole('link', { name: /^Block Drop — / })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/play\/blocks$/);
    await settled(page);
    await page.getByRole('button', { name: 'Back to DAScade Classics' }).click();
    await expect(page).toHaveURL(/\/cabinet\/classics$/);
    await settled(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/$/);
    await expectActive(page, 'classics');
  });

  test('a DASino table link carries the table into the room once', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/play/dasino?table=slots');
    await setName(page, 'Table Hopper');
    await page.getByRole('button', { name: 'Play solo' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}$/);
    const me = await page.evaluate(() => (window as any).__DASCADE__.store.getState().playerId as string);
    await expect.poll(async () => (await roomState(page))?.seats?.[me]?.table, { timeout: 15_000 }).toBe('slots');
    await expect(page.getByRole('navigation', { name: 'DASino tables' }).locator('[aria-current="page"]')).toContainText('Slots');
    // A refresh restores the server-remembered table…
    await page.reload();
    await expect.poll(async () => (await roomState(page))?.seats?.[me]?.table, { timeout: 15_000 }).toBe('slots');
    await expect(page.getByRole('navigation', { name: 'DASino tables' }).locator('[aria-current="page"]')).toContainText('Slots');
    // …and the one-time request never drags you back after you walk elsewhere.
    await page.getByRole('navigation', { name: 'DASino tables' }).getByRole('button', { name: /Floor/ }).click();
    await expect.poll(async () => (await roomState(page)).seats[me].table).toBe('floor');
    await page.reload();
    await expect.poll(async () => (await roomState(page))?.seats?.[me]?.table, { timeout: 15_000 }).toBe('floor');
    await page.evaluate(() => (window as any).__DASCADE__?.session.leaveRoom());
  });
});

test.describe('floor HUD', () => {
  test('join modal rejects invalid and unknown codes with friendly errors', async ({ page }) => {
    await openFloor(page);
    await page
      .locator('button:visible')
      .filter({ hasText: /Join with code/ })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Join with a code' })).toBeVisible();
    await setName(page, 'Visitor');
    const code = dialog.getByLabel('Room code');
    await code.fill('AB2');
    await dialog.getByRole('button', { name: 'Join game' }).click();
    await expect(dialog.getByText('Room codes are 5 characters.')).toBeVisible();
    await code.fill('ZZZZZ');
    await dialog.getByRole('button', { name: 'Join game' }).click();
    await expect(dialog.getByText(/Room not found|arcade is offline/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('profile chip opens the profile editor', async ({ page }) => {
    await openFloor(page);
    await page.getByRole('button', { name: /Set your name|Profile:/ }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Your profile' })).toBeVisible();
    await setName(page, 'Neon Nina');
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: /Profile: Neon Nina/ })).toBeVisible();
  });

  test('the Tournament Center kiosk links to /tournaments', async ({ page }) => {
    await openFloor(page);
    await page.locator('[data-kiosk]:visible').click();
    await expect(page).toHaveURL(/\/tournaments$/);
  });
});

// The claw machine at the end of the row (and its close-up) has its own spec: e2e/claw.spec.ts.
