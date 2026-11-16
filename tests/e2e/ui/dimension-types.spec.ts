// M4-02: DIMJOGGED, DIMARC, DIMORDINATE and DIMJOGLINE in the app as a drafter uses them, on an
// empty part of the acadsharp AC1032 sample's plan (its current dimension style). A circle and
// a half-circle arc are drawn; DIMJOGGED dimensions the circle with its jog dragged into place,
// DIMARC the arc with its leader, DIMORDINATE the arc's end, and DIMJOGLINE puts a jog on a
// DIMLINEAR dimension picked on the canvas. The commands are unit-tested in packages/engine;
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

/** The dimensions made in this test: kind, type, whether jogged, and the texts drawn. */
const dimensions = (page: Page) =>
  page.evaluate(() => {
    const dims = new Map<string, { geom: DimensionGeometry; jog: boolean }>();
    const texts = new Map<string, { owner: string; contents: string }>();
    const kinds = new Set(['DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION']);
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      const put = (e: Entity) => {
        if (kinds.has(e.geom.kind)) {
          const jog = (e.xdata ?? []).some((a) =>
            a.values.some((v) => v.code === 1070 && v.value === 389),
          );
          dims.set(e.handle, { geom: e.geom as DimensionGeometry, jog });
        }
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
    return [...dims.values()].map(({ geom: g, jog }) => ({
      kind: g.kind,
      type: g.dimType,
      jog,
      drawn: [...texts.values()]
        .filter((t) => t.owner === g.block)
        .map((t) => t.contents.replace(/^\\A1;/, '')),
    }));
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

test('DIMJOGGED, DIMARC, DIMORDINATE and DIMJOGLINE', async ({ page }) => {
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
  await type(page, p(-1, -4), 'Specify opposite corner:');
  await type(page, p(15, 7), 'Command:');
  const k = Math.min(box.width / 16, box.height / 11);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 7) * k,
    y: box.y + box.height / 2 - (y - 1.5) * k,
  });
  const click = async (x: number, y: number) => {
    const q = at(x, y);
    await page.mouse.click(q.x, q.y);
  };
  // Running object snaps would pull the cursor onto the objects; off.
  await page.keyboard.press('F3');

  await type(page, 'CIRCLE', /^Specify center point for circle/);
  await type(page, p(3, 2), /^Specify radius of circle/);
  await type(page, '1.5', 'Command:');
  await type(page, 'ARC', /^Specify start point of arc/);
  await type(page, p(13, 1), /^Specify second point of arc/);
  await type(page, p(10, 4), /^Specify end point of arc/);
  await type(page, p(7, 1), 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, -2), 'Specify second extension line origin:');
  await type(page, p(5, -2), /^Specify dimension line location/);
  await type(page, p(2.5, -3), 'Command:');
  await shot('1-before.png');

  await type(page, 'DIMJOGGED', 'Select arc or circle:');
  await click(4.5, 2);
  await off();
  await expect(prompt(page)).toHaveText('Specify center location override:');
  await type(page, p(6, -1), 'Specify dimension line location or [Mtext/Text/Angle]:');
  await type(page, p(4.6, 3.6), 'Specify jog location:');
  // Dragged: the jog follows the cursor before it is placed.
  const jog = at(5.2, 0.7);
  await page.mouse.move(jog.x, jog.y, { steps: 4 });
  await page.waitForTimeout(300);
  await shot('2-dimjogged-jog-drag.png');
  await off();
  await type(page, p(5.2, 0.7), 'Command:');

  await type(page, 'DIMARC', 'Select arc or polyline arc segment:');
  await click(10, 4);
  await off();
  await expect(prompt(page)).toHaveText(
    'Specify arc length dimension location or [Mtext/Text/Angle/Partial/Leader]:',
  );
  await type(
    page,
    'L',
    'Specify arc length dimension location or [Mtext/Text/Angle/Partial/No leader]:',
  );
  await type(page, p(10, 5.2), 'Command:');

  await type(page, 'DIMORDINATE', 'Specify feature location:');
  await type(page, p(7, 1), 'Specify leader endpoint or [Xdatum/Ydatum/Mtext/Text/Angle]:');
  await type(page, p(7.5, -0.5), 'Command:');

  await type(page, 'DIMJOGLINE', 'Select dimension to add jog or [Remove]:');
  await click(1, -3);
  await off();
  await expect(prompt(page)).toHaveText('Specify jog location (or press ENTER):');
  await type(page, '', 'Command:');

  await expect
    .poll(() => dimensions(page))
    .toEqual([
      { kind: 'DIMENSION', type: 'linear', jog: true, drawn: [expect.stringMatching(/^5/)] },
      {
        kind: 'LARGE_RADIAL_DIMENSION',
        type: 'jogged',
        jog: false,
        drawn: [expect.stringMatching(/^R1\.5/)],
      },
      {
        kind: 'ARC_DIMENSION',
        type: 'arc',
        jog: false,
        drawn: [expect.stringMatching(/^9\.42/)],
      },
      {
        kind: 'DIMENSION',
        type: 'ordinate',
        jog: false,
        drawn: [expect.stringMatching(/^1000007/)],
      },
    ]);
  await page.waitForTimeout(300);
  await shot('3-after.png');
});
