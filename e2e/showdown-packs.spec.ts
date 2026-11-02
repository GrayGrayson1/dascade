/**
 * DAS Survey Showdown — the question packs in the lobby (Z2): the seasonal Harvest and Winter packs
 * sit next to Halloween, each with its own icon, and the regular packs hold 10 questions each. Only
 * metadata reaches the client; the answers stay on the server.
 */
import { expect, test, type Page } from '@playwright/test';
import { createRoom } from './helpers.ts';

/** Phones show one lobby section at a time: open the one that holds `target`. */
async function showLobbySection(page: Page, tab: 'Settings' | 'Setup'): Promise<void> {
  const t = page.getByRole('tab', { name: tab });
  if (await t.isVisible().catch(() => false)) await t.click();
}

test('the lobby offers Harvest 🍂 and Winter ❄️ next to Halloween 🎃; the regular packs hold 10 questions', async ({ page }) => {
  await createRoom(page, 'showdown', 'Marcus');
  await showLobbySection(page, 'Settings');
  const packs = page.getByRole('group', { name: 'Question packs' });
  const pack = (title: string) => packs.getByRole('button', { name: new RegExp(`^${title}`) });
  await expect(pack('Halloween Spooktacular')).toContainText('🎃');
  await expect(pack('Harvest & Gratitude')).toContainText('🍂');
  await expect(pack('Harvest & Gratitude')).toContainText('8 questions');
  await expect(pack('Winter Holidays & Snow Days')).toContainText('❄️');
  await expect(pack('Winter Holidays & Snow Days')).toContainText('10 questions');
  for (const title of ['Office Life', 'Tech Talk', 'Snack Attack', 'Life & Leisure']) {
    await expect(pack(title)).toContainText('10 questions');
    await expect(pack(title)).not.toContainText(/[🎃🍂❄]/u);
  }
  // A seasonal pack toggles like any other (in December a new room starts with Winter on).
  const winter = pack('Winter Holidays & Snow Days');
  const before = await winter.getAttribute('aria-pressed');
  await winter.click();
  await expect(winter).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
});
