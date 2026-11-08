// M1-20: PDF underlays through pdf.js. The thread-authored drawing (packages/testkit/src/underlay
// /fixture.ts) attaches page 1 of its PDF at the origin, one unit per inch, and page 2 at
// (12, 0), half size, turned 30° and clipped by a pentagon. Before the PDF is supplied only
// page 2's clip boundary shows; once it is dropped on the window, pdf.js loads, draws the pages
// the canvas asks for, and they show with their colours adjusted for the dark canvas. Zooming in
// and back to the same view draws from the page cache, not pdf.js. The golden image of this
// drawing comes with the fidelity harness (M1-24).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { colourAt, expectShown, ink, openWithDrop, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');
const DXF = path.join(FIXTURES, 'pdf-underlay.dxf');
const PDF = path.join(FIXTURES, 'pdf-underlay.pdf');

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
