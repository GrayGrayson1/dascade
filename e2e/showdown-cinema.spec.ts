/**
 * DAS Survey Showdown — stage scenes and the local cinema (Production Desk: Scenes A + Video A). The
 * presenter loads a video from their own computer, Cinema (V) plays it in a frame in the stage window
 * (the window Teams shares), phones say "Cartoon break", and Show (B) brings the board back exactly as
 * it was with the round clock paused. The video is made in the browser at run time (no file in the
 * repo) and never leaves it.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createRoom, joinRoom, roomState, startGame, waitForPhase } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'The presenter runs the show (and its stage window) from a laptop; the phone is checked here too.');

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

/** A three-second test video (moving colour + a tone), recorded in a blank page of this browser. */
async function makeClip(ctx: BrowserContext): Promise<Buffer> {
  const gen = await ctx.newPage();
  const b64 = await gen.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const g = canvas.getContext('2d')!;
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const out = audio.createMediaStreamDestination();
    tone.connect(out);
    tone.start();
    const stream = new MediaStream([...canvas.captureStream(15).getVideoTracks(), ...out.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    let n = 0;
    const draw = setInterval(() => {
      g.fillStyle = `hsl(${(n * 25) % 360} 70% 45%)`;
      g.fillRect(0, 0, 320, 240);
      g.fillStyle = '#fff';
      g.font = '48px sans-serif';
      g.fillText(String(n++), 140, 140);
    }, 66);
    rec.start(250);
    await new Promise((r) => setTimeout(r, 3000));
    const done = new Promise((r) => (rec.onstop = r));
    rec.stop();
    await done;
    clearInterval(draw);
    tone.stop();
    await audio.close();
    const bytes = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  await gen.close();
  return Buffer.from(b64, 'base64');
}

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test('Cinema plays the presenter’s own video in the stage window; phones get the break card; Show brings the board back', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const host = page;
  await host.setViewportSize({ width: 1280, height: 720 });
  const code = await createRoom(host, 'showdown', 'Host');
  const settingsTab = host.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await host.getByRole('button', { name: /^Load DAS-O-Ween rehearsal/ }).click();
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).mode).toBe('showcase');
  const phone = await joinRoom(browser, code, 'Ada', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(async () => (await board(host))?.stage).toBe('intro');
  await send(host, 'showdown:act', { a: 'begin', rev: (await board(host)).rev });
  await expect.poll(async () => (await board(host))?.stage).toBe('title');
  await send(host, 'showdown:act', { a: 'question', rev: (await board(host)).rev });
  await expect.poll(async () => (await board(host))?.stage).toBe('live');
  await send(host, 'showdown:act', { a: 'clock', op: 'start' });
  await expect.poll(async () => (await roomState(host)).clockEndsAt).toBeGreaterThan(0);
  const before = await board(host);

  // V with nothing loaded opens the Cinema tab and leaves the stage alone.
  await blur(host);
  await host.keyboard.press('v');
  await expect(host.locator('[data-part="showdown-cinema-panel"]')).toBeVisible();
  expect((await roomState(host)).card).toBe('');

  // The stage window, then a video from "this computer".
  const [stageWin] = await Promise.all([
    host.waitForEvent('popup'),
    host
      .getByRole('button', { name: /Stage window/ })
      .first()
      .click(),
  ]);
  await stageWin.setViewportSize({ width: 1280, height: 720 });
  await expect(stageWin.locator('.sd-stage').first()).toBeVisible();
  const clip = await makeClip(host.context());
  await host
    .locator('[data-part="showdown-cinema-file"]')
    .setInputFiles({ name: 'cartoon-break.webm', mimeType: 'video/webm', buffer: clip });
  await expect(host.locator('[data-part="showdown-cinema-status"]')).toContainText('cartoon-break.webm');

  // V: Cinema is on every stage; the round clock stopped where it was.
  await blur(host);
  await host.keyboard.press('v');
  await expect.poll(async () => (await roomState(host)).card).toBe('cinema');
  await expect.poll(async () => (await roomState(host)).clockEndsAt).toBe(0);
  const cinema = stageWin.locator('[data-part="showdown-cinema"]');
  await expect(cinema).toBeVisible();
  await expect(cinema).toHaveAttribute('data-frame', 'tv');
  await expect(phone.locator('[data-part="showdown-scene-card"]')).toContainText('Cartoon break');
  await expect(host.locator('[data-part="showdown-scene-up"]')).toBeVisible();

  // Play: the video runs in the stage window (and only there).
  await host.locator('[data-part="showdown-cinema-play"]').click();
  await expect
    .poll(() => cinema.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 })
    .toBeGreaterThan(0.4);
  await expect(cinema).toHaveAttribute('data-playing', 'true');
  await expect(host.locator('[data-part="showdown-cinema-status"]')).toContainText('Playing');
  expect(await host.locator('video').count()).toBe(0);
  expect(await phone.locator('video').count()).toBe(0);
  await stageWin.waitForTimeout(1200);
  await shot(stageWin, 'cinema-tv');
  await shot(host, 'console-cinema');
  await shot(phone, 'phone-cinema');

  // The frames.
  for (const [frame, title] of [
    ['cinema', 'Haunted cinema'],
    ['portrait', 'Gilded portrait'],
  ] as const) {
    await host.locator('[data-part="showdown-cinema-panel"]').getByRole('button', { name: title }).click();
    await expect(cinema).toHaveAttribute('data-frame', frame);
    await shot(stageWin, `cinema-${frame}`);
  }

  // B: the board exactly as it was, the clock still paused, the video stopped and gone from the share.
  await blur(host);
  await host.keyboard.press('b');
  await expect.poll(async () => (await roomState(host)).card).toBe('');
  await expect(cinema).toBeHidden();
  expect(await cinema.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(await board(host)).toEqual(before);
  expect((await roomState(host)).clockEndsAt).toBe(0);
  await expect(phone.locator('[data-part="showdown-scene-card"]')).toHaveCount(0);
  await shot(stageWin, 'back-to-show');

  // Nothing about the video reached the room.
  const state = JSON.stringify(await roomState(host));
  expect(state).not.toContain('cartoon-break');
  expect(state).not.toContain('blob:');
  await phone.context().close();
});
