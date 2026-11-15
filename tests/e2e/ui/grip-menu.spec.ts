// M3-05 part 2: a grip's hover menu, GRIPHOVER and Ctrl-copy in the app. A polyline drawn on an
// empty part of the plan and picked at `Command:` shows its grips; the cursor on a vertex grip
// turns it GRIPHOVER's colour (ACI 11) at once, and resting there shows the grip's functions in
// a menu beside it (AutoCAD's "Stretch Vertex, Add Vertex, Remove Vertex"). Remove Vertex chosen
// there takes the vertex out at once; Add Vertex makes the grip hot in that function. A click
// with Ctrl held at a grip mode's prompt leaves a copy. The rules are unit-tested in
// packages/engine (grip-menu.test.ts) and apps/web (grip-menu.test.ts).
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

/** Each polyline's vertices (x, y), less the 1,000,000 offset of the empty part used. */
const polylines = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, number[][]>();
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind !== 'LWPOLYLINE') return;
      const r = (v: number) => Math.round(v * 1e3) / 1e3 + 0;
      out.set(
        e.handle,
        g.vertices.map((v) => [r(v.x - 1e6), r(v.y - 1e6)]),
      );
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
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

/** How many pixels around a point are GRIPHOVER's light red (ACI 11, #ff7f7f). */
async function hoverPixels(page: Page, x: number, y: number, r = 3): Promise<number> {
  const png = await page.screenshot({ clip: { x: x - r, y: y - r, width: 2 * r, height: 2 * r } });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (r > 220 && g > 95 && g < 160 && b > 95 && b < 160) n++;
    }
    return n;
  }, png.toString('base64'));
}

test('a grip’s hover menu, GRIPHOVER and Ctrl-copy', async ({ page }) => {
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
  const click = async (x: number, y: number, modifiers?: 'Control'[]) => {
    const p = at(x, y);
    if (modifiers) await page.keyboard.down('Control');
    await page.mouse.click(p.x, p.y);
    if (modifiers) await page.keyboard.up('Control');
  };
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const menu = page.getByTestId('grip-menu');

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
    .poll(() => polylines(page))
    .toEqual([
      [
        [50, 40],
        [90, 40],
        [90, 70],
      ],
    ]);
  // Running object snaps would pull the clicks below onto the polyline's own points; off.
  await page.keyboard.press('F3');
  await click(70, 40);

  // The cursor on the corner grip: GRIPHOVER (ACI 11, a light red); then, resting, its menu.
  const corner = at(90, 40);
  await move(80, 40);
  expect(await hoverPixels(page, corner.x, corner.y)).toBe(0);
  await move(90, 40);
  await expect.poll(() => hoverPixels(page, corner.x, corner.y)).toBeGreaterThan(4);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Stretch Vertex',
    'Add Vertex',
    'Remove Vertex',
  ]);
  await shot('1-grip-hover-menu.png');

  // Add Vertex: the grip is hot in that function.
  await menu.getByRole('menuitem', { name: 'Add Vertex' }).click();
  await expect(menu).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify new vertex point or [eXit]:');
  await move(110, 55);
  await shot('2-add-vertex-from-menu.png');
  await click(110, 55);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => polylines(page))
    .toEqual([
      [
        [50, 40],
        [90, 40],
        [110, 55],
        [90, 70],
      ],
    ]);

  // Remove Vertex from the new vertex's menu: at once.
  await move(100, 50);
  await move(110, 55);
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Remove Vertex' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => polylines(page))
    .toEqual([
      [
        [50, 40],
        [90, 40],
        [90, 70],
      ],
    ]);

  // Ctrl-copy: the start grip hot, Enter to MOVE, a click with Ctrl held leaves a copy and the
  // mode goes on copying; Enter ends.
  await click(50, 40);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await type(page, '', 'Specify move point or [Base point/Copy/Undo/eXit]:');
  await click(50, 10, ['Control']);
  await expect(prompt(page)).toHaveText('Specify move point or [Base point/Copy/Undo/eXit]:');
  await expect.poll(async () => (await polylines(page)).length).toBe(2);
  await shot('3-ctrl-copy.png');
  await type(page, '', 'Command:');
  await expect
    .poll(() => polylines(page))
    .toEqual([
      [
        [50, 40],
        [90, 40],
        [90, 70],
      ],
      [
        [50, 10],
        [90, 10],
        [90, 40],
      ],
    ]);
});
