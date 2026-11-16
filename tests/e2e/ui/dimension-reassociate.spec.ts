// M4-02 part 3: DIMREASSOCIATE in the app as a drafter uses it, on an empty part of the
// acadsharp AC1032 sample's plan. A DIMLINEAR dimension measures a 4-long line; DIMREASSOCIATE
// picks it on the canvas, keeps its first origin (Enter) and moves the second onto the end of a
// longer line, and the dimension is measured again. The command is unit-tested in
// packages/engine and kept by a save over the corpus in testkit.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, DimensionGeometry } from '@triya/engine';
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

/** The dimensions made in this test: their origins and the texts drawn. */
const dimensions = (page: Page) =>
  page.evaluate(() => {
    const dims = new Map<
      string,
      DimensionGeometry & { first: { x: number }; second: { x: number } }
    >();
    const texts = new Map<string, { owner: string; contents: string }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const e of [
        ...(cs.entities?.added ?? []).map((a) => a.entity),
        ...(cs.entities?.updated ?? []).map((u) => u.after),
      ]) {
        if (e.geom.kind === 'DIMENSION') dims.set(e.handle, e.geom as never);
        if (e.geom.kind === 'MTEXT')
          texts.set(e.handle, { owner: e.owner, contents: e.geom.contents });
      }
      for (const r of cs.entities?.removed ?? []) texts.delete(r.entity.handle);
    }
    return [...dims.values()].map((g) => ({
      span: [g.first.x % 1000, g.second.x % 1000].map((x) => Math.round(x * 1e6) / 1e6),
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

test('DIMREASSOCIATE', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
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
  await page.keyboard.press('F3');

  await type(page, 'LINE', /^Specify first point/);
  await type(page, p(0, 0), /^Specify next point/);
  await type(page, p(4, 0), /^Specify next point/);
  await type(page, '', 'Command:');
  await type(page, 'LINE', /^Specify first point/);
  await type(page, p(0, 2), /^Specify next point/);
  await type(page, p(9, 2), /^Specify next point/);
  await type(page, '', 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(4, 0), /^Specify dimension line location/);
  await type(page, p(2, -2), 'Command:');
  await shot('1-before.png');

  await type(page, 'DIMREASSOCIATE', 'Select dimensions to reassociate:');
  const q = at(1, -2);
  await page.mouse.click(q.x, q.y);
  await off();
  await type(page, '', 'Specify first extension line origin or [Select object] <next>:');
  await type(page, '', 'Specify second extension line origin <next>:');
  await type(page, p(9, 2), 'Command:');

  await expect
    .poll(() => dimensions(page))
    .toEqual([{ span: [0, 9], drawn: [expect.stringMatching(/^9/)] }]);
  await page.waitForTimeout(300);
  await shot('2-after.png');
});
