// M3-02 part 2: TRIM from the app's canvas, as a drafter runs it in Quick mode. On an empty part
// of the plan a line is drawn across two uprights, with a short line to their left: a click on
// the line between the uprights trims that part away, a Shift+click on the short line extends it
// to the first upright, and two clicks on nothing below the line make a fence that trims the
// uprights' lower halves. EXTEND then trims with Shift and Undo takes it back.
// The prompts and geometry are unit-tested in packages/engine/test (commands/trim.test.ts,
// edit/trim.test.ts); this checks that the app's canvas, bus and engine worker carry them: the
// click with the pickbox (no snaps), Shift with it, and the fence's rubber band.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, expectDrawn, expectShown, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The lines the session drew, as [x1, y1, x2, y2] less (1000000, 1000000), sorted. */
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
    const r = (v: number) => Math.round((v - 1000000) * 1000) / 1000;
    return [...now.values()]
      .filter((e) => e.type === 'LINE')
      .map((e) => {
        const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
        return [r(g.start.x), r(g.start.y), r(g.end.x), r(g.end.y)];
      })
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const TRIM =
  'Select object to trim or shift-select to extend or [cuTting edges/Crossing/mOde/Project/eRase/Undo]:';
const EXTEND =
  'Select object to extend or shift-select to trim or [Boundary edges/Crossing/mOde/Project/Undo]:';

test('TRIM with a click, Shift+click to extend and a fence; EXTEND with Shift to trim', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000).
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const draw = async (a: string, b: string) => {
    await type(page, 'L', 'Specify first point:');
    await type(page, a, 'Specify next point or [Undo]:');
    await type(page, b, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  };
  await draw('1000020,1000050', '1000140,1000050');
  await draw('1000050,1000020', '1000050,1000080');
  await draw('1000110,1000020', '1000110,1000080');
  await draw('1000020,1000070', '1000040,1000070');
  await expect.poll(() => lines(page)).toHaveLength(4);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  await type(page, 'TR', TRIM);
  await expect(log).toContainText('Current settings: Projection=UCS, Edge=None, Mode=Quick');
  // The line between the uprights.
  await click(80, 50);
  await expect
    .poll(() => lines(page))
    .toEqual([
      [20, 50, 50, 50],
      [20, 70, 40, 70],
      [50, 20, 50, 80],
      [110, 20, 110, 80],
      [110, 50, 140, 50],
    ]);
  // Shift+click near the short line's end: extended to the first upright.
  await page.keyboard.down('Shift');
  await click(38, 70);
  await page.keyboard.up('Shift');
  await expect.poll(() => lines(page)).toContainEqual([20, 70, 50, 70]);
  // Two clicks on nothing: a fence across the uprights below the line.
  await click(40, 30);
  await expect(prompt(page)).toHaveText('Specify next fence point or [Undo]:');
  await click(120, 30);
  await expect(prompt(page)).toHaveText(TRIM);
  await expect
    .poll(() => lines(page))
    .toEqual([
      [20, 50, 50, 50],
      [20, 70, 50, 70],
      [50, 50, 50, 80],
      [110, 50, 110, 80],
      [110, 50, 140, 50],
    ]);
  await type(page, '', 'Command:');
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('2-after-trim.png') });

  // EXTEND: Shift+click trims the short line back to... nothing crosses it but its end on the
  // upright, so Quick mode deletes it; Undo puts it back.
  await type(page, 'EX', EXTEND);
  await page.keyboard.down('Shift');
  await click(30, 70);
  await page.keyboard.up('Shift');
  await expect.poll(() => lines(page)).not.toContainEqual([20, 70, 50, 70]);
  await type(page, 'U', EXTEND);
  await expect.poll(() => lines(page)).toContainEqual([20, 70, 50, 70]);
  await type(page, '', 'Command:');
});
