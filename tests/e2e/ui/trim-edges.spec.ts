// M3-12 part 4: TRIM with a block reference and its attributes as edges, from the app's canvas.
// On the title-block test drawing (packages/testkit/fixtures/attributes/title-block.dxf: the
// TITLE-BLOCK reference at (230, 10), 180 × 60, a line of the block at x = 270 above y = 44, the
// TITLE attribute "PUMP HOUSE GA" 5 high at (272, 58)) a line is drawn across the block's left
// side, its line at x = 270 and the title: a click left of the block trims it to the block's
// frame, a click between the block's line and the title trims that gap, at the title's box as the
// canvas measures it with its fonts (`textOutlines`). The geometry is unit-tested in
// packages/engine (edit/trim-edges.test.ts, commands/trim-edges.test.ts).
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { expectDrawn, expectShown, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

const FILE = fileURLToPath(
  new URL('../../../packages/testkit/fixtures/attributes/title-block.dxf', import.meta.url),
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The lines the session drew, as [x1, y1, x2, y2] to 0.001, sorted. */
const lines = (page: Page) =>
  page.evaluate(() => {
    const now = new Map<string, { type: string; geom: unknown }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) now.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) {
        if (now.has(u.after.handle)) now.set(u.after.handle, u.after);
      }
      for (const r of cs.entities?.removed ?? []) now.delete(r.entity.handle);
    }
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return [...now.values()]
      .filter((e) => e.type === 'LINE')
      .map((e) => {
        const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
        return [r(g.start.x), r(g.start.y), r(g.end.x), r(g.end.y)];
      })
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const TRIM =
  'Select object to trim or shift-select to extend or [cuTting edges/Crossing/mOde/Project/eRase/Undo]:';

test('TRIM cuts at a block reference and at its attribute text', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, 'title-block.dxf');

  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '190,0', 'Specify opposite corner:');
  await type(page, '420,80', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '200,61', 'Specify next point or [Undo]:');
  await type(page, '300,61', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(() => lines(page)).toEqual([[200, 61, 300, 61]]);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(5, 5);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(x, y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  await type(page, 'TR', TRIM);
  // Left of the block: trimmed back to its frame at x = 230.
  await click(212, 61);
  await expect.poll(() => lines(page)).toEqual([[230, 61, 300, 61]]);
  // Between the block's line at x = 270 and the title: the gap goes, up to the title's box.
  await click(271, 61);
  await expect.poll(() => lines(page)).toHaveLength(2);
  const [left, right] = await lines(page);
  expect(left).toEqual([230, 61, 270, 61]);
  expect(right![0]).toBeGreaterThan(271);
  expect(right![0]).toBeLessThan(273);
  expect(right!.slice(1)).toEqual([61, 300, 61]);
  await type(page, '', 'Command:');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: test.info().outputPath('2-after-trim.png') });
});
