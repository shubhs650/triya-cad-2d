// M9-05 part 1: geometric constraints from the app. On an empty part of the plan three lines are
// drawn; the Parametric tab's Parallel makes the second line parallel to the first, the first
// staying put; GCPERPENDICULAR typed makes the third perpendicular to the first; a Perpendicular
// between the two parallel lines is refused, saying why; U takes the last constraint back with
// what it moved. The lines turned keep their length (M9-08). The engine worker loads the
// PlaneGCS solver on the first constraint. Prompts and refusals are unit-tested in
// packages/engine/test/commands/constraints.test.ts, the solving in
// packages/constraints/test/solver.test.ts; this checks that the ribbon, canvas, bus, engine
// worker and solver module carry them.
//
// M9-04: a constraint is saved with the drawing (the `TRIYA_CONSTRAINTS` dictionary, DEC-081) and
// holds after the saved file is opened again: a Perpendicular between the parallel lines of the
// reopened drawing is refused as before.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
  viewOf,
  worldAt,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The lines the session drew, less (1000000, 1000000), rounded, and its constraints' kinds. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const lines = new Map<
      string,
      { start: { x: number; y: number }; end: { x: number; y: number } }
    >();
    const constraints = new Map<string, string>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? [])
        if (a.entity.type === 'LINE') lines.set(a.entity.handle, a.entity.geom as never);
      for (const u of cs.entities?.updated ?? [])
        if (lines.has(u.after.handle)) lines.set(u.after.handle, u.after.geom as never);
      for (const o of cs.objects?.added ?? [])
        if (o.type === 'TRIYA_GEOMCONSTRAINT')
          constraints.set(o.handle, (o as unknown as { kind: string }).kind);
      for (const o of cs.objects?.removed ?? []) constraints.delete(o.handle);
    }
    const r = (v: number) => Math.round((v - 1000000) * 1000) / 1000 + 0;
    return {
      lines: [...lines.values()].map((g) => [r(g.start.x), r(g.start.y), r(g.end.x), r(g.end.y)]),
      constraints: [...constraints.values()],
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Parallel from the Parametric tab, GCPERPENDICULAR typed, a refusal and U', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
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
  await draw('1000020,1000020', '1000080,1000020');
  await draw('1000020,1000050', '1000080,1000070');
  await draw('1000100,1000020', '1000130,1000060');
  await expect.poll(async () => (await drawn(page)).lines).toHaveLength(3);
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  /** The cursor out of the way of the lines and the navigation bar, for the screenshots. */
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  await ribbon.getByRole('tab', { name: 'Parametric', exact: true }).click();
  const geometric = page.getByRole('group', { name: 'Geometric' });
  await expect(geometric.getByRole('button', { name: 'Smooth', exact: true })).toBeDisabled();
  await park();
  await page.screenshot({ path: test.info().outputPath('1-parametric-tab.png') });

  await geometric.getByRole('button', { name: 'Parallel', exact: true }).click();
  await expect(prompt(page)).toHaveText('Select first object:');
  await click(50, 20);
  await expect(prompt(page)).toHaveText('Select second object:');
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  // The first line stays; the second turns level.
  const level = (l: readonly number[] | undefined) => !!l && Math.abs(l[1]! - l[3]!) < 1e-3;
  const upright = (l: readonly number[] | undefined) => !!l && Math.abs(l[0]! - l[2]!) < 1e-3;
  await expect.poll(async () => level((await drawn(page)).lines[1])).toBe(true);
  expect((await drawn(page)).lines[0]).toEqual([20, 20, 80, 20]);
  const second = (await drawn(page)).lines[1]!;

  await type(page, 'GCPERPENDICULAR', 'Select first object:');
  await click(50, 20);
  await click(115, 40);
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(async () => upright((await drawn(page)).lines[2])).toBe(true);
  await expect
    .poll(async () => (await drawn(page)).constraints)
    .toEqual(['parallel', 'perpendicular']);
  // M9-08: each turned about its start, its length kept (the second was 63.246 long, the
  // third 50; a least-change solve had left them 60 and about 46).
  expect((await drawn(page)).lines.slice(1)).toEqual([
    [20, 50, 83.246, 50],
    [100, 20, 100, 70],
  ]);
  await expectDrawn(page);
  await park();
  await page.screenshot({ path: test.info().outputPath('2-constrained.png') });

  // Perpendicular between the parallel lines cannot be: refused, with the reason.
  await geometric.getByRole('button', { name: 'Perpendicular', exact: true }).click();
  await click(50, 20);
  await click((second[0]! + second[2]!) / 2, second[1]!);
  await expect(log).toContainText('The constraint would over-constrain the geometry.');
  await expect(prompt(page)).toHaveText('Select first object:');
  await park();
  await page.screenshot({ path: test.info().outputPath('3-refused.png') });
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  await type(page, 'U', 'Command:');
  await expect.poll(async () => (await drawn(page)).constraints).toEqual(['parallel']);
  await expect.poll(async () => (await drawn(page)).lines[2]).toEqual([100, 20, 130, 60]);
});

test('a constraint saved with the drawing holds after it is opened again (M9-04)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  const log = page.getByRole('log', { name: 'Recent command lines' });
  const zoom = async () => {
    await type(page, 'Z', /^Specify corner of window/);
    await type(page, '1000000,1000000', 'Specify opposite corner:');
    await type(page, '1000160,1000100', 'Command:');
  };
  await zoom();
  for (const [a, b] of [
    ['1000020,1000020', '1000080,1000020'],
    ['1000020,1000050', '1000080,1000070'],
  ] as const) {
    await type(page, 'L', 'Specify first point:');
    await type(page, a, 'Specify next point or [Undo]:');
    await type(page, b, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });
  let view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  await type(page, 'GCPARALLEL', 'Select first object:');
  await click(50, 20);
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  await expect.poll(async () => (await drawn(page)).constraints).toEqual(['parallel']);
  const second = (await drawn(page)).lines[1]!;

  // Saved (downloaded, as without File System Access) and opened again.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const saving = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = test.info().outputPath('constrained.dxf');
  await (await saving).saveAs(file);
  const text = readFileSync(file, 'utf8');
  expect(text).toMatch(/\r?\nTRIYA_CONSTRAINTS\r?\n/);
  expect(text).toMatch(/\r?\n {2}1\r?\nparallel\r?\n/);

  await openWithPicker(page, file);
  await expectShown(page, 'constrained.dxf');
  await zoom();
  await expectDrawn(page, { timeout: 15_000 });
  // `Command:` is not a sync point for ZOOM's view (TESTING.md §7): wait for it to centre.
  const box = (await activeCanvas(page).boundingBox())!;
  await expect
    .poll(async () => Math.abs((await worldAt(page, box.width / 2, box.height / 2)).x - 1000080))
    .toBeLessThan(5);
  view = await viewOf(page);
  await type(page, 'GCPERPENDICULAR', 'Select first object:');
  await click(50, 20);
  await click((second[0]! + second[2]!) / 2, second[1]!);
  await expect(log).toContainText('The constraint would over-constrain the geometry.', {
    timeout: 15_000,
  });
  await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  await page.screenshot({ path: test.info().outputPath('4-reopened-refused.png') });
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});

// M9-06: modify commands keep the constraints (PRD FR-X4). An L is joined at its corner and its
// foot made horizontal; MOVE of the upright drags the foot's end along, the foot staying level;
// ROTATE of the foot is refused (it is horizontal) and changes nothing; ERASE of the upright
// takes the corner's constraint with it, saying so.
test('MOVE drags joined geometry, a refused ROTATE, ERASE removes constraints (M9-06)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  const log = page.getByRole('log', { name: 'Recent command lines' });

  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const draw = async (a: string, b: string) => {
    await type(page, 'L', 'Specify first point:');
    await type(page, a, 'Specify next point or [Undo]:');
    await type(page, b, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  };
  await draw('1000020,1000020', '1000080,1000020');
  await draw('1000080,1000020', '1000080,1000070');
  await expect.poll(async () => (await drawn(page)).lines).toHaveLength(2);
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);

  await type(page, 'GCHORIZONTAL', /^Select an object or/);
  await click(50, 20);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  await type(page, 'GCCOINCIDENT', /^Select first point or/);
  await click(70, 20);
  await expect(prompt(page)).toHaveText('Select second point:');
  await click(80, 30);
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => (await drawn(page)).constraints)
    .toEqual(['horizontal', 'coincident']);
  await expectDrawn(page);
  await park();
  await page.screenshot({ path: test.info().outputPath('m9-06-1-before-move.png') });

  // MOVE the upright 30 to the right: the foot's end follows, the foot level.
  await type(page, 'MOVE', 'Select objects:');
  await click(80, 50);
  await type(page, '', /^Specify base point or/);
  await type(page, '1000080,1000020', /^Specify second point or/);
  await type(page, '@30,0', 'Command:');
  await expect
    .poll(async () => (await drawn(page)).lines)
    .toEqual([
      [20, 20, 110, 20],
      [110, 20, 110, 70],
    ]);
  await expectDrawn(page);
  await park();
  await page.screenshot({ path: test.info().outputPath('m9-06-2-after-move.png') });

  // ROTATE the foot: it is horizontal, so the rotation is refused and nothing turns.
  await type(page, 'ROTATE', 'Select objects:');
  await click(60, 20);
  await type(page, '', 'Specify base point:');
  await type(page, '1000020,1000020', /^Specify rotation angle or/);
  await type(page, '30', 'Command:');
  await expect(log).toContainText(
    'The change breaks a constraint the other geometry cannot follow.',
  );
  expect((await drawn(page)).lines[0]).toEqual([20, 20, 110, 20]);

  // ERASE the upright: the corner's constraint goes with it.
  await type(page, 'ERASE', 'Select objects:');
  await click(110, 50);
  await type(page, '', 'Command:');
  await expect(log).toContainText('1 geometric constraint removed.');
  await expect.poll(async () => (await drawn(page)).constraints).toEqual(['horizontal']);
  await park();
  await page.screenshot({ path: test.info().outputPath('m9-06-3-after-erase.png') });
});
