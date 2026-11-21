// M6-02 part 14: MVIEW NAmed and NEw place a view of model space on the layout in a new
// display-locked viewport (AutoCAD 2024 Help, "MVIEW (Command)"). sample_AC1018.dwg's MyLayout has
// one floating viewport over most of the sheet: turned off, the sheet is blank there; a named view
// saved on the Model tab, and a window picked there by NEw, each come back in a viewport placed
// with a click (a typed point) in the middle of that area.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  lightPixels,
  openWithPicker,
  worldAt,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const shot = async (page: Page, name: string) => {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: `${dir}/${name}.png` });
};

test('MVIEW NAmed and NEw place model views in new layout viewports', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  const prompt = page.getByTestId('command-prompt');
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // A named view of model space as the Model tab shows it.
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Model');
  await expectDrawn(page, { timeout: 15_000 });
  await enterCommand(page, '-VIEW');
  await enterCommand(page, 'Save');
  await enterCommand(page, 'Whole');
  await expectInputsRead(page);

  await tabs.nth(3).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expectDrawn(page, { timeout: 15_000 });
  const box = (await activeCanvas(page).boundingBox())!;
  const a = { x: box.width * 0.22, y: box.height * 0.3 };
  const b = { x: box.width * 0.45, y: box.height * 0.8 };
  const blank = () => lightPixels(page, { x: a.x + 4, y: a.y + 4 }, { x: b.x - 4, y: b.y - 4 });
  const middle = await worldAt(page, (a.x + b.x) / 2, (a.y + b.y) / 2);
  await enterCommand(page, 'MVIEW');
  await enterCommand(page, 'OFF');
  await enterCommand(page, 'ALL');
  await enterCommand(page, '');
  await expectInputsRead(page);
  const off = await blank();
  await shot(page, '1-before-viewport-off');

  // NAmed: the view named, a scale chosen to fit the sheet, the click its centre.
  await enterCommand(page, 'MV');
  await enterCommand(page, 'NA');
  await expect(prompt).toContainText('Enter view name or');
  await enterCommand(page, 'Whole');
  await expect(prompt).toContainText('Specify viewport location or');
  await expect(log).toContainText('Viewport scale:');
  await enterCommand(page, `${middle.x},${middle.y}`);
  await expectInputsRead(page);
  await expect.poll(blank).toBeLessThan(off - 200);
  await shot(page, '2-named-view-placed');

  await enterCommand(page, 'U');
  await expect.poll(blank).toBeGreaterThan(off - 50);

  // NEw: the Model tab shown for the window's corners, the layout again for the placing.
  await enterCommand(page, 'MV');
  await enterCommand(page, 'NE');
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Model');
  await expect(prompt).toContainText('Specify first corner');
  await expectDrawn(page, { timeout: 15_000 });
  const model = (await activeCanvas(page).boundingBox())!;
  const p = await worldAt(page, model.width * 0.25, model.height * 0.75);
  const q = await worldAt(page, model.width * 0.75, model.height * 0.25);
  await enterCommand(page, `${p.x},${p.y}`);
  await enterCommand(page, `${q.x},${q.y}`);
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expect(prompt).toContainText('Specify viewport location or');
  await enterCommand(page, 'Scale');
  await expect(prompt).toContainText('Enter viewport scale or');
  await enterCommand(page, '');
  await enterCommand(page, `${middle.x},${middle.y}`);
  await expectInputsRead(page);
  await expect.poll(blank).toBeLessThan(off - 200);
  await shot(page, '3-new-view-placed');
});
