// M9-09: a grip edit of constrained geometry keeps line lengths. Two lines are drawn on an empty
// part of the plan and made parallel; the first is picked and its end grip dragged, turning it.
// The second turns with it about its start, its length kept, and the first keeps its start
// (a least-change solve had shortened the second and moved both lines' other ends). The
// solving is unit-tested in packages/constraints/test/model.test.ts ('edits keep line
// lengths'); this checks that the grip, the bus's constraint upkeep (M9-06), the engine
// worker and the solver module carry it.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, expectDrawn, expectShown, gridOff, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The lines the session drew, less (1000000, 1000000), rounded to 0.001. */
const lines = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<
      string,
      { start: { x: number; y: number }; end: { x: number; y: number } }
    >();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? [])
        if (a.entity.type === 'LINE') out.set(a.entity.handle, a.entity.geom as never);
      for (const u of cs.entities?.updated ?? [])
        if (out.has(u.after.handle)) out.set(u.after.handle, u.after.geom as never);
    }
    const r = (v: number) => Math.round((v - 1000000) * 1000) / 1000 + 0;
    return [...out.values()].map((g) => [r(g.start.x), r(g.start.y), r(g.end.x), r(g.end.y)]);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('a grip drag turns a parallel line with it, lengths kept (M9-09)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const draw = async (a: string, b: string) => {
    await type(page, 'L', 'Specify first point:');
    await type(page, a, 'Specify next point or [Undo]:');
    await type(page, b, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  };
  await draw('1000020,1000020', '1000060,1000020');
  await draw('1000020,1000040', '1000060,1000040');
  await expect.poll(() => lines(page)).toHaveLength(2);
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  await type(page, 'GCPARALLEL', 'Select first object:');
  await click(40, 40);
  await expect(prompt(page)).toHaveText('Select second object:');
  await click(40, 20);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  // Running object snaps would pull the grip's destination onto the lines' own points; off.
  await page.keyboard.press('F3');

  // Picked at Command: the lower line's grips show; a click on its end makes that grip hot.
  await click(30, 20);
  await park();
  await expectDrawn(page);
  await shot('m9-09-1-picked.png');
  await click(60, 20);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  const to = at(52, 44);
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await shot('m9-09-2-dragging.png');
  await page.mouse.click(to.x, to.y);
  await expect(prompt(page)).toHaveText('Command:');

  // The dragged line keeps its start; the other turns about its start, still 40 long.
  await expect
    .poll(() => lines(page), { timeout: 15_000 })
    .toEqual([
      [20, 20, 52, 44],
      [20, 40, 52, 64],
    ]);
  await page.keyboard.press('Escape');
  await expectDrawn(page);
  await park();
  await shot('m9-09-3-after.png');
});
