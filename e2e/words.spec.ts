import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { WordDictionary, solveGrid } from '../packages/game-core/src/words/index.ts';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers.ts';

// The test (not the browser) reads the shipped dictionary to know which words are on the board —
// exactly what a player would see and type. The browser itself never receives a word list.
const dict = WordDictionary.fromText(readFileSync(new URL('../apps/game-server/src/rooms/words/data/dascade-words.txt', import.meta.url), 'utf8'));

const playerId = (page: Page) => page.evaluate(() => (window as any).__DASCADE__.store.getState().playerId as string);

async function openSettings(page: Page) {
  const tab = page.getByRole('tab', { name: 'Settings' });
  if (await tab.isVisible({ timeout: 1500 }).catch(() => false)) await tab.click();
}

async function sendSettings(page: Page, settings: Record<string, unknown>) {
  await page.evaluate((s) => (window as any).__DASCADE__.session.send('lobby:settings', { settings: s }), settings);
  await expect.poll(async () => {
    const current = JSON.parse((await roomState(page))?.settingsJson ?? '{}');
    return Object.entries(settings).every(([k, v]) => current[k] === v);
  }).toBe(true);
}

async function guestFor(browser: Browser, code: string, testInfo: TestInfo): Promise<Page> {
  const use = testInfo.project.use;
  return joinRoom(browser, code, 'Guest', {
    baseURL: use.baseURL,
    viewport: use.viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
  });
}

/** Type into a word field the way a phone user would: with the on-screen keyboard covering the lower screen. */
async function typeWithKeyboardViewport(page: Page, label: string, word: string, isMobile: boolean) {
  const full = page.viewportSize();
  if (isMobile && full) await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });
  const input = page.getByRole('textbox', { name: label });
  await input.click();
  await expect(input).toBeInViewport();
  await input.fill(word);
  await input.press('Enter');
  if (isMobile && full) await page.setViewportSize(full);
}

test('DASwords Letter Grid: trace and type words, private until the reveal, podium, leave', async ({ page, browser }, testInfo) => {
  const host = page;
  const isMobile = Boolean(testInfo.project.use.isMobile);
  const code = await createRoom(host, 'words', 'Host');
  await openSettings(host);
  await host.getByRole('radio', { name: /Letter Grid/ }).click();
  await sendSettings(host, { mode: 'grid', rounds: 1, gridSize: 4, gridMinLength: 3 });
  const guest = await guestFor(browser, code, testInfo);
  await expect.poll(async () => Object.keys((await roomState(host))?.players ?? {}).length).toBe(2);

  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(async () => (await roomState(host))?.stage, { timeout: 15_000 }).toBe('play');
  const state = await roomState(host);
  const tiles = state.grid as string[];
  expect(tiles).toHaveLength(16);
  const words = [...solveGrid(tiles, dict, 3).entries()].filter(([w]) => dict.isCommon(w) && w.length >= 4).sort((a, b) => b[0].length - a[0].length);
  expect(words.length).toBeGreaterThan(3);
  const [traced, path] = words[0]!;
  const typed = words[1]![0];
  const guestWord = words[2]![0];

  // 1) Trace a word on the board (drag with a mouse, tap tile-by-tile on touch screens).
  const cells = host.getByTestId('words-board').locator('.wd-cell');
  const boxes = [];
  for (const i of path) boxes.push((await cells.nth(i).boundingBox())!);
  const center = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2] as const;
  if (isMobile) {
    for (const b of boxes) await host.touchscreen.tap(...center(b));
    await host.touchscreen.tap(...center(boxes[boxes.length - 1]!)); // tap the last tile again to submit
  } else {
    await host.mouse.move(...center(boxes[0]!));
    await host.mouse.down();
    for (const b of boxes.slice(1)) await host.mouse.move(...center(b), { steps: 4 });
    await host.mouse.up();
  }
  await expect(host.getByRole('listitem', { name: new RegExp(`^${traced}, Accepted`) })).toBeVisible();

  // 2) Type a word (phones: "Type instead", then the keyboard covers half the screen).
  const typeInstead = host.getByRole('button', { name: 'Type instead' });
  if (await typeInstead.isVisible().catch(() => false)) await typeInstead.click();
  await typeWithKeyboardViewport(host, 'Type a word', typed, isMobile);
  await expect(host.getByRole('listitem', { name: new RegExp(`^${typed}, Accepted`) })).toBeVisible();
  // Invalid words are refused with a reason.
  await typeWithKeyboardViewport(host, 'Type a word', 'zzqx', isMobile);
  await expect(host.getByText(/Can’t be traced on the grid|Not in the dictionary/).first()).toBeVisible();

  const hostId = await playerId(host);
  await expect.poll(async () => (await roomState(guest))?.progress?.[hostId]?.found).toBe(2);
  // The guest sees only a count — never the host's words.
  expect(JSON.stringify(await roomState(guest))).not.toContain(traced);

  const guestTypeInstead = guest.getByRole('button', { name: 'Type instead' });
  if (await guestTypeInstead.isVisible().catch(() => false)) await guestTypeInstead.click();
  await typeWithKeyboardViewport(guest, 'Type a word', guestWord, isMobile);
  await expect(guest.getByRole('listitem', { name: new RegExp(`^${guestWord}, Accepted`) })).toBeVisible();

  // Host ends the round → reveal shows everyone's words.
  await host.getByRole('button', { name: 'End round' }).click();
  await expect.poll(async () => (await roomState(host))?.stage).toBe('reveal');
  await expect(guest.getByRole('heading', { name: /words? found/ })).toBeVisible();
  const reveal = JSON.parse((await roomState(guest))?.revealJson);
  expect(reveal.players.find((p: any) => p.id === hostId).words.map((w: any) => w.w)).toEqual(expect.arrayContaining([traced, typed]));

  await host.getByRole('button', { name: 'Final results' }).click();
  await waitForPhase(host, 'RESULTS');
  await expect(host.getByRole('heading', { name: /wins!|tie/ })).toBeVisible();
  await leaveRoom(guest);
  await leaveRoom(host);
});

test('DASwords Word Chain: link words with the on-screen keyboard up, lose a heart, leave', async ({ page, browser }, testInfo) => {
  const host = page;
  const isMobile = Boolean(testInfo.project.use.isMobile);
  const code = await createRoom(host, 'words', 'Host');
  await openSettings(host);
  await host.getByRole('radio', { name: /Word Chain/ }).click();
  await sendSettings(host, { mode: 'chain', rounds: 1, chainLives: 1, chainSeconds: 12 });
  const guest = await guestFor(browser, code, testInfo);
  await expect.poll(async () => Object.keys((await roomState(host))?.players ?? {}).length).toBe(2);

  await startGame(host);
  await expect.poll(async () => (await roomState(host))?.stage, { timeout: 15_000 }).toBe('link');
  const s = await roomState(host);
  const prefix = s.chainPrefix as string;
  const answer = dict.wordsWithPrefix(prefix, (w) => w.length >= 6 && dict.isCommon(w) && w !== s.chainWord)[0]!;

  // A wrong start is refused (the field is pre-filled with the link letters; replace them).
  await typeWithKeyboardViewport(host, 'Your link word', prefix === 'z' ? 'apple' : 'zebra', isMobile);
  await expect(host.getByText('Doesn’t link to the chain').first()).toBeVisible();
  await typeWithKeyboardViewport(host, 'Your link word', answer, isMobile);
  await expect(host.getByText(/Locked in/)).toBeVisible();
  const hostId = await playerId(host);
  await expect.poll(async () => (await roomState(guest))?.seats?.[hostId]?.answered).toBe(true);

  // The guest never answers → loses their only heart when the link closes; the chain ends.
  await expect.poll(async () => (await roomState(host))?.stage, { timeout: 40_000 }).toMatch(/linkReveal|reveal/);
  // One heart and no answer: the guest is out, the chain ends and the host survives.
  await expect.poll(async () => (await roomState(host))?.revealJson ?? '', { timeout: 30_000 }).not.toBe('');
  const reveal = JSON.parse((await roomState(host))!.revealJson);
  expect(reveal.survivors).toEqual([hostId]);
  expect(reveal.players.find((p: any) => p.id === hostId).words.map((w: any) => w.w)).toContain(answer);
  await expect(guest.getByRole('heading', { name: /chain of/ })).toBeVisible();
  await leaveRoom(guest);
  await leaveRoom(host);
});
