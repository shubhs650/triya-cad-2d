// M6-02 part 1: MVIEW in a layout. sample_AC1018.dwg's MyLayout has one floating viewport showing
// model space on most of the sheet: MVIEW OFF hides it (the paper inside its frame turns blank),
// a viewport made from two corners inside that area shows model space there again, and U takes
// each back.
import path from 'node:path';
import { expect, test } from '@playwright/test';
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

test('MVIEW turns a viewport off and makes one that shows model space', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await tabs.nth(3).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expectDrawn(page, { timeout: 15_000 });

  // A band across the middle of the sheet, inside the viewport's frame, where model space shows.
  const box = (await activeCanvas(page).boundingBox())!;
  const a = { x: box.width * 0.22, y: box.height * 0.3 };
  const b = { x: box.width * 0.45, y: box.height * 0.8 };
  const area = Math.round((b.x - a.x) * (b.y - a.y));
  const blank = () => lightPixels(page, { x: a.x + 4, y: a.y + 4 }, { x: b.x - 4, y: b.y - 4 });
  const shown = await blank();
  expect(shown).toBeLessThan(area * 0.97);

  // OFF: every floating viewport of the layout picked (ALL), the layout's own never.
  await enterCommand(page, 'MVIEW');
  await enterCommand(page, 'OFF');
  await enterCommand(page, 'ALL');
  await enterCommand(page, '');
  await expect.poll(blank).toBeGreaterThan(shown + 200);
  const off = await blank();

  // A new viewport from two corners typed in paper space shows model space in it again.
  const p = await worldAt(page, a.x, b.y);
  const q = await worldAt(page, b.x, a.y);
  await enterCommand(page, 'MV');
  await enterCommand(page, `${p.x},${p.y}`);
  await enterCommand(page, `${q.x},${q.y}`);
  await expectInputsRead(page);
  await expect.poll(blank).toBeLessThan(off - 200);

  // U takes the new viewport away, U again turns the first one back on.
  await enterCommand(page, 'U');
  await expect.poll(blank).toBeGreaterThan(off - 50);
  await enterCommand(page, 'U');
  await expect.poll(blank).toBeLessThan(off - 200);
});
