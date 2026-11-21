// M6-02 part 15: a twisted layout viewport (DXF 51) is worked in turned. The test drawing is
// self-authored/viewport-overrides.dxf with its top-left viewport (handle 43, frame centre paper
// 105,212, 180 × 120, model 100,60 at its middle) twisted 30° about that model point: its view
// centre (DXF 12/22) is in the twisted display coordinates, R(30°)·(100, 60). A double click
// makes it current (it was refused before); the crosshairs turn with model space (AutoCAD 2024
// Help, "VIEWTWIST"; the crosshairs follow the UCS, which the view turns on the screen); the
// point under the cursor moves along the turned axes; VIEWTWIST says 30; ZOOM 2X zooms about
// the frame's middle and the saved drawing keeps the twist.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const TWIST = 30;
const MIDDLE = { x: 100, y: 60 };
const CENTRE = { x: 105, y: 212 };

/** The test drawing: viewport 43 of the source twisted by TWIST about the model at its middle. */
function twistedDrawing(dir: string): string {
  const lines = readFileSync(SOURCE, 'latin1').split(/\r?\n/);
  const r = (TWIST * Math.PI) / 180;
  const set: Record<string, string> = {
    '12': String(MIDDLE.x * Math.cos(r) - MIDDLE.y * Math.sin(r)),
    '22': String(MIDDLE.x * Math.sin(r) + MIDDLE.y * Math.cos(r)),
    '51': String(TWIST),
  };
  let inside = false;
  let changed = 0;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i]!.trim();
    const value = lines[i + 1]!.trim();
    if (code === '0') inside = value === 'VIEWPORT' && lines[i + 3]?.trim() === '43';
    else if (inside && code in set) {
      lines[i + 1] = set[code]!;
      changed++;
    }
  }
  expect(changed).toBe(3);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'twisted-viewport.dxf');
  writeFileSync(file, lines.join('\n'), 'latin1');
  return file;
}

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

test('a twisted layout viewport is worked in turned', async ({ page }) => {
  test.setTimeout(90_000);
  const file = twistedDrawing(test.info().outputPath('drawing'));
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab', { name: 'Layout1' })
    .click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
  await expectDrawn(page, { timeout: 15_000 });
  await shot(page, '1-twisted-viewport-on-the-sheet');

  // A double click inside the twisted viewport makes it current.
  const v = await viewOf(page);
  const mid = v.at(CENTRE.x, CENTRE.y);
  await page.mouse.dblclick(v.box.x + mid.x, v.box.y + mid.y);
  await expect.poll(() => viewport(page)).toBe('43');
  await expect(page.getByTestId('space')).toHaveText('MODEL');

  // The crosshairs turn with model space: the WCS's X axis shows 30° up from the screen's.
  const cursor = () => activeCanvas(page).evaluate((c) => getComputedStyle(c).cursor);
  await page.mouse.move(v.box.x + mid.x, v.box.y + mid.y);
  await expect.poll(cursor).toContain(`rotate(${-TWIST}`);

  // The model point at the frame's middle, and the cursor 200 px right of it: model space's
  // point there runs 30° below its X axis, the screen's X as the twisted view turns it.
  const here = await worldAt(page, mid.x, mid.y);
  expect(here.x).toBeCloseTo(MIDDLE.x, 0);
  expect(here.y).toBeCloseTo(MIDDLE.y, 0);
  const right = await worldAt(page, mid.x + 200, mid.y);
  const angle = (Math.atan2(right.y - here.y, right.x - here.x) * 180) / Math.PI;
  expect(angle).toBeCloseTo(-TWIST, 0);
  await page.keyboard.press('F7');
  await page.mouse.move(v.box.x + mid.x + 40, v.box.y + mid.y + 20);
  await shot(page, '2-working-in-the-twisted-viewport-grid-on');
  await page.keyboard.press('F7');

  const log = page.getByRole('log', { name: 'Recent command lines' });
  await enterCommand(page, 'VIEWTWIST');
  // In the drawing's angular units (AUPREC 2 here).
  await expect(log).toContainText(`VIEWTWIST = ${TWIST}.00 (read only)`);

  // ZOOM 2X about the frame's middle: the same model point stays there, twice as large.
  const before = Math.hypot(right.x - here.x, right.y - here.y);
  await enterCommand(page, 'ZOOM');
  await enterCommand(page, '2X');
  await expectInputsRead(page);
  await expect
    .poll(async () => {
      const a = await worldAt(page, mid.x, mid.y);
      const b = await worldAt(page, mid.x + 200, mid.y);
      return Math.hypot(b.x - a.x, b.y - a.y);
    })
    .toBeCloseTo(before / 2, 1);
  const still = await worldAt(page, mid.x, mid.y);
  expect(still.x).toBeCloseTo(MIDDLE.x, 0);
  expect(still.y).toBeCloseTo(MIDDLE.y, 0);
  await shot(page, '3-zoomed-2x-in-the-twisted-viewport');
});
