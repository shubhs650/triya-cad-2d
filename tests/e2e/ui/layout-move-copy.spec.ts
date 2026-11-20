// M6-01 part 2: the layout tab menu's Move or Copy dialog, dragging a layout tab, and LAYOUT Copy
// at the command line. sample_AC1018.dwg has three layouts: Layout1, Layout2 and MyLayout (its
// floating viewport shows model space on most of the sheet).
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectShown,
  lightPixels,
  openWithPicker,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('Move or Copy moves and copies a layout, a tab drags, and LAYOUT Copy copies', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Layout2', 'MyLayout']);
  const menu = page.getByRole('menu', { name: 'Layout tab' });
  const dialog = page.getByRole('dialog', { name: 'Move or Copy' });
  const list = dialog.getByRole('listbox', { name: 'Before layout' });

  // The Model tab cannot be moved or copied.
  await tabs.nth(0).click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Move or Copy...' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // Move: MyLayout before Layout1. The dialog opens on the tab after its own, "(move to end)".
  await tabs.nth(3).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Move or Copy...' }).click();
  await expect(list.getByRole('option')).toHaveText([
    'Layout1',
    'Layout2',
    'MyLayout',
    '(move to end)',
  ]);
  await expect(list.getByRole('option', { selected: true })).toHaveText('(move to end)');
  await expect(dialog.getByRole('checkbox', { name: 'Create a copy' })).not.toBeChecked();
  await list.getByRole('option', { name: 'Layout1' }).click();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(tabs).toHaveText(['Model', 'MyLayout', 'Layout1', 'Layout2']);

  // Copy: MyLayout copied before Layout2 as "MyLayout (2)", its viewport and all.
  await tabs.nth(1).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Move or Copy...' }).click();
  await dialog.getByRole('checkbox', { name: 'Create a copy' }).check();
  await list.getByRole('option', { name: 'Layout2' }).click();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(tabs).toHaveText(['Model', 'MyLayout', 'Layout1', 'MyLayout (2)', 'Layout2']);

  // The copy's sheet draws as the original's: model space through the copied viewport.
  const band = async () => {
    const box = (await activeCanvas(page).boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height - 2);
    return lightPixels(
      page,
      { x: box.width * 0.22, y: box.height * 0.3 },
      { x: box.width * 0.78, y: box.height * 0.7 },
    );
  };
  await tabs.nth(1).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expectDrawn(page, { timeout: 15_000 });
  const original = await band();
  await tabs.nth(3).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout (2)');
  await expectDrawn(page, { timeout: 15_000 });
  await expect.poll(band, { timeout: 15_000 }).toBeGreaterThan(original * 0.9);
  expect(original).toBeGreaterThan(0);

  // Dragging Layout2's tab onto the left half of MyLayout's puts it first.
  const first = (await tabs.nth(1).boundingBox())!;
  await tabs.nth(4).dragTo(tabs.nth(1), { targetPosition: { x: 4, y: first.height / 2 } });
  await expect(tabs).toHaveText(['Model', 'Layout2', 'MyLayout', 'Layout1', 'MyLayout (2)']);
  // Onto the right half of the last tab: last.
  const last = (await tabs.nth(4).boundingBox())!;
  await tabs
    .nth(1)
    .dragTo(tabs.nth(4), { targetPosition: { x: last.width - 4, y: last.height / 2 } });
  await expect(tabs).toHaveText(['Model', 'MyLayout', 'Layout1', 'MyLayout (2)', 'Layout2']);
  // The Model tab does not drag.
  await expect(tabs.nth(0)).toHaveAttribute('draggable', 'false');

  // LAYOUT Copy at the command line: before the layout copied, under AutoCAD's default name.
  await enterCommand(page, 'LAYOUT');
  await enterCommand(page, 'C');
  await enterCommand(page, 'Layout1');
  await enterCommand(page, '');
  await expect(tabs).toHaveText([
    'Model',
    'MyLayout',
    'Layout1 (2)',
    'Layout1',
    'MyLayout (2)',
    'Layout2',
  ]);

  // Each was one undo step.
  await enterCommand(page, 'U');
  await expect(tabs).toHaveText(['Model', 'MyLayout', 'Layout1', 'MyLayout (2)', 'Layout2']);
  await enterCommand(page, 'U');
  await enterCommand(page, 'U');
  await enterCommand(page, 'U');
  await expect(tabs).toHaveText(['Model', 'MyLayout', 'Layout1', 'Layout2']);
});
