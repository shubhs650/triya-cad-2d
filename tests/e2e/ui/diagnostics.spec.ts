// The Diagnostics palette (M7-08 part 2, ARCHITECTURE.md §17): frame time, entity counts, cache
// sizes, worker status and the last command's timing for the drawing on screen, read again every
// second. Opened from the palette rail and from Tools > Drawing Utilities.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DWG, activeCanvas, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** Screenshots for the PR when TRIYA_SHOTS names a folder. */
async function shot(page: Page, name: string) {
  const dir = process.env['TRIYA_SHOTS'];
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), animations: 'disabled' });
}

const palette = (page: Page) => page.getByRole('complementary', { name: 'Diagnostics' });

test('shows frame times, entity counts, caches, workers and the last command', async ({ page }) => {
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Diagnostics', exact: true })
    .click();
  const p = palette(page);
  await expect(p).toBeVisible();

  // The drawing's entities, as the file holds them.
  await expect(p.getByTestId('diagnostics-entities')).not.toHaveText('0');
  // Its canvas: drawn by the render worker, with frames and their times.
  const canvas = p.getByTestId('diagnostics-canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toContainText('Model');
  await expect(canvas).toContainText(/Worker, answered in [\d.]+ ms/);
  await expect(p.getByTestId('diagnostics-last-frame')).toHaveText(/^[\d.]+ ms$/);
  await expect(p.getByText('Worker', { exact: true })).toBeVisible();
  await expect(p.getByTestId('diagnostics-last-command')).toHaveText('None yet');

  // A command run: its timing and the engine's read of its input show within a second.
  const frames = Number(await p.getByTestId('diagnostics-frames').textContent());
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, 'E');
  await expect(p.getByTestId('diagnostics-last-command')).toHaveText(/^ZOOM, [\d.]+ m?s$/);
  await expect(p.getByTestId('diagnostics-last-input')).toHaveText(/^[\d.]+ ms$/);
  await expect
    .poll(async () => Number(await p.getByTestId('diagnostics-frames').textContent()))
    .toBeGreaterThan(frames);

  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height - 40);
  await shot(page, '5-diagnostics-palette.png');

  await p.getByRole('button', { name: 'Close Diagnostics' }).click();
  await expect(p).toBeHidden();

  // Tools > Drawing Utilities opens it too.
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  await page
    .getByRole('group', { name: 'Drawing Utilities' })
    .getByRole('button', { name: 'Diagnostics', exact: true })
    .click();
  await expect(palette(page)).toBeVisible();
});
