// M2-21: the Properties palette, as a drafter uses it. A line drawn on an empty part of the plan
// is picked; Ctrl+1 shows its properties; its colour is chosen and its end typed, each an edit
// the drawing's engine makes (and so a change set); Ctrl+A shows every object, General only,
// with *VARIES*, and the object list narrows it; PROPERTIESCLOSE closes the palette. A drawing
// with dynamic block references shows the FR-B3 badge. The sheet and the edits are unit-tested
// in packages/engine/test/properties; this checks the app carries them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, InsertGeometry } from '@triya/engine';
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

// M2-35 part 2: a text's Justify and a block reference's Scale X are a choice and a typed value in
// the palette. A new justification keeps the text's insertion point and moves the text about it,
// measured where the canvas draws it; a new scale stretches the reference, its attributes too.
test('justifies a text from the palette about its insertion point', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000070,1000050', /^Specify height/);
  await type(page, '5', /^Specify rotation angle of text/);
  await type(page, '', 'Enter text:');
  await page.getByRole('textbox', { name: 'Text' }).pressSequentially('SECTION A');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toContainText(/Text \(1\)/);
  await objects.selectOption({ label: 'Text (1)' });
  const justify = palette.getByRole('combobox', { name: 'Justify' });
  await expect(justify).toHaveValue('Left');
  await expect(palette.getByRole('combobox', { name: 'Style' })).toHaveValue(/.+/);
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('1-text-left.png') });
  await justify.selectOption({ label: 'Middle center' });
  await expect(justify).toHaveValue('Middle center');
  const text = await page.evaluate(() => {
    for (const cs of [...(window as unknown as Dev).triyaDev.changes()].reverse())
      for (const u of cs.entities?.updated ?? [])
        if (u.after.geom.kind === 'TEXT') return u.after.geom;
    return undefined;
  });
  // The insertion point stays at the picked point; DXF 10 is the baseline start half the
  // text's measured width to the left and half its height down.
  expect(text).toMatchObject({ halign: 1, valign: 2, alignmentPoint: { x: 1000070, y: 1000050 } });
  const start = (text as { position: { x: number; y: number } }).position;
  expect(start.x).toBeLessThan(1000070 - 5);
  expect(start.y).toBeCloseTo(1000050 - 2.5, 6);
  await page.screenshot({ path: test.info().outputPath('2-text-middle-center.png') });
});

test('scales a block reference from the palette, its attributes following', async ({ page }) => {
  test.setTimeout(120_000);
  const file = path.resolve('packages/testkit/fixtures/attributes/title-block.dxf');
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  // The whole sheet in the canvas the docked palette narrowed.
  await activeCanvas(page).hover();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'E', 'Command:');
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toContainText(/Block Reference \(1\)/);
  await objects.selectOption({ label: 'Block Reference (1)' });
  const scaleX = palette.getByRole('textbox', { name: 'Scale X' });
  await expect(scaleX).toHaveValue(/^1(\.0+)?$/);
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('3-block-before.png') });
  await scaleX.fill('0.8');
  await scaleX.press('Enter');
  const insert = () =>
    page.evaluate(() => {
      for (const cs of [...(window as unknown as Dev).triyaDev.changes()].reverse())
        for (const u of cs.entities?.updated ?? [])
          if (u.after.geom.kind === 'INSERT') {
            const before = u.before.geom as InsertGeometry;
            const after = u.after.geom as InsertGeometry;
            return {
              scale: after.scale,
              // Each attribute's distance from the insertion point along X (where it has
              // one), after over before, and its width factor, after over before.
              ratios: after.attributes
                .map((a, i) => ({
                  now: a.position.x - after.position.x,
                  was: before.attributes[i]!.position.x - before.position.x,
                }))
                .filter((d) => Math.abs(d.was) > 1)
                .map((d) => d.now / d.was),
              widths: after.attributes.map(
                (a, i) => a.widthFactor / before.attributes[i]!.widthFactor,
              ),
            };
          }
      return undefined;
    });
  await expect.poll(async () => (await insert())?.scale).toEqual({ x: 0.8, y: 1, z: 1 });
  const r = (await insert())!;
  for (const k of r.ratios) expect(k).toBeCloseTo(0.8, 6);
  expect(r.ratios.length).toBeGreaterThan(0);
  for (const w of r.widths) expect(w).toBeCloseTo(0.8, 6);
  await expect(scaleX).toHaveValue(/^0\.80*$/);
  await page.screenshot({ path: test.info().outputPath('4-block-scaled.png') });
});

test('gives a hatch another pattern, angle and scale from the palette', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  await activeCanvas(page).hover();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'E', 'Command:');
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  // The drawing's model space holds one object, a solid hatch.
  await expect(objects).toHaveText('Hatch (1)');
  // A field with suggestions (a datalist) is a combobox.
  const name = palette.getByRole('combobox', { name: 'Pattern name' });
  await expect(name).toHaveValue('SOLID');
  // The library's patterns are offered as the name is typed.
  const offered = await page
    .locator('datalist#patternName-choices option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(offered).toEqual(expect.arrayContaining(['SOLID', 'TRIYA_CROSS45', 'TRIYA_LINES45']));
  await page.mouse.move(300, 640);
  await page.screenshot({ path: test.info().outputPath('5-hatches-solid.png') });

  const hatches = () =>
    page.evaluate(() => {
      const out = new Map<string, unknown>();
      for (const cs of (window as unknown as Dev).triyaDev.changes())
        for (const u of cs.entities?.updated ?? [])
          if (u.after.geom.kind === 'HATCH') {
            const g = u.after.geom;
            out.set(u.after.handle, {
              pattern: g.pattern,
              solid: g.solid,
              angle: Math.round((g.patternAngle * 180) / Math.PI),
              scale: g.patternScale,
              families: g.patternLines.length,
              gap:
                Math.round(
                  Math.hypot(g.patternLines[0]?.offset.x ?? 0, g.patternLines[0]?.offset.y ?? 0) *
                    1000,
                ) / 1000,
            });
          }
      return [...out.values()];
    });
  await name.fill('triya_cross45');
  await name.press('Enter');
  const crossed = { pattern: 'TRIYA_CROSS45', solid: false, families: 2 };
  // The fill keeps the angle its file states (45°), as AutoCAD keeps a hatch's angle.
  await expect.poll(hatches).toEqual([{ ...crossed, angle: 45, scale: 1, gap: 3 }]);
  await expect(name).toHaveValue('TRIYA_CROSS45');
  await expect(palette.getByText('Custom')).toHaveCount(0);

  const angle = palette.getByRole('textbox', { name: 'Angle', exact: true });
  await angle.fill('15');
  await angle.press('Enter');
  const scale = palette.getByRole('textbox', { name: 'Scale', exact: true });
  await scale.fill('2');
  await scale.press('Enter');
  await expect.poll(hatches).toEqual([{ ...crossed, angle: 15, scale: 2, gap: 6 }]);
  await page.mouse.move(300, 640);
  await page.screenshot({ path: test.info().outputPath('6-hatches-cross45.png') });
});
