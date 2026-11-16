// M3-11 part 3: array grips in the app. An associative array picked at `Command:` shows its
// base grip and the blue triangles that size it; a click on the column count triangle makes it
// hot (red) and asks for the number of columns, the next click counts them, the far corner's
// triangle counts rows and columns at once, and a polar array's second item sets the angle
// between items typed. What each grip does is unit-tested in
// packages/engine/test/commands/array-grips.test.ts.
// M3-05 part 7: while a triangle is hot the array is drawn remade as the cursor drags it, and
// Dynamic Input's field at a count grip names the function and shows the count, which can be
// typed.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import { DXF, activeCanvas, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function answer(page: Page, text: string, next: string | RegExp): Promise<void> {
  await enterCommand(page, text);
  await expect(prompt(page)).toHaveText(next);
}

/** How many item INSERTs each array block holds, as the change sets left them, sorted. */
const itemCounts = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) out.set(u.after.handle, u.after);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    const inserts = [...out.values()].filter((e) => e.geom.kind === 'INSERT');
    const space = inserts.find((e) => !inserts.some((i) => i.handle === e.owner))?.owner;
    const counts = new Map<string, number>();
    for (const e of inserts)
      if (e.owner !== space) counts.set(e.owner, (counts.get(e.owner) ?? 0) + 1);
    return [...counts.values()].sort((a, b) => a - b);
  });

/** The grip colours in a small square of the page about a point: blue grips, the red hot one. */
async function gripPixels(page: Page, x: number, y: number, r = 6) {
  const png = await page.screenshot({ clip: { x: x - r, y: y - r, width: 2 * r, height: 2 * r } });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let blue = 0;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (B > 180 && R < 80) blue++;
      else if (R > 150 && G < 60 && B < 60) red++;
    }
    return { blue, red };
  }, png.toString('base64'));
}

test('array grips count columns and rows and set a polar array’s angle between items', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  // ZOOM Window fits 160 × 100 units about (80, 50) into the canvas, in an empty part far off.
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const move = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  const blue = async (x: number, y: number) =>
    (await gripPixels(page, at(x, y).x, at(x, y).y)).blue;
  const red = async (x: number, y: number) => (await gripPixels(page, at(x, y).x, at(x, y).y)).red;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await answer(page, 'ZOOM', /^Specify corner of window/);
  await answer(page, '1000000,1000000', 'Specify opposite corner:');
  await answer(page, '1000160,1000100', 'Command:');
  // A short stroke: its 4 × 4 extents make the array 6 apart, about its centre (20, 20).
  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '1000018,1000018', 'Specify next point or [Undo]:');
  await answer(page, '1000022,1000022', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
  await answer(page, 'ARRAYRECT', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', /^Select grip to edit array/);
  await answer(page, '', 'Command:');
  await expect.poll(() => itemCounts(page)).toEqual([12]);
  // Running object snaps would pull the clicks onto the strokes' points; off.
  await page.keyboard.press('F3');

  // Picked at Command: the base grip and the triangles show, the column count one at the end
  // of the first row (38, 20).
  await click(27, 27);
  await expect.poll(() => blue(38, 20)).toBeGreaterThan(10);
  expect(await blue(38, 32)).toBeGreaterThan(10);
  await shot('1-array-grips.png');

  await click(38, 20);
  await expect(prompt(page)).toHaveText('Specify number of columns or [Total spacing/eXit]:');
  await expect.poll(() => red(38, 20)).toBeGreaterThan(10);
  await move(56, 20);
  await shot('2-column-count-hot.png');
  await click(56, 20);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => itemCounts(page)).toEqual([21]);
  await shot('3-seven-columns.png');

  // Still selected: the far corner (56, 32) counts rows and columns to the click.
  await expect.poll(() => blue(56, 32)).toBeGreaterThan(10);
  await click(56, 32);
  await expect(prompt(page)).toHaveText(
    'Specify number of rows and columns or [Total spacing/eXit]:',
  );
  await click(44, 44);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => itemCounts(page)).toEqual([25]);
  await shot('4-rows-and-columns.png');
  await page.keyboard.press('Escape');

  // A polar array of six strokes round (110, 50); its second item's triangle, typed 30°.
  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '1000120,1000050', 'Specify next point or [Undo]:');
  await answer(page, '1000124,1000050', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
  await answer(page, 'ARRAYPOLAR', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', /^Specify center point of array/);
  await answer(page, '1000110,1000050', /^Select grip to edit array/);
  await answer(page, '', 'Command:');
  await expect.poll(() => itemCounts(page)).toEqual([6, 25]);
  // The base point (122, 50), 12 from the centre; the second item 60° round.
  const second = { x: 110 + 12 * Math.cos(Math.PI / 3), y: 50 + 12 * Math.sin(Math.PI / 3) };
  await click(122, 50.4);
  await expect.poll(() => blue(second.x, second.y)).toBeGreaterThan(10);
  await shot('5-polar-grips.png');
  await click(second.x, second.y);
  await expect(prompt(page)).toHaveText(
    'Specify the angle between items or [Count/Fill angle/eXit]:',
  );
  await answer(page, '30', 'Command:');
  await expect.poll(() => blue(110 + 12 * Math.cos(Math.PI / 6), 56)).toBeGreaterThan(10);
  await shot('6-polar-30-degrees.png');
});

/** The light pixels in a small square of the page about a point: strokes drawn there. */
async function strokePixels(page: Page, x: number, y: number, r = 6): Promise<number> {
  const png = await page.screenshot({ clip: { x: x - r, y: y - r, width: 2 * r, height: 2 * r } });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 90 && d[i + 1]! > 90 && d[i + 2]! > 90) n++;
    return n;
  }, png.toString('base64'));
}

test('the array drawn remade while a count triangle is dragged, its count in Dynamic Input', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const move = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  const strokes = (x: number, y: number) => strokePixels(page, at(x, y).x, at(x, y).y);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const dyn = page.getByTestId('dyn');

  await answer(page, 'ZOOM', /^Specify corner of window/);
  await answer(page, '1000000,1000000', 'Specify opposite corner:');
  await answer(page, '1000160,1000100', 'Command:');
  // The 4 × 3 array of strokes 6 apart from part 3's test, about (20, 20).
  await answer(page, 'LINE', 'Specify first point:');
  await answer(page, '1000018,1000018', 'Specify next point or [Undo]:');
  await answer(page, '1000022,1000022', 'Specify next point or [Undo]:');
  await answer(page, '', 'Command:');
  await answer(page, 'ARRAYRECT', 'Select objects:');
  await answer(page, 'L', 'Select objects:');
  await answer(page, '', /^Select grip to edit array/);
  await answer(page, '', 'Command:');
  await expect.poll(() => itemCounts(page)).toEqual([12]);
  await page.keyboard.press('F3');

  await click(27, 27);
  await click(38, 20);
  await expect(prompt(page)).toHaveText('Specify number of columns or [Total spacing/eXit]:');
  // No stroke where the sixth column's top row will be, before the drag.
  expect(await strokes(50.5, 32.5)).toBe(0);
  await move(50, 21);
  // Dragged to (50, 21): six columns drawn, the count field saying so.
  await expect.poll(() => strokes(50.5, 32.5)).toBeGreaterThan(3);
  await expect(dyn.getByLabel('Column count')).toHaveText('6');
  await shot('7-column-count-dragged.png');
  await move(62, 21);
  await expect(dyn.getByLabel('Column count')).toHaveText('8');
  await expect.poll(() => strokes(62.5, 32.5)).toBeGreaterThan(3);
  // A count typed in the field.
  await page.keyboard.type('5');
  await expect(dyn.getByLabel('Column count')).toHaveText('5');
  await shot('8-count-typed.png');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => itemCounts(page)).toEqual([15]);
  // The preview is gone with the drag: nothing past the fifth column.
  await move(80, 80);
  await expect.poll(() => strokes(62.5, 32.5)).toBe(0);
  await shot('9-five-columns.png');
});
