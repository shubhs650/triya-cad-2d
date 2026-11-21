// M5-04 part 20: calibrating a PDF underlay's scale with two picks, the way AutoCAD 2024 does
// it (AutoCAD has no calibration command: SCALE's Reference option, AutoCAD Help "SCALE
// (Command)", with PDFOSNAP snapping to the underlay's vectors): SCALE, the underlay, a base
// point, Reference, two points snapped on the page, then the true length between them. The PDF
// underlay test drawing (packages/testkit/src/underlay/fixture.ts) shows page 1 at the origin, a
// unit an inch, with a black 1 in grid; grid corners (1, 1) and (3, 1) are 2 in apart, which the
// drafter says is 50. The ribbon's Insert > Reference > Snap to Underlays button (M7-01; the
// Ctrl+K palette's toggle before it) turns UOSNAP, PDFOSNAP here, off and on. SHOTS=<dir> saves
// the PR's screenshots.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { expectShown, openWithDrop, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');
const DXF = path.join(FIXTURES, 'pdf-underlay.dxf');
const PDF = path.join(FIXTURES, 'pdf-underlay.pdf');
const SHOTS = process.env['SHOTS'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Every PDFUNDERLAY replaced so far, after its change. */
async function underlaysUpdated(page: Page) {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: { changes(): readonly ChangeSet[] } }).triyaDev.changes(),
  );
  const out = [];
  for (const cs of changes)
    for (const { after } of cs.entities?.updated ?? [])
      if (after.geom.kind === 'PDFUNDERLAY') out.push(after.geom);
  return out;
}

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  // pdf.js draws the page at the new view's resolution a moment after the view changes.
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/** The PDF underlay test drawing, its PDF dropped, zoomed to page 1's lower left corner. */
async function openPage1(page: Page) {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'pdf-underlay.dxf');
  await openWithDrop(page, PDF);
  await expectShown(page, 'pdf-underlay.dxf');
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '-0.5,-0.5', 'Specify opposite corner:');
  await type(page, '3.5,3.5', 'Command:');
  // The page is drawn, so its size and vectors are known (the frame to pick, the snaps).
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { triyaDev: { pdfRenders(): number } }).triyaDev.pdfRenders(),
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(1);
  const v = await viewOf(page);
  const tip = page.getByTestId('autosnap-tip');
  /** Hovers a few pixels off page point (x, y); the object snap AutoSnap marks, if any. */
  const hover = async (x: number, y: number) => {
    const s = v.at(x, y);
    await page.mouse.move(v.box.x + s.x + 4, v.box.y + s.y - 3);
    await page.mouse.move(v.box.x + s.x + 3, v.box.y + s.y - 3);
    return tip.getAttribute('data-mode', { timeout: 1000 }).catch(() => null);
  };
  /** Hovers until AutoSnap marks page point (x, y), then clicks. */
  const snapAt = async (x: number, y: number) => {
    await expect.poll(() => hover(x, y), { timeout: 30_000 }).toMatch(/^(INT|END)$/);
    await page.mouse.down();
    await page.mouse.up();
  };
  return { v, tip, hover, snapAt };
}

test('SCALE Reference calibrates a PDF underlay by two points snapped on its page', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { v, snapAt } = await openPage1(page);
  await shot(page, '1-before-calibration');

  await type(page, 'SCALE', 'Select objects:');
  // Page 1's left edge holds no content: the pick takes the underlay by its frame.
  const edge = v.at(0, 2);
  await page.mouse.click(v.box.x + edge.x, v.box.y + edge.y);
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText('1 found');
  await type(page, '', 'Specify base point:');
  await snapAt(1, 1);
  await expect(prompt(page)).toHaveText('Specify scale factor or [Copy/Reference] <1.0000>:');
  await type(page, 'R', 'Specify reference length <1.0000>:');
  await snapAt(1, 1);
  await expect(prompt(page)).toHaveText('Specify second point:');
  await snapAt(3, 1);
  await shot(page, '2-second-reference-point');
  await expect(prompt(page)).toHaveText('Specify new length or [Points] <1.0000>:');
  await type(page, '50', 'Command:');

  const [after] = (await underlaysUpdated(page)).slice(-1);
  expect(after).toBeDefined();
  // 50 / 2 = 25 about (1, 1): the page's corner at the origin goes to (1 - 25, 1 - 25).
  expect(after!.scale.x).toBeCloseTo(25, 9);
  expect(after!.scale.y).toBeCloseTo(25, 9);
  expect(after!.position.x).toBeCloseTo(-24, 9);
  expect(after!.position.y).toBeCloseTo(-24, 9);
  // The calibrated page, 25 times its size, in the drawing's extents.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'E', 'Command:');
  await page.mouse.move(640, 708);
  await shot(page, '3-after-calibration');
});

test("the ribbon's Snap to Underlays button turns UOSNAP, so PDFOSNAP, off and on again", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { tip, hover } = await openPage1(page);
  // AutoCAD's split button: its list's OFF entry, from the Insert tab.
  const toggle = async () => {
    const ribbon = page.getByTestId('ribbon');
    await ribbon.getByRole('tab', { name: 'Insert' }).click();
    await ribbon
      .getByRole('group', { name: 'Reference' })
      .getByRole('button', { name: 'Snap to Underlays options' })
      .click();
    const menu = page.getByRole('menu', { name: 'Snap to Underlays' });
    await menu.getByRole('menuitemradio', { name: 'Snap to Underlays OFF' }).click();
    await expect(menu).toHaveCount(0);
    await ribbon.getByRole('tab', { name: 'Home' }).click();
  };

  await type(page, 'L', 'Specify first point:');
  await expect.poll(() => hover(1, 1), { timeout: 30_000 }).toMatch(/^(INT|END)$/);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  await toggle();
  await type(page, 'UOSNAP', 'Enter new value for UOSNAP <0>:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'PDFOSNAP', 'Enter new value for PDFOSNAP <0>:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'L', 'Specify first point:');
  await hover(1, 1);
  await page.waitForTimeout(500);
  await expect(tip).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // UOSNAP 1 turns it on again, as the toggle does.
  await type(page, 'UOSNAP', 'Enter new value for UOSNAP <0>:');
  await type(page, '1', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await expect.poll(() => hover(1, 1), { timeout: 30_000 }).toMatch(/^(INT|END)$/);
  await page.keyboard.press('Escape');
});
