// M3-01 part 1: CIRCLE and ARC from the app's command line with clicks, as a drafter draws them:
// the circle dragged with the cursor while its radius is asked, an arc through three clicked
// points, an arc continued tangent from it with Enter, and a line continued tangent from that
// arc. Every method's prompts and geometry are unit-tested in packages/engine/test/commands;
// this checks that the bus, the canvas's drag preview and the engine worker carry them.
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

test('CIRCLE dragged and clicked, ARC 3P, ARC and LINE continuing tangent', async ({ page }) => {
  test.setTimeout(90_000);
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
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  await type(page, 'CIRCLE', 'Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:');
  await click(0.15, 0.7);
  await expect(prompt(page)).toHaveText('Specify radius of circle or [Diameter]:');
  // The circle follows the cursor before the radius is given: the light linework at the top of
  // a circle of radius 0.1 × the canvas width shows only once the cursor is that far out.
  const cx = box.width * 0.15;
  const top = box.height * 0.7 - box.width * 0.1;
  const atTop = () => lightPixels(page, { x: cx - 8, y: top - 4 }, { x: cx + 8, y: top + 4 });
  const small = at(0.17, 0.7);
  await page.mouse.move(small.x, small.y, { steps: 2 });
  await expect.poll(atTop).toBe(0);
  const large = at(0.25, 0.7);
  await page.mouse.move(large.x, large.y, { steps: 4 });
  await expect.poll(atTop).toBeGreaterThan(4);
  await page.screenshot({ path: test.info().outputPath('2-circle-dragged.png') });
  await page.mouse.click(large.x, large.y);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => added(page)).toEqual(['CIRCLE']);

  // ARC 3P with three clicks, then Enter continues tangent from its end.
  await type(page, 'ARC', 'Specify start point of arc or [Center]:');
  await click(0.45, 0.6);
  await expect(prompt(page)).toHaveText('Specify second point of arc or [Center/End]:');
  await click(0.55, 0.45);
  await expect(prompt(page)).toHaveText('Specify end point of arc:');
  await click(0.65, 0.6);
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'ARC', 'Specify start point of arc or [Center]:');
  await type(page, '', 'Specify end point of arc (hold Ctrl to switch direction):');
  const end = at(0.8, 0.75);
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.screenshot({ path: test.info().outputPath('3-arc-continued-dragged.png') });
  await page.mouse.click(end.x, end.y);
  await expect(prompt(page)).toHaveText('Command:');

  // LINE continues tangent from the arc, asking only its length.
  await type(page, 'LINE', 'Specify first point:');
  await type(page, '', 'Specify length of line:');
  await type(page, '20', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(() => added(page)).toEqual(['CIRCLE', 'ARC', 'ARC', 'LINE']);
  await page.mouse.move(at(0.95, 0.95).x, at(0.95, 0.95).y);
  await page.screenshot({ path: test.info().outputPath('4-after.png') });
});
