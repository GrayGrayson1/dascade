/**
 * DAS Survey Showdown — stage scenes and the local cinema (Production Desk: Scenes A + Video A). The
 * presenter loads a video from their own computer, Cinema (V) plays it in a frame in the stage window
 * (the window Teams shares), phones say "Cartoon break", and Show (B) brings the board back exactly as
 * it was with the round clock paused. The video is made in the browser at run time (no file in the
 * repo) and never leaves it. The TV frame never clips the video (it stuttered on a presenter's
 * laptop), the stage under Cinema stops rendering, and the console's transport (seek bar, ±10 s)
 * moves the video. The Cinema tab fits the drawer and a wider panel without a sideways scroll.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createRoom, joinRoom, roomState, startGame, waitForPhase } from './helpers.ts';

test.skip(({ isMobile }) => isMobile, 'The presenter runs the show (and its stage window) from a laptop; the phone is checked here too.');

const SHOTS = process.env.SHOTS_DIR ?? '';
async function shot(page: Page | Locator, name: string): Promise<void> {
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

/** The video's place in the clip (seconds). */
const at = (video: Locator) => video.evaluate((v: HTMLVideoElement) => v.currentTime);

/** True when nothing scrolls sideways: the drawer's body and the tab itself fit their width. */
const fitsWidth = (panel: Locator) =>
  panel.evaluate((el) => {
    const body = el.closest('.sdc-drawer__body') ?? el.parentElement!;
    return body.scrollWidth <= body.clientWidth + 1 && el.scrollWidth <= el.clientWidth + 1;
  });

/**
 * How the video is shown: whether anything from it up to the Cinema layer clips it with rounded
 * corners, a clip-path or a mask (a per-frame masked composite), and where the TV's bezel overlay is.
 */
const videoClipping = (video: Locator) =>
  video.evaluate((v: HTMLVideoElement) => {
    const rounded: string[] = [];
    for (let el: Element | null = v; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const clips = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.contain.includes('paint') || cs.contain === 'strict';
      const radius = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].some(
        (k) => parseFloat(cs[k as 'borderTopLeftRadius']) > 0,
      );
      if ((el === v && radius) || (clips && radius) || cs.clipPath !== 'none' || (cs.maskImage && cs.maskImage !== 'none'))
        rounded.push(el.className || el.tagName);
      if (el.classList.contains('sd-cinema')) break;
    }
    const bezel = v.parentElement!.querySelector<HTMLElement>('.sd-cinema__bezel');
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round).join(',');
    };
    const bs = bezel ? getComputedStyle(bezel) : null;
    return {
      rounded,
      bezel: bs
        ? { display: bs.display, pointerEvents: bs.pointerEvents, over: Number(bs.zIndex) > 0, sameBox: box(bezel!) === box(v) }
        : null,
    };
  });

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

  // While Cinema is up, the stage under it stops rendering (it is covered; its animations would redraw
  // the window every frame).
  const stageRoot = stageWin.locator('.sd-window__root');
  expect(await stageRoot.evaluate((el) => getComputedStyle(el).contentVisibility)).toBe('hidden');

  // Play: the video runs in the stage window (and only there).
  const video = cinema.locator('video');
  await host.locator('[data-part="showdown-cinema-play"]').click();
  await expect.poll(() => at(video), { timeout: 10_000 }).toBeGreaterThan(0.4);
  await expect(cinema).toHaveAttribute('data-playing', 'true');
  await expect(host.locator('[data-part="showdown-cinema-status"]')).toContainText('Playing');
  expect(await host.locator('video').count()).toBe(0);
  expect(await phone.locator('video').count()).toBe(0);

  // The Retro TV never clips the video: a plain rectangle under a still bezel overlay that rounds its
  // corners (and lets clicks through).
  expect(await videoClipping(video)).toEqual({
    rounded: [],
    bezel: { display: 'block', pointerEvents: 'none', over: true, sameBox: true },
  });
  await stageWin.waitForTimeout(1200);
  await shot(stageWin, 'cinema-tv');
  await shot(host, 'console-cinema');
  await shot(phone, 'phone-cinema');

  // The frames (none clips the video either; only the TV has a bezel).
  for (const [frame, title] of [
    ['cinema', 'Haunted cinema'],
    ['portrait', 'Gilded portrait'],
  ] as const) {
    await host.locator('[data-part="showdown-cinema-panel"]').getByRole('button', { name: title }).click();
    await expect(cinema).toHaveAttribute('data-frame', frame);
    expect((await videoClipping(video)).rounded).toEqual([]);
    expect((await videoClipping(video)).bezel?.display).toBe('none');
    await shot(stageWin, `cinema-${frame}`);
  }

  // The transport. The test clip learns its length at its end (a recorded .webm), so let it end once.
  const panel = host.locator('[data-part="showdown-cinema-panel"]');
  const status = host.locator('[data-part="showdown-cinema-status"]');
  const seek = panel.getByRole('slider', { name: 'Seek' });
  await expect(status).toContainText('Ended', { timeout: 15_000 });
  await expect(panel.getByRole('button', { name: 'Play again' })).toBeVisible();
  await expect(seek).toBeEnabled();
  const length = await video.evaluate((v: HTMLVideoElement) => v.duration);
  expect(length).toBeGreaterThan(2);
  await expect(host.locator('[data-part="showdown-cinema-length"]')).toHaveText(/^0:0[23]$/);

  // Back 10 s from the end: the start (held there), and no longer "Ended".
  await panel.getByRole('button', { name: 'Back 10 s' }).click();
  await expect.poll(() => at(video)).toBeLessThan(0.05);
  await expect(status).toContainText('Ready');
  // The seek bar is a slider: arrows ±5 s, Page Up/Down ±10 s, Home and End (this clip is short, so
  // every step lands on its start or its end).
  await seek.focus();
  await host.keyboard.press('ArrowRight');
  await expect.poll(() => at(video)).toBeGreaterThan(length - 0.05);
  await expect(status).toContainText('Ended');
  await host.keyboard.press('ArrowLeft');
  await expect.poll(() => at(video)).toBeLessThan(0.05);
  await expect(seek).toHaveAttribute('aria-valuetext', /^0:00 of 0:0[23]$/);
  await host.keyboard.press('End');
  await expect.poll(() => at(video)).toBeGreaterThan(length - 0.05);
  await host.keyboard.press('PageDown');
  await expect.poll(() => at(video)).toBeLessThan(0.05);
  // A click on the bar jumps there (its middle here), and lets go of the focus for the console's keys.
  const bar = (await seek.boundingBox())!;
  await host.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect.poll(() => at(video)).toBeGreaterThan(length * 0.35);
  expect(await at(video)).toBeLessThan(length * 0.65);
  await expect(seek).toHaveAttribute('aria-valuetext', /^0:01 of 0:0[23]$/);
  await expect(host.locator('[data-part="showdown-cinema-time"]')).toHaveText('0:01');
  expect(await seek.evaluate((el) => el === document.activeElement)).toBe(false);
  // Playing: back 10 s goes to the start and keeps playing; forward 10 s runs to the end.
  await host.locator('[data-part="showdown-cinema-restart"]').click();
  await expect.poll(() => at(video)).toBeLessThan(0.05);
  await host.locator('[data-part="showdown-cinema-play"]').click();
  await expect(status).toContainText('Playing');
  await expect.poll(() => at(video)).toBeGreaterThan(1.2);
  await panel.getByRole('button', { name: 'Back 10 s' }).click();
  await expect.poll(() => at(video)).toBeLessThan(1);
  await expect(cinema).toHaveAttribute('data-playing', 'true');
  await panel.getByRole('button', { name: 'Forward 10 s' }).click();
  await expect(status).toContainText('Ended');
  expect(await at(video)).toBeGreaterThan(length - 0.2);

  // The tab fits the drawer: a long file name is cut short (whole in its tooltip), its delete button
  // stays on its row, the frames are one row of three, and nothing scrolls sideways.
  const long = 'TheMadDoctor1933MickeyMouseSoundCartoon-the-skeleton-dance_1929.ia-restored-1080p.webm';
  await host.locator('[data-part="showdown-cinema-file"]').setInputFiles({ name: long, mimeType: 'video/webm', buffer: clip });
  const longRow = panel.locator('[data-part="showdown-cinema-clip"]').filter({ hasText: 'TheMadDoctor' });
  await expect(longRow).toBeVisible();
  await expect(longRow.locator('label')).toHaveAttribute('title', long);
  expect(await longRow.locator('.sdc-cinema__name').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const rowBox = (await longRow.boundingBox())!;
  const trashBox = (await longRow.getByRole('button', { name: `Remove ${long}` }).boundingBox())!;
  expect(trashBox.y).toBeGreaterThanOrEqual(rowBox.y);
  expect(trashBox.y + trashBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
  expect(rowBox.height).toBeLessThan(56);
  const frameTops = await panel
    .locator('.sdc-cinema__frames > button')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(frameTops).size).toBe(1);
  expect(await fitsWidth(panel)).toBe(true);
  const drawer = host.locator('[data-part="showdown-drawer"]', { has: panel });
  await host.setViewportSize({ width: 1280, height: 1280 }); // tall enough to see the whole tab
  expect(await fitsWidth(panel)).toBe(true);
  await shot(drawer, 'console-cinema-tab');

  // A wider panel (the dashboard to come): two columns, still no sideways scroll.
  await drawer.evaluate((el: HTMLElement) => {
    el.style.cssText +=
      ';position:fixed;top:56px;right:12px;width:660px;max-width:none;height:560px;z-index:99;background:var(--panel-bg-opaque,#1a1230)';
  });
  const videosBox = (await panel.locator('.sdc-cinema__videos').boundingBox())!;
  const runBox = (await panel.locator('.sdc-cinema__run').boundingBox())!;
  expect(runBox.x).toBeGreaterThan(videosBox.x + videosBox.width - 1);
  expect(await fitsWidth(panel)).toBe(true);
  await shot(drawer, 'console-cinema-tab-wide');
  await drawer.evaluate((el: HTMLElement) => {
    for (const p of ['position', 'top', 'right', 'width', 'max-width', 'height', 'z-index', 'background']) el.style.removeProperty(p);
  });
  await host.setViewportSize({ width: 1280, height: 720 });
  await panel.getByRole('button', { name: `Remove ${long}` }).click();
  await expect(longRow).toHaveCount(0);

  // B: the board exactly as it was, the clock still paused, the video stopped and gone from the share.
  await blur(host);
  await host.keyboard.press('b');
  await expect.poll(async () => (await roomState(host)).card).toBe('');
  await expect(cinema).toBeHidden();
  expect(await cinema.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  expect(await stageRoot.evaluate((el) => getComputedStyle(el).contentVisibility)).toBe('visible');
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
