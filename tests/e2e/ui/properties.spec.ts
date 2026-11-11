// M2-21: the Properties palette, as a drafter uses it. A line drawn on an empty part of the plan
// is picked; Ctrl+1 shows its properties; its colour is chosen and its end typed, each an edit
// the drawing's engine makes (and so a change set); Ctrl+A shows every object, General only,
// with *VARIES*, and the object list narrows it; PROPERTIESCLOSE closes the palette. A drawing
// with dynamic block references shows the FR-B3 badge. The sheet and the edits are unit-tested
// in packages/engine/test/properties; this checks the app carries them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The lines this test drew, as the change sets left them: their colour and ends. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, { color: unknown; ends: number[] }>();
    const put = (e: Entity) => {
      if (e.geom.kind !== 'LINE') return;
      const g = e.geom;
      out.set(e.handle, {
        color: e.color,
        ends: [g.start.x, g.start.y, g.end.x, g.end.y].map((v) => Math.round(v - 1e6)),
      });
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) if (out.has(u.after.handle)) put(u.after);
    }
    return [...out.values()];
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('shows and edits the selected objects’ properties', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line across it.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000070,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000090,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect
    .poll(() => drawn(page))
    .toEqual([{ color: { kind: 'byLayer' }, ends: [70, 50, 90, 50] }]);

  const palette = page.getByRole('complementary', { name: 'Properties' });
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  await expect(objects).toHaveText('No selection');

  // Pick the line at the canvas centre, (80, 50): the docked palette narrowed the canvas.
  const docked = (await canvas.boundingBox())!;
  await page.mouse.click(docked.x + docked.width / 2, docked.y + docked.height / 2);
  await expect(objects).toHaveText('Line (1)');
  await expect(palette.getByRole('table', { name: 'Geometry' })).toBeVisible();
  await expect(palette.getByRole('textbox', { name: 'Start X' })).toHaveValue(/^1000070\.0+$/);
  await expect(palette.getByLabel('Length', { exact: true })).toHaveText(/^20\.0+$/);

  await palette.getByRole('combobox', { name: 'Color' }).selectOption({ label: 'Red' });
  await expect
    .poll(() => drawn(page))
    .toEqual([{ color: { kind: 'aci', index: 1 }, ends: [70, 50, 90, 50] }]);
  const endX = palette.getByRole('textbox', { name: 'End X' });
  await endX.fill('1000100');
  await endX.press('Enter');
  await expect
    .poll(() => drawn(page))
    .toEqual([{ color: { kind: 'aci', index: 1 }, ends: [70, 50, 100, 50] }]);
  await expect(palette.getByLabel('Length', { exact: true })).toHaveText(/^30\.0+$/);
  // The line stays selected after the edits.
  await expect(objects).toHaveText('Line (1)');

  // Everything: General only, a layer that varies, and the list to narrow it. The field
  // keeps the focus (and its keys) until the drafter leaves the palette.
  await palette.getByRole('heading', { name: 'Properties' }).click();
  await page.keyboard.press('Escape');
  await expect(objects).toHaveText('No selection');
  await page.mouse.move(docked.x + docked.width / 2, docked.y + docked.height / 2);
  await page.keyboard.press('Control+a');
  await expect(objects).toContainText(/^All \(\d+\)/);
  await expect(palette.getByRole('table')).toHaveCount(1);
  await expect(palette.getByRole('combobox', { name: 'Layer' })).toHaveValue('*VARIES*');
  await objects.selectOption({ label: 'Line (1)' });
  await expect(palette.getByRole('table', { name: 'Geometry' })).toBeVisible();
  await expect(palette.getByRole('textbox', { name: 'End X' })).toHaveValue(/^1000100\.0+$/);

  await page.keyboard.press('Escape');
  await expect(objects).toHaveText('No selection');
  await canvas.hover();
  await type(page, 'PROPERTIESCLOSE', 'Command:');
  await expect(palette).toBeHidden();
  await type(page, 'PR', 'Command:');
  await expect(palette).toBeVisible();
});

// M2-35: with nothing selected the palette shows the drawing's current settings (AutoCAD's "No
// selection" General), a change sets them, and the next object drawn takes them.
test('sets the current colour, layer and lineweight with nothing selected', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toHaveText('No selection');
  await expect(objects).toBeDisabled();
  const general = palette.getByRole('table', { name: 'General' });
  await expect(palette.getByRole('table')).toHaveCount(1);
  const color = general.getByRole('combobox', { name: 'Color' });
  const layer = general.getByRole('combobox', { name: 'Layer' });
  await expect(color).toHaveValue('ByLayer');
  // The drawing's layers are 0 (current) and Defpoints.
  await expect(layer.locator('option:checked')).toHaveText('0');
  const other = 'Defpoints';

  await color.selectOption({ label: 'Blue' });
  await expect(color).toHaveValue('aci:5');
  await layer.selectOption({ label: other });
  await expect(layer.locator('option:checked')).toHaveText(other);
  await general.getByRole('combobox', { name: 'Lineweight' }).selectOption({ label: '0.50 mm' });

  await activeCanvas(page).hover();
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000070,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000090,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  const line = await page.evaluate(() => {
    const changes = (window as unknown as Dev).triyaDev.changes();
    for (const cs of [...changes].reverse())
      for (const a of cs.entities?.added ?? []) if (a.entity.geom.kind === 'LINE') return a.entity;
    return undefined;
  });
  expect(line).toMatchObject({ color: { kind: 'aci', index: 5 }, lineweight: 50 });
  const layerValue = await layer.inputValue();
  expect(line!.layer).toBe(layerValue);
  // U takes the drawing back to the settings it had, one palette change at a time.
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await expect(general.getByRole('combobox', { name: 'Lineweight' })).toHaveValue('ByLayer');
});

test('shows the dynamic block badge on dynamic block references', async ({ page }) => {
  const file = path.resolve(
    'corpus/public/third-party/acadsharp/dynamic-blocks/BLOCKVISIBILITYPARAMETER.dxf',
  );
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Properties' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toContainText(/Block Reference/);
  const types = await objects.locator('option').allTextContents();
  const block = types.find((t) => t.startsWith('Block Reference'))!;
  if (types.length > 1) await objects.selectOption({ label: block });
  await expect(palette.getByRole('note')).toContainText('Dynamic — edit in AutoCAD');
  await expect(palette.getByLabel('Name', { exact: true })).not.toHaveText(/^\*U/);
});
