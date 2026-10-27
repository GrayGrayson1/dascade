/**
 * DAS Survey Showdown — the guest's side of an event room (DAS-O-Ween):
 *   JOI-01 B  /r/<code> of an event room is a one-field join screen that fits a 390×844 phone
 *   JOI-03 B  a second "Sam" is asked for an initial before seating ("Sam P."), or keeps "Sam 2"
 *   PCK-03 C  Skip me on the join screen arrives in the phone's pool card
 *   DSP-03 B  only the picked phone shows "You're up!" (at the landing); the others "… is answering"
 * and a non-event room's /r/<code> still goes straight to the room.
 *
 * Practice content only (the rehearsal preset). Screenshots: .scratch/decision-build/shots/phone/.
 */
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { createRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers.ts';

const SHOTS = '.scratch/decision-build/shots/phone';

/** A 390×844 phone, whatever the project (mobile runs keep their phone's user agent). */
function phone(testInfo: TestInfo) {
  const use = testInfo.project.use;
  return {
    baseURL: use.baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    ...(use.isMobile ? { userAgent: use.userAgent } : {}),
  };
}

const shot = (page: Page, name: string, testInfo: TestInfo) => page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-${name}.png` });

const send = (page: Page, type: string, payload: unknown) =>
  page.evaluate(([t, p]) => (window as any).__DASCADE__.session.send(t, p), [type, payload] as const);

const board = async (page: Page) => {
  const s = await roomState(page);
  return s?.boardJson ? JSON.parse(s.boardJson) : null;
};

/** The host makes the room an event room: the DAS-O-Ween rehearsal preset (practice boards). */
async function loadRehearsal(host: Page, code: string): Promise<void> {
  await send(host, 'showdown:preset', { id: 'dasoween-rehearsal' });
  await expect.poll(async () => (await roomState(host)).event).toBe('dasoween-rehearsal');
  // The lookup the join link uses (room metadata, flushed about once a second).
  await expect
    .poll(
      async () => host.evaluate((c) => (window as any).__DASCADE__.session.lookup(c).then((r: { event?: string }) => r.event ?? ''), code),
      {
        timeout: 15_000,
      },
    )
    .toBe('dasoween-rehearsal');
}

async function openJoinLink(browser: Browser, code: string, testInfo: TestInfo): Promise<Page> {
  const ctx = await browser.newContext(phone(testInfo));
  // Record vibrations (headless Chrome has no motor; Android buzzes, iPhones have no navigator.vibrate).
  await ctx.addInitScript(() => {
    (window as any).__buzz = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern: number[]) => ((window as any).__buzz.push(pattern), true),
    });
  });
  const page = await ctx.newPage();
  await page.goto(`/r/${code}`);
  await expect(page.locator('[data-part="event-join"]')).toBeVisible();
  return page;
}

const nameField = (page: Page) => page.getByRole('textbox', { name: 'What should we call you?' });

async function inRoom(page: Page, code: string): Promise<void> {
  await page.waitForURL(new RegExp(`/room/${code}$`));
  await expect(page.locator('.lobby, .game-stage').first()).toBeVisible();
}

test('event join link: one field, the initial prompt, Skip me, and the pick on the right phone', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const host = page;
  const code = await createRoom(host, 'showdown', 'Host');
  await loadRehearsal(host, code);

  // ---- JOI-01 B: one field and one tap, the instruction visible without scrolling at 390×844 ----
  const ada = await openJoinLink(browser, code, testInfo);
  const field = nameField(ada);
  await expect(ada.getByRole('textbox')).toHaveCount(1);
  await expect(field).toHaveAccessibleDescription(
    /Use the name your coworkers know you by — it’s how you’ll appear on the stage and in the picker\./,
  );
  const help = ada.getByText('Use the name your coworkers know you by', { exact: false });
  await expect(help).toBeInViewport({ ratio: 1 });
  await expect(field).toBeInViewport({ ratio: 1 });
  await expect(ada.getByRole('switch', { name: 'Skip me' })).toBeInViewport();
  await expect(ada.getByRole('button', { name: 'Join the show' })).toBeInViewport({ ratio: 1 });
  expect(await ada.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  // No email, legal name or ID is ever asked.
  await expect(ada.getByText(/e-?mail address|employee id|legal name/i)).toHaveCount(0);
  await shot(ada, 'join-390x844', testInfo);

  // Errors are announced: Join with nothing typed.
  await ada.getByRole('button', { name: 'Join the show' }).click();
  await expect(ada.getByRole('alert').filter({ hasText: 'Type your name first' })).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();

  // The live name tag shows the name as the server will seat it; Enter joins.
  await field.fill('  Sam  ');
  await expect(ada.getByRole('figure', { name: 'How you’ll appear: Sam' })).toBeVisible();
  await expect(ada.getByRole('alert').filter({ hasText: 'Type your name first' })).toHaveCount(0);
  await field.press('Enter');
  await inRoom(ada, code);

  // ---- JOI-03 B: a second Sam is asked for an initial before joining ----
  const sam2 = await openJoinLink(browser, code, testInfo);
  await nameField(sam2).fill('Sam');
  await sam2.getByRole('button', { name: 'Join the show' }).click();
  const prompt = sam2.locator('[data-part="event-join-duplicate"]');
  await expect(prompt.getByRole('status')).toHaveText('There’s already a Sam here. Add your last initial?');
  const initial = sam2.getByRole('textbox', { name: 'Last initial' });
  await expect(initial).toBeFocused();
  await expect(sam2.getByRole('button', { name: 'Keep “Sam 2”' })).toBeVisible();
  // Still one screen on the phone, with the prompt open.
  await expect(sam2.getByRole('button', { name: 'Join the show' })).toBeInViewport({ ratio: 1 });
  await shot(sam2, 'join-duplicate', testInfo);
  // Join without an initial: told what to do, nothing seated.
  await sam2.getByRole('button', { name: 'Join the show' }).click();
  await expect(sam2.getByRole('alert').filter({ hasText: 'Type your last initial' })).toBeVisible();
  await initial.fill('p');
  await expect(sam2.getByRole('figure', { name: 'How you’ll appear: Sam P.' })).toBeVisible();
  await expect(sam2.getByRole('button', { name: 'Join as Sam P.' })).toBeVisible();
  // Keyboard: Enter in the initial field joins as "Sam P.".
  await initial.press('Enter');
  await inRoom(sam2, code);

  // The other path: keep the name the room offers — still distinct.
  const sam3 = await openJoinLink(browser, code, testInfo);
  await nameField(sam3).fill('Sam');
  await nameField(sam3).press('Enter');
  await sam3.getByRole('button', { name: 'Keep “Sam 2”' }).click();
  await inRoom(sam3, code);

  // ---- PCK-03 C: Skip me on the join screen ----
  const riley = await openJoinLink(browser, code, testInfo);
  await nameField(riley).fill('Riley');
  const skip = riley.getByRole('switch', { name: 'Skip me' });
  // (The design system's switch hides its input under the thumb: a tap anywhere on the label flips it.)
  await skip.check({ force: true });
  await expect(skip).toBeChecked();
  await riley.getByRole('button', { name: 'Join the show' }).click();
  await inRoom(riley, code);
  const card = (p: Page) => p.locator('[data-part="showdown-pool-card"]');
  // It arrives in the pool card (the lobby's compact one first).
  await expect(card(riley)).toContainText('Skip me is on — you’re out of the random draw');
  await expect(card(riley).getByRole('switch', { name: 'Skip me' })).toBeChecked();
  await card(riley).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await card(riley).screenshot({ path: `${SHOTS}/${testInfo.project.name}-lobby-pool-compact.png` });

  const names = async () =>
    Object.values((await roomState(host)).players ?? {})
      .map((p: any) => p.name as string)
      .sort();
  await expect.poll(names).toEqual(['Host', 'Riley', 'Sam', 'Sam 2', 'Sam P.']);

  // A device with a seat that opens the link again goes straight back into the room.
  await ada.goto(`/r/${code}`);
  await inRoom(ada, code);
  await expect(ada.locator('[data-part="event-join"]')).toHaveCount(0);

  // ---- The show: round 1's title card, then the phones' pool cards ----
  await startGame(host);
  await waitForPhase(host, 'PLAYING');
  await expect.poll(async () => (await board(host))?.stage).toBe('intro');
  await send(host, 'showdown:act', { a: 'begin', rev: (await board(host)).rev });
  await expect.poll(async () => (await board(host))?.stage).toBe('title');

  await expect(card(riley)).toContainText('Skip me is on — you’re out of the random draw');
  await expect(card(riley)).toContainText('The presenter can still call you up by name.');
  await expect(card(riley).getByRole('switch', { name: 'Skip me' })).toBeChecked();
  await expect(card(ada)).toContainText('You’re in the pool — you might be picked');
  await expect(card(ada)).toContainText('On stage as Sam');
  await expect(card(ada).getByRole('switch', { name: 'Skip me' })).not.toBeChecked();
  await shot(ada, 'phone-pool', testInfo);
  await shot(riley, 'phone-skip', testInfo);
  // The presenter's console has no pool card (only participants get one).
  await expect(card(host)).toHaveCount(0);

  // ---- DSP-03 B: the presenter picks; only the picked phone shows "You're up!" ----
  const phones = [ada, sam2, sam3];
  const ids = await Promise.all(phones.map((p) => myPlayerId(p)));
  await send(host, 'showdown:pick', { a: 'pick', round: 0, drawNo: (await roomState(host)).drawNo });
  await expect.poll(async () => (await roomState(host)).hotSeat).not.toBe('');
  const s = await roomState(host);
  const winnerIndex = ids.indexOf(s.hotSeat);
  expect(winnerIndex, 'Riley switched on Skip me: never drawn').toBeGreaterThanOrEqual(0);
  const winner = phones[winnerIndex]!;
  const winnerName = s.players[s.hotSeat].name as string;
  const others = [...phones.filter((_, i) => i !== winnerIndex), riley];
  const upOn = (p: Page) => p.getByRole('alertdialog', { name: `You’re up, ${winnerName}!` });

  // Not before the stage lands (landAt = the pick + 3.5 s).
  expect(s.landAt - s.pickAt).toBeGreaterThanOrEqual(3000);
  await expect(winner.locator('[data-part="showdown-youre-up"]')).toHaveCount(0);
  await expect(winner.getByText(`${winnerName} is answering`)).toHaveCount(0);
  await expect(upOn(winner)).toBeVisible({ timeout: 10_000 });
  await expect(upOn(winner).getByRole('button', { name: 'Got it' })).toBeFocused();
  for (const p of others) {
    await expect(p.getByText(`${winnerName} is answering`)).toBeVisible();
    await expect(p.locator('[data-part="showdown-youre-up"]')).toHaveCount(0);
  }
  await shot(winner, 'phone-youre-up', testInfo);
  await shot(riley, 'phone-answering', testInfo);
  // The picked phone buzzed once, the others not at all.
  const buzz = (p: Page) => p.evaluate(() => (window as any).__buzz as number[][]);
  expect(await buzz(winner)).toEqual([[200, 100, 200]]);
  for (const p of others) expect(await buzz(p)).toEqual([]);

  // Dismissed: the picked phone keeps a strip; Mark done clears the hot seat everywhere.
  await upOn(winner).getByRole('button', { name: 'Got it' }).click();
  await expect(winner.locator('[data-part="showdown-youre-up"]')).toHaveCount(0);
  await expect(winner.locator('[data-part="showdown-answering"]')).toContainText('You’re answering');
  await expect(card(winner)).toContainText('You’re answering now');
  await send(host, 'showdown:pick', { a: 'done', drawNo: (await roomState(host)).drawNo });
  await expect.poll(async () => (await roomState(host)).hotSeat).toBe('');
  // Fair mode: a turn counts, and you're back once everyone has had one.
  await expect(card(winner)).toContainText('You’ve had a turn — you’re back in once everyone has had one');
  for (const p of [...others, winner]) await expect(p.locator('[data-part="showdown-answering"]')).toHaveCount(0);

  // JOI-02 C, the guest's side: a moderator's rename shows on their phone at once.
  const sam3Id = ids[2]!;
  await send(host, 'showdown:rename', { playerId: sam3Id, name: 'Sam O.' });
  await expect(card(sam3)).toContainText('On stage as Sam O.');
  await expect(sam3.locator('[data-part="toast"]').filter({ hasText: 'A moderator changed your name to' })).toBeVisible();

  // The pool card's own switch: Riley changes their mind.
  await card(riley).getByRole('switch', { name: 'Skip me' }).uncheck({ force: true });
  await expect(card(riley)).toContainText('You’re in the pool — you might be picked');
  await expect(card(riley).getByRole('switch', { name: 'Skip me' })).not.toBeChecked();
});

test('a non-event room’s join link still opens the room as before', async ({ page, browser }, testInfo) => {
  const code = await createRoom(page, 'showdown', 'Host');
  const ctx = await browser.newContext(phone(testInfo));
  const guest = await ctx.newPage();
  await guest.goto(`/r/${code}`);
  await guest.waitForURL(new RegExp(`/room/${code}$`));
  await expect(guest.getByRole('button', { name: 'Join game' })).toBeVisible();
  await expect(guest.locator('[data-part="event-join"]')).toHaveCount(0);
});

test('an event join link for a room that isn’t open says so kindly', async ({ browser }, testInfo) => {
  const ctx = await browser.newContext(phone(testInfo));
  const guest = await ctx.newPage();
  await guest.goto('/r/zzzzz');
  await expect(guest.getByRole('heading', { name: 'This show isn’t open right now' })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Try again' })).toBeVisible();
  await shot(guest, 'join-missing', testInfo);
});
