/**
 * Lobby chat (C5): on phones the lobby shows one section at a time, so the Chat tab counts what
 * other players said while you were elsewhere; quick-chat buttons send a message in one tap.
 */
import { expect, test } from '@playwright/test';
import { createRoom, joinRoom } from './helpers.ts';

test.describe('phone lobby chat', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the Chat tab counts messages you missed, and quick chat sends in one tap', async ({ page, browser }) => {
    const code = await createRoom(page, 'wheel', 'Host');
    const chatTab = page.getByRole('tab', { name: /^Chat/ });
    await expect(chatTab).toBeVisible();
    await expect(page.locator('[data-part="chat-unread"]')).toHaveCount(0);

    const guest = await joinRoom(browser, code, 'Chatty');
    // The guest's own messages never badge their own tab.
    const say = (text: string) => guest.evaluate((t) => (window as any).__DASCADE__.session.lobby.chat(t), text);
    await say('hello');
    await say('anyone there?');
    await expect(page.locator('[data-part="chat-unread"]')).toHaveText('2, 2 unread');
    await expect(chatTab).toHaveAccessibleName(/^Chat\W*2 unread$/);

    // Opening the tab reads them; the badge stays gone while you're on it.
    await chatTab.click();
    const log = page.getByRole('log', { name: 'Room chat' });
    await expect(log).toContainText('anyone there?');
    await expect(page.locator('[data-part="chat-unread"]')).toHaveCount(0);
    await say('still here');
    await expect(log).toContainText('still here');
    await expect(page.locator('[data-part="chat-unread"]')).toHaveCount(0);

    // Quick chat: one tap, sent as ordinary chat everyone sees.
    const quick = page.getByRole('group', { name: 'Quick messages' });
    await expect(quick.getByRole('button')).toHaveText(['GG', 'Nice!', 'One more?', 'brb']);
    await quick.getByRole('button', { name: 'One more?' }).click();
    await expect(log.locator('[data-part="chat-message"]').last()).toContainText('One more?');
    await expect(guest.locator('.lobby__chat [data-part="chat-message"]').last()).toContainText('One more?');

    // Leave the tab: only what arrives after that counts.
    await page.getByRole('tab', { name: /^Players/ }).click();
    await say('brb too');
    await expect(page.locator('[data-part="chat-unread"]')).toHaveText('1, 1 unread');
    await guest.context().close();
  });
});
