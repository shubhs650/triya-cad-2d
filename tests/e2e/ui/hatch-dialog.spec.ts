// M4-07 part 5: HATCH's Hatch and Gradient dialog and HATCHEDIT's Hatch Edit dialog in the app,
// as a drafter hatches a plate: the dialog opens at once (HPDLGMODE 2, no ribbon), a pattern is
// chosen from the Hatch Pattern Palette, Add: Pick points closes it to pick in the drawing and
// opens it again, OK makes the hatch; a double click opens Hatch Edit, whose Gradient tab turns
// the hatch into a gradient. The scenarios are unit-tested in
// packages/engine/test/commands/hatch-dialog.test.ts; this checks the dialog, the bus and the
// canvas carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, HatchGeometry } from '@triya/engine';
import { DXF, expectDrawn, expectShown, openWithPicker } from '../app/page';
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

/** The hatches made in this test as they stand now. */
const hatches = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, HatchGeometry>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind === 'HATCH') out.set(a.entity.handle, a.entity.geom);
      }
      for (const u of cs.entities?.updated ?? []) {
        if (out.has(u.after.handle)) out.set(u.after.handle, u.after.geom as HatchGeometry);
      }
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].map((g) => ({
      pattern: g.pattern,
      scale: g.patternScale,
      loops: g.loops.length,
      gradient: g.gradient?.name,
    }));
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('the Hatch and Gradient dialog makes a hatch; Hatch Edit changes it', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.mouse.move(20, 400);
  await type(page, 'RECTANG', /Specify first corner point/);
  await type(page, '1000020,1000020', /Specify other corner point/);
  await type(page, '#1000140,1000080', 'Command:');

  await type(page, 'HATCH', 'Hatch and Gradient:');
  const dialog = page.getByRole('dialog', { name: 'Hatch and Gradient' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Pattern:')).toHaveValue('TRIYA_LINES45');
  await expect(dialog.getByRole('button', { name: 'Remove boundaries' })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: 'Associative' })).toBeDisabled();

  // The Hatch Pattern Palette, by its swatches.
  await dialog.getByRole('button', { name: 'Hatch Pattern Palette' }).click();
  const palette = page.getByRole('dialog', { name: 'Hatch Pattern Palette' });
  await expect(palette.getByRole('option', { name: /TRIYA_BRICK/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('1-pattern-palette.png') });
  await palette.getByRole('option', { name: /TRIYA_CROSS45/ }).click();
  await palette.getByRole('button', { name: 'OK' }).click();
  await expect(palette).toBeHidden();
  await expect(dialog.getByLabel('Pattern:')).toHaveValue('TRIYA_CROSS45');
  await dialog.getByLabel('Scale:').fill('2');

  await dialog.getByRole('button', { name: 'Add: Pick points' }).click();
  await expect(prompt(page)).toHaveText(
    'Pick internal point or [Select objects/remove Boundaries/Undo]:',
  );
  await expect(dialog).toBeHidden();
  await type(page, '#1000080,1000050', /Pick internal point/);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('2-picked.png') });
  await type(page, '', 'Hatch and Gradient:');
  await expect(dialog.getByRole('button', { name: 'Remove boundaries' })).toBeEnabled();
  await expect(dialog.getByLabel('Scale:')).toHaveValue('2');
  await dialog.getByRole('button', { name: 'More options' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Island detection' })).toBeChecked();
  await page.screenshot({ path: test.info().outputPath('3-dialog-again.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => hatches(page))
    .toEqual([{ pattern: 'TRIYA_CROSS45', scale: 2, loops: 1 }]);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('4-hatched.png') });

  // Hatch Edit, from the command line (a double click opens it too: engine tests).
  await type(page, 'HATCHEDIT', 'Select hatch object:');
  await type(page, 'L', 'Hatch Edit:');
  const edit = page.getByRole('dialog', { name: 'Hatch Edit' });
  await expect(edit.getByLabel('Pattern:')).toHaveValue('TRIYA_CROSS45');
  await expect(edit.getByRole('button', { name: 'Recreate boundary' })).toBeEnabled();
  await edit.getByRole('tab', { name: 'Gradient' }).click();
  await edit.getByRole('radio', { name: 'Spherical', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('5-hatch-edit-gradient.png') });
  await edit.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => hatches(page))
    .toEqual([{ pattern: 'SOLID', scale: 0, loops: 1, gradient: 'SPHERICAL' }]);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('6-gradient.png') });

  // One undo step takes the edit back.
  await type(page, 'U', 'Command:');
  await expect
    .poll(() => hatches(page))
    .toEqual([{ pattern: 'TRIYA_CROSS45', scale: 2, loops: 1 }]);
});

test('the Hatch Pattern Palette offers the material patterns (M4-12)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(page, 'Z', /Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.mouse.move(20, 400);
  await type(page, 'RECTANG', /Specify first corner point/);
  await type(page, '1000020,1000020', /Specify other corner point/);
  await type(page, '#1000140,1000080', 'Command:');

  await type(page, 'HATCH', 'Hatch and Gradient:');
  const dialog = page.getByRole('dialog', { name: 'Hatch and Gradient' });
  await dialog.getByRole('button', { name: 'Hatch Pattern Palette' }).click();
  const palette = page.getByRole('dialog', { name: 'Hatch Pattern Palette' });
  // The materials have a tab of their own, as AutoCAD's Other Predefined.
  await expect(palette.getByRole('option', { name: /TRIYA_CONCRETE/ })).toBeHidden();
  await palette.getByRole('tab', { name: 'Other Predefined' }).click();
  for (const name of ['TRIYA_CONCRETE', 'TRIYA_EARTH', 'TRIYA_INSULATION', 'TRIYA_STEEL'])
    await expect(palette.getByRole('option', { name: new RegExp(`${name}$`) })).toBeVisible();
  await expect(palette.getByRole('option', { name: /TRIYA_LINES45/ })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('1-other-predefined.png') });
  await palette.getByRole('option', { name: /TRIYA_CONCRETE/ }).click();
  await palette.getByRole('button', { name: 'OK' }).click();
  await expect(dialog.getByLabel('Pattern:')).toHaveValue('TRIYA_CONCRETE');

  // Opened again on a material pattern, the palette shows its tab.
  await dialog.getByRole('button', { name: 'Hatch Pattern Palette' }).click();
  await expect(palette.getByRole('tab', { name: 'Other Predefined' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await palette.getByRole('button', { name: 'Cancel' }).click();

  await dialog.getByRole('button', { name: 'Add: Pick points' }).click();
  await expect(dialog).toBeHidden();
  await type(page, '#1000080,1000050', /Pick internal point/);
  await type(page, '', 'Hatch and Gradient:');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => hatches(page))
    .toEqual([{ pattern: 'TRIYA_CONCRETE', scale: 1, loops: 1 }]);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('2-concrete-hatch.png') });
});
