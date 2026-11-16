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
import { activeCanvas, enterCommand, expectShown, openWithPicker } from '../app/page';
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
