import { expect, test, type Page } from '@playwright/test';
import { roomState } from './helpers';
import { backToClassics, myStanding, openSoloFromPicker, pressStart } from './classics-helpers';

/** Records the tiles that light up during the show stage (what a player sees), in order. */
async function watchPattern(page: Page, round: number): Promise<number[]> {
  await expect.poll(async () => {
    const s = await roomState(page);
    return s?.round === round && s?.stage === 'show';
  }, { timeout: 15_000 }).toBe(true);
  const seen: number[] = [];
  let last = '';
  for (;;) {
    const s = await roomState(page);
    if (s?.stage !== 'show') break;
    const lit = await page.$$eval('.mm-tile.is-lit', (els) => els.map((e) => Number((e.getAttribute('aria-label') ?? '').match(/Tile (\d+)/)?.[1] ?? 0) - 1));
    const key = lit.join(',');
    if (key && key !== last) {
      for (const t of lit) if (s.kind === 'sequence' || !seen.includes(t)) seen.push(t);
    }
    last = key;
    await page.waitForTimeout(40);
  }
  return seen;
}

test.describe('Memory Matrix', () => {
  test('solo from the Classics picker: answer a pattern, miss out, retry, back to Classics', async ({ page }) => {
    test.setTimeout(120_000);
    await openSoloFromPicker(page, /Memory Matrix/i, 'memory');
    // Pick sequence mode on the start card so round 1 is a sequence.
    await page.getByRole('radio', { name: 'Sequence' }).first().click();
    await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).variant).toBe('sequence');
    await pressStart(page);

    const tiles = await watchPattern(page, 1);
    expect(tiles.length).toBe(3);
    await expect(page.getByText('Your turn')).toBeVisible();
    for (const t of tiles) await page.getByRole('button', { name: new RegExp(`^Tile ${t + 1}(,|$)`) }).click();
    await expect.poll(async () => (await myStanding(page))?.stat, { timeout: 10_000 }).toBe(1);
    expect((await myStanding(page)).score).toBeGreaterThan(100);

    // Miss three rounds on purpose: tap a tile that is not the first one in the sequence.
    for (let round = 2; round <= 4; round++) {
      const pattern = await watchPattern(page, round);
      await expect.poll(async () => (await roomState(page))?.stage, { timeout: 15_000 }).toBe('input');
      const wrong = pattern[0] === 0 ? 1 : 0;
      await page.getByRole('button', { name: new RegExp(`^Tile ${wrong + 1}(,|$)`) }).click();
      await expect.poll(async () => (await myStanding(page))?.lives, { timeout: 10_000 }).toBe(3 - (round - 1));
    }
    await expect.poll(async () => (await myStanding(page))?.status, { timeout: 30_000 }).toBe('over');
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Play again' }).click();
    await expect.poll(async () => (await myStanding(page))?.runs, { timeout: 10_000 }).toBe(2);

    await backToClassics(page);
    await expect(page.getByRole('link', { name: /Memory Matrix/i }).first()).toBeVisible();
  });
});
