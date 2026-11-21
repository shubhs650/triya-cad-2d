// M6-02 part 19: SNAPMODE, GRIDMODE and UCSICON are each viewport's (AutoCAD 2024 Help, each
// "Saved in: Drawing"; the DXF reference's VPORT 75, 76 and 74 and VIEWPORT 90 bits 256, 512, 32
// and 64). ACadSharp's sample_AC1032_ascii.dxf was saved with model space's grid on (its *Active
// VPORT's 76 is 1) and its layouts' paper space with it off: it opens with GRID on, and F7 turns
// model space's own off without touching a layout's. In a layout UCSICON shows and hides paper
// space's icon, its paper-space viewport's bit 32.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, enterCommand, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const toggle = (page: Page, name: string) =>
  page.getByRole('contentinfo').getByRole('button', { name, exact: true });
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab', { name });

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test('GRID and SNAP open as the drawing saved them and stay each viewport’s own', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await expectDrawn(page, { timeout: 15_000 });
  // Model space's *Active VPORT has the grid on and snap off.
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'false');
  await shot(page, '1-model-opens-with-its-grid');

  // A layout's paper space has its own, off.
  await tab(page, 'Layout1').click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('F9');
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'true');
  // UCSICON in paper space: its paper-space viewport's icon.
  const icon = activeCanvas(page).locator('..').getByTestId('ucs-icon');
  await expect(icon).toBeVisible();
  await enterCommand(page, 'UCSICON');
  await page.keyboard.type('OFF');
  await page.keyboard.press('Enter');
  await expect(icon).toBeHidden();
  await shot(page, '2-layout-snap-on-icon-off');

  // Model space kept its own: grid on, snap off; F7 turns its grid off there only.
  await tab(page, 'Model').click();
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('F7');
  await expect(toggle(page, 'GRID')).toHaveAttribute('aria-pressed', 'false');
  await shot(page, '3-model-grid-off');
  await tab(page, 'Layout1').click();
  await expect(toggle(page, 'SNAP')).toHaveAttribute('aria-pressed', 'true');
  await expect(icon).toBeHidden();
  // SETVAR reads the viewport worked in's.
  await enterCommand(page, 'SNAPMODE');
  await expect(page.getByTestId('command-prompt')).toHaveText('Enter new value for SNAPMODE <1>:');
  await page.keyboard.press('Escape');
});
