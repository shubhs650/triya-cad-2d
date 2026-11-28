// M9-13: an associative array keeps its source's constraints in the app. On an empty part of the
// plan an L of two lines is constrained with AUTOCONSTRAIN and arrayed in three associative
// columns: the constraints go into the source block, where nothing draws them. ARRAYEDIT Source
// opens the middle item, its constraint bars show, and a MOVE of its upright drags the foot,
// which every item follows; ARRAYCLOSE keeps the edit and the constraints in the source block.
// The rules are unit-tested in packages/engine/test/commands/block-constraints.test.ts, the
// solving in packages/constraints/test/block-constraints.test.ts and the save in
// packages/io/test/block-constraints.test.ts; this checks the canvas shows what they keep.
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

interface Line {
  readonly owner: string;
  readonly geom: { start: { x: number; y: number }; end: { x: number; y: number } };
}

/**
 * The lines the session drew or made that are still there, as `owner:length` (rounded), and
 * the constraints whose objects are all among them, by owner.
 */
const made = (page: Page) =>
  page.evaluate(() => {
    const lines = new Map<string, Line>();
    const constraints = new Map<string, { refs: { entity: string }[] }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? [])
        if (a.entity.type === 'LINE') lines.set(a.entity.handle, a.entity as unknown as Line);
      for (const u of cs.entities?.updated ?? [])
        if (lines.has(u.after.handle)) lines.set(u.after.handle, u.after as unknown as Line);
      for (const r of cs.entities?.removed ?? []) lines.delete(r.entity.handle);
      for (const o of cs.objects?.added ?? [])
        if (o.type === 'TRIYA_GEOMCONSTRAINT') constraints.set(o.handle, o as never);
      for (const u of cs.objects?.updated ?? [])
        if (constraints.has(u.after.handle)) constraints.set(u.after.handle, u.after as never);
      for (const o of cs.objects?.removed ?? []) constraints.delete(o.handle);
    }
    const length = (l: Line) =>
      Math.round(Math.hypot(l.geom.end.x - l.geom.start.x, l.geom.end.y - l.geom.start.y));
    return {
      lines: [...lines.values()].map((l) => `${l.owner}:${length(l)}`).sort(),
      constraints: [...constraints.values()]
        .map((c) => [...new Set(c.refs.map((r) => lines.get(r.entity)?.owner ?? 'gone'))].join())
        .sort(),
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('an associative array keeps its source’s constraints; ARRAYEDIT Source solves them', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  await page.keyboard.press('F3');

  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000200,1000120', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000010,1000020', 'Specify next point or [Undo]:');
  await type(page, '1000040,1000020', 'Specify next point or [Undo]:');
  await type(page, '1000040,1000040', 'Specify next point or [Close/Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  const shot = async (name: string) => {
    await expectDrawn(page);
    await park();
    await page.screenshot({ path: test.info().outputPath(name) });
  };

  await type(page, 'AUTOCONSTRAIN', 'Select objects or [Settings]:');
  await click(25, 20);
  await click(40, 30);
  await type(page, '', 'Command:');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'applied to 2 objects',
    {
      timeout: 15_000,
    },
  );
  const before = await made(page);
  const space = before.lines[0]!.split(':')[0]!;
  expect(before.lines).toEqual([`${space}:20`, `${space}:30`]);
  expect(before.constraints.length).toBeGreaterThanOrEqual(3);
  await shot('1-constrained.png');

  // Three associative columns 50 apart: the L and its constraints go into the source block.
  await type(page, 'ARRAYRECT', 'Select objects:');
  await click(25, 20);
  await click(40, 30);
  await type(page, '', /^Select grip to edit array or/);
  await type(page, 'COU', /^Enter number of columns/);
  await type(page, '3', /^Enter number of rows/);
  await type(page, '1', /^Select grip to edit array or/);
  await type(page, 'S', /^Specify the distance between columns/);
  await type(page, '50', /^Specify the distance between rows/);
  await type(page, '', /^Select grip to edit array or/);
  await type(page, '', 'Command:');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).not.toContainText(
    'constraints removed',
  );
  const arrayed = await made(page);
  const source = arrayed.lines[0]!.split(':')[0]!;
  expect(source).not.toBe(space);
  expect(arrayed.lines).toEqual([`${source}:20`, `${source}:30`]);
  expect(new Set(arrayed.constraints)).toEqual(new Set([source]));
  await shot('2-arrayed.png');

  // ARRAYEDIT Source on the middle item: its L stands in the plan, constrained.
  await type(page, 'ARRAYEDIT', 'Select array:');
  await click(75, 20);
  await expect(prompt(page)).toHaveText(/^Enter an option \[Source/);
  await type(page, 'S', 'Select item in array:');
  await click(90, 30);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  await expect
    .poll(async () => new Set((await made(page)).constraints), { timeout: 15_000 })
    .toEqual(new Set([space]));
  await shot('3-source-opened.png');

  // MOVE of the upright 10 right drags the foot, which stays level: every item follows.
  await type(page, 'MOVE', 'Select objects:');
  await click(90, 30);
  await type(page, '', /^Specify base point/);
  await type(page, '0,0', /^Specify second point/);
  await type(page, '@10,0', 'Command:');
  await expect
    .poll(async () => (await made(page)).lines.filter((l) => l.startsWith(`${space}:`)), {
      timeout: 15_000,
    })
    .toEqual([`${space}:20`, `${space}:40`]);
  await shot('4-moved.png');

  await type(page, 'ARRAYCLOSE', 'Save changes to array [Yes/No] <Yes>:');
  await type(page, '', 'Command:');
  await expect
    .poll(async () => made(page), { timeout: 15_000 })
    .toEqual({
      lines: [`${source}:20`, `${source}:40`],
      constraints: arrayed.constraints,
    });
  await shot('5-closed.png');
});
