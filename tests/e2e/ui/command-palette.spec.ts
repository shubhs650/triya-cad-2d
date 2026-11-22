// M7-06 part 2: the Ctrl+K palette's polish (UI_SPEC.md §5, FR-C3). Every action of the keyboard
// map is there with its keys and what it is; the letters a search matched are marked; the items
// run last come first while nothing is typed, after a reload too; each Options tab is found by
// what it holds and opens on that tab; Page Down moves a page and keeps the highlight in view.
// The search itself is unit-tested in apps/web/test/palette.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' });
const options = (page: Page) => palette(page).getByRole('option');
const selected = (page: Page) => palette(page).locator('[role="option"][aria-selected="true"]');

/** Screenshots for the PR when TRIYA_SHOTS names a folder. */
async function shot(page: Page, name: string) {
  const dir = process.env['TRIYA_SHOTS'];
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), animations: 'disabled' });
}

async function open(page: Page) {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
}

test.describe('the Ctrl+K palette (1600 px)', () => {
  test.use({ viewport: { width: 1600, height: 900 } });
  test.describe.configure({ timeout: 90_000 });

  test('keys, marks, recently used, Options tabs and Page Down', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    await page.keyboard.type('clean');
    // The command and the keyboard map's action, each saying what it is.
    const action = options(page).filter({ hasText: 'Clean Screen on/off' });
    await expect(action).toContainText('Ctrl+0');
    await expect(action.locator('.group')).toHaveText('View');
    await expect(options(page).filter({ hasText: 'CLEANSCREENON' }).locator('.group')).toHaveText(
      'Command',
    );
    await expect(action.locator('mark')).toHaveText('Clean');
    await shot(page, '6-palette-search-marks.png');
    await action.click();
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByTestId('ribbon')).toBeHidden();
    await page.keyboard.press('Control+0');
    await expect(page.getByTestId('ribbon')).toBeVisible();

    // A search for what a tab holds finds the tab, and opens Options on it.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('autosnap');
    await expect(options(page).first()).toContainText('Options: Drafting');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Options' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Drafting' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // With nothing typed the items run last come first, newest first.
    await page.keyboard.press('Control+k');
    await expect(options(page).nth(0)).toContainText('Options: Drafting');
    await expect(options(page).nth(0).locator('.group')).toHaveText('Recently used');
    await expect(options(page).nth(1)).toContainText('Clean Screen on/off');
    await shot(page, '7-palette-recently-used.png');

    // Page Down moves a page, the highlight kept in view; ↑ from the top wraps to the end.
    await page.keyboard.press('PageDown');
    await expect(selected(page)).toHaveId(/palette-/);
    await expect(options(page).nth(8)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await expect(selected(page)).toBeInViewport();
    await page.keyboard.press('PageUp');
    await page.keyboard.press('PageUp');
    await page.keyboard.press('PageUp');
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(options(page).last()).toHaveAttribute('aria-selected', 'true');
    await expect(selected(page)).toBeInViewport();
    await page.keyboard.press('Escape');

    // Kept with the preferences: after a reload they still come first.
    await page.reload();
    await openWithPicker(page, DXF);
    await expectShown(page, path.basename(DXF));
    await page.keyboard.press('Control+k');
    await expect(options(page).nth(0)).toContainText('Options: Drafting');
    await expect(options(page).nth(1)).toContainText('Clean Screen on/off');
  });
});
