// M6-02 part 16: ROTATE turns a layout viewport by any angle, its view with it (VPROTATEASSOC
// 1, AutoCAD's default). On self-authored/viewport-overrides.dxf, Layout1's top-left viewport
// (handle 43, frame centre paper 105,212, 180 × 120, model 100,60 at its middle) is picked by its
// left edge and turned 30° about its middle. It is clipped to its turned frame (AutoCAD makes a
// turned rectangular viewport a clipped one) and still shows model 100,60 at its middle; a
// double click there works in it turned, VIEWTWIST saying 30, and U puts it back.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  openWithPicker,
  viewOf,
  worldAt,
} from '../app/page';
import { CORPUS, startApp } from '../app/server';

const SOURCE = path.join(CORPUS, '../self-authored/viewport-overrides.dxf');
const MIDDLE = { x: 100, y: 60 };
const CENTRE = { x: 105, y: 212 };

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** The viewport the canvas works in (its handle), '' in paper space. */
const viewport = (page: Page) => activeCanvas(page).getAttribute('data-viewport');

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  await page.addStyleTag({ content: '.nav-bar { display: none !important; }' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test('ROTATE turns a layout viewport by 30°, its view with it', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, SOURCE);
  await expectShown(page, path.basename(SOURCE));
  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab', { name: 'Layout1' })
    .click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
  await expectDrawn(page, { timeout: 15_000 });
  const v = await viewOf(page);
  await shot(page, '1-before-rotate');

  // ROTATE, the viewport picked by its left edge, about its middle by 30°.
  await enterCommand(page, 'ROTATE');
  await expectInputsRead(page);
  const edge = v.at(CENTRE.x - 90, CENTRE.y);
  await page.mouse.click(v.box.x + edge.x, v.box.y + edge.y);
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText('1 found');
  await enterCommand(page, '');
  await enterCommand(page, `${CENTRE.x},${CENTRE.y}`);
  await enterCommand(page, '30');
  await expectInputsRead(page);
  await page.mouse.move(v.box.x + 5, v.box.y + 5);
  await shot(page, '2-viewport-turned-30');

  // A double click at its middle works in it, turned: model 100,60 is still there.
  const mid = v.at(CENTRE.x, CENTRE.y);
  await page.mouse.dblclick(v.box.x + mid.x, v.box.y + mid.y);
  await expect.poll(() => viewport(page)).toBe('43');
  const here = await worldAt(page, mid.x, mid.y);
  expect(here.x).toBeCloseTo(MIDDLE.x, 0);
  expect(here.y).toBeCloseTo(MIDDLE.y, 0);
  const log = page.getByRole('log', { name: 'Recent command lines' });
  await enterCommand(page, 'VIEWTWIST');
  await expect(log).toContainText('VIEWTWIST = 30.00 (read only)');
  await shot(page, '3-working-in-the-turned-viewport');

  // Back in paper space, U puts the viewport back square: no twist to work in.
  await enterCommand(page, 'PSPACE');
  await expect.poll(() => viewport(page)).toBe('');
  await enterCommand(page, 'U');
  await expectInputsRead(page);
  await page.mouse.dblclick(v.box.x + mid.x, v.box.y + mid.y);
  await expect.poll(() => viewport(page)).toBe('43');
  await enterCommand(page, 'VIEWTWIST');
  await expect(log).toContainText('VIEWTWIST = 0.00 (read only)');
});
