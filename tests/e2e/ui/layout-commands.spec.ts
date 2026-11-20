// M6-01 part 1: the layout tab's shortcut menu (New Layout, Delete, Rename), renaming a layout
// in place on its tab, and LAYOUT at the command line. sample_AC1018.dwg has three layouts:
// Layout1, Layout2 and MyLayout.
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectShown,
  openWithPicker,
  paperPixels,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

test('layout tabs make, rename and delete layouts, as LAYOUT does', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Layout2', 'MyLayout']);
  const menu = page.getByRole('menu', { name: 'Layout tab' });

  // The Model tab offers New Layout and the Page Setup Manager only.
  await tabs.nth(0).click({ button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'New Layout',
    'Delete',
    'Rename',
    'Move or Copy...',
    'Page Setup Manager...',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'New Layout' }).click();
  await expect(menu).toBeHidden();
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Layout2', 'MyLayout', 'Layout4']);

  // The new layout shows its sheet on the surround (before the renderer knew a layout made after
  // the drawing opened, the whole canvas was paper).
  await tabs.nth(4).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout4');
  await expectDrawn(page, { timeout: 15_000 });
  const box = (await activeCanvas(page).boundingBox())!;
  await expect.poll(() => paperPixels(page), { timeout: 15_000 }).toBeGreaterThan(50_000);
  expect(await paperPixels(page)).toBeLessThan(box.width * box.height * 0.8);

  // Rename from the menu: the name is edited on the tab; Enter renames it.
  await tabs.nth(2).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Rename' }).click();
  const field = page.getByRole('textbox', { name: 'Layout name' });
  await expect(field).toBeFocused();
  await field.fill('Plan');
  await field.press('Enter');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Plan', 'MyLayout', 'Layout4']);

  // A double-click edits it too; Esc keeps the name.
  await tabs.nth(3).dblclick();
  await field.fill('Ignored');
  await field.press('Escape');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Plan', 'MyLayout', 'Layout4']);

  // A name in use is refused, and says why.
  await tabs.nth(3).dblclick();
  await field.fill('plan');
  await field.press('Enter');
  await expect(page.getByRole('alert')).toContainText('A layout named "plan" already exists.');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Plan', 'MyLayout', 'Layout4']);

  // Delete asks first; Cancel keeps it, OK deletes it and, as it was shown, the Model tab shows.
  await tabs.nth(4).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout4');
  await tabs.nth(4).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  const ask = page.getByRole('dialog', { name: 'Delete Layout' });
  await expect(ask).toContainText('The selected layout(s) will be permanently deleted.');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(tabs).toHaveCount(5);
  await tabs.nth(4).click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await ask.getByRole('button', { name: 'OK' }).click();
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Plan', 'MyLayout']);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

  // LAYOUT at the command line: Set shows a tab; U brings the deleted layout back.
  await enterCommand(page, 'LAYOUT');
  await enterCommand(page, 'S');
  await enterCommand(page, 'plan');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await enterCommand(page, 'U');
  await expect(tabs).toHaveText(['Model', 'Layout1', 'Plan', 'MyLayout', 'Layout4']);
});
