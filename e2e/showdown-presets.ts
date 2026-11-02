/**
 * DAS Survey Showdown e2e: loading an event preset from the lobby's Settings. A season's presets
 * (DAS-O-Ween) sit in a "Seasonal" group that's collapsed outside their month, so open it first.
 */
import { expect, type Page } from '@playwright/test';

/** Presses a preset's Load button (by its accessible name), opening a collapsed Seasonal group when it's in one. */
export async function loadPreset(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.locator('[data-part="showdown-presets"]')).toBeVisible();
  const button = page.getByRole('button', { name });
  if (!(await button.isVisible())) {
    const closed = page.locator('[data-part="showdown-seasonal-presets"]:not([open]) > summary');
    for (let i = 0; i < 4 && (await closed.count()) > 0; i++) await closed.first().click();
  }
  await button.click();
}
