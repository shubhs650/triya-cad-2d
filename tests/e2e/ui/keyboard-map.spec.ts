// M7-06: AutoCAD's remaining default window keys (UI_SPEC.md §5, keymap.ts). Ctrl+0 is Clean
// Screen (the ribbon, palettes and Palettes rail go; the status bar's Clean Screen button shows
// it is on), Ctrl+Shift+H hides and shows the palettes, Ctrl+F2 shows the command history,
// Ctrl+Page Down and Page Up step along the layout tabs, Ctrl+[ cancels like Esc, Ctrl+R makes
// the next tiled viewport current and Ctrl+F6 shows the next drawing. Their commands
// (CLEANSCREENON/OFF, HIDEPALETTES/SHOWPALETTES, TEXTSCR/GRAPHSCR) do the same. The map itself
// is unit-tested in apps/web/test/keymap.test.ts against AutoCAD's whole default list.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DWG, DXF, enterCommand, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DXF_NAME = path.basename(DXF);
const DWG_NAME = path.basename(DWG);

const prompt = (page: Page) => page.getByTestId('command-prompt');
const ribbon = (page: Page) => page.getByTestId('ribbon');
const rail = (page: Page) => page.getByRole('navigation', { name: 'Palettes' });
const stack = (page: Page) => page.getByRole('region', { name: 'Palette stack' });
const properties = (page: Page) => stack(page).getByRole('tab', { name: 'Properties' });
const history = (page: Page) => page.getByRole('complementary', { name: 'Command History' });
const cleanButton = (page: Page) => page.getByRole('button', { name: 'Clean Screen' });
const layoutTab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab', { name });

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
  await expectShown(page, DXF_NAME);
  await expectDrawn(page, { timeout: 15_000 });
  await expect(prompt(page)).toHaveText('Command:');
}

test.describe('the window keys (1600 px)', () => {
  test.use({ viewport: { width: 1600, height: 900 } });
  test.describe.configure({ timeout: 90_000 });

  test('Ctrl+0 Clean Screen, Ctrl+Shift+H palettes, and their commands', async ({ page }) => {
    await open(page);
    await rail(page).getByRole('button', { name: 'Properties', exact: true }).click();
    await expect(properties(page)).toBeVisible();
    await expect(cleanButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(cleanButton(page)).toHaveAttribute('title', 'Clean Screen (Ctrl+0)');
    await shot(page, '1-before-clean-screen.png');

    // Ctrl+0: the ribbon, the palette stack and the rail go; the command line and status bar stay.
    await page.keyboard.press('Control+0');
    await expect(ribbon(page)).toBeHidden();
    await expect(rail(page)).toHaveCount(0);
    await expect(stack(page)).toHaveCount(0);
    await expect(cleanButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('region', { name: 'Command line' })).toBeVisible();
    await shot(page, '2-clean-screen-on.png');
    await page.keyboard.press('Control+0');
    await expect(ribbon(page)).toBeVisible();
    await expect(properties(page)).toBeVisible();
    await expect(rail(page)).toBeVisible();

    // The commands and the status bar button do the same.
    await enterCommand(page, 'CLEANSCREENON');
    await expect(ribbon(page)).toBeHidden();
    await cleanButton(page).click();
    await expect(ribbon(page)).toBeVisible();
    await expect(cleanButton(page)).toHaveAttribute('aria-pressed', 'false');

    // Ctrl+Shift+H hides the palettes open, their tabs kept; again shows them.
    await page.keyboard.press('Control+Shift+H');
    await expect(stack(page)).toHaveCount(0);
    await expect(rail(page)).toBeVisible();
    await shot(page, '3-palettes-hidden.png');
    await page.keyboard.press('Control+Shift+H');
    await expect(properties(page)).toBeVisible();
    // HIDEPALETTES, then a palette's key shows them again.
    await enterCommand(page, 'HIDEPALETTES');
    await expect(stack(page)).toHaveCount(0);
    await enterCommand(page, 'SHOWPALETTES');
    await expect(properties(page)).toBeVisible();
  });

  test('Ctrl+F2 history, Ctrl+Page Down/Up layouts, Ctrl+[ cancels', async ({ page }) => {
    await open(page);
    // Ctrl+F2 is AutoCAD's text window: the Command History palette; GRAPHSCR closes it.
    await page.keyboard.press('Control+F2');
    await expect(history(page)).toBeVisible();
    await enterCommand(page, 'GRAPHSCR');
    await expect(history(page)).toHaveCount(0);
    await enterCommand(page, 'TEXTSCR');
    await expect(history(page)).toBeVisible();

    // Ctrl+Page Down steps to the next layout tab, stopping at the last; Page Up back to Model.
    await expect(layoutTab(page, 'Model')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+PageDown');
    await expect(layoutTab(page, 'Layout1')).toHaveAttribute('aria-selected', 'true');
    await shot(page, '4-ctrl-page-down-layout.png');
    await page.keyboard.press('Control+PageUp');
    await expect(layoutTab(page, 'Model')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+PageUp');
    await expect(layoutTab(page, 'Model')).toHaveAttribute('aria-selected', 'true');

    // Ctrl+[ is Esc: LINE is cancelled.
    await enterCommand(page, 'LINE');
    await expect(prompt(page)).toContainText('Specify first point');
    await page.keyboard.press('Control+BracketLeft');
    await expect(prompt(page)).toHaveText('Command:');
    await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText('*Cancel*');
  });

  test('Ctrl+R makes the next tiled viewport current, Ctrl+F6 the next drawing', async ({
    page,
  }) => {
    await open(page);
    // Two tiled viewports side by side (-VPORTS 2, Vertical), the left one current.
    await enterCommand(page, '-VPORTS');
    await enterCommand(page, '2');
    await enterCommand(page, '');
    const tiles = page.locator('canvas[aria-label^="Model"]');
    await expect(tiles).toHaveCount(2);
    await expect(tiles.nth(0)).toHaveAttribute('data-active', 'true');
    await page.keyboard.press('Control+r');
    await expect(tiles.nth(1)).toHaveAttribute('data-active', 'true');
    await expect(tiles.nth(0)).toHaveAttribute('data-active', 'false');
    await shot(page, '5-ctrl-r-next-viewport.png');
    await page.keyboard.press('Control+r');
    await expect(tiles.nth(0)).toHaveAttribute('data-active', 'true');

    // Ctrl+F6 and Ctrl+Shift+F6 (Ctrl+Tab in the installed app) step through the drawings.
    await openWithPicker(page, DWG);
    await expectShown(page, DWG_NAME);
    await page.keyboard.press('Control+F6');
    await expectShown(page, DXF_NAME);
    await page.keyboard.press('Control+Shift+F6');
    await expectShown(page, DWG_NAME);
  });
});
