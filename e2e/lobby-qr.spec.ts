/**
 * The QR invite in every lobby (C6): Lobby → QR shows the short /R/CODE link as a QR (checked module
 * by module against the same encoder), and that link joins the room.
 */
import { generate, correction } from 'lean-qr';
import { expect, test, type Page } from '@playwright/test';
import { createRoom, setName } from './helpers.ts';

/** The QR's modules as drawn on a canvas (one pixel per module, quiet zone included): true = dark. */
async function canvasModules(page: Page, selector: string): Promise<boolean[][]> {
  return page
    .locator(selector)
    .first()
    .evaluate((c: HTMLCanvasElement) => {
      const g = c.getContext('2d')!;
      const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
      const rows: boolean[][] = [];
      for (let y = 0; y < height; y++) {
        const row: boolean[] = [];
        for (let x = 0; x < width; x++) row.push(data[(y * width + x) * 4]! < 128);
        rows.push(row);
      }
      return rows;
    });
}

/** The modules the same encoder makes for `text`, with the 4-module quiet zone. */
function expectedModules(text: string): boolean[][] {
  const code = generate(text, { minCorrectionLevel: correction.M, maxCorrectionLevel: correction.M });
  const n = code.size + 8;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => code.get(x - 4, y - 4)));
}

test('Lobby → QR shows the join QR, and its link joins the room', async ({ page, browser }) => {
  const code = await createRoom(page, 'wheel', 'Host');
  const origin = new URL(page.url()).origin;
  const text = `${origin}/r/${code}`.toUpperCase();

  await page.locator('[data-part="room-qr"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Scan to join' })).toBeVisible();
  const qr = dialog.locator('[data-part="invite-qr"] canvas');
  await expect(qr).toHaveAttribute('data-ready', 'true');
  await expect(qr).toHaveAttribute('data-qr', text);
  await expect(dialog.getByRole('img', { name: `QR code for ${new URL(origin).host}/r/${code}` })).toBeVisible();
  expect(await canvasModules(page, '[data-part="invite-qr"] canvas')).toEqual(expectedModules(text));
  // Big enough to scan off a shared screen, and inside the window.
  const box = (await qr.boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(dialog).toContainText(code);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // What a phone camera opens: the link in capitals goes on to the room, and Join takes the seat.
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(text);
  await guest.waitForURL((url) => url.pathname === `/room/${code}`);
  await setName(guest, 'Scanner');
  await guest.getByRole('button', { name: 'Join game' }).click();
  await expect(guest.locator('.lobby')).toBeVisible();
  await expect(page.locator('.player-list')).toContainText('Scanner');
  await ctx.close();
});
