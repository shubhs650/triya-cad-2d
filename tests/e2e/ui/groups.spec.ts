// M3-08: groups on the canvas, as AutoCAD 2024's. GROUP makes a named group of the objects
// picked; a pick on one member then selects the group while group selection is on (PICKSTYLE),
// which Ctrl+Shift+A turns off and on. CLASSICGROUP's Object Grouping dialog lists the named
// groups, highlights one's members, makes a new group from objects picked and explodes one;
// UNGROUP explodes the group of an object picked.
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

test('GROUP, group selection, Object Grouping and UNGROUP', async ({ page }) => {
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

  // An empty part of the plan, running object snaps off: three lines apart.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.press('F3');
  await line(0.2, 0.3, 0.6, 0.3);
  await line(0.2, 0.5, 0.6, 0.5);
  await line(0.2, 0.7, 0.6, 0.7);
  const [a, b, c] = (await added(page)) as [number, number, number];

  // GROUP, named DOORS, of the first two lines (picked away from their midpoints).
  await type(page, 'G', 'Select objects or [Name/Description]:');
  await type(page, 'N', 'Enter a group name or [?]:');
  await type(page, 'doors', 'Select objects or [Name/Description]:');
  await click(0.3, 0.3);
  await click(0.3, 0.5);
  await type(page, '', 'Command:');

  // A pick on one member selects the group; Ctrl+Shift+A turns group selection off and on.
  await click(0.3, 0.3);
  await expect.poll(() => selected(page)).toEqual([a, b]);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);
  await page.keyboard.press('Control+Shift+A');
  await click(0.3, 0.3);
  await expect.poll(() => selected(page)).toEqual([a]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+A');
  await click(0.3, 0.5);
  await expect.poll(() => selected(page)).toEqual([a, b]);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);

  // Object Grouping lists DOORS; Highlight shows its members until Enter.
  await type(page, 'CLASSICGROUP', 'Object Grouping:');
  const dialog = page.getByRole('dialog', { name: 'Object Grouping' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('row')).toHaveText([/Group Name/, /DOORS\s*Yes/]);
  await dialog.getByTestId('group-DOORS').click();
  await expect(dialog.getByLabel('Group Name:')).toHaveValue('DOORS');
  await dialog.getByRole('button', { name: 'Highlight <' }).click();
  await expect(prompt(page)).toHaveText('Press ENTER to continue:');
  await expect.poll(() => selected(page)).toEqual([a, b]);
  await type(page, '', 'Object Grouping:');
  await expect.poll(() => selected(page)).toEqual([]);

  // New < makes WINDOWS of the third line, described, and comes back with it selected.
  await dialog.getByLabel('Group Name:').fill('windows');
  await dialog.getByLabel('Description:').fill('west side');
  await dialog.getByRole('button', { name: 'New <' }).click();
  await expect(prompt(page)).toHaveText('Select objects for grouping:');
  await click(0.3, 0.7);
  await type(page, '', 'Object Grouping:');
  await expect(dialog.getByRole('row')).toHaveText([/Group Name/, /DOORS/, /WINDOWS\s*Yes/]);
  await expect(dialog.getByLabel('Description:')).toHaveValue('west side');
  // A name in use is refused, said under the list.
  await dialog.getByLabel('Group Name:').fill('doors');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog.getByRole('status')).toHaveText('A group with this name already exists.');
  // Explode takes DOORS away; its lines stay.
  await dialog.getByTestId('group-DOORS').click();
  await dialog.getByRole('button', { name: 'Explode' }).click();
  await expect(dialog.getByRole('row')).toHaveText([/Group Name/, /WINDOWS/]);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await click(0.3, 0.3);
  await expect.poll(() => selected(page)).toEqual([a]);
  await page.keyboard.press('Escape');

  // UNGROUP explodes the group of the line picked.
  await type(page, 'UNGROUP', 'Select group or [Name]:');
  await click(0.3, 0.7);
  await type(page, '', 'Command:');
  await type(page, 'CLASSICGROUP', 'Object Grouping:');
  await expect(dialog.getByRole('row')).toHaveText([/Group Name/]);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  expect(c).toBeGreaterThan(b);
});
