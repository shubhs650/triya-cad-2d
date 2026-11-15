// M3-12 part 1: OFFSET's variables from the app's command line, as a drafter sets them. On an
// empty part of the plan an L-shaped closed polyline is drawn; OFFSETGAPTYPE is set with SETVAR
// and by name, and the L is offset outside with each gap type: its five outside corners extended
// (0), filleted (1) and chamfered (2), the inside corner trimmed every time. OFFSETDIST set by
// name is the distance OFFSET offers.
// The variables and geometry are unit-tested in packages/engine/test
// (commands/option-variables.test.ts, geom/offset-gap-type.test.ts) and apps/web/test
// (system-variables.test.ts, preferences.test.ts); this checks the app keeps them for the commands.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
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

/** The polylines the session added: how many vertices each has, and how many are arcs' starts. */
const polylines = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, [number, number]>();
    const keep = (e: Entity) => {
      const g = e.geom;
      if (g.kind === 'LWPOLYLINE') {
        out.set(e.handle, [g.vertices.length, g.vertices.filter((v) => v.bulge).length]);
      }
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) keep(a.entity);
      // PLINE adds its polyline at the first segment and adds a vertex at each next point.
      for (const u of cs.entities?.updated ?? []) keep(u.after);
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

const NEXT = /^Specify next point or \[/;
const SELECT = 'Select object to offset or [Exit/Undo] <Exit>:';
const SIDE = 'Specify point on side to offset or [Exit/Multiple/Undo] <Exit>:';

test('OFFSETGAPTYPE and OFFSETDIST set at the command line shape the next OFFSET', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // An empty part of the plan, from (1000000, 1000000): an L 40 wide and 40 high, 20 thick.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '999970,999985', 'Specify opposite corner:');
  await type(page, '1000130,1000085', 'Command:');
  await type(page, 'PLINE', 'Specify start point:');
  for (const p of ['1000010,1000010', '1000050,1000010', '1000050,1000030', '1000030,1000030']) {
    await type(page, p, NEXT);
  }
  await type(page, '1000030,1000050', NEXT);
  await type(page, '1000010,1000050', NEXT);
  await type(page, 'C', 'Command:');
  await expect.poll(() => polylines(page)).toEqual([[6, 0]]);
  // The cursor away from the canvas's navigation bar, whose menu would show in the screenshot.
  await page.mouse.move(300, 560);
  await page.screenshot({ path: test.info().outputPath('1-before.png') });

  // OFFSETDIST by name: OFFSET offers it.
  await type(page, 'OFFSETDIST', 'Enter new value for OFFSETDIST <-1.0000>:');
  await type(page, '4', 'Command:');
  // Gap type 1 by SETVAR: the L offset 4 outside, five corners filleted.
  await type(page, 'SETVAR', /^Enter variable name or \[\?\]/);
  await type(page, 'OFFSETGAPTYPE', 'Enter new value for OFFSETGAPTYPE <0>:');
  await type(page, '1', 'Command:');
  await type(page, 'O', 'Specify offset distance or [Through/Erase/Layer] <4.0000>:');
  await expect(log).toContainText(
    'Current settings: Erase source=No  Layer=Source  OFFSETGAPTYPE=1',
  );
  await type(page, '', SELECT);
  await type(page, '1000010,1000030', SIDE);
  await type(page, '1000000,1000030', SELECT);
  await type(page, '', 'Command:');
  // Gap type 2 by name: the L offset 8 outside, five corners chamfered.
  await type(page, 'OFFSETGAPTYPE', 'Enter new value for OFFSETGAPTYPE <1>:');
  await type(page, '2', 'Command:');
  await type(page, 'O', 'Specify offset distance or [Through/Erase/Layer] <4.0000>:');
  await type(page, '8', SELECT);
  await type(page, '1000010,1000030', SIDE);
  await type(page, '1000000,1000030', SELECT);
  await type(page, '', 'Command:');
  // The distance typed is OFFSETDIST now.
  await type(page, 'OFFSETDIST', 'Enter new value for OFFSETDIST <8.0000>:');
  await type(page, '', 'Command:');
  await expect
    .poll(() => polylines(page))
    .toEqual([
      [6, 0],
      [11, 5],
      [11, 0],
    ]);
  await page.mouse.move(300, 560);
  await page.screenshot({ path: test.info().outputPath('2-gap-types-1-and-2.png') });
});
