// M2-10 part 3: STRETCH regenerates a dimension in the app. The acadsharp AC1032 sample's
// horizontal dimension C96 (35.1233 between (313.77, −18.69) and (348.90, −18.69), its line at
// y = −11.72) is stretched through a crossing window over its second extension origin: while
// the second point is asked for, the dimension is drawn afresh following the cursor; after it,
// its stored `*D` block is rewritten with what the dimension engine draws (the new measurement,
// text recentred). The regeneration rules are unit-tested in packages/dims and packages/engine;
// the save of a regenerated block in packages/testkit (dims-regenerate.corpus.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, DimensionGeometry, Entity } from '@triya/engine';
import { activeCanvas, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The dimension C96 as the edits left it, and the texts its block holds now. */
const dimension = (page: Page) =>
  page.evaluate(() => {
    let geom: DimensionGeometry | undefined;
    const texts = new Map<string, string>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const u of cs.entities?.updated ?? []) {
        if (u.after.handle === 'C96') geom = u.after.geom as DimensionGeometry;
      }
      for (const a of cs.entities?.added ?? []) {
        const e: Entity = a.entity;
        if (e.geom.kind === 'MTEXT') texts.set(e.handle, `${e.owner} ${e.geom.contents}`);
      }
      for (const r of cs.entities?.removed ?? []) texts.delete(r.entity.handle);
    }
    if (!geom || geom.dimType !== 'linear') return undefined;
    const block = geom.block;
    return {
      second: [geom.second.x, geom.second.y].map((v) => Math.round(v * 1e4) / 1e4),
      texts: [...texts.values()]
        .filter((t) => t.startsWith(`${block} `))
        .map((t) => t.slice(block!.length + 1)),
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('STRETCH regenerates a dimension', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  // ZOOM Window fits 80 × 50 units about (340, −15) into the canvas.
  const k = Math.min(box.width / 80, box.height / 50);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 340) * k,
    y: box.y + box.height / 2 - (y + 15) * k,
  });
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // Typed points go in with the cursor off the canvas, where Dynamic Input does not take them
  // as relative to the last point.
  const off = () => page.mouse.move(box.x + box.width / 2, box.y - 20);

  const zoom = async (a: string, b: string) => {
    await off();
    await type(
      page,
      'Z',
      'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
    );
    await type(page, a, 'Specify opposite corner:');
    await type(page, b, 'Command:');
    await page.waitForTimeout(500);
  };
  // Close to the text first (35.1233), then the whole dimension.
  await zoom('322,-15', '346,-8');
  await shot('1-before-text.png');
  await zoom('300,-40', '380,10');
  // Running object snaps would pull the cursor onto the drawing's points; off.
  await page.keyboard.press('F3');
  await shot('2-before.png');

  // A crossing window over the second extension origin and DXF 10, nothing else of C96.
  await type(page, 'STRETCH', 'Select objects:');
  await type(page, 'C', 'Specify first corner:');
  await type(page, '352,-10', 'Specify opposite corner:');
  await type(page, '345,-20', 'Select objects:');
  await type(page, '', 'Specify base point or [Displacement] <Displacement>:');
  await type(page, '340,-15', 'Specify second point or <use first point as displacement>:');
  // Dragged: the dimension is drawn afresh as the cursor goes.
  const p = at(352, -15);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.waitForTimeout(300);
  await shot('3-stretch-drag.png');
  await off();
  await type(page, '350,-15', 'Command:');

  await expect
    .poll(() => dimension(page))
    .toEqual({ second: [358.8967, -18.6932], texts: ['\\A1;45.1233'] });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await shot('4-after.png');
  await zoom('322,-15', '346,-8');
  await shot('5-after-text.png');
});
