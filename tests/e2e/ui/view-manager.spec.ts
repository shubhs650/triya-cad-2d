// M2-47 part 2: the View Manager, VIEW's dialog (AutoCAD 2024's View Manager and New View / Shot
// Properties), on clockwise_arcs_hatch.dxf. New... saves the view shown and a window picked at the
// command line (Define window), Set Current and OK restore a view, the Name row renames one and
// Delete removes one; each is a VIEW undo step. Esc cancels, Enter is OK.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectShown, openWithPicker, worldAt } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const manager = (page: Page) => page.getByRole('dialog', { name: 'View Manager' });
const newView = (page: Page) => page.getByRole('dialog', { name: 'New View / Shot Properties' });
const tree = (page: Page) => manager(page).getByRole('tree', { name: 'Views' });

async function command(page: Page, text: string, next: string | RegExp): Promise<void> {
  await page.getByLabel('Command', { exact: true }).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** The world point at the canvas centre and the world height it shows. */
async function shown(page: Page): Promise<{ x: number; y: number; unit: number; height: number }> {
  const box = (await activeCanvas(page).boundingBox())!;
  const cx = Math.round(box.width / 2);
  const cy = Math.round(box.height / 2);
  const c = await worldAt(page, cx, cy);
  const r = await worldAt(page, cx + 100, cy);
  const unit = (r.x - c.x) / 100;
  return { ...c, unit, height: Math.abs(unit) * box.height };
}

function sameView(a: Awaited<ReturnType<typeof shown>>, b: typeof a): void {
  const px = 2 * Math.max(Math.abs(a.unit), Math.abs(b.unit));
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(px);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(px);
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(a.height / 100);
}

/** The Model Views the View Manager lists, read by opening it and closing it again. */
async function viewNames(page: Page): Promise<string[]> {
  await command(page, 'VIEW', '');
  const folder = tree(page).getByRole('treeitem', { name: /^Model Views/ });
  const names = await folder.getByRole('group').getByRole('treeitem').allTextContents();
  await page.keyboard.press('Escape');
  await expect(manager(page)).toBeHidden();
  return names;
}

test('the View Manager saves, restores, renames and deletes named views', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));

  // A zoomed-in view, saved by New... with Current display.
  await command(page, 'ZOOM', /^Specify corner of window/);
  await page.keyboard.type('3x');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const detail = await shown(page);

  await command(page, 'VIEW', '');
  await expect(manager(page)).toBeVisible();
  await expect(manager(page).getByText('Current View: Current')).toBeVisible();
  await expect(tree(page).getByRole('treeitem', { name: 'Current' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await manager(page).getByRole('button', { name: 'New...' }).click();
  await expect(newView(page)).toBeVisible();
  await expect(newView(page).getByRole('radio', { name: 'Current display' })).toBeChecked();
  await newView(page).getByLabel('View name').fill('Detail A');
  await page.screenshot({ path: test.info().outputPath('1-new-view.png') });
  await page.keyboard.press('Enter');
  await expect(newView(page)).toBeHidden();
  const detailItem = tree(page).getByRole('treeitem', { name: 'Detail A' });
  await expect(detailItem).toHaveAttribute('aria-selected', 'true');
  const props = manager(page).getByRole('table', { name: 'View properties' });
  await expect(props.getByLabel('Name')).toHaveValue('Detail A');

  // Define window: both dialogs go, VIEW asks for the corners, and they come back with it.
  await manager(page).getByRole('button', { name: 'New...' }).click();
  await newView(page).getByLabel('View name').fill('Corner');
  await newView(page).getByRole('radio', { name: 'Define window' }).click();
  await expect(manager(page)).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify first corner:');
  await page.keyboard.type('0,0');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await page.keyboard.type('20,10');
  await page.keyboard.press('Enter');
  await expect(newView(page)).toBeVisible();
  await expect(newView(page).getByLabel('View name')).toHaveValue('Corner');
  await expect(newView(page).getByRole('radio', { name: 'Define window' })).toBeChecked();
  await expect(newView(page).getByText('Window: 20.0000 × 10.0000')).toBeVisible();
  await newView(page).getByRole('button', { name: 'OK' }).click();
  await expect(props.getByRole('row', { name: /Center X/ })).toContainText('10.0000');
  await expect(props.getByRole('row', { name: /Height/ })).toContainText('10.0000');

  // A name the drawing has asks before replacing; No keeps the dialog open.
  await manager(page).getByRole('button', { name: 'New...' }).click();
  await newView(page).getByLabel('View name').fill('detail a');
  await newView(page).getByRole('button', { name: 'OK' }).click();
  const replace = newView(page).getByRole('alertdialog', { name: 'View - Replace' });
  await expect(replace).toContainText(
    'A view named "Detail A" already exists. Do you want to replace it?',
  );
  await replace.getByRole('button', { name: 'No' }).click();
  await page.keyboard.press('Escape');
  await expect(newView(page)).toBeHidden();
  await expect(manager(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(manager(page)).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  // Zoomed away, Set Current and OK restore Detail A.
  await command(page, 'ZOOM', /^Specify corner of window/);
  await page.keyboard.type('E');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const away = await shown(page);
  expect(Math.abs(away.height - detail.height)).toBeGreaterThan(detail.height / 10);
  await command(page, 'V', '');
  await tree(page).getByRole('treeitem', { name: 'Detail A' }).click();
  await manager(page).getByRole('button', { name: 'Set Current' }).click();
  await expect(manager(page).getByText('Current View: Detail A')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('2-view-manager.png') });
  // Cancel restores nothing.
  await manager(page).getByRole('button', { name: 'Cancel' }).click();
  sameView(await shown(page), away);
  await command(page, 'V', '');
  await tree(page).getByRole('treeitem', { name: 'Detail A' }).click();
  await manager(page).getByRole('button', { name: 'Set Current' }).click();
  await manager(page).getByRole('button', { name: 'OK' }).click();
  await expect(manager(page)).toBeHidden();
  sameView(await shown(page), detail);

  // The Name row renames, the arrow keys move through the tree, Delete removes.
  await command(page, 'V', '');
  await tree(page).getByRole('treeitem', { name: 'Corner' }).click();
  await props.getByLabel('Name').fill('Corner window');
  await props.getByLabel('Name').press('Enter');
  await expect(tree(page).getByRole('treeitem', { name: 'Corner window' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await tree(page).getByRole('treeitem', { name: 'Corner window' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(detailItem).toHaveAttribute('aria-selected', 'true');
  await expect(detailItem).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(detailItem).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('3-renamed-deleted.png') });
  await page.keyboard.press('Enter');
  await expect(manager(page)).toBeHidden();
  expect(await viewNames(page)).toEqual(['Corner window']);

  // Each was an undo step: U brings Detail A back, U again names Corner as it was.
  await command(page, 'U', 'Command:');
  await command(page, 'U', 'Command:');
  expect((await viewNames(page)).sort()).toEqual(['Corner', 'Detail A']);
});
