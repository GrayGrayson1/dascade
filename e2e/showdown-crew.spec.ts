/**
 * DAS Survey Showdown — the event crew (ADM-04 B, JOI-02 C, OPS-03 B): loading the rehearsal preset
 * makes the room an event room and gives the presenter their producer link; a moderator link opened
 * in a second browser gets the crew screen; the moderator renames and hides a guest and the stage
 * roster follows within a second; the log names the moderator for both; the preflight shows a
 * deliberate failure (no stage window) with its fix.
 *
 * Screenshots go to SHOTS_DIR when it's set (the decision build's visual record).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createRoom, myPlayerId, roomState, setName, startGame } from './helpers.ts';

const SHOTS = process.env.SHOTS_DIR ?? '';
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

/** Phones show one lobby section at a time: open the one that holds `target`. */
async function showLobbySection(page: Page, tab: 'Settings' | 'Setup'): Promise<void> {
  const t = page.getByRole('tab', { name: tab });
  if (await t.isVisible().catch(() => false)) await t.click();
}

/** Opens a room link in a fresh browser and joins under `name`. */
async function joinAs(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await setName(page, name);
  await page.getByRole('button', { name: /^Join/ }).first().click();
  await expect(page.locator('.lobby, .game-stage').first()).toBeVisible();
}

test('event crew: producer link, moderator screen, rename and hide follow on stage, the log, the preflight', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The producer runs the lobby from a laptop.');
  test.setTimeout(120_000);
  const host = page;
  const code = await createRoom(host, 'showdown', 'Marcus');

  // A guest joins before the event starts.
  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const guest = await guestCtx.newPage();
  await joinAs(guest, `/room/${code}`, 'xXghostXx');
  const guestId = (await myPlayerId(guest))!;
  expect(guestId).toBeTruthy();

  // Loading the rehearsal makes this an event room; its producer link arrives once and is kept here.
  await showLobbySection(host, 'Settings');
  await host.getByRole('button', { name: 'Load DAS-O-Ween rehearsal (demo answers)' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-rehearsal');
  await expect(host.locator('[data-part="showdown-event-badge"]')).toBeVisible();
  await showLobbySection(host, 'Setup');
  const crewChecks = host.locator('[data-part="showdown-crew-checks"]');
  await expect(crewChecks).toBeVisible();
  const producer = crewChecks.locator('[data-part="showdown-producer-link"]');
  await expect(producer.getByRole('button', { name: 'Copy producer link' })).toBeVisible();
  // The secret is never on screen (the console may be shared).
  await expect(producer).not.toContainText(/#crew=[A-Za-z0-9_-]{6,}\./);
  const stored = async () =>
    host.evaluate(
      (c) =>
        JSON.parse(localStorage.getItem(`dascade:showdown:crew:${c}`) ?? '{"links":[]}').links as Array<{
          role: string;
          name: string;
          link: string;
        }>,
      code,
    );
  await expect.poll(async () => (await stored()).map((l) => l.role)).toContain('producer');

  // The preflight: no stage window yet → a failure, with its fix right there.
  const preflight = crewChecks.locator('[data-part="showdown-preflight"]');
  const stageRow = preflight.locator('[data-check="stage"]');
  await expect(stageRow).toHaveAttribute('data-state', 'fail');
  await expect(stageRow).toContainText('The stage window isn’t open');
  await expect(stageRow.getByRole('button', { name: 'Open stage window' })).toBeVisible();
  await expect(preflight.locator('[data-part="showdown-preflight-verdict"]')).toContainText('NO-GO');
  // Server facts arrived (the rehearsal's practice boards are flagged, never a pass for the real show).
  await expect(preflight.locator('[data-check="show"]')).toHaveAttribute('data-state', 'warn');
  await stageRow.scrollIntoViewIfNeeded();
  await shot(host, 'lobby-preflight-nogo');

  // The producer hands out a moderator link for Ravi.
  const crewPanel = crewChecks.locator('[data-part="showdown-crew-panel"]');
  await crewPanel.getByLabel('Name', { exact: true }).fill('Ravi');
  await crewPanel.getByLabel('Role').selectOption('moderator');
  await crewPanel.getByRole('button', { name: 'Create link' }).click();
  await expect(crewPanel.getByRole('button', { name: 'Copy Ravi moderator link' })).toBeVisible();
  await expect(crewPanel.getByRole('status').filter({ hasText: 'Moderator link for Ravi is ready' })).toBeVisible();
  await expect.poll(async () => (await stored()).filter((l) => l.role === 'moderator').length).toBe(1);
  const modLink = (await stored()).find((l) => l.role === 'moderator')!.link;
  await crewPanel.scrollIntoViewIfNeeded();
  await shot(host, 'lobby-crew-links');

  // Ravi opens it in another browser: the crew screen, not the audience lobby.
  const modCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const mod = await modCtx.newPage();
  await joinAs(mod, `/room/${code}#crew=${modLink}`, 'Ravi');
  const crewScreen = mod.locator('[data-part="showdown-crew-screen"]');
  await expect(crewScreen).toBeVisible();
  await expect(crewScreen).toContainText('Moderator');
  await expect(mod.getByText('You’re crew, so you’re not in the picker pool.')).toBeVisible();
  // The secret left the address bar.
  expect(mod.url()).not.toContain('#crew=');
  // A moderator gets Names only (no log, no preflight).
  await expect(mod.getByRole('tab', { name: 'Crew & log' })).toHaveCount(0);
  await expect(mod.getByRole('tab', { name: 'Preflight' })).toHaveCount(0);
  const names = mod.locator('[data-part="showdown-names-panel"]');
  await expect(names).toBeVisible();
  await shot(mod, 'crew-screen-moderator');

  // Rename: the stage roster has the new name within a second.
  await names.getByRole('button', { name: 'Rename xXghostXx' }).click();
  const box = names.getByRole('textbox', { name: 'Rename xXghostXx' });
  await box.fill('Zoe H.');
  await box.press('Enter');
  await expect.poll(async () => (await roomState(host)).players?.[guestId]?.name, { timeout: 1000, intervals: [50] }).toBe('Zoe H.');
  await expect(names.getByRole('status').filter({ hasText: 'Renamed “xXghostXx” to “Zoe H.”' })).toBeVisible();
  // The guest is told.
  await expect(guest.getByText(/A moderator changed your name to Zoe H\./)).toBeVisible();

  // Hide: off the stage grid within a second; the guest stays in the room.
  expect((await roomState(host)).seats?.[guestId]).toBe(true);
  await names.getByRole('button', { name: 'Hide Zoe H. from stage' }).click();
  await expect.poll(async () => Boolean((await roomState(host)).seats?.[guestId]), { timeout: 1000, intervals: [50] }).toBe(false);
  expect((await roomState(host)).players?.[guestId]).toBeTruthy();
  await expect(names.getByRole('status').filter({ hasText: 'Zoe H. is hidden from the stage and the picker.' })).toBeVisible();
  await expect(names.getByRole('button', { name: 'Show Zoe H. on stage' })).toBeVisible();
  await shot(mod, 'crew-screen-names-after');

  // The log (the presenter has audit.read) names Ravi for both.
  const log = crewPanel.locator('[data-part="showdown-audit"]');
  const renamed = log.locator('li', { hasText: 'Renamed “xXghostXx” to “Zoe H.”' });
  const hid = log.locator('li', { hasText: 'Hid Zoe H. from the stage and the picker' });
  await expect(renamed).toContainText('Ravi');
  await expect(renamed).toContainText('Moderator');
  await expect(hid).toContainText('Ravi');
  await log.scrollIntoViewIfNeeded();
  await shot(host, 'lobby-audit-log');

  // The moderator's crew screen on a phone: one column, nothing cut off.
  await mod.setViewportSize({ width: 390, height: 844 });
  await expect(crewScreen).toBeVisible();
  const overflow = await mod.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await shot(mod, 'crew-screen-phone');

  await modCtx.close();
  await guestCtx.close();
});

test('event crew: the producer downloads the log as JSON', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The producer runs the lobby from a laptop.');
  const host = page;
  const code = await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  await host.getByRole('button', { name: 'Load DAS-O-Ween rehearsal (demo answers)' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-rehearsal');
  await showLobbySection(host, 'Setup');
  const crewPanel = host.locator('[data-part="showdown-crew-checks"] [data-part="showdown-crew-panel"]');
  // The presenter who made the event room is its producer: they may export.
  const download = host.waitForEvent('download');
  await crewPanel.getByRole('button', { name: 'Download log (JSON)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`dasoween-audit-${code}.json`);
  const body = JSON.parse(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'))) as {
    room: string;
    entries: Array<{ action: string }>;
  };
  expect(body.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['event.start', 'crew.issue', 'preset.load']));
  // Never a crew secret in the log.
  expect(JSON.stringify(body)).not.toMatch(/[A-Za-z0-9_-]{6,24}\.[A-Za-z0-9_-]{22,64}/);
});

test('picker strip: K draws (name first), K again nudges, D / A end the turn, a reroll after 30 s needs a reason', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter runs the show from a laptop.');
  test.setTimeout(150_000);
  const host = page;
  await host.setViewportSize({ width: 1280, height: 720 });
  const code = await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  await host.getByRole('button', { name: 'Load DAS-O-Ween rehearsal (demo answers)' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-rehearsal');
  const contexts = [];
  for (const name of ['Priya S.', 'Sam P.', 'Luis R.']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    contexts.push(ctx);
    await joinAs(await ctx.newPage(), `/room/${code}`, name);
  }
  await expect.poll(async () => Object.keys((await roomState(host)).seats ?? {}).length).toBe(3);
  await startGame(host);
  await expect.poll(async () => (await roomState(host)).phase).toBe('PLAYING');

  const strip = host.locator('[data-part="showdown-picker-strip"]');
  await expect(strip).toBeVisible();
  // Before round 1 the picker waits.
  await expect(strip.locator('[data-part="showdown-pick"]')).toBeDisabled();
  await host
    .getByRole('button', { name: /^Start round 1/ })
    .first()
    .click();
  await expect(strip.getByRole('button', { name: 'Pick someone · 3 in the pool' })).toBeEnabled();

  // K: the console names the winner at once, before the stage lands.
  await host.keyboard.press('k');
  await expect.poll(async () => (await roomState(host)).hotSeat).not.toBe('');
  const s1 = await roomState(host);
  const name1 = s1.players[s1.hotSeat].name as string;
  const hot = strip.locator('[data-part="showdown-pick-hot"]');
  await expect(hot).toContainText(name1);
  await expect(hot).toContainText(/on stage in [12] s/);
  // K again with someone in the hot seat nudges instead of drawing.
  await host.keyboard.press('k');
  await expect(hot).toContainText(`Mark ${name1} done?`);
  expect((await roomState(host)).drawNo).toBe(s1.drawNo);
  // Everything fits at 1280×720: Mark done is on screen without scrolling.
  const done = strip.locator('[data-part="showdown-pick-done"]');
  const box = await done.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(720);
  await shot(host, 'console-strip-nudge-1280');

  // D: the turn counts (out until the next round).
  await host.keyboard.press('d');
  await expect.poll(async () => (await roomState(host)).done?.[s1.hotSeat]).toBe(true);
  await expect(strip.getByRole('button', { name: 'Pick someone · 2 in the pool' })).toBeVisible();

  // A: back in the pool.
  await host.keyboard.press('k');
  await expect.poll(async () => (await roomState(host)).drawNo).toBe(s1.drawNo + 1);
  const s2 = await roomState(host);
  await host.keyboard.press('a');
  await expect.poll(async () => (await roomState(host)).hotSeat).toBe('');
  expect((await roomState(host)).done?.[s2.hotSeat]).toBeFalsy();

  // A no-show: after 30 s Reroll opens; the reason is required and goes in the log.
  await host.keyboard.press('k');
  await expect.poll(async () => (await roomState(host)).drawNo).toBe(s1.drawNo + 2);
  const reroll = strip.locator('[data-part="showdown-pick-reroll"]');
  await expect(reroll).toHaveCount(0);
  await expect(reroll).toBeVisible({ timeout: 40_000 });
  await reroll.click();
  await shot(host, 'console-strip-reroll-1280');
  await strip.getByRole('button', { name: 'Reroll: Not there' }).click();
  await expect.poll(async () => (await roomState(host)).drawNo).toBe(s1.drawNo + 3);
  await host
    .getByRole('tab', { name: /Crew & log/ })
    .first()
    .click();
  await expect(host.locator('[data-part="showdown-audit"] li', { hasText: 'Rerolled and drew' }).first()).toContainText(
    'Reason: Not there',
  );

  for (const ctx of contexts) await ctx.close();
});

test('show file (ADM-01): DAS-O-Ween 2026 asks for the show file; loading it is confirmed in words', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'The presenter loads the show from a laptop.');
  const host = page;
  await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  await host.getByRole('button', { name: 'Load DAS-O-Ween 2026' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-2026');
  // Settings only: no boards came with it, so the lobby says what to do next.
  expect((await roomState(host)).customRounds).toBe(0);
  const prompt = host.locator('[data-part="showdown-showfile-prompt"]');
  await expect(prompt).toContainText('Now load your show file.');
  await shot(host, 'lobby-load-your-show-file');
  await prompt.getByRole('button', { name: 'Load your show file' }).click();

  // The editor opens on the show file, its Load button focused.
  const editor = host.locator('[data-part="showdown-showfile"]');
  await expect(editor.getByRole('button', { name: 'Load show file…' })).toBeFocused();
  // Made-up boards (never the real show's).
  const answers = (tag: string) => Array.from({ length: 10 }, (_, i) => ({ text: `${tag} answer ${i + 1}`, points: 0 }));
  const file = {
    kind: 'dascade-showdown-show',
    version: 1,
    rounds: [
      { title: 'Test Board A', prompt: 'Name a made-up thing A.', special: 5, answers: answers('A') },
      { title: 'Test Board B', prompt: 'Name a made-up thing B.', special: 5, answers: answers('B') },
    ],
    settings: { mode: 'showcase', look: 'halloween', minutes: 10 },
  };
  await host.locator('[data-part="showdown-showfile"] input[type="file"]').setInputFiles({
    name: 'test-show.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  const status = editor.getByRole('status');
  await expect(status).toContainText('✓ Done: Loaded “test-show.json”: 2 rounds, each with a special answer, plus its settings.');
  // The confirmation never repeats an answer.
  await expect(status).not.toContainText('answer 1');
  await shot(host, 'editor-showfile-loaded');
  await host.getByRole('button', { name: 'Save to the show' }).click();
  await expect.poll(async () => (await roomState(host)).customRounds).toBe(2);
  await expect(host.locator('[data-part="showdown-preset-status"]')).toContainText(
    'DAS-O-Ween 2026’s settings with 2 rounds from your show file',
  );

  // A file that isn't a show file is refused, in words.
  await host.getByRole('button', { name: 'Load show file' }).click();
  await host
    .locator('[data-part="showdown-showfile"] input[type="file"]')
    .setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(host.locator('[data-part="showdown-showfile"]').getByRole('status')).toContainText(
    '✕ Not loaded: “notes.json” isn’t a show file',
  );
});

test('backup presenter (ADM-04): Take over opens only while the presenter is offline, and the console comes to them', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Crew run from laptops.');
  test.setTimeout(90_000);
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = await hostCtx.newPage();
  const code = await createRoom(host, 'showdown', 'Marcus');
  await showLobbySection(host, 'Settings');
  await host.getByRole('button', { name: 'Load DAS-O-Ween rehearsal (demo answers)' }).click();
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-rehearsal');
  await showLobbySection(host, 'Setup');
  const crewPanel = host.locator('[data-part="showdown-crew-checks"] [data-part="showdown-crew-panel"]');
  await crewPanel.getByLabel('Name', { exact: true }).fill('Dana');
  await crewPanel.getByLabel('Role').selectOption('backup');
  await crewPanel.getByRole('button', { name: 'Create link' }).click();
  await expect(crewPanel.getByRole('button', { name: 'Copy Dana backup presenter link' })).toBeVisible();
  const link = await host.evaluate(
    (c) =>
      (
        JSON.parse(localStorage.getItem(`dascade:showdown:crew:${c}`) ?? '{"links":[]}').links as Array<{ role: string; link: string }>
      ).find((l) => l.role === 'backup')!.link,
    code,
  );

  const dana = page;
  await joinAs(dana, `/room/${code}#crew=${link}`, 'Dana');
  const takeover = dana.locator('[data-part="showdown-backup-takeover"]');
  await expect(dana.locator('[data-part="showdown-crew-screen"]')).toContainText('Backup presenter');
  await expect(takeover).toBeDisabled();
  await expect(dana.locator('[data-part="showdown-backup"]')).toContainText('Marcus is online. Take over opens if they drop.');
  await shot(dana, 'crew-screen-backup-waiting');

  // The presenter's laptop dies.
  await hostCtx.close();
  await expect(takeover).toBeEnabled({ timeout: 20_000 });
  await expect(dana.locator('[data-part="showdown-backup"]')).toContainText('Marcus is offline — you can take over now.');
  await takeover.click();
  const danaId = await myPlayerId(dana);
  await expect.poll(async () => (await roomState(dana)).presenterId).toBe(danaId);
  // Dana now has the presenter's lobby (the crew screen is for crew who aren't presenting).
  await expect(dana.locator('[data-part="showdown-crew-screen"]')).toHaveCount(0);
});
