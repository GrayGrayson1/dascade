import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers.ts';

const playerId = (page: Page) => page.evaluate(() => (window as any).__DASCADE__.store.getState().playerId as string);
const opCount = (page: Page) => page.evaluate(() => (window as any).__DASKETCH__?.ops() ?? 0);

test('DASketch: create, join, choose a word, draw, guess it, reveal, leave', async ({ page, browser }, testInfo) => {
  const host = page;
  const code = await createRoom(host, 'dasketch', 'Host');

  // Configure a tiny custom-only word list through the lobby UI.
  const settingsTab = host.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible().catch(() => false)) await settingsTab.click();
  const words = host.getByRole('textbox', { name: 'Custom words' });
  await words.fill('pineapple\nlighthouse');
  await words.blur();
  await expect.poll(async () => (await roomState(host))?.customCount).toBe(2);
  // The switch is server-controlled (it flips when the host's settings round-trip), so click its label.
  await host.getByText('Only use custom words').click();
  await expect.poll(async () => JSON.parse((await roomState(host)).settingsJson).customOnly).toBe(true);

  const use = testInfo.project.use;
  const guest = await joinRoom(browser, code, 'Guest', {
    baseURL: use.baseURL,
    viewport: use.viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
  });
  await expect.poll(async () => Object.keys((await roomState(host)).players).length).toBe(2);
  // Players never receive the custom list.
  expect(JSON.stringify(await roomState(guest))).not.toContain('lighthouse');

  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(async () => (await roomState(host)).stage, { timeout: 15_000 }).toBe('choosing');

  const artistId = (await roomState(host)).artistId as string;
  const [artist, guesser] = (await playerId(host)) === artistId ? [host, guest] : [guest, host];

  // The artist privately picks a word; the guesser only sees "choosing".
  const choice = artist.getByRole('button', { name: /^Draw “/ }).first();
  await expect(choice).toBeVisible();
  const label = (await choice.getAttribute('aria-label'))!;
  const word = label.slice('Draw “'.length, -1);
  expect(['pineapple', 'lighthouse']).toContain(word);
  await expect(guesser.getByRole('heading', { name: /is choosing a word/ })).toBeVisible();
  await expect(guesser.getByRole('button', { name: /^Draw “/ })).toHaveCount(0);
  await choice.click();
  await expect.poll(async () => (await roomState(host)).stage).toBe('drawing');
  await expect(artist.getByRole('img', { name: `Your word: ${word}` })).toBeVisible();
  expect((await roomState(guesser)).hint).toBe('_'.repeat(word.length));

  // Draw a stroke and a rectangle; the guesser's canvas receives the ops.
  const surface = artist.getByTestId('sketch-surface');
  const box = (await surface.boundingBox())!;
  await artist.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await artist.mouse.down();
  await artist.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 8 });
  await artist.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, { steps: 8 });
  await artist.mouse.up();
  await artist.getByRole('radio', { name: /^Rectangle/ }).click();
  await artist.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await artist.mouse.down();
  await artist.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85, { steps: 4 });
  await artist.mouse.up();
  await expect.poll(() => opCount(guesser)).toBe(2);

  // The guesser guesses correctly in chat.
  const input = guesser.getByRole('textbox', { name: 'Type your guess' });
  await input.fill(word.toUpperCase());
  await input.press('Enter');
  await expect(guesser.getByRole('img', { name: `You guessed it: ${word}` })).toBeVisible();
  await expect(artist.getByText('Guest guessed the word!').or(artist.getByText('Host guessed the word!')).first()).toBeVisible();

  // Everyone guessed → the turn ends and the word is revealed to all.
  await waitForPhase(host, 'INTERMISSION');
  await expect(guesser.getByRole('heading', { name: word })).toBeVisible();
  const scored = await roomState(host);
  expect(scored.players[await playerId(guesser)].score).toBeGreaterThan(0);
  expect(scored.players[artistId].score).toBeGreaterThan(0);

  await leaveRoom(guest);
  await leaveRoom(host);
  await expect(host).toHaveURL(/\/$/);
});
