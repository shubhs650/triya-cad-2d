// M6-02 part 3: a layout worked in through a viewport. sample_AC1018.dwg's MyLayout has one
// floating viewport showing model space on most of the sheet. A double click inside it makes it
// current: the cursor's coordinates turn model space's, a line typed there goes into model space
// (LIST says so) and is drawn through the viewport; a double click off the sheet puts the layout
// back in paper space. MSPACE and PSPACE do the same from the command line.
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

test('a double click works in a layout viewport; off the sheet, in paper space again', async ({
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
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // A point inside the viewport's frame, in paper space's coordinates.
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = { x: box.width * 0.33, y: box.height * 0.55 };
  const paper = await worldAt(page, at.x, at.y);

  await page.mouse.dblclick(box.x + at.x, box.y + at.y);
  await expect.poll(() => viewport(page)).not.toBe('');
  await expect(page.getByTestId('space')).toHaveText('MODEL');
  // The same spot now reads in model space's coordinates.
  await page.mouse.move(box.x + at.x + 20, box.y + at.y + 20);
  const model = await worldAt(page, at.x, at.y);
  // (The viewport shows model space at nearly 1:1, a little moved: 4.74,3.53 on paper is
  // 4.65,3.87 in model space.)
  expect(Math.hypot(model.x - paper.x, model.y - paper.y)).toBeGreaterThan(0.1);
  // Forty pixels to the right, in model space's units.
  const right = await worldAt(page, at.x + 40, at.y);
  const unit = (right.x - model.x) / 40;
  expect(unit).toBeGreaterThan(0);

  // A line typed in model coordinates lands in model space.
  await enterCommand(page, 'LINE');
  await enterCommand(page, `${model.x},${model.y}`);
  await enterCommand(page, `${model.x + 60 * unit},${model.y}`);
  await enterCommand(page, '');
  await expectInputsRead(page);
  await enterCommand(page, 'LIST');
  await enterCommand(page, 'L');
  await enterCommand(page, '');
  await page.keyboard.press('F2');
  const history = page.getByRole('complementary', { name: 'Command History' });
  await expect(history).toContainText('Space: Model space');
  await page.keyboard.press('F2');
  await expect(history).toBeHidden();
  // Selected, the line shows its grips and highlight through the viewport.
  await page.keyboard.press('Escape');
  await page.mouse.click(box.x + at.x + 30, box.y + at.y);
  await page.mouse.move(box.x + at.x + 30, box.y + at.y + 60);
  await page.screenshot({ path: test.info().outputPath('1-working-in-viewport.png') });
  await page.keyboard.press('Escape');

  // Off the sheet, where no viewport is: paper space again.
  await page.mouse.dblclick(box.x + 8, box.y + 8);
  await expect.poll(() => viewport(page)).toBe('');
  await expect(page.getByTestId('space')).toHaveText('PAPER');
  await page.mouse.move(box.x + at.x + 20, box.y + at.y + 20);
  const back = await worldAt(page, at.x, at.y);
  expect(back.x).toBeCloseTo(paper.x, 1);
  expect(back.y).toBeCloseTo(paper.y, 1);
  await page.screenshot({ path: test.info().outputPath('2-paper-space-again.png') });

  // MSPACE makes the viewport last current current again; PSPACE leaves it.
  await enterCommand(page, 'MS');
  await expect.poll(() => viewport(page)).not.toBe('');
  await page.mouse.move(box.x + at.x + 20, box.y + at.y + 20);
  const again = await worldAt(page, at.x, at.y);
  expect(again.x).toBeCloseTo(model.x, 1);
  await enterCommand(page, 'PS');
  await expect.poll(() => viewport(page)).toBe('');
  await enterCommand(page, 'PS');
  await expect(log).toContainText('Already in paper space.');
});
