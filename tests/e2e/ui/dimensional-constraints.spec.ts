// M9-03 part 3: dimensional constraints from the app. On an empty part of the plan two lines are
// drawn; the Parametric tab's Dimensional panel has AutoCAD's constraints; Aligned on the second
// line, typed `width=50`, makes it 50 long, its start staying; DCLINEAR typed on the first line's
// ends places a horizontal constraint below it, the value an expression of `width`; a second
// Aligned on the second line would over-constrain it, so it is offered and made as a reference
// constraint. Saved and opened again (the `TRIYA_CONSTRAINTS` dictionary, DEC-082), the
// constraints still hold: another value on the second line is refused again. Prompts are
// unit-tested in packages/engine/test/commands/dimensional-constraints.test.ts, the solving in
// packages/constraints/test/solver.test.ts; this checks that the ribbon, canvas, bus, engine
// worker, solver module and save carry them.
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

interface Dim {
  readonly parameter: string;
  readonly expression: string;
  readonly dimension: string;
  readonly reference?: boolean;
}

/** The lines the session drew, less (1000000, 1000000), rounded, and its dimensional constraints. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const lines = new Map<
      string,
      { start: { x: number; y: number }; end: { x: number; y: number } }
    >();
    const dims = new Map<string, Dim>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? [])
        if (a.entity.type === 'LINE') lines.set(a.entity.handle, a.entity.geom as never);
      for (const u of cs.entities?.updated ?? [])
        if (lines.has(u.after.handle)) lines.set(u.after.handle, u.after.geom as never);
      for (const o of cs.objects?.added ?? [])
        if (o.type === 'TRIYA_DIMCONSTRAINT') dims.set(o.handle, o as unknown as Dim);
      for (const o of cs.objects?.removed ?? []) dims.delete(o.handle);
    }
    const r = (v: number) => Math.round((v - 1000000) * 1000) / 1000 + 0;
    return {
      lines: [...lines.values()].map((g) => [r(g.start.x), r(g.start.y), r(g.end.x), r(g.end.y)]),
      dims: [...dims.values()].map((d) => [d.dimension, d.parameter, d.expression, !!d.reference]),
    };
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const length = (l: readonly number[]) => Math.hypot(l[2]! - l[0]!, l[3]! - l[1]!);

test('Aligned from the Dimensional panel, DCLINEAR typed, a reference constraint, saved', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000).
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
  await expect.poll(async () => (await drawn(page)).lines).toHaveLength(2);
  await expectDrawn(page, { timeout: 15_000 });

  let view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  /** The cursor out of the way of the lines and the navigation bar, for the screenshots. */
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);

  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  await ribbon.getByRole('tab', { name: 'Parametric', exact: true }).click();
  const dimensional = page.getByRole('group', { name: 'Dimensional' });
  await expect(dimensional.getByRole('button', { name: 'Convert', exact: true })).toBeDisabled();
  await park();
  await page.screenshot({ path: test.info().outputPath('1-dimensional-panel.png') });

  // Aligned on the second line (Object, the default), the dimension line above it.
  await dimensional.getByRole('button', { name: 'Aligned', exact: true }).click();
  await expect(prompt(page)).toHaveText(
    'Specify first constraint point or [Object/Point&line/2Line] <Object>:',
  );
  await type(page, '', 'Select object:');
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 80);
  await expect(prompt(page)).toHaveText('Dimension text <d1=63.2456>:');
  await park();
  await page.screenshot({ path: test.info().outputPath('2-dimension-text.png') });
  await type(page, 'width=50', 'Command:');
  // The second line is 50 long, its start where it was, its direction kept.
  await expect.poll(async () => length((await drawn(page)).lines[1]!)).toBeCloseTo(50, 3);
  const second = (await drawn(page)).lines[1]!;
  expect(second.slice(0, 2)).toEqual([20, 50]);
  // (Rounded to 0.001 above.)
  expect((second[3]! - 50) / (second[2]! - 20)).toBeCloseTo(20 / 60, 4);

  // DCLINEAR on the first line's ends, the dimension line below: horizontal, set from `width`.
  await type(page, 'DCLINEAR', 'Specify first constraint point or [Object] <Object>:');
  await click(22, 20);
  await expect(prompt(page)).toHaveText('Specify second constraint point:');
  await click(78, 20);
  await expect(prompt(page)).toHaveText('Specify dimension line location:');
  await click(50, 10);
  await type(page, 'width+20', 'Command:');
  await expect.poll(async () => (await drawn(page)).lines[0]).toEqual([20, 20, 90, 20]);
  await expectDrawn(page);
  await park();
  await page.screenshot({ path: test.info().outputPath('3-constrained.png') });

  // A second value on the second line's length over-constrains it: a reference is offered.
  await type(page, 'DCALIGNED', /<Object>:$/);
  await type(page, '', 'Select object:');
  await click(35, 55);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(30, 75);
  await type(page, '40', 'Create a reference constraint? [Yes/No] <Yes>:');
  await expect(log).toContainText('over-constrain the geometry');
  await park();
  await page.screenshot({ path: test.info().outputPath('4-reference-offered.png') });
  await type(page, '', 'Command:');
  await expect
    .poll(async () => (await drawn(page)).dims)
    .toEqual([
      ['aligned', 'width', '50', false],
      // The lowest free names: `width` took d1's place.
      ['horizontal', 'd1', 'width+20', false],
      ['aligned', 'd2', '50', true],
    ]);

  // Saved (downloaded, as without File System Access) and opened again.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const saving = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = test.info().outputPath('dimensioned.dxf');
  await (await saving).saveAs(file);
  const text = readFileSync(file, 'utf8');
  expect(text).toMatch(/\r?\n {2}1\r?\ndimensional\r?\n/);
  expect(text).toMatch(/\r?\n300\r?\nwidth\r?\n301\r?\n50\r?\n/);

  await openWithPicker(page, file);
  await expectShown(page, 'dimensioned.dxf');
  await zoom();
  await expectDrawn(page, { timeout: 15_000 });
  // `Command:` is not a sync point for ZOOM's view (TESTING.md §7): wait for it to centre.
  const box = (await activeCanvas(page).boundingBox())!;
  await expect
    .poll(async () => Math.abs((await worldAt(page, box.width / 2, box.height / 2)).x - 1000080))
    .toBeLessThan(5);
  view = await viewOf(page);
  // The second line's length is still driven by `width`: another value is refused again.
  await type(page, 'DCALIGNED', /<Object>:$/);
  await type(page, '', 'Select object:');
  await click(35, 55);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(30, 75);
  await type(page, '30', 'Create a reference constraint? [Yes/No] <Yes>:');
  await park();
  await page.screenshot({ path: test.info().outputPath('5-reopened-holds.png') });
  await type(page, 'N', 'Command:');
});
