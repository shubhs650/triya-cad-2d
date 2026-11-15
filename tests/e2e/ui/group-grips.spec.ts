// M3-13: a group selected whole shows one grip at its centre and its bounding box
// (GROUPDISPLAYMODE 2, AutoCAD's initial value), not its members' own grips; the Group Bounding
// Box toggle (Ctrl+K) takes the box away; a click on the centre grip makes it hot and the next
// click moves the whole group. GROUPDISPLAYMODE, the copies of groups and PICKSTYLE 2 are
// unit-tested in packages/engine (test/commands/group.test.ts); the drawing of the grip and box
// in packages/render (test/drag.test.ts).
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
 * The pixels of a small square of the page around a point, counted by colour: `blue` (grips
 * and the group's box, ACI 150) and `red` (the hot grip, ACI 12).
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

test('a selected group’s centre grip and bounding box, and moving it by that grip', async ({
  page,
}) => {
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
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const near = (x: number, y: number) => pixels(page, at(x, y).x, at(x, y).y);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  for (const y of [40, 60]) {
    await type(page, 'L', 'Specify first point:');
    await type(page, `1000060,10000${y}`, 'Specify next point or [Undo]:');
    await type(page, `1000100,10000${y}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  await expect
    .poll(() => lines(page))
    .toEqual([
      [60, 40, 100, 40],
      [60, 60, 100, 60],
    ]);
  // Running object snaps would pull the clicks below onto the lines' own points; off.
  await page.keyboard.press('F3');
  await type(page, 'G', 'Select objects or [Name/Description]:');
  await click(70, 40);
  await click(70, 60);
  await type(page, '', 'Command:');

  // One pick selects the group: one grip at its centre (80, 50) and its bounding box (its left
  // side at x 60), none at a member's midpoint (80, 40), which the box's edge only crosses.
  await click(70, 40);
  await expect.poll(async () => (await near(80, 50)).blue).toBeGreaterThan(40);
  await expect.poll(async () => (await near(60, 50)).blue).toBeGreaterThan(0);
  expect((await near(80, 40)).blue).toBeLessThan(20);
  await shot('1-group-grip-and-box.png');

  // The Group Bounding Box toggle: the grip stays, the box goes.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('Group Bounding Box');
  await expect(palette.getByRole('option').first()).toContainText('Group Bounding Box on/off');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect.poll(async () => (await near(60, 50)).blue).toBe(0);
  expect((await near(80, 50)).blue).toBeGreaterThan(40);
  expect((await near(80, 40)).blue).toBe(0);
  await shot('2-group-grip-without-box.png');

  // A click on the centre grip makes it hot; the next click moves the whole group.
  await click(80, 50);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await expect.poll(async () => (await near(80, 50)).red).toBeGreaterThan(20);
  const p = at(80, 80);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await shot('3-group-grip-hot-dragging.png');
  await click(80, 80);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => lines(page))
    .toEqual([
      [60, 70, 100, 70],
      [60, 90, 100, 90],
    ]);
  await shot('4-group-moved.png');
});
