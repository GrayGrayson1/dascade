/**
 * DAS Survey Showdown — the Awards desk and ceremony (Production Desk, Awards A). After the quiz the
 * presenter fills in an award (names and a photo, shrunk in the browser), starts the ceremony, and
 * steps it: the title, the award, 3rd → 2nd → 1st on the podium with the drumroll and the applause,
 * fireworks over the last winner, then Thanks for playing. Phones say "Awards on stage"; no name or
 * photo ever reaches the room. Rehearsal boards only; the photo is drawn at run time.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, roomState, startGame, waitForPhase } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'The presenter runs the ceremony from a laptop; the phone is checked here too.');

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

/** A 1200×800 test picture (a pumpkin-ish circle on purple), drawn in a blank page. */
async function makePhoto(page: Page): Promise<Buffer> {
  const gen = await page.context().newPage();
  const b64 = await gen.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 800;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3b1458';
    g.fillRect(0, 0, 1200, 800);
    g.fillStyle = '#ff8a3d';
    g.beginPath();
    g.arc(600, 420, 300, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await gen.close();
  return Buffer.from(b64, 'base64');
}

test('the awards: names and a photo in the console, the ceremony on the stage window, phones told; nothing reaches the room', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const host = page;
  await host.setViewportSize({ width: 1280, height: 900 });
  const code = await createRoom(host, 'showdown', 'Host');
  const settingsTab = host.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await host.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).mode).toBe('showcase');
  const phone = await joinRoom(browser, code, 'Ada', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const [stageWin] = await Promise.all([host.waitForEvent('popup'), host.locator('[data-part="showdown-stage-window"]').first().click()]);
  await stageWin.setViewportSize({ width: 1280, height: 720 });

  // A quick show, finished.
  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(async () => (await board(host))?.stage).toBe('intro');
  await send(host, 'showdown:act', { a: 'finish', rev: (await board(host)).rev });
  await waitForPhase(host, 'RESULTS');

  // The Awards desk on the results screen: three names and a photo for Best Costume.
  const desk = host.locator('[data-part="showdown-results-awards"]');
  await expect(desk).toBeVisible();
  const costume = desk.locator('[data-part="showdown-award"]').first();
  const names = ['Morgan R.', 'Sam P.', 'Alex K.'];
  for (const [i, name] of names.entries()) await costume.locator('[data-part="showdown-award-name"]').nth(i).fill(name);
  await costume
    .locator('[data-part="showdown-award-file"]')
    .first()
    .setInputFiles({ name: 'winner.png', mimeType: 'image/png', buffer: await makePhoto(host) });
  await expect(costume.locator('[data-part="showdown-award-photo"] img').first()).toBeVisible();
  // Nothing on the share yet.
  expect((await roomState(host)).card).not.toBe('awards');

  // Start: the title on the stage window; phones are told.
  await desk.locator('[data-part="showdown-awards-start"]').click();
  await expect.poll(async () => (await roomState(host)).card).toBe('awards');
  const awards = stageWin.locator('[data-part="showdown-awards"]');
  await expect(awards).toHaveAttribute('data-step', 'title');
  await expect(awards).toContainText('DAS-O-Ween Awards');
  await expect(phone.locator('[data-part="showdown-results-awards"]')).toHaveCount(0);
  await expect(phone.getByText('Awards on stage').first()).toBeVisible();
  await stageWin.waitForTimeout(1400); // the scene curtain opens first
  await shot(stageWin, 'awards-title');

  const next = desk.locator('[data-part="showdown-awards-next"]');
  await next.click();
  await expect(awards).toHaveAttribute('data-step', 'category');
  await expect(awards).toContainText('Best Costume');
  await expect(awards).not.toContainText('Morgan R.');

  // 3rd, 2nd, 1st: each after its drumroll.
  for (const [step, name] of [
    ['place-3', 'Alex K.'],
    ['place-2', 'Sam P.'],
    ['place-1', 'Morgan R.'],
  ] as const) {
    await next.click();
    await expect(desk.locator('[data-part="showdown-awards-now"]')).toContainText('drumroll');
    await expect(awards).toHaveAttribute('data-step', step, { timeout: 6_000 });
    await expect(awards).toContainText(name);
  }
  // The winner's photo, shrunk to at most 640 px in this browser; then the fireworks.
  const img = awards.locator('[data-rank="1"] img');
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => Math.max(el.naturalWidth, el.naturalHeight))).toBeLessThanOrEqual(640);
  await expect(stageWin.locator('[data-part="showdown-fireworks"]')).toBeVisible();
  await stageWin.waitForTimeout(1100);
  await shot(stageWin, 'awards-first');

  // Then Thanks for playing.
  await next.click();
  await expect.poll(async () => (await roomState(host)).card).toBe('thanks');

  // No name, photo or award ever went to the room.
  const state = JSON.stringify(await roomState(phone));
  for (const name of names) expect(state).not.toContain(name);
  expect(state).not.toContain('Best Costume');
  expect(state).not.toContain('blob:');

  // The desk survives a console reload (this browser keeps it).
  await host.reload();
  await waitForPhase(host, 'RESULTS');
  await expect(host.locator('[data-part="showdown-results-awards"] [data-part="showdown-award-name"]').first()).toHaveValue('Morgan R.');
  await phone.context().close();
});
