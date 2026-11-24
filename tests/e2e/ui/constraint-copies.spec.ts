// M9-10: copies carry constraints in the app. On an empty part of the plan an L of two lines is
// drawn and given dimensional constraints, its foot `width=30` and its upright `width/2`. With
// PARAMETERCOPYMODE 4 an ARRAY of separate items gives each copy of the L constraints of its own
// under new names, the upright's expression naming its own foot's copy; with 1 (the initial
// value) a COPY gives values. ERASE of a copied upright takes its constraint, and OOPS brings both
// back. The rules are unit-tested in packages/engine/test/commands/constraint-upkeep.test.ts
// ('the rest of constraint upkeep (M9-10)'), the solving of the copies in
// packages/constraints/test/upkeep.test.ts; this checks that the app keeps the variable and that
// the canvas shows what the copies carry.
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

interface Dim {
  readonly parameter: string;
  readonly expression: string;
}

/** The session's dimensional constraints as `name=expression`, in the order they were made. */
const dims = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Dim>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const o of cs.objects?.added ?? [])
        if (o.type === 'TRIYA_DIMCONSTRAINT') out.set(o.handle, o as unknown as Dim);
      for (const u of cs.objects?.updated ?? [])
        if (out.has(u.after.handle)) out.set(u.after.handle, u.after as unknown as Dim);
      for (const o of cs.objects?.removed ?? []) out.delete(o.handle);
    }
    return [...out.values()].map((d) => `${d.parameter}=${d.expression}`);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('ARRAY and COPY carry dimensional constraints; OOPS brings an erased one back', async ({
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
  const at = (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    return { x: view.box.x + p.x, y: view.box.y + p.y };
  };
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  const shot = async (name: string) => {
    await expectDrawn(page);
    await park();
    await page.screenshot({ path: test.info().outputPath(name) });
  };

  // The foot 30 long as `width`, the upright half of it.
  const aligned = async (x: number, y: number, lx: number, ly: number, value: string) => {
    await type(page, 'DCALIGNED', /<Object>:$/);
    await type(page, '', 'Select object:');
    await click(x, y);
    await expect(prompt(page)).toHaveText('Specify dimension line location:', {
      timeout: 15_000,
    });
    await click(lx, ly);
    await expect(prompt(page)).toHaveText(/^Dimension text </);
    await type(page, value, 'Command:');
  };
  await aligned(25, 20, 25, 12, 'width=30');
  await aligned(40, 30, 48, 30, 'width/2');
  await expect.poll(() => dims(page), { timeout: 15_000 }).toEqual(['width=30', 'd1=width/2']);
  await shot('1-constrained.png');

  // PARAMETERCOPYMODE 4: ARRAY's three separate items keep the expressions among their copies.
  await type(page, 'PARAMETERCOPYMODE', /^Enter new value for PARAMETERCOPYMODE <1>:/);
  await type(page, '4', 'Command:');
  await type(page, 'ARRAYRECT', 'Select objects:');
  await click(25, 20);
  await click(40, 30);
  await type(page, '', /^Select grip to edit array or/);
  await type(page, 'AS', /^Create associative array/);
  await type(page, 'N', /^Select grip to edit array or/);
  await type(page, 'COU', /^Enter number of columns/);
  await type(page, '3', /^Enter number of rows/);
  await type(page, '1', /^Select grip to edit array or/);
  await type(page, 'S', /^Specify the distance between columns/);
  await type(page, '50', /^Specify the distance between rows/);
  await type(page, '', /^Select grip to edit array or/);
  await type(page, '', 'Command:');
  await expect
    .poll(() => dims(page), { timeout: 15_000 })
    .toEqual(['width=30', 'd1=width/2', 'd2=30', 'd3=d2/2', 'd4=30', 'd5=d4/2']);
  await shot('2-array-mode-4.png');

  // Back to 1: a COPY gives the copies values.
  await type(page, 'PARAMETERCOPYMODE', /^Enter new value for PARAMETERCOPYMODE <4>:/);
  await type(page, '1', 'Command:');
  await type(page, 'COPY', 'Select objects:');
  await click(25, 20);
  await click(40, 30);
  await type(page, '', /^Specify base point/);
  await type(page, '0,0', /^Specify second point/);
  await type(page, '0,60', /^Specify second point/);
  await type(page, '', 'Command:');
  await expect
    .poll(async () => (await dims(page)).slice(6), { timeout: 15_000 })
    .toEqual(['d6=30', 'd7=15']);
  await shot('3-copy-mode-1.png');

  // ERASE of a copied upright takes its constraint; OOPS brings both back.
  await type(page, 'ERASE', 'Select objects:');
  await click(140, 30);
  await type(page, '', 'Command:');
  await expect.poll(async () => (await dims(page)).length, { timeout: 15_000 }).toBe(7);
  await shot('4-erased.png');
  await type(page, 'OOPS', 'Command:');
  await expect
    .poll(() => dims(page), { timeout: 15_000 })
    .toEqual(['width=30', 'd1=width/2', 'd2=30', 'd3=d2/2', 'd4=30', 'd6=30', 'd7=15', 'd5=d4/2']);
  await shot('5-oops.png');
});
