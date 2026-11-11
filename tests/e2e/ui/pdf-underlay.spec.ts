// M1-20: PDF underlays through pdf.js. The thread-authored drawing (packages/testkit/src/underlay
// /fixture.ts) attaches page 1 of its PDF at the origin, one unit per inch, and page 2 at
// (12, 0), half size, turned 30° and clipped by a pentagon. Before the PDF is supplied only
// page 2's clip boundary shows; once it is dropped on the window, pdf.js loads, draws the pages
// the canvas asks for, and they show with their colours adjusted for the dark canvas. Zooming in
// and back to the same view draws from the page cache, not pdf.js. The golden image of this
// drawing comes with the fidelity harness (M1-24).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { colourAt, expectShown, ink, openWithDrop, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');
const DXF = path.join(FIXTURES, 'pdf-underlay.dxf');
const PDF = path.join(FIXTURES, 'pdf-underlay.pdf');
// M2-38 part 2: one page with three PDF layers, attached twice (fixture.ts `underlayLayersDxf`).
const LAYERS_DXF = path.join(FIXTURES, 'pdf-underlay-layers.dxf');
const LAYERS_PDF = path.join(FIXTURES, 'pdf-underlay-layers.pdf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const pdfRenders = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { triyaDev: { pdfRenders(): number } }).triyaDev.pdfRenders(),
  );

const nav = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Navigation' }).getByRole('button', { name, exact: true });

test('draws PDF underlay pages once their file is dropped, from the cache when revisited', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  const tab = page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab', {
    name: 'pdf-underlay.dxf',
  });
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  // ZOOM Extents frames page 2's clip and the line under both pages (page 1 has no known
  // extent before its PDF is read); one ZOOM Out brings page 1's lower half in too.
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(50);
  await nav(page, 'Zoom Extents').click();
  await nav(page, 'Zoom Out').click();
  const v = await viewOf(page);
  const red = v.at(2, 2);
  // Page 2's triangle, (5.5, 4.25) in on the page: half size, turned 30° about (12, 0).
  const t = { x: 5.5 * 0.5, y: 4.25 * 0.5 };
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  const green = v.at(12 + t.x * cos - t.y * sin, t.x * sin + t.y * cos);
  const before = await ink(page);
  const dark = await colourAt(page, red);
  expect(Math.max(...dark.slice(0, 3))).toBeLessThan(80);
  expect(await pdfRenders(page)).toBe(0);

  await openWithDrop(page, PDF);
  await expectShown(page, 'pdf-underlay.dxf');
  // Pure red keeps its lightness, so the dark canvas leaves it red.
  await expect
    .poll(
      async () => {
        const [r, g, b] = await colourAt(page, red);
        return r! > 200 && g! < 60 && b! < 60;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  // The green triangle shows inside page 2's clip, lightened for the dark canvas.
  await expect
    .poll(
      async () => {
        const [r, g, b] = await colourAt(page, green);
        return g! > 200 && r! < g! && b! < g!;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  expect(await ink(page)).toBeGreaterThan(before + 1000);
  const drawn = await pdfRenders(page);
  expect(drawn).toBeGreaterThanOrEqual(2);

  // In and back: ZOOM Previous shows the view before, whose pages the cache still holds.
  await nav(page, 'Zoom In').click();
  await expect.poll(() => pdfRenders(page), { timeout: 30_000 }).toBeGreaterThan(drawn);
  await page.waitForTimeout(1000);
  const zoomedIn = await pdfRenders(page);
  await nav(page, 'Zoom Previous').click();
  await expect
    .poll(
      async () => {
        const [r, g, b] = await colourAt(page, red);
        return r! > 200 && g! < 60 && b! < 60;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.waitForTimeout(1000);
  expect(await pdfRenders(page)).toBe(zoomedIn);
});

/** The LINE entities the drawing's commands added, as [x1, y1, x2, y2]. */
async function linesAdded(page: Page): Promise<number[][]> {
  const changes = await page.evaluate(() =>
    (window as unknown as { triyaDev: { changes(): readonly ChangeSet[] } }).triyaDev.changes(),
  );
  const out: number[][] = [];
  for (const cs of changes) {
    for (const { entity } of cs.entities?.added ?? []) {
      if (entity.geom.kind !== 'LINE') continue;
      const { start, end } = entity.geom;
      out.push([start.x, start.y, end.x, end.y]);
    }
  }
  return out;
}

/** A point of page 2 (inches) in the drawing: half size, turned 30° about (12, 0). */
const onPage2 = (x: number, y: number) => {
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  return { x: 12 + 0.5 * (x * cos - y * sin), y: 0.5 * (x * sin + y * cos) };
};

test('snaps to the PDF page’s grid corners inside the clip, and nothing outside it (M2-22)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const prompt = page.getByTestId('command-prompt');
  const tip = page.getByTestId('autosnap-tip');
  const type = async (text: string, next: string) => {
    if (text) await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await expect(prompt).toHaveText(next);
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'pdf-underlay.dxf');
  await openWithDrop(page, PDF);
  await expectShown(page, 'pdf-underlay.dxf');
  // Page 2's grid around its corners (3, 4), inside the pentagon, and (3, 7), above its roof.
  await type(
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type('10.8,1.8', 'Specify opposite corner:');
  await type('13.4,4.4', 'Command:');
  await expect.poll(() => pdfRenders(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  const view = await viewOf(page);
  const move = (p: { x: number; y: number }, dx = 0, dy = 0) => {
    const s = view.at(p.x, p.y);
    return page.mouse.move(view.box.x + s.x + dx, view.box.y + s.y + dy);
  };
  const inside = onPage2(3, 4);
  const outside = onPage2(3, 7);

  await type('L', 'Specify first point:');
  // Above the roof the grid lines are clipped away: nothing to snap to.
  await move(outside, 4, -3);
  await move(outside, 3, -3);
  await page.waitForTimeout(500);
  await expect(tip).toBeHidden();
  // A few pixels off the corner inside: AutoSnap marks the intersection and the click takes it.
  await expect
    .poll(
      async () => {
        await move(inside, 4, -3);
        await move(inside, 3, -3);
        return tip.getAttribute('data-mode', { timeout: 1000 }).catch(() => null);
      },
      { timeout: 30_000 },
    )
    .toBe('INT');
  await expect(tip).toHaveText('Intersection');
  await page.mouse.down();
  await page.mouse.up();
  await expect(prompt).toHaveText('Specify next point or [Undo]:');
  await type('@1,0', 'Specify next point or [Undo]:');
  await type('', 'Command:');
  const [line] = await linesAdded(page);
  expect(Math.abs(line![0]! - inside.x)).toBeLessThan(1e-6);
  expect(Math.abs(line![1]! - inside.y)).toBeLessThan(1e-6);
});

test('draws an underlay without the PDF layers it turns off (ULAYERS), the other with them (M2-38)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, LAYERS_DXF);
  await expectShown(page, 'pdf-underlay-layers.dxf');
  await openWithDrop(page, LAYERS_PDF);
  await expectShown(page, 'pdf-underlay-layers.dxf');
  // Both pages are 4 × 3 in, at (0, 0) and (0, −4): extents once pdf.js has read the page.
  await expect.poll(() => pdfRenders(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await nav(page, 'Zoom Extents').click();
  const v = await viewOf(page);
  const colour = (x: number, y: number) => colourAt(page, v.at(x, y));
  const red = (c: number[]) => c[0]! > 200 && c[1]! < 60 && c[2]! < 60;
  const blue = (c: number[]) => c[2]! > 200 && c[0]! < 60 && c[1]! < 60;
  const green = (c: number[]) => c[1]! > 100 && c[0]! < 60 && c[2]! < 60;
  // The plain underlay: Walls red, Notes blue; Draft is off by the PDF's own default.
  await expect.poll(async () => red(await colour(0.75, 1.5)), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => blue(await colour(2, 1.5)), { timeout: 30_000 }).toBe(true);
  expect(green(await colour(3.25, 1.5))).toBe(false);
  // The underlay turning Walls off: its page has Notes alone.
  await expect.poll(async () => blue(await colour(2, -2.5)), { timeout: 30_000 }).toBe(true);
  expect(red(await colour(0.75, -2.5))).toBe(false);
  expect(green(await colour(3.25, -2.5))).toBe(false);
});
