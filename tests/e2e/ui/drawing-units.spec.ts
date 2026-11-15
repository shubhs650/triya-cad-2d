// M2-35 part 17: the command line shows lengths and angles in the drawing's units, as AutoCAD's
// RTOS and ANGTOS write them: set LUNITS to architectural and AUNITS to degrees/minutes/seconds,
// and TEXT reports its height and asks for the next one in feet and inches, and its rotation in
// degrees. The formats are unit-tested in packages/engine/test/commands/units.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** A unitless drawing (INSUNITS 0). */
const UNITLESS = path.join(
  import.meta.dirname,
  '../../../packages/testkit/fixtures/raster/raster-images.dxf',
);

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test('TEXT reports and asks in feet and inches once LUNITS is architectural', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // Decimal first, as the drawing has it.
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await expect(log).toContainText(/Text height: {2}\d+\.\d{4} {2}Annotative/);
  await type(page, '10,10', /^Specify height <\d+\.\d{4}>:$/);
  await shot(page, '1-before-decimal');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  await type(page, 'LUNITS', /^Enter new value for LUNITS <\d>:$/);
  await type(page, '4', 'Command:');
  await type(page, 'AUNITS', /^Enter new value for AUNITS <\d>:$/);
  await type(page, '1', 'Command:');

  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await expect(log).toContainText(/Text height: {2}\d+'-\d+(?: \d+\/\d+)?" {2}Annotative/);
  await type(page, '10,10', /^Specify height <\d+'-\d+(?: \d+\/\d+)?">:$/);
  // A height typed in feet and inches, then the rotation's default in degrees.
  await type(page, `1'-6"`, /^Specify rotation angle of text <0d[0-9'".]*>:$/);
  await shot(page, '2-after-architectural');
  await type(page, '', 'Enter text:');
  await type(page, 'Note', 'Enter text:');
  await type(page, '', 'Command:');

  // The height the text took is the next default, shown as it was given.
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '10,10', `Specify height <1'-6">:`);
});

// M2-35 part 18: in surveyor's units the rotation's default is a bearing, a bearing typed at the
// prompt reads (with no spaces, as a space ends the input), and it is the next default.
test('TEXT takes and offers its rotation as a bearing once AUNITS is surveyor', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');

  await type(page, 'AUNITS', /^Enter new value for AUNITS <\d>:$/);
  await type(page, '4', 'Command:');
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '10,10', /^Specify height <[^>]+>:$/);
  await type(page, '', 'Specify rotation angle of text <E>:');
  await type(page, 'N30dW', 'Enter text:');
  await type(page, 'Bearing', 'Enter text:');
  await shot(page, '3-after-bearing-text');
  await type(page, '', 'Command:');

  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '20,20', /^Specify height <[^>]+>:$/);
  // The drawing's AUPREC may show minutes (`N 30d0' W`).
  await type(page, '', /^Specify rotation angle of text <N 30d[0-9'"]* W>:$/);
  await shot(page, '4-after-bearing-default');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});

// M3-09: UNITS' Drawing Units dialog (AutoCAD 2024 Help, "Drawing Units Dialog Box"): it opens on
// the drawing's units, the Sample Output follows the choices, Direction Control sets the angle
// base (named, or picked on the canvas), OK sets the variables as one undo step and Esc changes
// nothing. Its insertion scale is what a paste from another drawing scales by; from a unitless
// drawing, the paste first asks the units. The engine side is unit-tested in
// packages/engine/test/commands/drawing-units.test.ts and clipboard.test.ts.
test('the Drawing Units dialog sets the units and the insertion scale a paste takes', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');

  // Esc closes it with nothing changed.
  await type(page, 'UN', 'Drawing Units:');
  const d = page.getByRole('dialog', { name: 'Drawing Units' });
  await expect(d).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  await type(page, 'UNITS', 'Drawing Units:');
  const length = d.getByRole('group', { name: 'Length' });
  const angle = d.getByRole('group', { name: 'Angle' });
  const insertion = d.getByRole('combobox', { name: 'Units to scale inserted content:' });
  const sample = d.getByRole('status', { name: 'Sample Output' });
  await expect(length.getByRole('combobox', { name: 'Type:' })).toHaveValue('2');
  await expect(insertion).toHaveValue('6');
  await expect(sample).toHaveText(/1\.5000,2\.0039,0\.0000\s*3\.0000<45(\.0+)?,0\.0000/);
  await shot(page, '3-units-dialog-opened');

  await length.getByRole('combobox', { name: 'Type:' }).selectOption({ label: 'Architectural' });
  await length.getByRole('combobox', { name: 'Precision:' }).selectOption({ label: `0'-0 1/16"` });
  await angle.getByRole('combobox', { name: 'Type:' }).selectOption({ label: 'Deg/Min/Sec' });
  await angle.getByRole('checkbox', { name: 'Clockwise' }).check();
  await insertion.selectOption({ label: 'Millimeters' });
  await expect(sample).toHaveText(/0'-1 1\/2",0'-2",0'-0"\s*0'-3"<45d[0']*,0'-0"/);

  // Direction Control: North, then Other picked on the canvas.
  await d.getByRole('button', { name: 'Direction...' }).click();
  const dc = page.getByRole('dialog', { name: 'Direction Control' });
  await dc.getByRole('radio', { name: /^North/ }).check();
  await shot(page, '4-direction-control');
  await dc.getByRole('button', { name: 'OK' }).click();
  await expect(dc).toBeHidden();
  await d.getByRole('button', { name: 'Direction...' }).click();
  await expect(dc.getByRole('radio', { name: /^North/ })).toBeChecked();
  await dc.getByRole('radio', { name: 'Other' }).check();
  await dc.getByRole('button', { name: 'Pick an angle' }).click();
  await expect(prompt(page)).toHaveText('Pick angle:');
  await type(page, '0,0', 'Specify second point:');
  await type(page, '-1,0', 'Drawing Units:');
  // Both open again on the angle picked, the choices made kept.
  await expect(dc.getByRole('radio', { name: /^West/ })).toBeChecked();
  await expect(sample).toHaveText(/0'-1 1\/2"/);
  await shot(page, '5-angle-picked');
  await dc.getByRole('button', { name: 'OK' }).click();
  await d.getByRole('button', { name: 'OK' }).click();
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  await type(page, 'INSUNITS', 'Enter new value for INSUNITS <4>:');
  await type(page, '', 'Command:');
  await type(page, 'ANGDIR', 'Enter new value for ANGDIR <1>:');
  await type(page, '', 'Command:');
  await type(page, 'ANGBASE', /^Enter new value for ANGBASE <180d\S*>:$/);
  await type(page, '', 'Command:');
  // One undo step takes all of it back.
  await type(page, 'U', 'Command:');
  await type(page, 'INSUNITS', 'Enter new value for INSUNITS <6>:');
  await type(page, '', 'Command:');
  await type(page, 'LUNITS', 'Enter new value for LUNITS <2>:');
  await type(page, '', 'Command:');

  // A line copied from a unitless drawing asks its units: inches into this metre drawing.
  await openWithPicker(page, UNITLESS);
  await expectShown(page, path.basename(UNITLESS));
  await type(page, 'L', 'Specify first point:');
  await type(page, '0,0', 'Specify next point or [Undo]:');
  await type(page, '100,0', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'COPYCLIP', 'Select objects:');
  await type(page, 'L', 'Select objects:');
  await type(page, '', 'Command:');
  await page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab').first().click();
  await expectShown(page, path.basename(DXF));
  await type(
    page,
    'PASTECLIP',
    'The objects come from a unitless drawing. Specify their units ' +
      '[Unitless/Inches/Feet/Yards/Millimeters/Centimeters/MEters/Kilometers] <Unitless>:',
  );
  await shot(page, '6-unitless-paste-prompt');
  await type(page, 'I', 'Specify insertion point:');
  await type(page, '0,0', 'Command:');
  const lines = await page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => cs.entities?.added ?? [])
      .map((a) => a.entity.geom as { kind: string; start?: { x: number }; end?: { x: number } })
      .filter((g) => g.kind === 'LINE'),
  );
  // 100 inches in metres.
  expect(lines.at(-1)!.end!.x - lines.at(-1)!.start!.x).toBeCloseTo(2.54, 9);
});
