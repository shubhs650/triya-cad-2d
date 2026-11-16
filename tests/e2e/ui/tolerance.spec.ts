// M4-11 from the app's canvas: TOLERANCE's Geometric Tolerance dialog (the Symbol and Material
// Condition pickers, the diameter box, values, a second row, the projected zone, Esc cancelling),
// the frame dragged to its location and drawn, and a double click on it opening the dialog on its
// fields. The frame text and the command's prompts are unit-tested in packages/engine/test
// (commands/tolerance, edit/tolerance-frame); this checks that the canvas, the bus, the engine
// worker and the dialog carry them.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import path from 'node:path';
import { DXF, expectShown, lightPixels, openWithPicker, worldAt } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The entities this test added, as they are now. */
const added = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, Entity>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) out.set(a.entity.handle, a.entity);
      for (const u of cs.entities?.updated ?? []) {
        if (out.has(u.after.handle)) out.set(u.after.handle, u.after);
      }
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].map((e) => ({ type: e.type, geom: e.geom }));
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const X0 = 1000000;
const Y0 = 1000000;

const FRAME = [
  '{\\Fgdt;j}%%v{\\Fgdt;n}0.1{\\Fgdt;m}%%v%%vA%%vB%%vC',
  '{\\Fgdt;c}%%v0.05%%v%%v%%v%%v',
  '25{\\Fgdt;p}',
].join('\n');

test('TOLERANCE: the Geometric Tolerance dialog places a frame; a double click edits it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  // An empty part of the plan, 60 × 40 units (the drawing's text is 2.5 high).
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, `${X0},${Y0}`, 'Specify opposite corner:');
  await type(page, `${X0 + 60},${Y0 + 40}`, 'Command:');
  const w1 = await worldAt(page, 100, 100);
  const w2 = await worldAt(page, 300, 100);
  const s = (w2.x - w1.x) / 200;
  /** Canvas CSS pixels of a point given from the corner X0, Y0. */
  const px = (x: number, y: number) => ({
    x: 100 + (X0 + x - w1.x) / s,
    y: 100 - (Y0 + y - w1.y) / s,
  });
  const box = (await page.locator('canvas[data-active="true"]').boundingBox())!;

  // Esc cancels the dialog: nothing placed.
  await type(page, 'TOL', 'Geometric Tolerance:');
  const dialog = page.getByRole('dialog', { name: 'Geometric Tolerance' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  await type(page, 'TOLERANCE', 'Geometric Tolerance:');
  await expect(dialog).toBeVisible();
  // Sym opens the Symbol dialog; Esc closes it alone.
  await dialog.getByRole('button', { name: 'Sym, row 1' }).click();
  const symbols = page.getByRole('dialog', { name: 'Symbol' });
  await expect(symbols).toBeVisible();
  await expect(symbols.getByRole('button')).toHaveCount(15);
  await page.screenshot({ path: test.info().outputPath('1-symbol-dialog.png') });
  await page.keyboard.press('Escape');
  await expect(symbols).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Sym, row 1' }).click();
  await symbols.getByRole('button', { name: 'Position' }).click();
  await expect(symbols).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Sym, row 1' })).toHaveAttribute(
    'title',
    'Position',
  );
  // Tolerance 1: the diameter box, the value, MMC.
  await dialog.getByRole('button', { name: 'Tolerance 1 diameter, row 1' }).click();
  await expect(dialog.getByRole('button', { name: 'Tolerance 1 diameter, row 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByLabel('Tolerance 1 value, row 1').fill('0.1');
  await dialog.getByRole('button', { name: 'Tolerance 1 material condition, row 1' }).click();
  const conditions = page.getByRole('dialog', { name: 'Material Condition' });
  await expect(conditions.getByRole('button')).toHaveCount(4);
  await conditions.getByRole('button', { name: 'At maximum material condition (MMC)' }).click();
  await expect(conditions).toBeHidden();
  await dialog.getByLabel('Datum 1 value, row 1').fill('A');
  await dialog.getByLabel('Datum 2 value, row 1').fill('B');
  await dialog.getByLabel('Datum 3 value, row 1').fill('C');
  // Row 2: flatness 0.05.
  await dialog.getByRole('button', { name: 'Sym, row 2' }).click();
  await symbols.getByRole('button', { name: 'Flatness' }).click();
  await dialog.getByLabel('Tolerance 1 value, row 2').fill('0.05');
  // The projected tolerance zone, 25 high.
  await dialog.getByLabel('Height:').fill('25');
  await dialog.getByRole('button', { name: 'Projected Tolerance Zone:' }).click();
  await page.screenshot({ path: test.info().outputPath('2-geometric-tolerance.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Enter tolerance location:');
  // The frame follows the cursor.
  const at = px(10, 25);
  await page.mouse.move(box.x + at.x + 20, box.y + at.y + 20, { steps: 3 });
  await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 3 });
  await page.screenshot({ path: test.info().outputPath('3-dragged.png') });
  await type(page, `#${X0 + 10},${Y0 + 25}`, 'Command:');
  await expect.poll(async () => (await added(page)).map((e) => e.type)).toEqual(['TOLERANCE']);
  expect((await added(page))[0]!.geom).toMatchObject({
    kind: 'TOLERANCE',
    position: { x: X0 + 10, y: Y0 + 25 },
    rotation: 0,
    text: FRAME,
  });
  // Drawn: its left edge runs up and down from the insertion point.
  const edge = px(10, 25);
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('4-placed.png') });
  await expect
    .poll(() =>
      lightPixels(page, { x: edge.x - 2, y: edge.y - 6 }, { x: edge.x + 2, y: edge.y + 6 }),
    )
    .toBeGreaterThan(4);
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.screenshot({ path: test.info().outputPath('4-placed.png') });

  // A double click on the frame opens the dialog on its fields.
  await page.mouse.dblclick(box.x + edge.x, box.y + edge.y);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Datum 2 value, row 1')).toHaveValue('B');
  await expect(dialog.getByLabel('Tolerance 1 value, row 2')).toHaveValue('0.05');
  await expect(dialog.getByLabel('Height:')).toHaveValue('25');
  await dialog.getByLabel('Datum Identifier:').fill('D');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => ((await added(page))[0]!.geom as { text: string }).text)
    .toBe(`${FRAME}\nD`);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.screenshot({ path: test.info().outputPath('5-edited.png') });
});
