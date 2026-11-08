// M1-35 part 2: ZOOM Extents counts text by its glyphs. The drawing has a short LINE at the
// origin and, well away from it, a TEXT 10 units tall at (100, 50), and no VPORT table, so it
// opens at its extents. The I/O worker that opens it has no fonts, so its extents were the
// line alone and the text opened off to the side; the renderer, which has the bundled fonts,
// measures the text too, as AutoCAD's extents include it.
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, expectShown, openWithPicker, worldAt } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

function drawing(): string {
  return [
    ...['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015'],
    ...['9', '$HANDSEED', '5', 'FFFF', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
    ...['0', 'LINE', '5', '100', '100', 'AcDbEntity', '8', '0', '100', 'AcDbLine'],
    ...['10', '0', '20', '0', '30', '0', '11', '10', '21', '0', '31', '0'],
    ...['0', 'TEXT', '5', '101', '100', 'AcDbEntity', '8', '0', '100', 'AcDbText'],
    ...['10', '100', '20', '50', '30', '0', '40', '10', '1', 'FAR TEXT', '100', 'AcDbText'],
    ...['0', 'ENDSEC', '0', 'EOF', ''],
  ].join('\r\n');
}

const nav = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Navigation' }).getByRole('button', { name, exact: true });

/** The world point at the canvas centre and the world units per CSS pixel there. */
async function centre(page: Page) {
  const box = (await activeCanvas(page).boundingBox())!;
  const cx = Math.round(box.width / 2);
  const cy = Math.round(box.height / 2);
  const c = await worldAt(page, cx, cy);
  const right = await worldAt(page, cx + 100, cy);
  return { ...c, unit: (right.x - c.x) / 100 };
}

/**
 * Framed on the extents from (0, 0) to the text's top right, (about 165, 60): the centre is
 * half way up the text and well right of the line's (5, 0).
 */
function expectFramesText(c: { x: number; y: number; unit: number }) {
  expect(c.x).toBeGreaterThan(60);
  expect(c.x).toBeLessThan(110);
  expect(Math.abs(c.y - 30)).toBeLessThan(2 * c.unit + 0.5);
}

test('opens at and zooms to extents that include text', async ({ page }) => {
  const file = test.info().outputPath('far-text.dxf');
  writeFileSync(file, drawing());
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, 'far-text.dxf');
  expectFramesText(await centre(page));

  await nav(page, 'Zoom In').click();
  await nav(page, 'Zoom In').click();
  await nav(page, 'Zoom Extents').click();
  expectFramesText(await centre(page));
});
