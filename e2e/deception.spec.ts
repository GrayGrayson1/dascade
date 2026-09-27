/**
 * DASception smoke: one browser player + four protocol bots (5 players) — create, start, private
 * role reveal, a night action, discussion, a secret vote and the public verdict, then leave.
 */
import { expect, test, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { createRoom, leaveRoom, myPlayerId, roomState, startGame, waitForPhase } from './helpers';

interface Bot {
  room: Room;
  priv: any;
}

/** The game server URL this page talks to (Vite dev serves the client on another port). */
async function serverUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ws = (window as any).__DASCADE__.session.room.connection.transport.ws as WebSocket;
    const url = new URL(ws.url);
    return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`;
  });
}

async function addBot(server: string, code: string, name: string): Promise<Bot> {
  const room = await new Client(server).joinById(code, { name });
  const bot: Bot = { room, priv: null };
  room.onMessage('deception:private', (p: unknown) => (bot.priv = p));
  for (const t of ['sys:welcome', 'sys:toast', 'sys:error', 'sys:time', 'chat:msg', 'chat:history', 'deception:event', 'deception:team'])
    room.onMessage(t, () => undefined);
  room.onMessage('*', () => undefined);
  return bot;
}

const stage = async (page: Page) => (await roomState(page))?.stage as string | undefined;

test('DASception: 5 players reach the role reveal, act at night and vote', async ({ page }) => {
  test.setTimeout(150_000);
  const code = await createRoom(page, 'deception', 'Host');
  const server = await serverUrl(page);
  const bots: Bot[] = [];
  for (const name of ['Ana', 'Ben', 'Cid', 'Dee']) bots.push(await addBot(server, code, name));
  await expect.poll(async () => Object.keys((await roomState(page)).players).length).toBe(5);
  await page.evaluate(() =>
    (window as any).__DASCADE__.session.send('lobby:settings', { settings: { nightSeconds: 20, voteSeconds: 30 } }),
  );

  await startGame(page);
  await waitForPhase(page, 'PLAYING');
  await expect.poll(() => stage(page)).toBe('boot');
  const hostId = (await myPlayerId(page))!;

  // Private role reveal: the host sees only their own role; public state reveals nobody's.
  const card = page.getByRole('region', { name: /^Your role: / });
  await expect(card).toBeVisible();
  const roleName = ((await card.getAttribute('aria-label')) ?? '').replace('Your role: ', '');
  expect(['Sysop', 'Scanner', 'Firewall', 'Glitch']).toContain(roleName);
  const boot = await roomState(page);
  expect(Object.values(boot.nodes).every((n: any) => n.role === '')).toBe(true);
  await expect.poll(() => bots.every((b) => b.priv?.role)).toBe(true);
  expect(JSON.stringify(boot)).not.toContain('"glitch"');

  await page.getByRole('button', { name: /Got it/ }).click();
  for (const b of bots) b.room.send('deception:ready', { ready: true });
  await expect.poll(() => stage(page), { timeout: 20_000 }).toBe('night');

  // Night: bots act (never targeting the host, so the host can vote by day); the host uses the UI.
  const nodes = Object.keys((await roomState(page)).nodes);
  for (const b of bots) {
    const allies = new Set((b.priv.allies ?? []).map((a: any) => a.id));
    const targets = nodes.filter((id) => id !== hostId && !allies.has(id));
    const kind = b.priv.role === 'glitch' ? 'attack' : b.priv.role === 'scanner' ? 'scan' : b.priv.role === 'firewall' ? 'shield' : null;
    if (kind) for (const t of targets) b.room.send('deception:act', { kind, target: t, lock: true });
  }
  const lockIn = page.getByRole('button', { name: 'Lock in' });
  if (await lockIn.isVisible().catch(() => false)) {
    await page.locator('button.dx-node:not(.is-blocked)').first().click();
    await expect(lockIn).toBeEnabled();
    await lockIn.click();
    await expect(page.getByText('Locked in')).toBeVisible();
  } else {
    await expect(page.getByText(/lie low until dawn/)).toBeVisible();
  }
  // Nothing about night actions is public.
  const night = await roomState(page);
  expect(Object.values(night.seats).every((s: any) => !s.answered)).toBe(true);

  await expect.poll(() => stage(page), { timeout: 40_000 }).toBe('dawn');
  await expect(page.getByLabel(/System log, night 1/)).toBeVisible();
  await expect.poll(() => stage(page), { timeout: 20_000 }).toBe('day');

  // Day → vote once everyone online is ready.
  await page.getByRole('button', { name: 'Ready to vote' }).click();
  for (const b of bots) if (b.priv?.alive) b.room.send('deception:ready', { ready: true });
  await expect.poll(() => stage(page), { timeout: 20_000 }).toBe('vote');

  // The host votes through the map + dock; the vote stays secret until the reveal.
  await page.locator('button.dx-node:not(.is-blocked)').first().click();
  const voteBtn = page.getByRole('button', { name: /^Vote / });
  await expect(voteBtn).toBeEnabled();
  await voteBtn.click();
  await expect(page.getByText(/secret until the reveal/)).toBeVisible();
  await expect.poll(async () => (await roomState(page)).seats[hostId].answered).toBe(true);
  expect((await roomState(page)).verdictJson).toBe('');
  for (const b of bots) if (b.priv?.alive) b.room.send('deception:vote', { target: 'skip' });

  await expect.poll(() => stage(page), { timeout: 20_000 }).toBe('verdict');
  const verdict = JSON.parse((await roomState(page)).verdictJson);
  expect(verdict.votes.some((v: any) => v.voterId === hostId)).toBe(true);
  await expect(page.getByLabel('Vote result')).toBeVisible();

  for (const b of bots) await b.room.leave().catch(() => undefined);
  await leaveRoom(page);
});
