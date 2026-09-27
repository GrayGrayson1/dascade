import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, leaveRoom, roomState, startGame, waitForPhase } from './helpers';
import { backToClassics, myStanding, openSoloFromPicker, pressStart } from './classics-helpers';

test.describe('Block Drop', () => {
  test('solo from the Classics picker: play, pause, top out (server-verified), retry, back to Classics', async ({ page }, info) => {
    test.setTimeout(120_000);
    await openSoloFromPicker(page, /Block Drop/i, 'blocks');
    await expect(page.getByRole('heading', { name: 'Block Drop' }).first()).toBeVisible();
    await pressStart(page);
    // READY… GO, then the well is live.
    await expect(page.getByRole('img', { name: 'Block Drop well' })).toBeVisible();
    await page.waitForTimeout(1_800);
    const mobile = info.project.name.startsWith('mobile');
    if (mobile) {
      await page.getByRole('button', { name: 'Rotate right' }).tap();
      await page.getByRole('button', { name: 'Move left' }).tap();
      await page.getByRole('button', { name: 'Hard drop' }).tap();
    } else {
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Space');
    }
    // The server replays the input log: the hard drop's points show up in the verified standings.
    await expect.poll(async () => (await myStanding(page))?.score ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);

    // Pause and resume.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();

    // Top out fast with hard drops.
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Space');
      if ((await myStanding(page))?.status === 'over') break;
      await page.waitForTimeout(40);
    }
    await expect.poll(async () => (await myStanding(page))?.status, { timeout: 20_000 }).toBe('over');
    await expect(page.getByText('Server verified')).toBeVisible();
    const final = await myStanding(page);
    expect(final.lives).toBe(0);
    await expect(page.getByLabel(`Final score ${final.score.toLocaleString("en-US")}`, { exact: true })).toBeVisible();

    // Retry = a fresh run in the same room.
    await page.getByRole('button', { name: 'Play again' }).click();
    await expect.poll(async () => (await myStanding(page))?.runs, { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => (await myStanding(page))?.status).toBe('playing');

    await backToClassics(page);
    await expect(page.getByRole('link', { name: /Block Drop/i }).first()).toBeVisible();
  });

  test('two-player score race: same pieces, verified standings, podium and rematch', async ({ page, browser }) => {
    test.setTimeout(150_000);
    const code = await createRoom(page, 'blocks', 'Host');
    const guest = await joinRoom(browser, code, 'Guest');
    await expect.poll(async () => Object.keys((await roomState(page))?.players ?? {}).length).toBe(2);
    await startGame(page);
    await expect(page.getByText('Race starts')).toBeVisible({ timeout: 10_000 });
    await waitForPhase(page, 'PLAYING', 20_000);
    const topOut = async (p: Page) => {
      for (let i = 0; i < 120; i++) {
        const s = await myStanding(p);
        if (s?.status === 'over') return;
        await p.keyboard.press('Space');
        await p.waitForTimeout(50);
      }
    };
    await page.waitForTimeout(600);
    await Promise.all([topOut(page), topOut(guest)]);
    await waitForPhase(page, 'RESULTS', 30_000);
    const s = await roomState(page);
    const rows = Object.values(s.standings) as Array<{ score: number; status: string; rank: number }>;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.status).toBe('over');
      expect(r.score).toBeGreaterThan(0);
      expect(r.rank).toBeGreaterThanOrEqual(1);
    }
    await expect(page.getByRole('list', { name: 'Podium' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Final standings' })).toBeVisible();
    await expect(guest.getByText(/Waiting for the host/)).toBeVisible();
    await page.getByRole('button', { name: 'Rematch' }).click();
    await expect.poll(async () => (await roomState(page))?.classics?.matchNo, { timeout: 10_000 }).toBe(2);
    await waitForPhase(page, 'PLAYING', 20_000);
    await leaveRoom(guest);
    await guest.context().close();
    await leaveRoom(page);
  });
});
