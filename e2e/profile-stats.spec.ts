/**
 * Profile → Stats: the overall summary (games played, different games, wins, most played) and the
 * per-game averages, rendered from a fixed /api/stats/me answer.
 */
import { expect, test } from '@playwright/test';

const GAMES = [
  // Most recent first, as the server sends them.
  {
    gameId: 'trivia',
    games: 2,
    wins: 1,
    losses: 1,
    draws: 0,
    podiums: 1,
    bestScore: 1500,
    lowerIsBetter: false,
    totalScore: 2500,
    scoredGames: 2,
    tournamentGames: 0,
    lastPlayedAt: Date.now() - 60_000,
    extras: { correctAnswers: 11 },
  },
  {
    gameId: 'blocks',
    games: 3,
    wins: 0,
    losses: 0,
    draws: 0,
    podiums: 0,
    bestScore: 4200,
    lowerIsBetter: false,
    totalScore: 9000,
    scoredGames: 3,
    tournamentGames: 0,
    lastPlayedAt: Date.now() - 120_000,
    extras: { maxLevel: 4, maxLines: 40 },
  },
  {
    gameId: 'circuit',
    games: 2,
    wins: 2,
    losses: 0,
    draws: 0,
    podiums: 0,
    bestScore: 61_000,
    lowerIsBetter: true,
    totalScore: 130_000,
    scoredGames: 2,
    tournamentGames: 0,
    lastPlayedAt: Date.now() - 180_000,
    extras: {},
  },
  {
    gameId: 'quest',
    games: 1,
    wins: 1,
    losses: 0,
    draws: 0,
    podiums: 0,
    bestScore: 300,
    lowerIsBetter: false,
    totalScore: 300,
    scoredGames: 1,
    tournamentGames: 0,
    lastPlayedAt: Date.now() - 240_000,
    extras: {},
  },
];

test('the Stats tab shows an overall summary and per-game averages', async ({ page }) => {
  await page.route('**/api/stats/me**', (route) =>
    route.fulfill({ json: { identity: 'guest', games: GAMES, ratings: [], persisted: false } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: /Set your name and avatar|^Profile: / }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Stats' }).click();

  const summary = dialog.locator('[data-part="stats-summary"]');
  await expect(summary).toBeVisible();
  const value = (label: string) =>
    summary
      .locator('div')
      .filter({ has: page.locator('dt', { hasText: label }) })
      .locator('dd');
  await expect(value('Games played')).toHaveText('8');
  await expect(value('Different games')).toHaveText('4');
  // DASQuest is co-op: its shared "win" isn't counted.
  await expect(value('Wins')).toHaveText('3');
  await expect(value('Most played')).toHaveText('Block Drop · 3 games');

  const card = (title: string) => dialog.locator('.ps-game').filter({ has: page.locator('.ps-game__title', { hasText: title }) });
  const stat = (title: string, label: string) =>
    card(title)
      .locator('dl > div')
      .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
      .locator('dd');
  await expect(stat('Block Drop', 'Average score')).toHaveText('3,000');
  await expect(stat('DAStravaganza Trivia', 'Average score')).toHaveText('1,250');
  await expect(stat('DASh Circuit', 'Average race time')).toHaveText('1:05.000');
  // One scored game: no average.
  await expect(card('DASQuest').locator('dt', { hasText: /^Average/ })).toHaveCount(0);
});
