// M1-22 part 4: a drawing saved with tiled model-space viewports (several `*Active` VPORTs)
// opens with each viewport in its part of the window and its own saved view, the first one
// current; clicking in another makes it current, and the navigation bar acts on the current
// one only, as in AutoCAD. The drawing is written here, as AutoCAD stores a two-viewport
// configuration (AutoCAD DXF reference, VPORT): the left half (10/11 = 0,0 – 0.5,1) looks at a
// circle at the origin, 20 units high; the right half (0.5,0 – 1,1) at a circle at (100, 0),
// 40 units high. No public corpus file saves more than one `*Active` VPORT.
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

function vport(
  handle: string,
  ll: [number, number],
  ur: [number, number],
  c: [number, number],
  h: number,
) {
  return [
    ...['0', 'VPORT', '5', handle, '330', '8', '100', 'AcDbSymbolTableRecord'],
    ...['100', 'AcDbViewportTableRecord', '2', '*Active', '70', '0'],
    ...['10', `${ll[0]}`, '20', `${ll[1]}`, '11', `${ur[0]}`, '21', `${ur[1]}`],
    ...['12', `${c[0]}`, '22', `${c[1]}`, '13', '0', '23', '0', '14', '1', '24', '1'],
    ...['15', '1', '25', '1', '16', '0', '26', '0', '36', '1', '17', '0', '27', '0', '37', '0'],
    ...['40', `${h}`, '41', '1', '42', '50', '43', '0', '44', '0', '50', '0', '51', '0'],
    ...['71', '0', '72', '1000', '73', '1', '74', '3', '75', '0', '76', '0', '77', '0', '78', '0'],
  ];
}

const circle = (handle: string, x: number, r: number) => [
  ...['0', 'CIRCLE', '5', handle, '100', 'AcDbEntity', '8', '0', '100', 'AcDbCircle'],
  ...['10', `${x}`, '20', '0', '30', '0', '40', `${r}`],
];

const DRAWING = [
  ...['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015'],
  ...['9', '$HANDSEED', '5', 'FFFF', '0', 'ENDSEC'],
  ...['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'VPORT', '5', '8', '330', '0'],
  ...['100', 'AcDbSymbolTable', '70', '2'],
  ...vport('2E', [0, 0], [0.5, 1], [0, 0], 20),
  ...vport('2F', [0.5, 0], [1, 1], [100, 0], 40),
  ...['0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'],
  ...circle('100', 0, 5),
  ...circle('101', 100, 10),
  ...['0', 'ENDSEC', '0', 'EOF'],
].join('\n');

/** The model canvases of the drawing, current or not. */
const tiles = (page: Page) => page.locator('canvas[aria-label^="Model"]');

/** The current viewport's view: its centre and the world height it shows. */
async function view(page: Page) {
  const box = (await activeCanvas(page).boundingBox())!;
  const cx = Math.round(box.width / 2);
  const cy = Math.round(box.height / 2);
  const c = await worldAt(page, cx, cy);
  const d = await worldAt(page, cx + 100, cy);
  const u = (d.x - c.x) / 100;
  return { box, c, u, height: u * box.height };
}

test.describe('tiled model-space viewports', () => {
  test.describe.configure({ timeout: 90_000 });

  test('opens each viewport in its part of the window and view; the first is current', async ({
    page,
  }) => {
    const file = test.info().outputPath('two-viewports.dxf');
    writeFileSync(file, DRAWING);
    await page.goto(app.url);
    await openWithPicker(page, file);
    await expectShown(page, 'two-viewports.dxf');

    await expect(tiles(page)).toHaveCount(2);
    const [left, right] = [
      (await tiles(page).nth(0).boundingBox())!,
      (await tiles(page).nth(1).boundingBox())!,
    ];
    // Side by side, each half the width and the whole height of the drawing area.
    expect(Math.abs(left.width - right.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(left.height - right.height)).toBeLessThanOrEqual(2);
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 2);
    expect(Math.abs(right.y - left.y)).toBeLessThanOrEqual(2);
    await expect(tiles(page).nth(0)).toHaveAttribute('data-active', 'true');
    await expect(tiles(page).nth(1)).toHaveAttribute('data-active', 'false');

    // The current (left) viewport in its saved view: the origin, 20 units high.
    let v = await view(page);
    expect(v.box.x).toBeCloseTo(left.x, 0);
    expect(Math.abs(v.c.x)).toBeLessThan(2 * v.u);
    expect(Math.abs(v.c.y)).toBeLessThan(2 * v.u);
    expect(v.height).toBeCloseTo(20, 0);

    // A click in the right viewport makes it current; it shows (100, 0), 40 units high.
    await page.mouse.click(right.x + right.width / 2, right.y + right.height / 2);
    await expect(tiles(page).nth(1)).toHaveAttribute('data-active', 'true');
    await expect(tiles(page).nth(0)).toHaveAttribute('data-active', 'false');
    v = await view(page);
    expect(v.box.x).toBeCloseTo(right.x, 0);
    expect(Math.abs(v.c.x - 100)).toBeLessThan(2 * v.u);
    expect(Math.abs(v.c.y)).toBeLessThan(2 * v.u);
    expect(v.height).toBeCloseTo(40, 0);

    // The navigation bar zooms the current viewport only.
    await page
      .getByRole('toolbar', { name: 'Navigation' })
      .getByRole('button', { name: 'Zoom Extents', exact: true })
      .click();
    v = await view(page);
    // The extents, (-5, -10)–(110, 10), centred at (52.5, 0).
    expect(Math.abs(v.c.x - 52.5)).toBeLessThan(2 * v.u + 0.5);

    await page.mouse.click(left.x + left.width / 2, left.y + left.height / 2);
    await expect(tiles(page).nth(0)).toHaveAttribute('data-active', 'true');
    v = await view(page);
    expect(Math.abs(v.c.x)).toBeLessThan(2 * v.u);
    expect(v.height).toBeCloseTo(20, 0);
  });
});
