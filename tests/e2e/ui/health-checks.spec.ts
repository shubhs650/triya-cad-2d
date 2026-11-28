// M8-07: the Health palette's drawing checks (PRD FR-Z4) on ACadSharp's BLOCKROTATIONPARAMETER.dxf,
// an inch drawing measured imperial whose block is dynamic: the Dynamic blocks card lists it with
// its references; a line drawn twice and a line lying on it are counted as Duplicate objects and
// Delete Duplicates takes them (one OVERKILL undo step, undone with Ctrl+Z); MEASUREMENT set to
// metric shows on the Units card and Set Measurement to Imperial mends it; a unitless drawing gets
// Use Inches, which the Drawing card follows; AUTOCONSTRAIN on the line shows on the Constraints
// card, whose Parameters Manager... opens the palette. The checks and fixes are unit-tested in
// packages/engine/test/edit/health.test.ts.
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { enterCommand, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = path.join(CORPUS, 'acadsharp/dynamic-blocks/BLOCKROTATIONPARAMETER.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Types `text` and waits for the prompt that follows. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  await enterCommand(page, text);
  await expect(prompt(page)).toHaveText(next);
}

const summary = (card: Locator) => card.locator('summary');

test('the Health palette checks duplicates, units, dynamic blocks and constraints, and fixes them (M8-07)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });

  // Line (1000,1000)-(1010,1000) drawn twice, and a line lying on it.
  for (const [a, b] of [
    ['1000,1000', '1010,1000'],
    ['1010,1000', '1000,1000'],
    ['1002,1000', '1004,1000'],
  ]) {
    await type(page, 'LINE', 'Specify first point:');
    await type(page, a!, 'Specify next point or [Undo]:');
    await type(page, b!, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }

  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Health' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Health' });
  const drawing = palette.getByRole('group', { name: /^Drawing/ });
  const units = palette.getByRole('group', { name: /^Units/ });
  const duplicates = palette.getByRole('group', { name: /^Duplicate objects/ });
  const dynamic = palette.getByRole('group', { name: /^Dynamic blocks/ });
  const constraints = palette.getByRole('group', { name: /^Constraints/ });

  await expect(summary(units)).toHaveText('Units (0)');
  await expect(drawing).toContainText('Inches');
  await expect(summary(dynamic)).toHaveText('Dynamic blocks (1)');
  const blocks = dynamic.getByRole('table', { name: 'Dynamic blocks' });
  await expect(blocks.locator('tbody tr')).toHaveCount(1);
  await expect(dynamic).toContainText('edit them in AutoCAD');
  await expect(summary(constraints)).toHaveText('Constraints (0)');

  await expect(summary(duplicates)).toHaveText('Duplicate objects (2)');
  const counts = duplicates.getByRole('table', { name: 'Duplicate objects' });
  await expect(counts.getByRole('row', { name: /^Duplicates/ })).toContainText('1');
  await expect(counts.getByRole('row', { name: /^Overlapping/ })).toContainText('1');
  await duplicates.scrollIntoViewIfNeeded();
  await page.mouse.move(300, 300);
  await shot('1-health-checks.png');

  // Delete Duplicates: one OVERKILL undo step.
  await duplicates.getByRole('button', { name: 'Delete Duplicates' }).click();
  await expect(summary(duplicates)).toHaveText('Duplicate objects (0)');
  await expect(duplicates).toContainText('None: OVERKILL finds nothing to delete.');
  await page.keyboard.press('Control+z');
  await expect(summary(duplicates)).toHaveText('Duplicate objects (2)');
  await duplicates.getByRole('button', { name: 'Delete Duplicates' }).click();
  await expect(summary(duplicates)).toHaveText('Duplicate objects (0)');

  // A metric measurement in an inch drawing.
  await type(page, 'MEASUREMENT', /^Enter new value for MEASUREMENT/);
  await type(page, '1', 'Command:');
  await expect(summary(units)).toHaveText('Units (1)');
  await expect(units).toContainText('The drawing is in Inches but its measurement is Metric');
  await units.scrollIntoViewIfNeeded();
  await page.mouse.move(300, 300);
  await shot('2-measurement-disagrees.png');
  await units.getByRole('button', { name: 'Set Measurement to Imperial' }).click();
  await expect(summary(units)).toHaveText('Units (0)');

  // Unitless: Use Inches, as the imperial measurement suggests; the Drawing card follows.
  await type(page, 'INSUNITS', /^Enter new value for INSUNITS/);
  await type(page, '0', 'Command:');
  await expect(summary(units)).toHaveText('Units (1)');
  await expect(drawing).toContainText('Unitless');
  await expect(units).toContainText('The drawing is unitless');
  await units.getByRole('button', { name: 'Use Inches' }).click();
  await expect(summary(units)).toHaveText('Units (0)');
  await expect(drawing).toContainText('Inches');

  // Constraints present.
  await type(page, 'AUTOCONSTRAIN', 'Select objects or [Settings]:');
  await type(page, 'L', /^Select objects/);
  await type(page, '', 'Command:');
  await expect(summary(constraints)).not.toHaveText('Constraints (0)', { timeout: 15_000 });
  const kinds = constraints.getByRole('table', { name: 'Constraints' });
  await expect(kinds.getByRole('row', { name: /^Geometric/ })).not.toContainText(/\b0$/);
  await constraints.scrollIntoViewIfNeeded();
  await page.mouse.move(300, 300);
  await shot('3-constraints.png');
  await constraints.getByRole('button', { name: 'Parameters Manager…' }).click();
  await expect(page.getByRole('complementary', { name: 'Parameters Manager' })).toBeVisible();
});
