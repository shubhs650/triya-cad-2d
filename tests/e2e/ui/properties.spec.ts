// M2-21: the Properties palette, as a drafter uses it. A line drawn on an empty part of the plan
// is picked; Ctrl+1 shows its properties; its colour is chosen and its end typed, each an edit
// the drawing's engine makes (and so a change set); Ctrl+A shows every object, General only,
// with *VARIES*, and the object list narrows it; PROPERTIESCLOSE closes the palette. A drawing
// with dynamic block references shows the FR-B3 badge. The sheet and the edits are unit-tested
// in packages/engine/test/properties; this checks the app carries them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, InsertGeometry, MultiLeaderGeometry } from '@triya/engine';
import { DXF, activeCanvas, expectDrawn, expectShown, ink, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  // General, and 3D Visualization's Material, which every object has (M2-35 part 6).
  await expect(palette.getByRole('table')).toHaveCount(2);
  await expect(palette.getByRole('table', { name: '3D Visualization' })).toBeVisible();
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

// M2-35 part 7: in an architectural drawing (LUNITS 4) lengths are typed in feet and inches, at
// the command line as AutoCAD types them (`@1'8",0`, a fraction's hyphen: `6-1/2"`) and in the
// palette as it shows them (`83340'-6 1/2"`, the space included). The parser is unit-tested in
// packages/engine/test/commands/parse.test.ts.
test('takes feet and inches at the command line and in the palette', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  await type(page, 'LUNITS', /^Enter new value for LUNITS/);
  await type(page, '4', 'Command:');
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000070,1000050', 'Specify next point or [Undo]:');
  await type(page, `@1'8",0`, 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect
    .poll(() => drawn(page))
    .toEqual([{ color: { kind: 'byLayer' }, ends: [70, 50, 90, 50] }]);

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  const docked = (await canvas.boundingBox())!;
  await page.mouse.click(docked.x + docked.width / 2, docked.y + docked.height / 2);
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toHaveText('Line (1)');
  // 1,000,070 inches; the field starts as shown, and the engine reads it back.
  const startX = palette.getByRole('textbox', { name: 'Start X' });
  await expect(startX).toHaveValue(`83339'-2"`);
  await expect(palette.getByLabel('Length', { exact: true })).toHaveText(`1'-8"`);
  const endX = palette.getByRole('textbox', { name: 'End X' });
  await endX.fill(`83340'-6 1/2"`);
  await endX.press('Enter');
  await expect(palette.getByLabel('Length', { exact: true })).toHaveText(`1'-4 1/2"`);
  await expect(endX).toHaveValue(`83340'-6 1/2"`);
  const ends = () =>
    page.evaluate(() => {
      let end: number | undefined;
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const u of cs.entities?.updated ?? []) {
          if (u.after.geom.kind === 'LINE') end = u.after.geom.end.x - 1e6;
        }
      }
      return end;
    });
  await expect.poll(ends).toBe(86.5);
  await page.screenshot({ path: test.info().outputPath('feet-and-inches.png') });
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

// M2-35 part 6: General's Plot style (ByColor and read only in this colour-dependent drawing),
// Hyperlink and Thickness, and 3D Visualization's Material, edited on a line drawn for the test.
test('sets a line’s hyperlink, thickness and material from the palette', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000070,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000090,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');

  const palette = page.getByRole('complementary', { name: 'Properties' });
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await page.keyboard.press('Control+1');
  await expect(objects).toHaveText('No selection');
  const docked = (await activeCanvas(page).boundingBox())!;
  await page.mouse.click(docked.x + docked.width / 2, docked.y + docked.height / 2);
  await expect(objects).toHaveText('Line (1)');

  const general = palette.getByRole('table', { name: 'General' });
  await expect(general.getByRole('rowheader')).toHaveText([
    'Color',
    'Layer',
    'Linetype',
    'Linetype scale',
    'Plot style',
    'Lineweight',
    'Transparency',
    'Hyperlink',
    'Thickness',
  ]);
  await expect(palette.getByLabel('Plot style', { exact: true })).toHaveText('ByColor');
  const material = palette.getByRole('combobox', { name: 'Material' });
  await expect(material).toHaveValue('ByLayer');
  await expect(material.getByRole('option')).toContainText(['ByLayer', 'ByBlock', 'Global']);

  /** The line as the last change set left it. */
  const line = () =>
    page.evaluate(() => {
      for (const cs of [...(window as unknown as Dev).triyaDev.changes()].reverse())
        for (const u of cs.entities?.updated ?? [])
          if (u.after.geom.kind === 'LINE') {
            const g = u.after.geom as { thickness?: number };
            return {
              thickness: g.thickness ?? 0,
              material: u.after.material !== undefined,
              xdata: (u.after.xdata ?? []).flatMap((a) => a.values.map((v) => v.value)),
            };
          }
      return undefined;
    });

  const hyperlink = palette.getByRole('textbox', { name: 'Hyperlink' });
  await hyperlink.fill('https://openengtools.com/triya');
  await hyperlink.press('Enter');
  await expect.poll(line).toMatchObject({ xdata: ['https://openengtools.com/triya'] });
  const thickness = palette.getByRole('textbox', { name: 'Thickness' });
  await thickness.fill('2.5');
  await thickness.press('Enter');
  await expect.poll(line).toMatchObject({ thickness: 2.5 });
  await expect(thickness).toHaveValue(/^2\.50*$/);
  await material.selectOption({ label: 'Global' });
  await expect.poll(line).toMatchObject({ material: true });
  await page.mouse.move(docked.x + 40, docked.y + docked.height - 40);
  await page.screenshot({ path: test.info().outputPath('1-general-rows.png') });

  // An empty Hyperlink takes the link off.
  await hyperlink.fill('');
  await hyperlink.press('Enter');
  await expect.poll(line).toMatchObject({ xdata: [] });
  await expect(hyperlink).toHaveValue('');
});

// M2-35 part 8: one polyline shows its vertices one at a time, as AutoCAD's palette does: the
// Vertex spinner steps through them, the vertex shown is marked on the canvas while its rows have
// the focus, and Vertex X/Y and the segment widths edit that vertex. The sheet and the edits are
// unit-tested in packages/engine/test/properties/polyline-vertex.test.ts.
test('steps through a polyline’s vertices and moves one from the palette', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  // A rectangular revision cloud: a closed polyline of arcs.
  await type(page, 'REVCLOUD', /^Specify first corner point or/);
  await type(page, '1000040,1000030', 'Specify opposite corner:');
  await type(page, '1000120,1000070', 'Command:');

  // Select it with a window round it, before the palette narrows the canvas.
  const box = (await canvas.boundingBox())!;
  const scale = Math.min(box.width / 160, box.height / 100);
  const screen = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * scale,
    y: box.y + box.height / 2 - (y - 50) * scale,
  });
  const a = screen(30, 20);
  const b = screen(130, 80);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  const palette = page.getByRole('complementary', { name: 'Properties' });
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await page.keyboard.press('Control+1');
  await expect(objects).toHaveText('Polyline (1)');

  const geometry = palette.getByRole('table', { name: 'Geometry' });
  await expect(geometry.getByRole('rowheader')).toHaveText([
    'Vertex',
    'Vertex X',
    'Vertex Y',
    'Start segment width',
    'End segment width',
    'Global width',
    'Elevation',
    'Length',
    'Area',
  ]);
  const vertex = palette.getByRole('spinbutton', { name: 'Vertex' });
  const vertexX = palette.getByRole('textbox', { name: 'Vertex X' });
  const vertexY = palette.getByRole('textbox', { name: 'Vertex Y' });
  await expect(vertex).toHaveValue('1');
  await expect(vertexX).toHaveValue(/^1000040\.0+$/);
  await expect(vertexY).toHaveValue(/^1000030\.0+$/);

  // The vertex shown is marked while the spinner has the focus.
  const heading = palette.getByRole('heading', { name: 'Properties' });
  const unmarked = await ink(page);
  await vertex.focus();
  await expect.poll(() => ink(page)).toBeGreaterThan(unmarked);
  await vertex.press('ArrowUp');
  await expect(vertex).toHaveValue('2');
  await expect(vertexY).toHaveValue(/^1000030\.0+$/);
  await expect(vertexX).not.toHaveValue(/^1000040\.0+$/);
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.screenshot({ path: test.info().outputPath('1-vertex-marked.png') });
  await heading.click();
  await expect.poll(() => ink(page)).toBe(unmarked);

  /** The cloud as the last change set left it: its second vertex and PLINEGEN. */
  const cloud = () =>
    page.evaluate(() => {
      for (const cs of [...(window as unknown as Dev).triyaDev.changes()].reverse())
        for (const u of cs.entities?.updated ?? [])
          if (u.after.geom.kind === 'LWPOLYLINE') {
            const v = u.after.geom.vertices[1]!;
            return { y: Math.round(v.y - 1e6), plinegen: u.after.geom.plinegen ?? false };
          }
      return undefined;
    });
  await vertexY.fill('1000020');
  await vertexY.press('Enter');
  await expect.poll(cloud).toEqual({ y: 20, plinegen: false });
  await expect(vertex).toHaveValue('2');
  await expect(vertexY).toHaveValue(/^1000020\.0+$/);
  await palette.getByRole('combobox', { name: 'Linetype generation' }).selectOption('Enabled');
  await expect.poll(cloud).toEqual({ y: 20, plinegen: true });
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.screenshot({ path: test.info().outputPath('2-vertex-moved.png') });
});

test('edits an MTEXT’s contents in the In-Place Text Editor from the palette', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, '-MTEXT', 'Specify first corner:');
  await type(page, '1000020,1000080', /^Specify opposite corner/);
  await type(page, '1000140,1000040', 'Enter text:');
  await type(page, 'GENERAL NOTES', 'Enter text:');
  await type(page, '', 'Command:');

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toContainText(/MText \(1\)/);
  await objects.selectOption({ label: 'MText (1)' });
  await expect(palette.getByLabel('Contents', { exact: true })).toHaveText('GENERAL NOTES');
  const more = palette.getByRole('button', { name: 'Edit Contents in the text editor' });
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('1-contents-button.png') });
  await more.click();
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('GENERAL NOTES');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. ALL DIMENSIONS IN MM');
  await page.screenshot({ path: test.info().outputPath('2-editing.png') });
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  // The MTEXT stays selected and the palette shows its new contents.
  await expect(palette.getByLabel('Contents', { exact: true })).toHaveText(
    'GENERAL NOTES\\P1. ALL DIMENSIONS IN MM',
  );
  await expect(objects).toContainText(/MText \(1\)/);
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('3-edited.png') });
  // One undo step takes it back.
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+z');
  await expect
    .poll(() =>
      page.evaluate(() => {
        for (const cs of [...(window as unknown as Dev).triyaDev.changes()].reverse())
          for (const u of cs.entities?.updated ?? [])
            if (u.after.geom.kind === 'MTEXT') return u.after.geom.contents;
        return undefined;
      }),
    )
    .toBe('GENERAL NOTES');
});

// M2-35 part 11: a multileader's Text rows. Its text stays on its landing: right-justified, its
// left edge stays a landing gap from the landing's end and its insertion point moves to the
// right edge, by the width the canvas measures.
test('justifies and sizes a multileader’s text from the palette, on its landing', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'MLD', /^Specify leader arrowhead location/);
  await type(page, '1000040,1000030', 'Specify leader landing location:');
  await type(page, '1000060,1000060', 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('GATE VALVE');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const leader = () =>
    page.evaluate(() => {
      let g: MultiLeaderGeometry | undefined;
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const a of cs.entities?.added ?? [])
          if (a.entity.geom.kind === 'MULTILEADER') g = a.entity.geom;
        for (const u of cs.entities?.updated ?? [])
          if (u.after.geom.kind === 'MULTILEADER') g = u.after.geom;
      }
      return g && { text: g.text!, alignment: g.textAlignment };
    });
  await expect.poll(async () => (await leader())?.text.attachment).toBe(1);
  const placed = (await leader())!.text;

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toContainText(/MultiLeader \(1\)/);
  await objects.selectOption({ label: 'MultiLeader (1)' });
  await expect(palette.getByLabel('Contents', { exact: true })).toHaveText('GATE VALVE');
  await expect(
    palette.getByRole('button', { name: 'Edit Contents in the text editor' }),
  ).toBeVisible();
  await expect(palette.getByRole('combobox', { name: 'Text style' })).toHaveValue(/.+/);
  const justify = palette.getByRole('combobox', { name: 'Justify' });
  await expect(justify).toHaveValue('Left');
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('1-multileader-text-rows.png') });

  await justify.selectOption({ label: 'Right' });
  await expect(justify).toHaveValue('Right');
  await expect.poll(async () => (await leader())?.text.attachment).toBe(3);
  const right = (await leader())!;
  expect(right.alignment).toBe(2);
  // The insertion point is now the right edge: the text's measured width to the right.
  expect(right.text.position.x).toBeGreaterThan(placed.position.x + placed.height);
  expect(right.text.position.y).toBeCloseTo(placed.position.y, 9);
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('2-justified-right.png') });

  const height = palette.getByRole('textbox', { name: 'Text height', exact: true });
  await height.fill(String(placed.height * 2));
  await height.press('Enter');
  await expect.poll(async () => (await leader())?.text.height).toBeCloseTo(placed.height * 2, 9);
  // Twice the height, twice the width: the right edge moves on by the old width.
  const taller = (await leader())!.text;
  expect(taller.position.x - placed.position.x).toBeCloseTo(
    2 * (right.text.position.x - placed.position.x),
    6,
  );
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('3-taller.png') });
});

// M2-35 part 12: a multileader's Leaders rows. The landing distance keeps the text where it is
// and the landing's end a gap from it, so the leader line's corner (the connection) moves.
test('sets a multileader’s leader colour, arrowhead size and landing from the palette', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'MLD', /^Specify leader arrowhead location/);
  await type(page, '1000040,1000030', 'Specify leader landing location:');
  await type(page, '1000060,1000060', 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('GATE VALVE');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const leader = () =>
    page.evaluate(() => {
      let g: MultiLeaderGeometry | undefined;
      for (const cs of (window as unknown as Dev).triyaDev.changes()) {
        for (const a of cs.entities?.added ?? [])
          if (a.entity.geom.kind === 'MULTILEADER') g = a.entity.geom;
        for (const u of cs.entities?.updated ?? [])
          if (u.after.geom.kind === 'MULTILEADER') g = u.after.geom;
      }
      return g;
    });
  await expect.poll(async () => (await leader())?.branches.length).toBe(1);
  const placed = (await leader())!;

  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await activeCanvas(page).hover();
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toContainText(/MultiLeader \(1\)/);
  await objects.selectOption({ label: 'MultiLeader (1)' });
  const leaders = palette.getByRole('table', { name: 'Leaders' });
  await expect(leaders.getByRole('rowheader')).toHaveText([
    'Leader type',
    'Leader color',
    'Leader linetype',
    'Leader lineweight',
    'Arrowhead',
    'Arrowhead size',
    'Horz landing',
    'Landing distance',
  ]);
  const type_ = palette.getByRole('combobox', { name: 'Leader type' });
  await expect(type_).toHaveValue('1');
  await expect(palette.getByRole('combobox', { name: 'Arrowhead', exact: true })).toHaveValue('');
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('1-multileader-leaders-rows.png') });

  // Red is index 1; Leader color's Select Color... opens the dialog.
  const color = palette.getByRole('combobox', { name: 'Leader color' });
  await color.selectOption({ label: 'Red' });
  await expect.poll(async () => (await leader())?.lineColor).toEqual({ kind: 'aci', index: 1 });
  await color.selectOption({ label: 'Select Color...' });
  const dialog = page.getByRole('dialog', { name: 'Select Color' });
  await expect(dialog).toBeVisible();
  // A leader takes a true colour (a dimension's colour rows do not).
  await expect(dialog.getByRole('tab', { name: 'True Color' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  const size = palette.getByRole('textbox', { name: 'Arrowhead size', exact: true });
  await size.fill(String(placed.arrowheadSize * 2));
  await size.press('Enter');
  await expect
    .poll(async () => (await leader())?.arrowheadSize)
    .toBeCloseTo(placed.arrowheadSize * 2, 9);

  const landing = palette.getByRole('textbox', { name: 'Landing distance', exact: true });
  const b0 = placed.branches[0]!;
  await landing.fill(String(b0.doglegLength * 2));
  await landing.press('Enter');
  await expect
    .poll(async () => (await leader())?.branches[0]!.doglegLength)
    .toBeCloseTo(b0.doglegLength * 2, 9);
  const longer = (await leader())!;
  // The text stays; the connection moves back along the landing by the old length.
  expect(longer.text!.position).toEqual(placed.text!.position);
  const along = (longer.branches[0]!.connection.x - b0.connection.x) * b0.direction.x;
  expect(along).toBeCloseTo(-b0.doglegLength, 6);
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('2-red-bigger-arrow-longer-landing.png') });

  await type_.selectOption({ label: 'Spline' });
  await expect.poll(async () => (await leader())?.pathType).toBe(2);
  await page.mouse.move(5, 500);
  await page.screenshot({ path: test.info().outputPath('3-spline.png') });
});

// M2-35 part 13: a gradient's own rows, edited on ezdxf's two associative solid hatches made
// gradients: the file keeps their gradient settings with the gradient turned off (DXF 450 = 0),
// so the test turns it on (450 = 1), as AutoCAD writes a gradient fill.
test('edits two gradient hatches’ name, colour, angle and centring, and lets them go of their boundaries', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const source = readFileSync(path.join(CORPUS, 'ezdxf/examples_dxf/hatches_2.dxf'), 'utf8');
  const file = test.info().outputPath('gradients.dxf');
  const on = source.replace(/^450\n( *)0$/gm, (_m, pad: string) => `450\n${pad}1`);
  expect(on).not.toBe(source);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, on);
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await page.keyboard.press('Control+1');
  await expect(palette).toBeVisible();
  await activeCanvas(page).hover();
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'E', 'Command:');
  await page.keyboard.press('Control+a');
  const objects = palette.getByRole('combobox', { name: 'Objects selected' });
  await expect(objects).toContainText(/Hatch \(2\)/);
  await objects.selectOption({ label: 'Hatch (2)' });
  const pattern = palette.getByRole('table', { name: 'Pattern' });
  await expect(pattern.getByRole('rowheader')).toHaveText([
    'Type',
    'Gradient name',
    'Color 1',
    'Color 2',
    'Gradient angle',
    'Centered',
    'Associative',
    'Island detection style',
  ]);
  const name = palette.getByRole('combobox', { name: 'Gradient name' });
  await expect(name).toHaveValue('LINEAR');
  await expectDrawn(page, { timeout: 15_000 });
  await page.mouse.move(300, 640);
  await page.screenshot({ path: test.info().outputPath('1-gradient-rows.png') });

  const hatches = () =>
    page.evaluate(() => {
      const out = new Map<string, unknown>();
      for (const cs of (window as unknown as Dev).triyaDev.changes())
        for (const u of cs.entities?.updated ?? [])
          if (u.after.geom.kind === 'HATCH') {
            const g = u.after.geom;
            out.set(u.after.handle, {
              name: g.gradient?.name,
              color1: g.gradient?.colors[0]?.color,
              angle: Math.round(((g.gradient?.angle ?? 0) * 180) / Math.PI),
              shift: g.gradient?.shift,
              associative: g.associative,
            });
          }
      return [...out.values()];
    });
  await name.selectOption('SPHERICAL');
  const color1 = palette.getByRole('combobox', { name: 'Color 1' });
  await color1.selectOption({ label: 'Select Color...' });
  const dialog = page.getByRole('dialog', { name: 'Select Color' });
  await expect(dialog).toBeVisible();
  // A gradient's colours are index or true colours (the save writes no book name for one).
  await expect(dialog.getByRole('tab', { name: 'True Color' })).toBeEnabled();
  const field = dialog.getByRole('textbox', { name: 'Color' });
  await field.fill('255,128,0');
  await field.press('Enter');
  await expect(dialog).toBeHidden();
  const angle = palette.getByRole('textbox', { name: 'Gradient angle', exact: true });
  await angle.fill('45');
  await angle.press('Enter');
  await palette.getByRole('combobox', { name: 'Centered' }).selectOption({ label: 'No' });
  const was = {
    name: 'SPHERICAL',
    color1: { kind: 'rgb', r: 255, g: 128, b: 0 },
    angle: 45,
    shift: 1,
  };
  await expect.poll(hatches).toEqual([
    { ...was, associative: true },
    { ...was, associative: true },
  ]);
  await palette.getByRole('combobox', { name: 'Associative' }).selectOption({ label: 'No' });
  await expect.poll(hatches).toEqual([
    { ...was, associative: false },
    { ...was, associative: false },
  ]);
  await page.mouse.move(300, 640);
  await page.screenshot({ path: test.info().outputPath('2-spherical-orange-45.png') });
});
