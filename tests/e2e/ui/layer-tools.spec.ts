// M5-06 part 1: the layer tool row's commands on the canvas. Two lines are drawn, one on layer
// 0 and one on HATCH; LAYISO on the first locks HATCH (faded by LAYLOCKFADECTL) and keeps 0
// current, LAYUNISO unlocks it again, and LAYOFF on the second turns HATCH off until LAYON. The
// Layers palette shows each change as the engine made it.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Types a line at the command line and waits for the prompt that follows. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('LAYISO, LAYUNISO, LAYOFF and LAYON change the layers of the objects picked', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const click = async (x: number, y: number) =>
    page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  const line = async (y: number) => {
    await type(page, 'L', 'Specify first point:');
    await click(0.2, y);
    await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
    await click(0.7, y);
    await type(page, '', 'Command:');
  };
  const lock = (layer: string) =>
    palette.getByRole('button', { name: `Lock ${layer}`, exact: true });
  const on = (layer: string) => palette.getByRole('button', { name: `On ${layer}`, exact: true });
  const current = (layer: string) =>
    palette
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: layer, exact: true }) });

  // An empty part of the plan, running object snaps off: a line on 0, then one on HATCH.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.press('F3');
  await line(0.35);
  await type(page, 'CLAYER', /^Enter new value for CLAYER/);
  await type(page, 'HATCH', 'Command:');
  await line(0.65);
  await expect(current('HATCH')).toHaveAttribute('data-current', 'true');
  await shot('1-before.png');

  // LAYISO on the line on 0: HATCH is locked (and faded), 0 becomes current.
  await type(page, 'LAYISO', 'Select objects on the layer(s) to be isolated or [Settings]:');
  await click(0.45, 0.35);
  await type(page, '', 'Command:');
  await expect(lock('HATCH')).toHaveAttribute('aria-pressed', 'true');
  await expect(lock('0')).toHaveAttribute('aria-pressed', 'false');
  await expect(current('0')).toHaveAttribute('data-current', 'true');
  await shot('2-layiso.png');

  await type(page, 'LAYUNISO', 'Command:');
  await expect(lock('HATCH')).toHaveAttribute('aria-pressed', 'false');
  await expect(lock('Defpoints')).toHaveAttribute('aria-pressed', 'false');

  // LAYOFF on the line on HATCH, until Enter; LAYON turns it back on.
  await type(page, 'LAYOFF', 'Select an object on the layer to be turned off or [Settings/Undo]:');
  await click(0.45, 0.65);
  await expect(on('HATCH')).toHaveAttribute('aria-pressed', 'false');
  await shot('3-layoff.png');
  await type(page, '', 'Command:');
  await type(page, 'LAYON', 'Command:');
  await expect(on('HATCH')).toHaveAttribute('aria-pressed', 'true');
});

// M5-06 part 2: LAYMRG merges the layer of a line picked into one named, after AutoCAD's
// warning, and the Layers palette loses the merged layer; LAYERP puts back a LAYLCK.
test('LAYMRG merges a layer picked into one named, and LAYERP puts back a lock', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const click = async (x: number, y: number) =>
    page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  const row = (layer: string) => palette.getByRole('rowheader', { name: layer, exact: true });
  const lock = (layer: string) =>
    palette.getByRole('button', { name: `Lock ${layer}`, exact: true });

  // An empty part of the plan, running object snaps off: a line on HATCH, then 0 current.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.press('F3');
  await type(page, 'CLAYER', /^Enter new value for CLAYER/);
  await type(page, 'HATCH', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await click(0.2, 0.5);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await click(0.7, 0.5);
  await type(page, '', 'Command:');
  await type(page, 'CLAYER', /^Enter new value for CLAYER/);
  await type(page, '0', 'Command:');
  await expect(row('HATCH')).toBeVisible();

  // LAYMRG: the line's layer, then the target by Name (M5-06 part 3: the Merge to Layer dialog).
  await type(page, 'LAYMRG', 'Select object on layer to merge or [Name]:');
  await click(0.45, 0.5);
  await expect(prompt(page)).toHaveText('Select object on layer to merge or [Name/Undo]:');
  await type(page, '', 'Select object on target layer or [Name]:');
  await page.keyboard.type('N');
  await page.keyboard.press('Enter');
  const mergeTo = page.getByRole('dialog', { name: 'Merge to Layer' });
  const targets = mergeTo.getByRole('listbox', { name: 'Target Layer:' });
  await expect(targets.getByRole('option', { name: 'HATCH', exact: true })).toHaveCount(0);
  await targets.getByRole('option', { name: '0', exact: true }).dblclick();
  await expect(mergeTo).toHaveCount(0);
  await expect(prompt(page)).toHaveText('Do you wish to continue? [Yes/No] <No>:');
  await shot('4-laymrg-warning.png');
  await type(page, 'Y', 'Command:');
  await expect(row('HATCH')).toHaveCount(0);
  await shot('5-laymrg-merged.png');

  // LAYLCK on the line (now on 0), then LAYERP unlocks 0 again.
  await type(page, 'LAYLCK', 'Select an object on the layer to be locked:');
  await click(0.45, 0.5);
  await expect(prompt(page)).toHaveText('Command:');
  await expect(lock('0')).toHaveAttribute('aria-pressed', 'true');
  await type(page, 'LAYERP', 'Command:');
  await expect(lock('0')).toHaveAttribute('aria-pressed', 'false');
});

// M5-06 part 3: Name opens AutoCAD's Change to Layer and Delete Layers dialogs. LAYMCH moves a
// line to a layer typed in Change to Layer's Current Layer box, which makes it; LAYDEL's Delete
// Layers takes it and HATCH with Ctrl, and both go after AutoCAD's warning.
test('Change to Layer makes a layer, and Delete Layers deletes the layers chosen', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const click = async (x: number, y: number) =>
    page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  const row = (layer: string) => palette.getByRole('rowheader', { name: layer, exact: true });

  // A line on 0 in an empty part of the plan, running object snaps off.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.press('F3');
  await type(page, 'CLAYER', /^Enter new value for CLAYER/);
  await type(page, '0', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await click(0.2, 0.5);
  await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
  await click(0.7, 0.5);
  await type(page, '', 'Command:');

  // LAYMCH: the line, then Name: Change to Layer opens on the current layer 0.
  await type(page, 'LAYMCH', 'Select objects to be changed:');
  await click(0.45, 0.5);
  await type(page, '', 'Select object on destination layer or [Name]:');
  await page.keyboard.type('N');
  await page.keyboard.press('Enter');
  const change = page.getByRole('dialog', { name: 'Change to Layer' });
  const current = change.getByRole('textbox', { name: 'Current Layer:' });
  await expect(current).toHaveValue('0');
  await expect(current).toBeFocused();
  const destinations = change.getByRole('listbox', { name: 'Destination Layer:' });
  await expect(destinations.getByRole('option', { name: '0', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // A click on a layer puts its name in the box; a name the drawing lacks selects none.
  await destinations.getByRole('option', { name: 'HATCH', exact: true }).click();
  await expect(current).toHaveValue('HATCH');
  await current.fill('NEW-WALLS');
  await expect(destinations.getByRole('option', { selected: true })).toHaveCount(0);
  await shot('1-change-to-layer.png');
  await change.getByRole('button', { name: 'OK' }).click();
  await expect(change).toHaveCount(0);
  await expect(prompt(page)).toHaveText('Command:');
  await expect(row('NEW-WALLS')).toBeVisible();

  // LAYDEL: Name opens Delete Layers; NEW-WALLS, then HATCH with Ctrl.
  await type(page, 'LAYDEL', 'Select object on layer to delete or [Name]:');
  await page.keyboard.type('N');
  await page.keyboard.press('Enter');
  const del = page.getByRole('dialog', { name: 'Delete Layers' });
  const list = del.getByRole('listbox', { name: 'Layers to Delete:' });
  await expect(list).toHaveAttribute('aria-multiselectable', 'true');
  // Not 0, which cannot be deleted, nor the current layer.
  await expect(list.getByRole('option', { name: '0', exact: true })).toHaveCount(0);
  await list.getByRole('option', { name: 'NEW-WALLS', exact: true }).click();
  await list.getByRole('option', { name: 'HATCH', exact: true }).click({ modifiers: ['Control'] });
  await expect(list.getByRole('option', { selected: true })).toHaveCount(2);
  await shot('2-delete-layers.png');
  await del.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Do you wish to continue? [Yes/No] <No>:');
  await type(page, 'Y', 'Command:');
  await expect(row('NEW-WALLS')).toHaveCount(0);
  await expect(row('HATCH')).toHaveCount(0);
  await shot('3-layers-deleted.png');
});
