// M3-04 part 4: FILTER's Object Selection Filters dialog and PICKADD on the canvas, as AutoCAD
// 2024's. A filter line is built under Select Filter and added to the list, saved by name, and
// applied: "Select objects" then keeps only what the filter takes. Typed transparently
// ('FILTER) at an editing command's "Select objects", what it takes joins that selection. PICKADD
// 0 makes each pick replace the selection.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, EntityId } from '@triya/engine';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

interface DevHooks {
  changes(): readonly ChangeSet[];
  selection(): readonly EntityId[];
}

type Dev = { triyaDev: DevHooks };

const selected = (page: Page) =>
  page.evaluate(() => [...(window as unknown as Dev).triyaDev.selection()].sort((a, b) => a - b));
const added = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => (cs.entities?.added ?? []).map((a) => a.entity.id)),
  );
const erased = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => (cs.entities?.removed ?? []).map((r) => r.entity.id)),
  );
const prompt = (page: Page) => page.getByTestId('command-prompt');
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

/** Types a line at the command line and waits for the prompt that follows. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('FILTER and PICKADD', async ({ page }) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };

  // An empty part of the plan: a line, a small circle and a large one.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await click(0.1, 0.5);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await click(0.25, 0.5);
  await type(page, '', 'Command:');
  for (const [x, r] of [
    [0.45, '5'],
    [0.75, '20'],
  ] as const) {
    await type(page, 'C', 'Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:');
    await click(x, 0.5);
    await expect(prompt(page)).toHaveText(/^Specify radius of circle/);
    await type(page, r, 'Command:');
  }
  const [line, small, big] = (await added(page)) as [number, number, number];

  // FILTER: circles with a radius of 10 or more, saved as "Big circles", applied to ALL.
  await page.keyboard.type('FILTER');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Object Selection Filters' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Select Filter').selectOption({ label: 'Circle' });
  await dialog.getByRole('button', { name: 'Add to List' }).click();
  await dialog.getByLabel('Select Filter').selectOption({ label: 'Circle Radius' });
  await dialog.getByLabel('X operator').selectOption('>=');
  await dialog.getByLabel('X value').fill('10');
  await dialog.getByRole('button', { name: 'Add to List' }).click();
  const list = dialog.getByLabel('Filter property list');
  await expect(list.locator('option')).toHaveText(['Object = Circle', 'Circle Radius >= 10.0000']);
  await dialog.getByLabel('Filter name').fill('Big circles');
  await dialog.getByRole('button', { name: 'Save As:' }).click();
  await expect(dialog.getByLabel('Current:')).toHaveValue('Big circles');
  await shot('1-object-selection-filters.png');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'ALL', 'Select objects:');
  await type(page, '', 'Command:');
  await expect(history(page)).toContainText('Exiting filtered selection.');
  // PICKADD 2: the filtered set stays selected, as SELECT's does.
  await expect.poll(() => selected(page)).toEqual([big]);
  await shot('2-filtered-selection.png');
  await page.keyboard.press('Escape');

  // An unbalanced list cannot be applied.
  await page.keyboard.type('FILTER');
  await page.keyboard.press('Enter');
  await expect(dialog.getByLabel('Current:')).toHaveValue('Big circles');
  await dialog.getByLabel('Select Filter').selectOption({ label: '**Begin NOT' });
  await dialog.getByRole('button', { name: 'Add to List' }).click();
  await expect(dialog.getByText('**Begin NOT has no **End NOT.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  // 'FILTER at ERASE's "Select objects": the line picked, then the saved filter's circles.
  await type(page, 'ERASE', 'Select objects:');
  await click(0.2, 0.5);
  await expect.poll(() => selected(page)).toEqual([line]);
  await page.keyboard.type("'FILTER");
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(prompt(page)).toHaveText('>>Select objects:');
  await type(page, 'ALL', '>>Select objects:');
  await type(page, '', 'Select objects:');
  await expect(history(page)).toContainText('Resuming ERASE command.');
  await expect.poll(() => selected(page)).toEqual([line, big]);
  await type(page, '', 'Command:');
  await expect.poll(() => erased(page)).toEqual(expect.arrayContaining([line, big]));
  expect(await erased(page)).not.toContain(small);
  await type(page, 'U', 'Command:');

  // PICKADD 0: each pick replaces the selection; Shift adds.
  await type(page, 'PICKADD', /^Enter new value for PICKADD <2>:/);
  await type(page, '0', 'Command:');
  await click(0.2, 0.5);
  await expect.poll(() => selected(page)).toEqual([line]);
  const left = at(0.45, 0.5);
  // The small circle's left quadrant: 5 units left of where its centre was clicked.
  const scale = Math.min(box.width / 160, box.height / 100);
  await page.mouse.click(left.x - 5 * scale, left.y);
  await expect.poll(() => selected(page)).toEqual([small]);
  await page.keyboard.down('Shift');
  await click(0.2, 0.5);
  await page.keyboard.up('Shift');
  await expect.poll(() => selected(page)).toEqual([line, small]);
});
