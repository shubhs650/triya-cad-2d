// M6-02 part 7: VPMAX and VPMIN. sample_AC1018.dwg's MyLayout has one floating viewport. VPMAX
// from MSPACE expands it to fill the canvas, a red border round it: model space at a larger scale
// than its frame showed it, the sheet gone. The wheel zooms the maximized view; VPMIN shows the
// layout again with the viewport's view as it was, still worked in. The status bar's VPMAX
// button does the same, and VPMAX given in paper space comes back to paper space at VPMIN.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  colourAt,
  enterCommand,
  expectDrawn,
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
/** 'true' while the viewport worked in is maximized. */
const maximized = (page: Page) => activeCanvas(page).getAttribute('data-maximized');

/** Model units per 200 pixels across, at `at`: the cursor's coordinates in the status bar. */
async function unitsAcross(page: Page, at: { x: number; y: number }): Promise<number> {
  const a = await worldAt(page, at.x, at.y);
  const b = await worldAt(page, at.x + 200, at.y);
  return b.x - a.x;
}

test('VPMAX fills the canvas with the layout viewport; VPMIN brings the layout back', async ({
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
  const at = { x: box.width * 0.3, y: box.height * 0.55 };
  const button = page.getByRole('button', { name: 'VPMAX' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  await enterCommand(page, 'MSPACE');
  await expect.poll(() => viewport(page)).not.toBe('');
  const framed = await unitsAcross(page, at);
  const there = await worldAt(page, at.x, at.y);
  // The corner of the canvas shows the surround round the sheet: no red.
  const surround = await colourAt(page, { x: 1, y: 1 });
  expect(surround[0]! - surround[1]!).toBeLessThan(60);
  await page.screenshot({ path: test.info().outputPath('1-before-vpmax.png') });

  await enterCommand(page, 'VPMAX');
  await expect.poll(() => maximized(page)).toBe('true');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('space')).toHaveText('MODEL');
  // The frame fills the canvas: model space shows larger, and a red border runs round it.
  await expect.poll(() => unitsAcross(page, at)).toBeLessThan(framed * 0.95);
  const border = await colourAt(page, { x: 1, y: 1 });
  expect(border[0]!).toBeGreaterThan(150);
  expect(border[0]! - border[1]!).toBeGreaterThan(80);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.screenshot({ path: test.info().outputPath('2-maximized.png') });

  // The wheel zooms the maximized view.
  const big = await unitsAcross(page, at);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => unitsAcross(page, at)).toBeLessThan(big * 0.9);
  await page.screenshot({ path: test.info().outputPath('3-maximized-zoomed.png') });

  // VPMIN: the layout again, the viewport still worked in, its own view as it was.
  await enterCommand(page, 'VPMIN');
  await expect.poll(() => maximized(page)).toBe('');
  await expect.poll(() => viewport(page)).not.toBe('');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await unitsAcross(page, at)).toBeCloseTo(framed, 2);
  const back = await worldAt(page, at.x, at.y);
  expect(back.x).toBeCloseTo(there.x, 1);
  expect(back.y).toBeCloseTo(there.y, 1);
  await page.screenshot({ path: test.info().outputPath('4-after-vpmin.png') });

  // From paper space, the status bar's button maximizes the one viewport and restores paper space.
  await enterCommand(page, 'PSPACE');
  await expect.poll(() => viewport(page)).toBe('');
  await button.click();
  await expect.poll(() => maximized(page)).toBe('true');
  await expect(page.getByTestId('space')).toHaveText('MODEL');
  await button.click();
  await expect.poll(() => maximized(page)).toBe('');
  await expect.poll(() => viewport(page)).toBe('');
  await expect(page.getByTestId('space')).toHaveText('PAPER');
});
