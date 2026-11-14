// M2-35 part 21: rollover tooltips and QUICKPROPERTIES, as a drafter meets them (AutoCAD 2024
// Help, "ROLLOVERTIPS (System Variable)", "QUICKPROPERTIES (Command)"). At `Command:` the cursor
// resting on a line shows a tooltip naming it with its Color, Layer and Linetype, gone once the
// cursor moves off; none shows while a command runs or with ROLLOVERTIPS 0. QUICKPROPERTIES shows
// the Quick Properties palette for the objects selected, or those it asks for, though QPMODE is
// off. The tooltip's rows and the command are unit-tested in
// packages/engine/test/properties/quick.test.ts and apps/web/test/rollover.test.ts.
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('shows a rollover tooltip on a line, and Quick Properties by QUICKPROPERTIES', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line across its
  // middle.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000060,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000100,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  const tip = page.getByRole('tooltip').and(page.getByTestId('rollover-tooltip'));
  const box = (await canvas.boundingBox())!;
  const on = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const off = { x: on.x, y: on.y - box.height / 4 };

  // The cursor rests on the line: its tooltip shows below and to the right of the cursor.
  await page.mouse.move(off.x, off.y);
  await page.mouse.move(on.x, on.y, { steps: 4 });
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Line');
  await expect(tip.locator('dt')).toHaveText(['Color', 'Layer', 'Linetype']);
  await expect(tip.locator('dd').first()).toHaveText('ByLayer');
  const placed = (await tip.boundingBox())!;
  expect(placed.x).toBeGreaterThan(on.x);
  expect(placed.y).toBeGreaterThan(on.y);
  await shot(page, '1-rollover-tooltip');

  // Off the line it goes, and resting on empty paper shows none.
  await page.mouse.move(off.x, off.y, { steps: 4 });
  await expect(tip).toBeHidden();
  await page.waitForTimeout(800);
  await expect(tip).toBeHidden();

  // None while a command runs.
  await type(page, 'L', 'Specify first point:');
  await page.mouse.move(on.x, on.y, { steps: 4 });
  await page.waitForTimeout(800);
  await expect(tip).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // ROLLOVERTIPS 0 turns them off; 1 back on.
  await type(page, 'ROLLOVERTIPS', /^Enter new value for ROLLOVERTIPS <1>:/);
  await type(page, '0', 'Command:');
  await page.mouse.move(off.x, off.y, { steps: 4 });
  await page.mouse.move(on.x, on.y, { steps: 4 });
  await page.waitForTimeout(800);
  await expect(tip).toBeHidden();
  await type(page, 'ROLLOVERTIPS', /^Enter new value for ROLLOVERTIPS <0>:/);
  await type(page, '1', 'Command:');
  await page.mouse.move(off.x, off.y, { steps: 4 });
  await page.mouse.move(on.x, on.y, { steps: 4 });
  await expect(tip).toBeVisible();

  // QUICKPROPERTIES with nothing selected asks for objects; Quick Properties then shows them,
  // though QPMODE is off (−1 at first).
  const quick = page.getByRole('dialog', { name: 'Quick Properties' });
  await expect(page.getByRole('button', { name: 'QP', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await type(page, 'QUICKPROPERTIES', 'Select objects:');
  await page.mouse.click(on.x, on.y);
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText('1 found');
  await type(page, '', 'Command:');
  await expect(quick).toBeVisible();
  await expect(quick.getByRole('combobox', { name: 'Objects selected' })).toHaveText('Line (1)');
  // By the cursor (QPLOCATION 0): above and to the right of where the line was picked.
  const qp = (await quick.boundingBox())!;
  expect(qp.x).toBeGreaterThan(on.x);
  expect(qp.y + qp.height).toBeLessThan(on.y);
  await shot(page, '2-quickproperties');

  // Esc clears the selection, and the palette goes: a pick at `Command:` alone does not show it.
  await canvas.hover();
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();
  await page.mouse.click(on.x, on.y);
  await page.waitForTimeout(500);
  await expect(quick).toBeHidden();
  // With the line selected, QUICKPROPERTIES shows it at once.
  await type(page, 'QUICKPROPERTIES', 'Command:');
  await expect(quick).toBeVisible();
  await expect(quick.getByRole('combobox', { name: 'Objects selected' })).toHaveText('Line (1)');
});
