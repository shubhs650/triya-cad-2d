// M2-06 part 2: grips, grip editing, STRETCH and the objects dragged with the cursor, in the app
// as a drafter uses them. A line is drawn on an empty part of the plan and picked at `Command:`:
// its grips show (blue squares); a click on its end makes that grip hot and the line stretches
// to the next click, drawn following the cursor on the way; Enter at the grip prompt goes on to
// MOVE. STRETCH then stretches the line's end through a crossing window, and MOVE drags it.
// The grip modes, STRETCH's rules and the drag motions are unit-tested in packages/engine; the
// drawing of grips and dragged objects in packages/render (test/drag.test.ts).
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

/** The lines drawn in this test, less the 1,000,000 offset of the empty part used. */
const lines = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, number[]>();
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind !== 'LINE') return;
      const ends = [g.start, g.end]
        .map((p) => [p.x - 1e6, p.y - 1e6].map((v) => Math.round(v * 1e3) / 1e3 + 0))
        .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
      out.set(e.handle, ends.flat());
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) if (out.has(u.after.handle)) put(u.after);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()];
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * The pixels of a small square of the page around a point, counted by colour: `bright` near
 * white (the line, ACI 7 on the dark canvas) and `blue` (grips, ACI 150), `red` (the hot grip).
 */
async function pixels(page: Page, x: number, y: number, r = 6) {
  const png = await page.screenshot({ clip: { x: x - r, y: y - r, width: 2 * r, height: 2 * r } });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let bright = 0;
    let blue = 0;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (R > 200 && G > 200 && B > 200) bright++;
      else if (B > 180 && R < 80) blue++;
      else if (R > 150 && G < 60 && B < 60) red++;
    }
    return { bright, blue, red };
  }, png.toString('base64'));
}

test('grips, grip editing, STRETCH and dragging', async ({ page }) => {
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
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000070,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000090,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(() => lines(page)).toEqual([[70, 50, 90, 50]]);
  // Running object snaps would pull the clicks below onto the line's own points; off.
  await page.keyboard.press('F3');

  // Picked at Command: the line shows its three grips.
  await click(75, 50);
  const end = at(90, 50);
  await expect.poll(async () => (await pixels(page, end.x, end.y)).blue).toBeGreaterThan(20);
  expect((await pixels(page, at(80, 50).x, at(80, 50).y)).blue).toBeGreaterThan(20);
  await shot('1-grips.png');

  // A click on its end makes it hot: the STRETCH grip mode.
  await click(90, 50);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await expect.poll(async () => (await pixels(page, end.x, end.y)).red).toBeGreaterThan(20);
  // The line is drawn stretched to the cursor before the click.
  await move(90, 80);
  const mid = at(80, 65);
  await expect.poll(async () => (await pixels(page, mid.x, mid.y, 4)).bright).toBeGreaterThan(0);
  await shot('2-grip-stretch-drag.png');
  await click(90, 80);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => lines(page)).toEqual([[70, 50, 90, 80]]);

  // Still selected: its midpoint grip, then Enter goes on to MOVE.
  await click(80, 65);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await type(page, '', 'Specify move point or [Base point/Copy/Undo/eXit]:');
  await type(page, '1000080,1000045', 'Command:');
  await expect.poll(() => lines(page)).toEqual([[70, 30, 90, 60]]);
  await page.keyboard.press('Escape');

  // STRETCH: a crossing window over the line's upper end, then the end dragged right. The
  // corners are typed with the cursor off the canvas, where Dynamic Input would take the
  // second one as relative to the first (DYNPICOORDS 0).
  await page.mouse.move(box.x + box.width / 2, box.y - 20);
  await type(page, 'S', 'Select objects:');
  await type(page, 'C', 'Specify first corner:');
  await type(page, '1000095,1000065', 'Specify opposite corner:');
  await type(page, '1000085,1000055', 'Select objects:');
  await type(page, '', 'Specify base point or [Displacement] <Displacement>:');
  await type(page, '1000090,1000060', 'Specify second point or <use first point as displacement>:');
  await move(120, 60);
  const stretched = at(95, 45);
  await expect
    .poll(async () => (await pixels(page, stretched.x, stretched.y, 4)).bright)
    .toBeGreaterThan(0);
  await shot('3-stretch-drag.png');
  await click(120, 60);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => lines(page)).toEqual([[70, 30, 120, 60]]);

  // MOVE drags the line with the cursor from its base point.
  await type(page, 'M', 'Select objects:');
  await click(95, 45);
  await type(page, '', 'Specify base point or [Displacement] <Displacement>:');
  await type(page, '1000070,1000030', 'Specify second point or <use first point as displacement>:');
  await move(20, 10);
  // The line's middle, moved by (−50, −20): (45, 25).
  const moved = at(45, 25);
  await expect
    .poll(async () => (await pixels(page, moved.x, moved.y, 4)).bright)
    .toBeGreaterThan(0);
  await shot('4-move-drag.png');
  await click(20, 10);
  await expect.poll(() => lines(page)).toEqual([[20, 10, 70, 40]]);
});
