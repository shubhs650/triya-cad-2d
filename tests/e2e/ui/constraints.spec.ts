// M9-05 part 1: geometric constraints from the app. On an empty part of the plan three lines are
// drawn; the Parametric tab's Parallel makes the second line parallel to the first, the first
// staying put; GCPERPENDICULAR typed makes the third perpendicular to the first; a Perpendicular
// between the two parallel lines is refused, saying why; U takes the last constraint back with
// what it moved. The lines turned keep their length (M9-08). The engine worker loads the
// PlaneGCS solver on the first constraint. Prompts and refusals are unit-tested in
// packages/engine/test/commands/constraints.test.ts, the solving in
// packages/constraints/test/solver.test.ts; this checks that the ribbon, canvas, bus, engine
// worker and solver module carry them.
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
