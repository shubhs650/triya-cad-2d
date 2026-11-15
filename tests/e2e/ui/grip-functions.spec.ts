// M3-05 part 1: multi-functional grips in the app. A polyline drawn on an empty part of the plan
// and picked at `Command:` shows its vertex and segment midpoint grips; a click on a vertex makes
// it hot (STRETCH), and a tap of Ctrl goes on to its next function, ADD VERTEX, drawn following
// the cursor before the click that adds the vertex. A segment's midpoint grip, Ctrl twice, turns
// the segment into an arc through the click; the arc's midpoint grip, with the function typed
// (LI), straightens it again. The functions' rules are unit-tested in packages/engine.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
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

/** The polyline's vertices (x, y, bulge), less the 1,000,000 offset of the empty part used. */
const vertices = (page: Page) =>
  page.evaluate(() => {
    let out: number[][] = [];
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind !== 'LWPOLYLINE') return;
      const r = (v: number) => Math.round(v * 1e3) / 1e3 + 0;
      out = g.vertices.map((v) => [r(v.x - 1e6), r(v.y - 1e6), r(v.bulge)]);
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
    }
    return out;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** How many near-white pixels (the polyline, ACI 7 on the dark canvas) around a point. */
async function bright(page: Page, x: number, y: number, r = 4): Promise<number> {
  const png = await page.screenshot({ clip: { x: x - r, y: y - r, width: 2 * r, height: 2 * r } });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! > 200 && d[i + 1]! > 200 && d[i + 2]! > 200) n++;
    return n;
  }, png.toString('base64'));
}

test('multi-functional grips: Ctrl cycles a hot grip’s functions', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  // ZOOM Window fits 160 × 100 units about (80, 50) into the canvas.
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const move = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'PL', 'Specify start point:');
  await type(page, '1000050,1000040', /^Specify next point/);
  await type(page, '1000090,1000040', /^Specify next point/);
  await type(page, '1000090,1000070', /^Specify next point/);
  await type(page, '', 'Command:');
  await expect
    .poll(() => vertices(page))
    .toEqual([
      [50, 40, 0],
      [90, 40, 0],
      [90, 70, 0],
    ]);
  // Running object snaps would pull the clicks below onto the polyline's own points; off.
  await page.keyboard.press('F3');

  // Picked, then its corner made hot: STRETCH; a tap of Ctrl goes on to ADD VERTEX.
  await click(70, 40);
  await click(90, 40);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await page.keyboard.press('Control');
  await expect(prompt(page)).toHaveText('Specify new vertex point or [eXit]:');
  // The polyline is drawn with the new vertex at the cursor before the click.
  await move(110, 55);
  const between = at(100, 47.5);
  await expect.poll(() => bright(page, between.x, between.y)).toBeGreaterThan(0);
  await shot('1-add-vertex-drag.png');
  await click(110, 55);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => vertices(page))
    .toEqual([
      [50, 40, 0],
      [90, 40, 0],
      [110, 55, 0],
      [90, 70, 0],
    ]);

  // Still selected: the first segment's midpoint grip, Ctrl twice: CONVERT TO ARC.
  await click(70, 40);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await page.keyboard.press('Control');
  await expect(prompt(page)).toHaveText('Specify new vertex point or [eXit]:');
  await page.keyboard.press('Control');
  await expect(prompt(page)).toHaveText('Specify arc midpoint or [eXit]:');
  await move(70, 20);
  await shot('2-convert-to-arc-drag.png');
  await click(70, 20);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => (await vertices(page))[0]).toEqual([50, 40, 1]);
  await shot('3-arc.png');

  // The arc's midpoint grip, its function typed: Convert to Line.
  await click(70, 20);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await type(page, 'LI', 'Command:');
  await expect.poll(async () => (await vertices(page))[0]).toEqual([50, 40, 0]);
});
