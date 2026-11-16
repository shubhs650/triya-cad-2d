// M4-03: DIMSTYLE's Dimension Style Manager in the app. On an empty part of the acadsharp AC1032
// sample's plan (current dimension style custom_style_ltypes, text 0.18 high), DIMLINEAR
// dimensions a line; D opens the manager on that style. Modify... changes the Text tab's Text
// height, which redraws the dimension at once; New... makes a style from it (Lines tab:
// dimension line Red), Set Current makes the new one current, Override... gives it "<style
// overrides>", F2 renames and the shortcut menu's Delete refuses the style the dimension uses. Close ends it, and U takes
// everything back as one step. The dialog is worked from the keyboard where AutoCAD's is (the
// list's arrows, F2, Enter, Esc). What each action writes is unit-tested in
// packages/engine/test/commands/dimstyle.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, DimensionGeometry, Entity } from '@triya/engine';
import path from 'node:path';
import { activeCanvas, enterCommand, expectShown, inkOf, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');
const O = 1e6;
type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The height of the text in the block of the dimension this test made. */
const textHeight = (page: Page) =>
  page.evaluate(() => {
    let dim: DimensionGeometry | undefined;
    const texts = new Map<string, { owner: string; height: number }>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      const put = (e: Entity) => {
        if (e.geom.kind === 'DIMENSION') dim = e.geom;
        if (e.geom.kind === 'MTEXT') texts.set(e.handle, { owner: e.owner, height: e.geom.height });
      };
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) put(u.after);
      for (const r of cs.entities?.removed ?? []) texts.delete(r.entity.handle);
    }
    const t = [...texts.values()].find((x) => dim && x.owner === dim.block);
    return t && Math.round(t.height * 1000) / 1000;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

/** The sample's current dimension style. */
const CURRENT = 'custom_style_ltypes';

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test('the Dimension Style Manager modifies, makes, overrides and renames styles', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-4, -8), 'Specify opposite corner:');
  await type(page, p(12, 6), 'Command:');
  await page.keyboard.press('F3');
  await type(page, 'LINE', 'Specify first point:');
  await type(page, p(0, 0), 'Specify next point or [Undo]:');
  await type(page, p(8, 0), 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 0), /^Specify dimension line location/);
  await type(page, p(4, -1.5), 'Command:');
  await expect.poll(() => textHeight(page)).toBe(0.18);

  await enterCommand(page, 'D');
  const manager = page.getByRole('dialog', { name: 'Dimension Style Manager' });
  await expect(manager).toBeVisible();
  await expect(manager.getByTestId('dimstyle-current')).toHaveText(CURRENT);
  const list = manager.getByRole('listbox', { name: 'Styles:' });
  await expect(list.getByRole('option', { name: new RegExp(CURRENT) })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shot(page, '1-manager');

  // Modify...: Text tab, Text height 0.5; the dimension is drawn again at once.
  await manager.getByRole('button', { name: 'Modify...' }).click();
  const modify = page.getByRole('dialog', { name: `Modify Dimension Style: ${CURRENT}` });
  await expect(modify).toBeVisible();
  await expect(modify.getByRole('tab')).toHaveText([
    'Lines',
    'Symbols and Arrows',
    'Text',
    'Fit',
    'Primary Units',
    'Alternate Units',
    'Tolerances',
  ]);
  await modify.getByRole('tab', { name: 'Text', exact: true }).click();
  const height = modify.getByLabel('Text height:');
  await height.fill('0.5');
  await shot(page, '2-modify-text-tab');
  await modify.getByRole('button', { name: 'OK' }).click();
  await expect(modify).toBeHidden();
  await expect.poll(() => textHeight(page)).toBe(0.5);

  // New...: "Mech" from the current style, its dimension line red; then Set Current.
  await manager.getByRole('button', { name: 'New...' }).click();
  const create = page.getByRole('dialog', { name: 'Create New Dimension Style' });
  await create.getByLabel('New Style Name:').fill('Mech');
  await expect(create.getByLabel('Start With:')).toHaveValue(CURRENT);
  await create.getByRole('button', { name: 'Continue' }).click();
  const made = page.getByRole('dialog', { name: 'New Dimension Style: Mech' });
  await made.getByRole('tab', { name: 'Lines' }).click();
  await made
    .getByRole('group', { name: 'Dimension lines' })
    .getByLabel('Color:')
    .selectOption({ label: 'Red' });
  await made.getByRole('tab', { name: 'Primary Units' }).click();
  await made.getByLabel('Unit format:').selectOption({ label: 'Architectural' });
  await expect(made.getByLabel('Decimal separator:')).toBeDisabled();
  await shot(page, '3-new-style-primary-units');
  await made.getByRole('button', { name: 'OK' }).click();
  const mech = list.getByRole('option', { name: 'Mech' });
  await expect(mech).toHaveAttribute('aria-selected', 'true');
  await manager.getByRole('button', { name: 'Set Current' }).click();
  await expect(manager.getByTestId('dimstyle-current')).toHaveText('Mech');

  // Override...: the current style's text height, shown as "<style overrides>".
  await manager.getByRole('button', { name: 'Override...' }).click();
  const override = page.getByRole('dialog', { name: 'Override Current Style: Mech' });
  await override.getByRole('tab', { name: 'Text', exact: true }).click();
  await override.getByLabel('Text height:').fill('0.3');
  await page.keyboard.press('Enter');
  const overrides = list.getByRole('option', { name: '<style overrides>' });
  await expect(overrides).toBeVisible();
  await overrides.click();
  await expect(manager.getByTestId('dimstyle-description')).toHaveText('Mech + Text height = 0.3');
  await shot(page, '4-style-overrides');

  // F2 renames from the keyboard; Delete of the style the dimension uses is refused.
  await list.getByRole('option', { name: 'Mech' }).click();
  await list.press('F2');
  const rename = list.getByRole('textbox', { name: 'New name' });
  await rename.fill('Mechanical');
  await rename.press('Enter');
  await expect(list.getByRole('option', { name: 'Mechanical' })).toBeVisible();
  await expect(manager.getByTestId('dimstyle-current')).toHaveText('Mechanical');
  await list.getByRole('option', { name: CURRENT }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(manager.getByRole('status')).toHaveText('Style in use, can’t be deleted.');

  // The list from the keyboard, then Close; U takes everything back.
  await list.focus();
  // The refused style stays selected; the one above it is the sample's custom_dim_style.
  await list.press('ArrowUp');
  await expect(list.getByRole('option', { name: 'custom_dim_style' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(manager).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'U', 'Command:');
  await expect.poll(() => textHeight(page)).toBe(0.18);
  await enterCommand(page, 'DIMSTYLE');
  await expect(manager.getByTestId('dimstyle-current')).toHaveText(CURRENT);
  await expect(list.getByRole('option', { name: /Mech/ })).toHaveCount(0);
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toBeHidden();
});

// M4-03 part 2: Use for makes a sub-style (the Linear dimensions of the current style, text
// 0.4), which the list shows under its parent and which redraws the linear dimension at once;
// Compare... lists it against its parent; deleting it draws the dimension with the parent again.
// The Symbols and Arrows tab has Break size and Jog height factor.
test('Use for makes a sub-style, and Compare lists how two styles differ', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-4, -8), 'Specify opposite corner:');
  await type(page, p(12, 6), 'Command:');
  await page.keyboard.press('F3');
  await type(page, 'DIMLINEAR', 'Specify first extension line origin or <select object>:');
  await type(page, p(0, 0), 'Specify second extension line origin:');
  await type(page, p(8, 0), /^Specify dimension line location/);
  await type(page, p(4, -1.5), 'Command:');
  await expect.poll(() => textHeight(page)).toBe(0.18);

  await enterCommand(page, 'DIMSTYLE');
  const manager = page.getByRole('dialog', { name: 'Dimension Style Manager' });
  const list = manager.getByRole('listbox', { name: 'Styles:' });
  await manager.getByRole('button', { name: 'New...' }).click();
  const create = page.getByRole('dialog', { name: 'Create New Dimension Style' });
  await create.getByLabel('Use for:').selectOption({ label: 'Linear dimensions' });
  await expect(create.getByLabel('New Style Name:')).toBeDisabled();
  await expect(create.getByLabel('New Style Name:')).toHaveValue(`${CURRENT}: Linear`);
  await shot(page, '5-use-for');
  await create.getByRole('button', { name: 'Continue' }).click();
  const sub = page.getByRole('dialog', { name: `New Dimension Style: ${CURRENT}: Linear` });
  await sub.getByRole('tab', { name: 'Symbols and Arrows' }).click();
  await expect(sub.getByLabel('Break size:')).toHaveValue('0.125');
  await expect(sub.getByLabel('Jog height factor:')).toHaveValue('1.5');
  await shot(page, '6-symbols-tab-break-and-jog');
  await sub.getByRole('tab', { name: 'Text', exact: true }).click();
  await sub.getByLabel('Text height:').fill('0.4');
  await sub.getByRole('button', { name: 'OK' }).click();
  await expect(sub).toBeHidden();
  const linear = list.getByRole('option', { name: `${CURRENT}: Linear` });
  await expect(linear).toHaveText('Linear');
  await expect(linear).toHaveAttribute('aria-selected', 'true');
  await expect(manager.getByTestId('dimstyle-description')).toHaveText(`${CURRENT}: Linear`);
  await expect(manager.getByRole('button', { name: 'Set Current' })).toBeDisabled();
  await expect.poll(() => textHeight(page)).toBe(0.4);
  await shot(page, '7-substyle-in-list');

  await manager.getByRole('button', { name: 'Compare...' }).click();
  const compare = page.getByRole('dialog', { name: 'Compare Dimension Styles' });
  await expect(compare.getByLabel('Compare:')).toHaveValue(`${CURRENT}$0`);
  await expect(compare.getByTestId('dimstyle-compare-summary')).toHaveText(
    `All properties of ${CURRENT}$0:`,
  );
  await compare.getByLabel('With:').selectOption(CURRENT);
  await expect(compare.getByTestId('dimstyle-compare-summary')).toHaveText('Found 1 difference:');
  await expect(compare.getByRole('row', { name: /DIMTXT/ })).toHaveText(
    /Text height\s*DIMTXT\s*0\.4000\s*0\.1800/,
  );
  await shot(page, '8-compare');
  await compare.getByRole('button', { name: 'Close' }).click();
  await expect(compare).toBeHidden();

  await list.focus();
  await list.press('Delete');
  await expect(list.getByRole('option', { name: `${CURRENT}: Linear` })).toHaveCount(0);
  await expect.poll(() => textHeight(page)).toBe(0.18);
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toBeHidden();
});

// M4-03 part 3: the preview image. The manager shows the selected style drawn by the renderer
// (a plate with linear, angular and radius dimensions), the Modify dialog the same sample
// following each change; Import... reads a drawing file's styles (ezdxf's
// text_negative_extrusion.dxf: Arch_*, Mech-*, and ISO-25 and Standard, which this drawing has
// already and which are greyed) and brings the checked ones in, the first one selected; U takes
// the import back.
test('the preview image follows the style, and Import... brings in another drawing’s styles', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));

  await enterCommand(page, 'DIMSTYLE');
  const manager = page.getByRole('dialog', { name: 'Dimension Style Manager' });
  const list = manager.getByRole('listbox', { name: 'Styles:' });
  const preview = manager.getByTestId('dimstyle-preview');
  await expect(manager.getByText(`Preview of: ${CURRENT}`)).toBeVisible();
  await expect(preview).toHaveAttribute('data-drawn', /custom_style_ltypes/, { timeout: 15_000 });
  expect(await inkOf(page, preview)).toBeGreaterThan(500);
  await shot(page, '9-manager-preview');
  await list.getByRole('option', { name: 'ISO-25' }).click();
  await expect(manager.getByText('Preview of: ISO-25')).toBeVisible();
  await expect(preview).toHaveAttribute('data-drawn', /ISO-25/);

  // Modify...: the sample follows the text height as it is typed.
  await manager.getByRole('button', { name: 'Modify...' }).click();
  const modify = page.getByRole('dialog', { name: 'Modify Dimension Style: ISO-25' });
  const sample = modify.getByTestId('dimstyle-preview');
  await expect(sample).toHaveAttribute('data-drawn', /"DIMTXT":2\.5/, { timeout: 15_000 });
  await modify.getByRole('tab', { name: 'Text', exact: true }).click();
  await modify.getByLabel('Text height:').fill('5');
  await expect(sample).toHaveAttribute('data-drawn', /"DIMTXT":5/);
  expect(await inkOf(page, sample)).toBeGreaterThan(500);
  await shot(page, '10-modify-preview');
  await modify.getByRole('button', { name: 'Cancel' }).click();
  await expect(modify).toBeHidden();

  // Import...: a drawing file's styles, the ones this drawing has greyed.
  await manager.getByRole('button', { name: 'Import...' }).click();
  const importer = page.getByRole('dialog', { name: 'Import Dimension Styles' });
  await expect(importer.getByLabel('From drawing:')).toContainText('No other drawing is open');
  await importer
    .getByLabel('Drawing to import from')
    .setInputFiles(path.join(CORPUS, 'ezdxf/examples_dxf/text_negative_extrusion.dxf'));
  const box = (name: string) => importer.getByRole('checkbox', { name, exact: true });
  await expect(box('Mech-2.5')).toBeEnabled({ timeout: 15_000 });
  await expect(importer.getByRole('checkbox', { name: /^ISO-25/ })).toBeDisabled();
  await expect(importer.getByRole('checkbox', { name: /^Standard/ })).toBeDisabled();
  await box('Mech-2.5').check();
  await box('Arch_25').check();
  await shot(page, '11-import-dialog');
  await importer.getByRole('button', { name: 'Import' }).click();
  await expect(importer).toBeHidden();
  await expect(list.getByRole('option', { name: 'Arch_25' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(list.getByRole('option', { name: 'Mech-2.5' })).toBeVisible();
  await expect(preview).toHaveAttribute('data-drawn', /Arch_25/, { timeout: 15_000 });
  await shot(page, '12-imported');
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toBeHidden();
  await type(page, 'U', 'Command:');
  await enterCommand(page, 'DIMSTYLE');
  await expect(list.getByRole('option', { name: 'Arch_25' })).toHaveCount(0);
  await manager.getByRole('button', { name: 'Close' }).click();
});
