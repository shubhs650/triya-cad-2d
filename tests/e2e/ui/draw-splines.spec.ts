// M3-01 part 5: SPLINE, DIVIDE and MEASURE from the app's command line with clicks, as a
// drafter uses them: a Fit spline whose curve follows the cursor, a CV spline, and the first
// divided into equal parts and the second measured off with points. Every option's prompts
// and geometry are unit-tested in packages/engine/test/commands/spline.test.ts; this checks
// that the bus, the canvas's drag preview and the engine worker carry them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, PointGeometry, SplineGeometry } from '@triya/engine';
import {
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  lightPixels,
  openWithPicker,
} from '../app/page';
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

/** The entities this test added. */
const added = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
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

test('SPLINE by fit points and by control vertices, then DIVIDE and MEASURE', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const px = (fx: number, fy: number) => ({ x: box.width * fx, y: box.height * fy });
  const at = (fx: number, fy: number) => ({ x: box.x + px(fx, fy).x, y: box.y + px(fx, fy).y });
  const click = async (fx: number, fy: number) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
  };
  const move = async (fx: number, fy: number) => {
    const p = at(fx, fy);
    await page.mouse.move(p.x, p.y, { steps: 4 });
  };
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  // SPLINE Fit: through three clicks; the curve on to the cursor is dragged: it crosses the
  // box between the second click and the cursor only when the cursor is down there.
  await type(page, 'SPLINE', 'Specify first point or [Method/Knots/Object]:');
  await click(0.1, 0.85);
  await expect(prompt(page)).toHaveText('Enter next point or [start Tangency/toLerance]:');
  await click(0.2, 0.6);
  await expect(prompt(page)).toHaveText('Enter next point or [end Tangency/toLerance/Undo]:');
  const a = px(0.225, 0.63);
  const b = px(0.28, 0.78);
  const between = () => lightPixels(page, a, b);
  await move(0.12, 0.35);
  await expect.poll(between).toBe(0);
  await move(0.3, 0.85);
  await expect.poll(between).toBeGreaterThan(4);
  await page.screenshot({ path: test.info().outputPath('2-spline-fit-dragged.png') });
  await click(0.3, 0.85);
  await click(0.4, 0.6);
  await type(page, '', 'Command:');

  // SPLINE CV: four vertices, the curve inside their polygon.
  await type(page, 'SPLINE', 'Specify first point or [Method/Knots/Object]:');
  await type(page, 'M', 'Enter spline creation method [Fit/CV] <Fit>:');
  await type(page, 'CV', 'Specify first point or [Method/Degree/Object]:');
  await click(0.62, 0.9);
  await expect(prompt(page)).toHaveText('Enter next point:');
  await click(0.66, 0.6);
  await click(0.8, 0.6);
  await expect(prompt(page)).toHaveText('Enter next point or [Close/Undo]:');
  await move(0.86, 0.9);
  await page.screenshot({ path: test.info().outputPath('3-spline-cv-dragged.png') });
  await click(0.86, 0.9);
  await type(page, '', 'Command:');

  // DIVIDE the fit spline (picked on a fit point) in six; MEASURE the CV spline from its
  // start (picked near it).
  await type(page, 'DIVIDE', 'Select object to divide:');
  await click(0.2, 0.6);
  await expect(prompt(page)).toHaveText('Enter the number of segments or [Block]:');
  await type(page, '6', 'Command:');
  await expect.poll(async () => (await added(page)).length).toBe(7);
  const [fit] = (await added(page)).map((e) => e.geom as SplineGeometry);
  const width = Math.abs(fit!.fitPoints![3]!.x - fit!.fitPoints![0]!.x);
  await type(page, 'MEASURE', 'Select object to measure:');
  await click(0.62, 0.9);
  await expect(prompt(page)).toHaveText('Specify length of segment or [Block]:');
  await type(page, (width / 8).toFixed(4), 'Command:');

  const all = await added(page);
  expect(all.map((e) => e.type).slice(0, 2)).toEqual(['SPLINE', 'SPLINE']);
  expect(all[1]!.geom).toMatchObject({ degree: 3 });
  const points = all.slice(2).map((e) => e.geom as PointGeometry);
  expect(points.every((p) => p.kind === 'POINT')).toBe(true);
  expect(points.length).toBeGreaterThan(5 + 2);
  await page.mouse.move(at(0.98, 0.98).x, at(0.98, 0.98).y);
  await page.screenshot({ path: test.info().outputPath('4-after.png') });
});
