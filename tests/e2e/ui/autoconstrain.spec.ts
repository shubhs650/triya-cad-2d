// M9-05 part 3: Auto Constrain and the Constraint Settings dialog. On an empty part of the plan a
// 60 x 40 rectangle is drawn a little off (one corner 0.03 apart, the bottom 0.3° off true). The
// Parametric tab's Constraint Settings opens on Geometric with AutoCAD's three tabs; on
// AutoConstrain, Equal's Apply is cleared and OK keeps it. Auto Constrain on the four lines
// applies 4 Coincident, 2 Parallel, 1 Perpendicular and 1 Horizontal (the rest redundant), the
// bars show. AUTOCONSTRAIN's Settings opens the
// dialog on its AutoConstrain tab, Equal still cleared. Which constraints are found is tested in
// packages/engine/test/edit/autoconstrain.test.ts, the command in
// packages/engine/test/commands/autoconstrain.test.ts and with PlaneGCS in
// packages/constraints/test/autoconstrain.test.ts (which checks the geometry squared up); this
// checks the ribbon, the dialog and the settings it keeps.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  DXF,
  enterCommand,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
  viewOf,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Auto Constrain squares up a rectangle as the Constraint Settings say', async ({ page }) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000).
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const O = 1000000;
  const sides: [number, number, number, number][] = [
    [20, 20, 80, 20.3],
    [80.03, 20.3, 80, 60],
    [80, 60, 20, 60],
    [20, 60, 20, 20],
  ];
  for (const [x1, y1, x2, y2] of sides) {
    await type(page, 'L', 'Specify first point:');
    await type(page, `${O + x1},${O + y1}`, 'Specify next point or [Undo]:');
    await type(page, `${O + x2},${O + y2}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });
  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(O + x, O + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };

  // Parametric > Geometric > Constraint Settings: Geometric first, AutoCAD's three tabs.
  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  await ribbon.getByRole('tab', { name: 'Parametric', exact: true }).click();
  const geometric = page.getByRole('group', { name: 'Geometric' });
  await geometric.getByRole('button', { name: 'Constraint Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Constraint Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab')).toHaveText(['Geometric', 'Dimensional', 'AutoConstrain']);
  await expect(dialog.getByRole('tab', { name: 'Geometric' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('checkbox', { name: 'Smooth (G2)' })).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: 'Infer geometric constraints' }),
  ).toBeDisabled();
  await shot('1-geometric-tab.png');
  await dialog.getByRole('tab', { name: 'Dimensional' }).click();
  await expect(dialog.getByLabel('Dimension name format:')).toHaveValue('2');
  await dialog.getByRole('tab', { name: 'AutoConstrain' }).click();
  const order = dialog.getByRole('table', { name: 'Constraint types' });
  await expect(order.locator('tbody tr td:nth-child(2)')).toHaveText([
    'Coincident',
    'Collinear',
    'Parallel',
    'Perpendicular',
    'Tangent',
    'Concentric',
    'Horizontal',
    'Vertical',
    'Equal',
  ]);
  await expect(dialog.getByLabel('Distance:')).toHaveValue('0.05');
  await expect(dialog.getByLabel('Angle:')).toHaveValue('1');
  await dialog.getByRole('checkbox', { name: 'Apply Equal' }).uncheck();
  // A bad tolerance holds OK until it is mended.
  await dialog.getByLabel('Distance:').fill('0');
  await expect(dialog.getByRole('alert')).toHaveText(/distance tolerance/);
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  await dialog.getByLabel('Distance:').fill('0.05');
  await shot('2-autoconstrain-tab.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  // Geometric > Auto Constrain on the four lines.
  await geometric.getByRole('button', { name: 'Auto Constrain', exact: true }).click();
  await expect(prompt(page)).toHaveText('Select objects or [Settings]:');
  await click(50, 20.15);
  await click(80, 40);
  await click(50, 60);
  await click(20, 40);
  await type(page, '', 'Command:');
  await expect(history(page)).toContainText('8 constraints applied to 4 objects.', {
    timeout: 15_000,
  });
  await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
  await shot('3-auto-constrained.png');

  // AUTOCONSTRAIN's Settings opens on AutoConstrain, Equal still cleared (the user's setting).
  await enterCommand(page, 'AUTOCONSTRAIN');
  await expect(prompt(page)).toHaveText('Select objects or [Settings]:');
  await page.keyboard.type('S');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'AutoConstrain' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByRole('checkbox', { name: 'Apply Equal' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt(page)).toHaveText('Select objects or [Settings]:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});
