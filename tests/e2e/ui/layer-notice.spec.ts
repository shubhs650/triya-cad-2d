// M5-19 part 4: the Unreconciled New Layers alert LAYERNOTIFY asks for (AutoCAD 2024 Help,
// "LAYERNOTIFY"; "Use New Layer Notification"). With LAYEREVAL 1 and LAYERNOTIFY 4, the title
// block's file found brings TB-FRAME and TB-LOGO as new: the status bar shows the Unreconciled New
// Layers icon and its balloon, whose View Unreconciled New Layers opens the Layer Properties
// Manager on the Unreconciled New Layers node. With LAYERNOTIFY 1 PLOT asks first: No plots, Yes
// shows the layers instead. Reconciled, the icon goes.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enterCommand, expectShown, openWithDrop, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const palette = (page: Page) => page.getByRole('complementary', { name: 'Layers' });
const node = (page: Page, name: string) =>
  palette(page)
    .getByRole('tree', { name: 'Layer filters' })
    .getByRole('treeitem', { name, exact: true });
const listed = (page: Page) =>
  palette(page).getByRole('table', { name: 'Layers of the drawing' }).locator('tbody th');
const statusBar = (page: Page) => page.locator('footer.status-bar');

test('alerts for unreconciled new layers: balloon, View, PLOT question (M5-19 part 4)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const fixtures = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/xref');
  const prompt = page.getByTestId('command-prompt');
  const icon = statusBar(page).getByRole('button', {
    name: 'Unreconciled New Layers',
    exact: true,
  });
  const balloon = statusBar(page).getByRole('status', { name: 'Unreconciled New Layers' });
  const setvar = async (name: string, value: string) => {
    await enterCommand(page, name);
    await expect(prompt).toHaveText(new RegExp(`^Enter new value for ${name} <\\d+>:$`));
    await enterCommand(page, value);
    await expect(prompt).toHaveText('Command:');
  };
  await page.goto(app.url);
  await openWithPicker(page, path.join(fixtures, 'xref-parent.dxf'));
  await expectShown(page, 'xref-parent.dxf');
  await setvar('LAYEREVAL', '1');
  await setvar('LAYERNOTIFY', '4');
  await expect(icon).toHaveCount(0);

  // The title block's file found: its new layers alert (bit 4).
  await openWithDrop(page, path.join(fixtures, 'xref-child-tb.dxf'));
  await expect(balloon).toBeVisible({ timeout: 30_000 });
  await expect(balloon).toContainText(
    '2 new layers have been added since the layer list was last checked: xref-child-tb|TB-FRAME, xref-child-tb|TB-LOGO.',
  );
  await expect(icon).toBeVisible();
  await shot('1-balloon.png');

  // View Unreconciled New Layers: the manager on the node, the balloon gone, the icon kept.
  await balloon.getByRole('button', { name: 'View Unreconciled New Layers' }).click();
  await expect(palette(page)).toBeVisible();
  await expect(node(page, 'Unreconciled New Layers')).toHaveAttribute('aria-selected', 'true');
  await expect(listed(page)).toHaveText(['xref-child-tb|TB-FRAME', 'xref-child-tb|TB-LOGO']);
  await expect(balloon).toHaveCount(0);
  await expect(icon).toBeVisible();
  await shot('2-viewed.png');

  // The icon's right-click menu views them too.
  await node(page, 'All').click();
  await icon.click({ button: 'right' });
  await statusBar(page).getByRole('menuitem', { name: 'View Unreconciled New Layers' }).click();
  await expect(node(page, 'Unreconciled New Layers')).toHaveAttribute('aria-selected', 'true');

  // PLOT with LAYERNOTIFY 1: No plots (the Plot dialog), Yes shows the layers instead.
  await setvar('LAYERNOTIFY', '5');
  const question = page.getByRole('dialog', { name: 'Unreconciled New Layers' });
  const plotDialog = page.getByRole('dialog', { name: /^Plot - / });
  await enterCommand(page, 'PLOT');
  await expect(question).toBeVisible();
  await expect(question).toContainText('View the new layers in the Layer Properties Manager');
  await shot('3-plot-question.png');
  await question.getByRole('button', { name: 'No' }).click();
  await expect(question).toBeHidden();
  await expect(plotDialog).toBeVisible();
  await plotDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(plotDialog).toBeHidden();
  await expect(prompt).toHaveText('Command:');
  await node(page, 'All').click();
  await enterCommand(page, 'PLOT');
  await question.getByRole('button', { name: 'Yes' }).click();
  await expect(question).toBeHidden();
  await expect(prompt).toHaveText('Command:');
  await expect(plotDialog).toHaveCount(0);
  await expect(node(page, 'Unreconciled New Layers')).toHaveAttribute('aria-selected', 'true');

  // Reconciled, the alert is over.
  await enterCommand(page, '-LAYER');
  await enterCommand(page, 'E');
  await enterCommand(page, '*');
  await enterCommand(page, '');
  await expect(prompt).toHaveText('Command:');
  await expect(icon).toHaveCount(0);
});
