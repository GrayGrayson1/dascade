/**
 * DAS Survey Showdown — "Write your rounds": the presenter types a whole round by hand (category,
 * attribution, question, answers, points, special answer) and saves it to the show. Typing in any
 * field must keep the editor open: the round fields used to read the input inside React's state
 * updater, after React had cleared the event, and the editor crashed on the first keystroke.
 *
 * Made-up boards only (never the show's).
 */
import { expect, test } from '@playwright/test';
import { createRoom, roomState } from './helpers.ts';

test('Write your rounds: typing the category, attribution, question and special answer keeps the editor open and saves', async ({ page }) => {
  await createRoom(page, 'showdown', 'Presenter');
  // Phones show one lobby section at a time.
  const settingsTab = page.getByRole('tab', { name: 'Settings' });
  if (await settingsTab.isVisible()) await settingsTab.click();
  await page.getByRole('radio', { name: /^Your own/ }).click();
  await expect.poll(async () => JSON.parse((await roomState(page)).settingsJson).source).toBe('custom');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.getByRole('button', { name: 'Write your rounds' }).click();
  const editor = page.getByRole('dialog', { name: 'Your rounds' });
  await expect(editor).toBeVisible();

  // Key by key, the way a person types (one change event per character).
  const typed = {
    'Round 1 category': 'Desk Drawer Finds',
    'Round 1 attribution': 'The Test Crew',
    'Round 1 question': 'Name something you find in a desk drawer.',
  };
  for (const [label, text] of Object.entries(typed)) {
    await editor.getByLabel(label, { exact: true }).pressSequentially(text);
    await expect(editor.getByLabel(label, { exact: true })).toHaveValue(text);
  }
  const answers: Array<[string, number]> = [
    ['Pens', 40],
    ['Sticky notes', 30],
    ['Paper clips', 20],
  ];
  for (const [i, [text, points]] of answers.entries()) {
    await editor.getByLabel(`Round 1 answer ${i + 1}`, { exact: true }).pressSequentially(text);
    await editor.getByLabel(`Round 1 answer ${i + 1} points`, { exact: true }).fill(String(points));
  }
  await editor.getByLabel('Round 1 special answer').selectOption('2');
  await expect(editor.getByLabel('Round 1 special answer')).toHaveValue('2');
  // Back to an earlier field after the answers: still typing, still open.
  await editor
    .getByLabel('Round 1 category', { exact: true })
    .evaluate((el: HTMLInputElement) => (el.focus(), el.setSelectionRange(el.value.length, el.value.length)));
  await page.keyboard.type('!');
  await expect(editor.getByLabel('Round 1 category', { exact: true })).toHaveValue('Desk Drawer Finds!');

  const preview = editor.getByLabel('Round 1 board preview');
  await expect(preview).toContainText('Desk Drawer Finds!');
  await expect(preview).toContainText('According to The Test Crew');
  await expect(editor.getByText('1 ready')).toBeVisible();
  expect(errors).toEqual([]);

  await editor.getByRole('button', { name: 'Save to the show' }).click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await roomState(page)).customRounds).toBe(1);

  // The presenter gets the round back: reopening shows what was typed.
  await page.getByRole('button', { name: 'Edit your rounds' }).click();
  await expect(editor.getByLabel('Round 1 category', { exact: true })).toHaveValue('Desk Drawer Finds!');
  await expect(editor.getByLabel('Round 1 question', { exact: true })).toHaveValue('Name something you find in a desk drawer.');
  await expect(editor.getByLabel('Round 1 special answer')).toHaveValue('2');
  expect(errors).toEqual([]);
});
