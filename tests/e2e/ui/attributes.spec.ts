// M2-12: editing attributes in the app, on the title-block test drawing
// (packages/testkit/fixtures/attributes/title-block.dxf). A double click on the title block
// opens the Enhanced Attribute Editor; its list, Value field, tabs, Apply and OK edit the
// reference's attributes; the `...` by a multiline value opens the MTEXT editor; ATTEDIT opens
// Edit Attributes; Esc cancels. The engine side is unit-tested in packages/engine
// (test/commands/attributes.test.ts) and the save in packages/testkit (attributes/scenario.test.ts,
// export/export-attribute-edit.corpus.test.ts).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, InsertAttribute, InsertGeometry } from '@triya/engine';
import { activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const FILE = fileURLToPath(
  new URL('../../../packages/testkit/fixtures/attributes/title-block.dxf', import.meta.url),
);

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The attributes edited so far, by tag: [value (a multiline one's contents), height, colour]. */
const edited = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, [string, number, string]> = {};
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const u of cs.entities?.updated ?? []) {
        if (u.after.geom.kind !== 'INSERT') continue;
        const was = new Map(
          ((u.before.geom as InsertGeometry).attributes ?? []).map((a) => [a.handle, a]),
        );
        for (const a of (u.after.geom as InsertGeometry).attributes as InsertAttribute[]) {
          if (JSON.stringify(was.get(a.handle)) === JSON.stringify(a)) continue;
          out[a.tag] = [a.mtext ? a.mtext.contents : a.value, a.height, JSON.stringify(a.color)];
        }
      }
    }
    return out;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Opens the title block zoomed to it; returns page coordinates of a point of the drawing. */
async function open(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '225,5', 'Specify opposite corner:');
  await type(page, '415,75', 'Command:');
  const box = (await activeCanvas(page).boundingBox())!;
  // ZOOM Window fits 190 × 70 units about (320, 40) into the canvas.
  const k = Math.min(box.width / 190, box.height / 70);
  return (x, y) => ({
    x: box.x + box.width / 2 + (x - 320) * k,
    y: box.y + box.height / 2 - (y - 40) * k,
  });
}

/** A point on the title block's frame: the line under the title fields (block y 34). */
const FRAME = { x: 330, y: 44 };

test('a double click opens the Enhanced Attribute Editor; OK writes the revision row', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const at = await open(page);
  await page.screenshot({ path: test.info().outputPath('1-title-block.png') });
  const frame = at(FRAME.x, FRAME.y);
  await page.mouse.dblclick(frame.x, frame.y);
  const dialog = page.getByRole('dialog', { name: 'Enhanced Attribute Editor' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('eattedit-block')).toHaveText('TITLE-BLOCK');
  const list = dialog.getByRole('listbox', { name: 'Attributes' });
  const value = dialog.getByRole('textbox', { name: 'Value:' });

  // Revision row 2: picked in the list, typed in the Value field.
  for (const [tag, text] of [
    ['REV2_NO', 'B'],
    ['REV2_DATE', '2026-11-09'],
    ['REV2_DESC', 'PUMP BASE REVISED'],
    ['REV2_BY', 'SP'],
  ] as const) {
    await list.getByRole('option').filter({ hasText: tag }).click();
    await expect(dialog.getByTestId('eattedit-tag')).toHaveText(tag);
    await value.fill(text);
  }
  await expect(list.getByRole('option').filter({ hasText: 'REV2_DESC' })).toContainText(
    'PUMP BASE REVISED',
  );
  await page.screenshot({ path: test.info().outputPath('2-enhanced-attribute-editor.png') });

  // Text Options: the description higher; Properties: red.
  await list.getByRole('option').filter({ hasText: 'REV2_DESC' }).click();
  await dialog.getByRole('tab', { name: 'Text Options' }).click();
  await dialog.getByRole('spinbutton', { name: 'Height:' }).fill('3.5');
  await page.screenshot({ path: test.info().outputPath('3-text-options.png') });
  await dialog.getByRole('tab', { name: 'Properties' }).click();
  await dialog.getByRole('combobox', { name: 'Color:' }).selectOption({ label: 'Red' });
  await page.screenshot({ path: test.info().outputPath('4-properties.png') });

  // Apply keeps the dialog open with the changes made.
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => edited(page).then((e) => e['REV2_NO']?.[0])).toBe('B');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  expect(await edited(page)).toEqual({
    REV2_NO: ['B', 2.5, '{"kind":"byLayer"}'],
    REV2_DATE: ['2026-11-09', 2.5, '{"kind":"byLayer"}'],
    REV2_DESC: ['PUMP BASE REVISED', 3.5, '{"kind":"aci","index":1}'],
    REV2_BY: ['SP', 2.5, '{"kind":"byLayer"}'],
  });
  await page.screenshot({ path: test.info().outputPath('5-revised.png') });
});

test("a multiline value's ... opens the MTEXT editor; the dialog comes back with it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const at = await open(page);
  await type(page, 'EATTEDIT', 'Select a block:');
  const frame = at(FRAME.x, FRAME.y);
  await page.mouse.click(frame.x, frame.y);
  const dialog = page.getByRole('dialog', { name: 'Enhanced Attribute Editor' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('listbox', { name: 'Attributes' })
    .getByRole('option')
    .filter({ hasText: 'NOTES' })
    .click();
  // Its lines, one per paragraph.
  await expect(dialog.getByRole('textbox', { name: 'Value:' })).toHaveValue(
    'ALL DIMENSIONS IN MM\nDO NOT SCALE',
  );
  await dialog.getByRole('button', { name: '...' }).click();
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('SEE ALSO OET-1002');
  await page.screenshot({ path: test.info().outputPath('6-notes-in-mtext-editor.png') });
  await page.keyboard.press('Control+Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('eattedit-tag')).toHaveText('NOTES');
  await expect(dialog.getByRole('textbox', { name: 'Value:' })).toHaveValue(
    'ALL DIMENSIONS IN MM\nDO NOT SCALE\nSEE ALSO OET-1002',
  );
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => edited(page).then((e) => e['NOTES']?.[0]))
    .toBe('ALL DIMENSIONS IN MM\\PDO NOT SCALE\\PSEE ALSO OET-1002');
});

test('ATTEDIT opens Edit Attributes; Esc in a dialog changes nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const at = await open(page);
  const frame = at(FRAME.x, FRAME.y);

  await type(page, 'ATE', 'Select block reference:');
  await page.mouse.click(frame.x, frame.y);
  const dialog = page.getByRole('dialog', { name: 'Edit Attributes' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Block name: TITLE-BLOCK');
  // Eight to a page: the title's first, revision row 3 on the next.
  await dialog.getByRole('textbox', { name: 'Drawing title' }).fill('PUMP HOUSE GA - REV B');
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Revision description 3' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('7-edit-attributes.png') });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => edited(page))
    .toEqual({
      TITLE: ['PUMP HOUSE GA - REV B', 5, '{"kind":"byLayer"}'],
    });

  const before = await edited(page);
  await page.mouse.dblclick(frame.x, frame.y);
  const editor = page.getByRole('dialog', { name: 'Enhanced Attribute Editor' });
  await expect(editor).toBeVisible();
  await editor.getByRole('textbox', { name: 'Value:' }).fill('Not kept');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  expect(await edited(page)).toEqual(before);
});
