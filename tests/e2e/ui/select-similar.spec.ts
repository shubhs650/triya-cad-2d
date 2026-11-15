// M3-04 part 3: selection cycling and SELECTSIMILAR on the canvas, as AutoCAD 2024's. With
// Selection Cycling on (the SC button, Ctrl+W), a pick over overlapping objects opens the
// Selection list beside it, a row per object; a row clicked is the object selected, Esc selects
// none. SELECTSIMILAR adds the objects like the ones selected (same type and layer at first);
// its SEttings opens the Select Similar Settings dialog.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, EntityId } from '@triya/engine';
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

interface DevHooks {
  changes(): readonly ChangeSet[];
  selection(): readonly EntityId[];
}

type Dev = { triyaDev: DevHooks };

const selected = (page: Page) =>
  page.evaluate(() => [...(window as unknown as Dev).triyaDev.selection()].sort((a, b) => a - b));
const added = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => (cs.entities?.added ?? []).map((a) => a.entity.id)),
  );
const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Types a line at the command line and waits for the prompt that follows. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('selection cycling and SELECTSIMILAR', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const line = async (x0: number, y0: number, x1: number, y1: number) => {
    await type(page, 'L', 'Specify first point:');
    await click(x0, y0);
    await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
    await click(x1, y1);
    await type(page, '', 'Command:');
  };

  // An empty part of the plan, running object snaps off: two lines crossing away from their
  // midpoints (a selected line's grip there would take the pick), a third apart, and a circle.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.press('F3');
  await line(0.2, 0.3, 0.6, 0.3);
  await line(0.45, 0.1, 0.45, 0.6);
  await line(0.2, 0.7, 0.35, 0.7);
  await type(page, 'C', 'Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:');
  await click(0.75, 0.5);
  await expect(prompt(page)).toHaveText(/^Specify radius of circle/);
  await type(page, '5', 'Command:');
  const [h, v, apart, circle] = (await added(page)) as [number, number, number, number];

  // Selection cycling on: the status bar's SC button.
  const sc = page.getByRole('button', { name: 'SC', exact: true });
  await expect(sc).toHaveAttribute('aria-pressed', 'false');
  await sc.click();
  await expect(sc).toHaveAttribute('aria-pressed', 'true');

  // A pick where the two lines cross opens the Selection list; a row picks its line.
  const list = page.getByRole('dialog', { name: 'Selection' });
  await click(0.45, 0.3);
  await expect(list).toBeVisible();
  await expect(list.getByRole('button')).toHaveText(['Line', 'Line']);
  await list.getByRole('button').nth(1).click();
  await expect(list).toBeHidden();
  await expect.poll(async () => (await selected(page)).length).toBe(1);
  const second = await selected(page);
  expect([h, v]).toContain(second[0]);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);
  await click(0.45, 0.3);
  await expect(list).toBeVisible();
  await list.getByRole('button').first().click();
  await expect.poll(async () => (await selected(page)).length).toBe(1);
  const first = await selected(page);
  expect(first[0]).not.toBe(second[0]);
  // Esc closes the list and selects nothing; the selection made before stays.
  await click(0.45, 0.3);
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect.poll(() => selected(page)).toEqual(first);
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);

  // SELECTSIMILAR on the line apart adds the other lines of its layer, not the circle.
  await click(0.3, 0.7);
  await expect.poll(() => selected(page)).toEqual([apart]);
  await type(page, 'SELECTSIMILAR', 'Command:');
  await expect.poll(() => selected(page)).toEqual(expect.arrayContaining([h, v, apart]));
  expect(await selected(page)).not.toContain(circle);
  await page.keyboard.press('Escape');

  // With nothing selected it asks; SEttings opens Select Similar Settings on Layer and Name.
  await type(page, 'SELECTSIMILAR', 'Select objects or [SEttings]:');
  await type(page, 'SE', 'Select Similar Settings:');
  const dialog = page.getByRole('dialog', { name: 'Select Similar Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Layer')).toBeChecked();
  await expect(dialog.getByLabel('Name')).toBeChecked();
  await expect(dialog.getByLabel('Color')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Clear All' }).click();
  await expect(dialog.getByLabel('Layer')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Select All' }).click();
  await expect(dialog.getByLabel('Plot style')).toBeChecked();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Select objects or [SEttings]:');
  await type(page, 'SE', 'Select Similar Settings:');
  await expect(dialog.getByLabel('Object style')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Select objects or [SEttings]:');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});
