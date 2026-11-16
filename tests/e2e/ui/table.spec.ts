// M4-05 part 1: -TABLE in the app, on an empty part of the acadsharp AC1032 sample (its Standard
// table style, imperial). Four columns and three data rows are inserted at a typed point: the
// table is drawn from the `*T` block the table engine wrote for it, a title row merged across, a
// header row and the data rows. The command's prompts, the engine's drawing and the save are
// unit- and corpus-tested in packages/engine and packages/testkit.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, TableGeometry } from '@triya/engine';
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

/** The tables made in this test, with the kinds of what their block holds. */
const tables = (page: Page) =>
  page.evaluate(() => {
    const all = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) all.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) all.set(u.after.handle, u.after);
      for (const r of cs.entities?.removed ?? []) all.delete(r.entity.handle);
    }
    return [...all.values()]
      .filter((e) => e.geom.kind === 'ACAD_TABLE')
      .map((e) => {
        const g = e.geom as TableGeometry;
        const inside = [...all.values()].filter((x) => x.owner === g.block);
        return {
          columns: g.columnWidths,
          rows: g.rowHeights.map((h) => Math.round(h * 1e4) / 1e4),
          block: inside.map((x) => x.geom.kind).filter((k) => k === 'LINE').length,
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

test('-TABLE inserts a table the table engine draws', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  // Typed points go in with the cursor below the canvas, where Dynamic Input does not take them.
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, p(-1, -3), 'Specify opposite corner:');
  await type(page, p(11, 1), 'Command:');
  await shot('1-before.png');

  await type(page, '-TABLE', 'Enter number of columns or [Auto] <5>:');
  await type(page, '4', 'Enter number of rows or [Auto] <1>:');
  await type(page, '3', 'Specify insertion point or [Style/Width/Height]:');
  await type(page, p(0, 0), 'Command:');
  await expect
    .poll(() => tables(page))
    .toEqual([
      {
        columns: [2.5, 2.5, 2.5, 2.5],
        rows: [0.4533, 0.36, 0.36, 0.36, 0.36],
        // Six row lines, five column lines and the Defpoints line.
        block: 6 + 5 + 1,
      },
    ]);
  await page.waitForTimeout(300);
  await shot('2-after.png');
});
