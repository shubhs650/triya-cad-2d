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
import {
  DWG,
  DXF,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectShown,
  openWithPicker,
} from '../app/page';
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

// M7-06 part 3: Ctrl+9 (COMMANDLINE, COMMANDLINEHIDE) and Ctrl+I (COORDS).
test.describe('the command line and coordinates keys (1600 px)', () => {
  test.use({ viewport: { width: 1600, height: 900 } });
  test.describe.configure({ timeout: 90_000 });

  const line = (page: Page) => page.getByRole('region', { name: 'Command line' });
  const coords = (page: Page) => page.getByTestId('coords');
  const at = async (page: Page, fx: number, fy: number) => {
    const box = (await activeCanvas(page).boundingBox())!;
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  };
  const hover = async (page: Page, fx: number, fy: number) => {
    const p = await at(page, fx, fy);
    await page.mouse.move(p.x - 4, p.y - 4);
    await page.mouse.move(p.x, p.y);
  };
  const decimal = /^-?\d+\.\d{4}, -?\d+\.\d{4}, 0\.0000$/;

  test('Ctrl+9 hides the command line; typing still reaches it', async ({ page }) => {
    await open(page);
    const height = (await activeCanvas(page).boundingBox())!.height;
    await page.keyboard.press('Control+9');
    await expect(line(page)).toHaveAttribute('data-hidden', 'true');
    await expect(page.getByRole('log', { name: 'Recent command lines' })).toBeHidden();
    await expect(page.getByLabel('Command', { exact: true })).not.toBeInViewport({ ratio: 0.5 });
    // The drawing area takes its room.
    await expect
      .poll(async () => (await activeCanvas(page).boundingBox())!.height)
      .toBeGreaterThan(height + 20);
    await shot(page, '8-command-line-hidden.png');

    // Typed, the input row shows over the drawing area, and stays while the command prompts.
    await hover(page, 0.5, 0.5);
    await page.keyboard.type('LINE');
    await expect(line(page)).toHaveAttribute('data-input', 'shown');
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toContainText('Specify first point');
    await expect(prompt(page)).toBeVisible();
    await shot(page, '9-command-line-floating.png');
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toHaveText('Command:');
    await expect(line(page)).not.toHaveAttribute('data-input');

    await page.keyboard.press('Control+9');
    await expect(line(page)).not.toHaveAttribute('data-hidden');
    await expect(page.getByRole('log', { name: 'Recent command lines' })).toBeVisible();
    // The commands do the same.
    await enterCommand(page, 'COMMANDLINEHIDE');
    await expect(line(page)).toHaveAttribute('data-hidden', 'true');
    await enterCommand(page, 'COMMANDLINE');
    await expect(line(page)).not.toHaveAttribute('data-hidden');
  });

  test('Ctrl+I turns the coordinates off and on; COORDS 2 shows distance<angle', async ({
    page,
  }) => {
    await open(page);
    await expect(coords(page)).toHaveAttribute('data-coords', '1');
    await expect(coords(page)).toHaveAttribute('title', 'Coordinates: absolute (Ctrl+I)');
    await hover(page, 0.4, 0.5);
    await expect(coords(page)).toHaveText(decimal);
    const shown = (await coords(page).textContent())!;

    // COORDS 0: they stay as they were while the cursor moves, and change as a point is picked.
    await page.keyboard.press('Control+i');
    await expect(coords(page)).toHaveAttribute('data-coords', '0');
    await hover(page, 0.6, 0.4);
    await expect(coords(page)).toHaveText(shown);
    await enterCommand(page, 'LINE');
    await expect(prompt(page)).toContainText('Specify first point');
    await page.mouse.click((await at(page, 0.6, 0.4)).x, (await at(page, 0.6, 0.4)).y);
    await expect(prompt(page)).toContainText('Specify next point');
    await expect(coords(page)).not.toHaveText(shown);
    const picked = (await coords(page).textContent())!;
    await hover(page, 0.3, 0.6);
    await expect(coords(page)).toHaveText(picked);
    await shot(page, '10-coords-off.png');
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toHaveText('Command:');

    // Ctrl+I again: they follow the cursor.
    await page.keyboard.press('Control+i');
    await expect(coords(page)).toHaveAttribute('data-coords', '1');
    await hover(page, 0.45, 0.55);
    await expect(coords(page)).not.toHaveText(picked);
    await expect(coords(page)).toHaveText(decimal);

    // COORDS 2: at LINE's next point, the distance and angle from the first.
    await enterCommand(page, 'COORDS');
    await enterCommand(page, '2');
    await expect(coords(page)).toHaveAttribute('data-coords', '2');
    await enterCommand(page, 'LINE');
    await expect(prompt(page)).toContainText('Specify first point');
    const first = await at(page, 0.4, 0.5);
    await page.mouse.click(first.x, first.y);
    await expect(prompt(page)).toContainText('Specify next point');
    await hover(page, 0.55, 0.35);
    await expect(coords(page)).toHaveText(/^\d+\.\d{4}<\d+(\.\d+)?, 0\.0000$/);
    await shot(page, '11-coords-distance-angle.png');
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toHaveText('Command:');
    await hover(page, 0.5, 0.5);
    await expect(coords(page)).toHaveText(decimal);
  });
});
