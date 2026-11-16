// M4-02 part 2: QDIM, DIMEDIT, DIMTEDIT and DIMOVERRIDE in the app as a drafter uses them, on an
// empty part of the acadsharp AC1032 sample's plan (its current dimension style). A rectangle
// and a circle are drawn; QDIM dimensions them in a continuous chain picked on the canvas,
// DIMEDIT slants one dimension's extension lines, DIMTEDIT drags the other's text into place and
// DIMOVERRIDE colours its dimension line red. The commands are unit-tested in packages/engine;
// what the dimension engine draws for them, and their save, in packages/dims and testkit.
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
const O = 1e6;
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The dimensions made in this test: type, slant, text placed, DSTYLE overrides, text drawn. */
const dimensions = (page: Page) =>
  page.evaluate(() => {
    const dims = new Map<string, Entity>();
    const texts = new Map<string, { owner: string; contents: string }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      const put = (e: Entity) => {
        if (e.geom.kind === 'DIMENSION') dims.set(e.handle, e);
        if (e.geom.kind === 'MTEXT')
          texts.set(e.handle, { owner: e.owner, contents: e.geom.contents });
      };
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
      for (const r of cs.entities?.removed ?? []) {
        dims.delete(r.entity.handle);
        texts.delete(r.entity.handle);
      }
    }
    return [...dims.values()].map((e) => {
      const g = e.geom as DimensionGeometry & { oblique?: number };
      return {
        type: g.dimType,
        oblique: g.oblique === undefined ? undefined : Math.round((g.oblique * 180) / Math.PI),
        placed: g.textUserPositioned,
        // DIMCLRD (176) filed in the DSTYLE xdata.
        red: (e.xdata ?? []).some((a) =>
          a.values.some(
            (v, i) => v.code === 1070 && v.value === 176 && a.values[i + 1]?.value === 1,
          ),
        ),
        drawn: [...texts.values()]
          .filter((t) => t.owner === g.block)
          .map((t) => t.contents.replace(/^\\A1;/, '')),
      };
    });
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('QDIM, DIMEDIT, DIMTEDIT and DIMOVERRIDE', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // Typed points go in with the cursor below the canvas, where Dynamic Input does not take them
  // as relative to the last point.
  const off = () => page.mouse.move(box.x + 20, box.y + box.height + 60);
  await off();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-1, -5), 'Specify opposite corner:');
  await type(page, p(11, 5), 'Command:');
  const k = Math.min(box.width / 12, box.height / 10);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 5) * k,
    y: box.y + box.height / 2 - y * k,
  });
  const click = async (x: number, y: number) => {
    const q = at(x, y);
    await page.mouse.click(q.x, q.y);
  };
  // Running object snaps would pull the cursor onto the objects; off.
  await page.keyboard.press('F3');

  await type(page, 'RECTANG', /^Specify first corner point/);
  await type(page, p(0, 0), /^Specify other corner point/);
  await type(page, p(5, 3), 'Command:');
  await type(page, 'CIRCLE', /^Specify center point for circle/);
  await type(page, p(8, 1.5), /^Specify radius of circle/);
  await type(page, '1', 'Command:');
  await shot('1-before.png');

  // QDIM: the rectangle's corners and the circle's centre, x = 0, 5 and 8, chained below.
  await type(page, 'QDIM', 'Select geometry to dimension:');
  await click(2.5, 0);
  await click(8, 2.5);
  await off();
  await type(
    page,
    '',
    'Specify dimension line position, or [Continuous/Staggered/Baseline/Ordinate/Radius/Diameter/datumPoint/Edit/seTtings] <Continuous>:',
  );
  await type(page, p(4, -2), 'Command:');

  await type(page, 'DIMEDIT', 'Enter type of dimension editing [Home/New/Rotate/Oblique] <Home>:');
  await type(page, 'O', 'Select objects:');
  await click(2.5, -2);
  await off();
  await type(page, '', 'Enter obliquing angle (press ENTER for none):');
  await type(page, '60', 'Command:');

  await type(page, 'DIMTEDIT', 'Select dimension:');
  await click(6, -2);
  await expect(prompt(page)).toHaveText(
    'Specify new location for dimension text or [Left/Right/Center/Home/Angle]:',
  );
  // Dragged: the text follows the cursor before it is placed.
  const text = at(7.5, -3.2);
  await page.mouse.move(text.x, text.y, { steps: 4 });
  await page.waitForTimeout(300);
  await shot('2-dimtedit-drag.png');
  await off();
  await type(page, p(7.5, -3.2), 'Command:');

  await type(
    page,
    'DIMOVERRIDE',
    'Enter dimension variable name to override or [Clear overrides]:',
  );
  await type(page, 'DIMCLRD', /^Enter new value for dimension variable/);
  await type(page, '1', 'Enter dimension variable name to override or [Clear overrides]:');
  await type(page, '', 'Select objects:');
  await click(6.5, -2);
  await off();
  await type(page, '', 'Command:');

  await expect
    .poll(() => dimensions(page))
    .toEqual([
      {
        type: 'linear',
        oblique: 60,
        placed: false,
        red: false,
        drawn: [expect.stringMatching(/^5/)],
      },
      {
        type: 'linear',
        oblique: undefined,
        placed: true,
        red: true,
        drawn: [expect.stringMatching(/^3/)],
      },
    ]);
  await page.waitForTimeout(300);
  await shot('3-after.png');
});
