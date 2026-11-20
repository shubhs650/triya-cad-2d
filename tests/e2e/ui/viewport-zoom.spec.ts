// M6-02 part 4: ZOOM, PAN and the wheel in a layout viewport made current change that viewport's
// own view, not the sheet: sample_AC1018.dwg's MyLayout has one floating viewport. In MSPACE, ZOOM
// 2X shows model space twice as large in the frame, the wheel zooms about the model point under
// the cursor, -PAN moves model space in the frame; the sheet does not move (paper space's
// coordinates under the cursor are as before), and U takes the zooms back.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
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

/** The viewport the canvas works in (its handle), '' in paper space. */
const viewport = (page: Page) => activeCanvas(page).getAttribute('data-viewport');

/** Model units per 200 pixels across, at `at`: the cursor's coordinates in the status bar. */
async function unitsAcross(page: Page, at: { x: number; y: number }): Promise<number> {
  const a = await worldAt(page, at.x, at.y);
  const b = await worldAt(page, at.x + 200, at.y);
  return b.x - a.x;
}

test("ZOOM, the wheel and PAN in a layout viewport change its own view, not the sheet's", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await tabs.nth(3).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  // Inside the viewport's frame, which takes most of the sheet.
  const at = { x: box.width * 0.3, y: box.height * 0.55 };
  const paper = await worldAt(page, at.x, at.y);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  await enterCommand(page, 'MSPACE');
  await expect.poll(() => viewport(page)).not.toBe('');
  const before = await unitsAcross(page, at);
  expect(before).toBeGreaterThan(0);

  // ZOOM 2X: twice as large in the frame.
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, '2X');
  await expectInputsRead(page);
  await expect.poll(() => unitsAcross(page, at)).toBeCloseTo(before / 2, 2);

  // The wheel: the model point under the cursor stays under it.
  const under = await worldAt(page, at.x, at.y);
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => unitsAcross(page, at)).toBeLessThan(before / 2 - 0.01);
  const still = await worldAt(page, at.x, at.y);
  expect(still.x).toBeCloseTo(under.x, 1);
  expect(still.y).toBeCloseTo(under.y, 1);

  // -PAN by one model unit to the right: the point under the cursor is one unit less.
  await enterCommand(page, '-PAN');
  await enterCommand(page, '0,0');
  await enterCommand(page, '1,0');
  await expectInputsRead(page);
  await expect.poll(async () => (await worldAt(page, at.x, at.y)).x).toBeCloseTo(still.x - 1, 1);
  await page.screenshot({ path: test.info().outputPath('2-viewport-zoomed.png') });

  // The sheet stayed where it was: paper space's coordinates under the cursor are as before.
  await enterCommand(page, 'PSPACE');
  await expect.poll(() => viewport(page)).toBe('');
  const sheet = await worldAt(page, at.x, at.y);
  expect(sheet.x).toBeCloseTo(paper.x, 2);
  expect(sheet.y).toBeCloseTo(paper.y, 2);

  // U takes back the pan and the zooms (one step: UNDO Control Combine).
  await enterCommand(page, 'MSPACE');
  await expect.poll(() => viewport(page)).not.toBe('');
  await enterCommand(page, 'U');
  await expectInputsRead(page);
  await expect.poll(() => unitsAcross(page, at)).toBeCloseTo(before, 2);
});
