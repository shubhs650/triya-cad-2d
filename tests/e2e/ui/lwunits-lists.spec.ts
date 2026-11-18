// M5-12: LWUNITS 0 lists lineweights in inches in the style dialogs, as AutoCAD 2024 lists every
// lineweight in the units LWUNITS names (AutoCAD Help, "LWUNITS"): the Dimension Style dialog's
// Lines tab (DIMLWD, DIMLWE), the Modify Multileader Style dialog's leader Lineweight and the
// Modify Table Style dialog's Borders tab. A lineweight chosen by its inches label is kept in
// hundredths of a millimetre. On the acadsharp AC1032 sample (dimension style
// custom_style_ltypes current, table style Standard). Edit Attributes' and LIST's lineweights
// are unit tested (apps/web/test/lineweight-lists.test.ts, packages/engine list.test.ts).
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { enterCommand, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test('LWUNITS 0 lists the style dialogs’ lineweights in inches (M5-12)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));

  // Millimetres first, as AutoCAD starts (LWUNITS 1).
  await enterCommand(page, 'D');
  const manager = page.getByRole('dialog', { name: 'Dimension Style Manager' });
  await manager.getByRole('button', { name: 'Modify...' }).click();
  const modify = page.getByRole('dialog', { name: 'Modify Dimension Style: custom_style_ltypes' });
  await modify.getByRole('tab', { name: 'Lines' }).click();
  const dimLine = modify.getByRole('group', { name: 'Dimension lines' }).getByLabel('Lineweight:');
  const extLine = modify.getByRole('group', { name: 'Extension lines' }).getByLabel('Lineweight:');
  await expect(dimLine.locator('option', { hasText: '0.30 mm' })).toHaveCount(1);
  await modify.getByRole('button', { name: 'Cancel' }).click();
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toBeHidden();

  await enterCommand(page, 'LWUNITS');
  await enterCommand(page, '0');
  await expect(page.getByTestId('command-prompt')).toHaveText('Command:');

  // Dimension Style: both lists in inches; 0.020" is DIMLWD 50.
  await enterCommand(page, 'D');
  await manager.getByRole('button', { name: 'Modify...' }).click();
  await modify.getByRole('tab', { name: 'Lines' }).click();
  for (const list of [dimLine, extLine]) {
    await expect(list.locator('option', { hasText: ' mm' })).toHaveCount(0);
    await expect(list.locator('option', { hasText: '0.012"' })).toHaveCount(1);
    await expect(list.locator('option', { hasText: '0.083"' })).toHaveCount(1);
  }
  await dimLine.selectOption({ label: '0.020"' });
  await expect(dimLine).toHaveValue('50');
  await expect(dimLine.locator('option:checked')).toHaveText('0.020"');
  await shot(page, '1-dimension-style-lines-inches');
  await modify.getByRole('button', { name: 'Cancel' }).click();
  await manager.getByRole('button', { name: 'Close' }).click();
  await expect(manager).toBeHidden();

  // Multileader Style: the leader's Lineweight list.
  await enterCommand(page, 'MLEADERSTYLE');
  const leaders = page.getByRole('dialog', { name: 'Multileader Style Manager' });
  await leaders.getByRole('button', { name: 'Modify...' }).click();
  const leader = page.getByRole('dialog', { name: /^Modify Multileader Style: / });
  const leaderWeight = leader.getByLabel('Lineweight:');
  await expect(leaderWeight.locator('option', { hasText: ' mm' })).toHaveCount(0);
  await expect(leaderWeight.locator('option', { hasText: '0.010"' })).toHaveCount(1);
  await leaderWeight.selectOption({ label: '0.010"' });
  await expect(leaderWeight).toHaveValue('25');
  await shot(page, '2-multileader-style-inches');
  await leader.getByRole('button', { name: 'Cancel' }).click();
  await leaders.getByRole('button', { name: 'Close' }).click();
  await expect(leaders).toBeHidden();

  // Table Style: the Borders tab's Lineweight list.
  await enterCommand(page, 'TABLESTYLE');
  const tables = page.getByRole('dialog', { name: 'Table Style' });
  await tables.getByRole('button', { name: 'Modify...' }).click();
  const table = page.getByRole('dialog', { name: 'Modify Table Style: Standard' });
  await table.getByRole('tab', { name: 'Borders' }).click();
  const tableWeight = table.getByLabel('Lineweight:');
  await expect(tableWeight.locator('option', { hasText: ' mm' })).toHaveCount(0);
  await expect(tableWeight.locator('option', { hasText: '0.014"' })).toHaveCount(1);
  await tableWeight.selectOption({ label: '0.014"' });
  await expect(tableWeight).toHaveValue('35');
  await shot(page, '3-table-style-borders-inches');
  await table.getByRole('button', { name: 'Cancel' }).click();
  await tables.getByRole('button', { name: 'Close' }).click();
  await expect(tables).toBeHidden();
});
