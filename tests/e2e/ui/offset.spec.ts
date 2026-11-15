// M3-02 part 1: OFFSET from the app's command line, as a drafter runs it. On an empty part of
// the plan a rectangular revision cloud (a closed polyline of arcs) and two lines are drawn;
// the cloud is offset 3 inside, where the offsets of its arcs cross one another and OFFSET cuts
// the loops out, and 3 outside; a line is offset through a point and again at a distance with
// Multiple; Undo takes the last back.
// The prompts and geometry are unit-tested in packages/engine/test (commands/offset.test.ts,
// edit/offset.test.ts); this checks that the app's bus, canvas and engine worker carry them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The types of the objects the session has, in the order it added them. */
const added = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, string>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity.type);
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

const DISTANCE = /^Specify offset distance or \[Through\/Erase\/Layer\] <.*>:$/;
const SELECT = 'Select object to offset or [Exit/Undo] <Exit>:';
const SIDE = 'Specify point on side to offset or [Exit/Multiple/Undo] <Exit>:';

test('OFFSET a revision cloud inside and out, and lines through a point and with Multiple', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000): a cloud of 6-unit arcs
  // round a 50-unit square, and a V of two lines.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'REVCLOUD', /^Specify first corner point or/);
  await type(page, 'A', /^Specify minimum length of arc/);
  await type(page, '6', /^Specify maximum length of arc/);
  await type(page, '6', /^Specify first corner point or/);
  await type(page, '1000020,1000025', 'Specify opposite corner:');
  await type(page, '1000070,1000075', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000095,1000080', 'Specify next point or [Undo]:');
  await type(page, '1000115,1000020', 'Specify next point or [Undo]:');
  await type(page, '1000135,1000080', 'Specify next point or [Close/Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(() => added(page)).toEqual(['LWPOLYLINE', 'LINE', 'LINE']);
  // The cursor off the canvas's navigation bar, which would show its menu in the screenshot.
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  // The cloud, 3 inside (its corner vertex picked) and 3 outside.
  await type(page, 'O', DISTANCE);
  await expect(log).toContainText(
    'Current settings: Erase source=No  Layer=Source  OFFSETGAPTYPE=0',
  );
  await type(page, '3', SELECT);
  await type(page, '1000020,1000025', SIDE);
  await type(page, '1000045,1000050', SELECT);
  await type(page, '1000020,1000025', SIDE);
  await type(page, '1000010,1000050', SELECT);
  await type(page, '', 'Command:');
  await expect
    .poll(() => added(page))
    .toEqual(['LWPOLYLINE', 'LINE', 'LINE', 'LWPOLYLINE', 'LWPOLYLINE']);

  // The V's left line through a point 4 inside the V; the right one 2, 4 and 6 outside with
  // Multiple; Undo takes the last back.
  await type(page, 'O', DISTANCE);
  await type(page, 'T', SELECT);
  await type(page, '1000105,1000050', 'Specify through point or [Exit/Multiple/Undo] <Exit>:');
  await type(page, '1000112,1000060', SELECT);
  await type(page, 'E', 'Command:');
  await type(page, 'O', 'Specify offset distance or [Through/Erase/Layer] <Through>:');
  await type(page, '2', SELECT);
  await type(page, '1000125,1000050', SIDE);
  await type(page, 'M', 'Specify point on side to offset or [Exit/Undo] <next object>:');
  for (let i = 0; i < 3; i++) {
    await type(
      page,
      '1000150,1000050',
      'Specify point on side to offset or [Exit/Undo] <next object>:',
    );
  }
  await type(page, 'U', 'Specify point on side to offset or [Exit/Undo] <next object>:');
  await type(page, '', SELECT);
  await type(page, '', 'Command:');
  await expect
    .poll(() => added(page))
    .toEqual(['LWPOLYLINE', 'LINE', 'LINE', 'LWPOLYLINE', 'LWPOLYLINE', 'LINE', 'LINE', 'LINE']);
  await page.mouse.move(400, 300);
  await page.screenshot({ path: test.info().outputPath('2-after.png') });
});
