// M3-02 part 4: BREAK, LENGTHEN, JOIN and EXPLODE from the app's canvas. On an empty part of
// the plan a long line, a U of three lines and a short line are drawn. BREAK erases the middle of
// the long line with two clicks; LENGTHEN adds 20 to the end of the short line nearer the click;
// JOIN takes the U by a crossing window and makes it one polyline; EXPLODE breaks that polyline
// back into lines. The prompts and geometry are unit-tested in packages/engine/test
// (commands/break.test.ts, edit/break.test.ts); this checks that the app's canvas, bus and
// engine worker carry them: object picks with the pickbox and the click as BREAK's first point.
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

/** The session's lines (less (1000000, 1000000), rounded, sorted) and polylines. */
const drawn = (page: Page) =>
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
    const lines = [...now.values()]
      .filter((e) => e.type === 'LINE')
      .map((e) => {
        const g = e.geom as { start: { x: number; y: number }; end: { x: number; y: number } };
        return [r(g.start.x), r(g.start.y), r(g.end.x), r(g.end.y)];
      })
      .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]! || a[3]! - b[3]!);
    const polylines = [...now.values()]
      .filter((e) => e.type === 'LWPOLYLINE')
      .map((e) => (e.geom as { vertices: { x: number; y: number }[] }).vertices.length);
    return { lines, polylines };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const JOIN_FIRST = 'Select source object or multiple objects to join at once:';

test('BREAK, LENGTHEN, JOIN and EXPLODE with clicks and windows', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000).
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const draw = async (...points: string[]) => {
    await type(page, 'L', 'Specify first point:');
    for (const p of points) await type(page, p, /^Specify next point or \[/);
    await type(page, '', 'Command:');
  };
  await draw('1000010,1000020', '1000070,1000020');
  await draw('1000010,1000050', '1000040,1000050', '1000040,1000080', '1000010,1000080');
  await draw('1000100,1000020', '1000140,1000020');
  await expect.poll(async () => (await drawn(page)).lines).toHaveLength(5);
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  // BREAK: the click on the line (a pickbox pick, unsnapped) is the first break point.
  await type(page, 'BR', 'Select object:');
  await click(30, 20);
  await expect(prompt(page)).toHaveText('Specify second break point or [First point]:');
  // The second point is a point prompt with the running object snaps: typed, so no snap moves
  // it, with # since Dynamic Input takes a second point as relative.
  await type(page, '#1000050,1000020', 'Command:');
  await expect
    .poll(async () => (await drawn(page)).lines)
    .toEqual(
      expect.arrayContaining([
        [10, 20, 30, 20],
        [50, 20, 70, 20],
      ]),
    );

  // LENGTHEN DElta 20 at the end nearer the click.
  await type(page, 'LEN', 'Select an object to measure or [DElta/Percent/Total/DYnamic] <DElta>:');
  await click(120, 20);
  await expect(log).toContainText('Current length: 40');
  await type(page, 'DE', /^Enter delta length or \[Angle\]/);
  await type(page, '20', 'Select an object to change or [Undo]:');
  await click(135, 20);
  await expect.poll(async () => (await drawn(page)).lines).toContainEqual([100, 20, 160, 20]);
  await type(page, '', 'Command:');

  // JOIN the U, taken by a crossing window, into one polyline.
  await type(page, 'J', JOIN_FIRST);
  await type(page, 'C', 'Specify first corner:');
  await type(page, '1000005,1000045', 'Specify opposite corner:');
  await type(page, '1000045,1000085', JOIN_FIRST);
  await type(page, '', 'Command:');
  await expect(log).toContainText('3 objects converted to 1 polyline');
  await expect.poll(async () => (await drawn(page)).polylines).toEqual([4]);
  await expect.poll(async () => (await drawn(page)).lines).toHaveLength(3);
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('2-after.png') });

  // EXPLODE the polyline JOIN made (the last object) back into its lines.
  await type(page, 'X', 'Select objects:');
  await type(page, 'L', 'Select objects:');
  await type(page, '', 'Command:');
  await expect.poll(async () => (await drawn(page)).polylines).toEqual([]);
  await expect
    .poll(async () => (await drawn(page)).lines)
    .toEqual(
      expect.arrayContaining([
        [10, 50, 40, 50],
        [40, 50, 40, 80],
        [40, 80, 10, 80],
      ]),
    );
});
