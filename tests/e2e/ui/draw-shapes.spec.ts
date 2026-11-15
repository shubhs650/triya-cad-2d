// M3-01 part 4: ELLIPSE, XLINE, RAY, DONUT and POINT from the app's command line with clicks, as a
// drafter draws them: the ellipse dragged with the cursor while its other axis is asked, an
// xline and a ray through clicked points, donuts placed where clicked, and a point shown as a
// circled cross once PDMODE is 34. Every option's prompts and geometry are unit-tested in
// packages/engine/test/commands; this checks that the bus, the canvas's drag preview, the engine
// worker and the renderer's point figures carry them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import { DXF, activeCanvas, expectShown, lightPixels, openWithPicker } from '../app/page';
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

/** The types of the entities this test added, in order. */
const added = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].map((e) => e.type);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('ELLIPSE dragged, XLINE, RAY, DONUT and a PDMODE 34 POINT', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const click = async (fx: number, fy: number) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
  };
  /** Light pixels in a small box round a fraction of the canvas. */
  const inkAt = (fx: number, fy: number, r = 6) => {
    const x = box.width * fx;
    const y = box.height * fy;
    return lightPixels(page, { x: x - r, y: y - r }, { x: x + r, y: y + r });
  };
  await page.mouse.move(at(0.98, 0.98).x, at(0.98, 0.98).y);
  // The drawing's hatch is drawn before anything is added.
  await expect.poll(() => inkAt(0.45, 0.5)).toBeGreaterThan(20);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  // ELLIPSE: two axis endpoints, then the other axis follows the cursor.
  await type(page, 'ELLIPSE', 'Specify axis endpoint of ellipse or [Arc/Center]:');
  await click(0.08, 0.2);
  await expect(prompt(page)).toHaveText('Specify other endpoint of axis:');
  await click(0.32, 0.2);
  await expect(prompt(page)).toHaveText('Specify distance to other axis or [Rotation]:');
  // The ellipse's top at the centre's x shows only once the cursor is that far from the centre.
  const topY = 0.2 - (box.width * 0.06) / box.height;
  const top = () => inkAt(0.2, topY, 4);
  await page.mouse.move(at(0.2, 0.21).x, at(0.2, 0.21).y, { steps: 2 });
  await expect.poll(top).toBe(0);
  const other = { x: at(0.2, 0).x, y: at(0.2, 0.2).y - box.width * 0.06 };
  await page.mouse.move(other.x, other.y, { steps: 4 });
  await expect.poll(top).toBeGreaterThan(2);
  await page.screenshot({ path: test.info().outputPath('2-ellipse-dragged.png') });
  await page.mouse.click(other.x, other.y);
  await expect(prompt(page)).toHaveText('Command:');

  // XLINE through two clicked points, RAY from a start through one.
  await type(page, 'XLINE', 'Specify a point or [Hor/Ver/Ang/Bisect/Offset]:');
  await click(0.5, 0.5);
  await expect(prompt(page)).toHaveText('Specify through point:');
  await click(0.6, 0.4);
  await expect(prompt(page)).toHaveText('Specify through point:');
  await type(page, '', 'Command:');
  await type(page, 'RAY', 'Specify start point:');
  await click(0.55, 0.8);
  await expect(prompt(page)).toHaveText('Specify through point:');
  await click(0.7, 0.8);
  await type(page, '', 'Command:');

  // DONUT: a zero inside diameter fills it; the outside diameter given by two clicks.
  await type(page, 'DONUT', /^Specify inside diameter of donut <.*>:$/);
  await type(page, '0', /^Specify outside diameter of donut <.*>:$/);
  await click(0.8, 0.25);
  await expect(prompt(page)).toHaveText('Specify second point:');
  await click(0.86, 0.25);
  await expect(prompt(page)).toHaveText('Specify center of donut or <exit>:');
  await click(0.85, 0.25);
  await expect(prompt(page)).toHaveText('Specify center of donut or <exit>:');
  await type(page, '', 'Command:');
  // Filled at its centre.
  await page.mouse.move(at(0.98, 0.98).x, at(0.98, 0.98).y);
  await expect.poll(() => inkAt(0.85, 0.25, 3)).toBeGreaterThan(20);

  // POINT, shown as a circled cross after PDMODE 34 with a size of 5% of the view.
  await type(page, 'PDMODE', /^Enter new value for PDMODE <0>:$/);
  await type(page, '34', 'Command:');
  await type(page, 'POINT', 'Specify a point:');
  await click(0.85, 0.7);
  await expect(prompt(page)).toHaveText('Command:');
  // The circle's rightmost ink, 2.5% of the canvas height to the right of the point.
  const r = (box.height * 0.025) / box.width;
  await page.mouse.move(at(0.98, 0.98).x, at(0.98, 0.98).y);
  await expect.poll(() => inkAt(0.85 + r, 0.7, 3)).toBeGreaterThan(0);

  await expect.poll(() => added(page)).toEqual(['ELLIPSE', 'XLINE', 'RAY', 'LWPOLYLINE', 'POINT']);
  await page.screenshot({ path: test.info().outputPath('3-after.png') });
});
