// M2-07 part 2: editing text in the app. TEXT moves to a click elsewhere for its next line; a
// double click on a TEXT or MTEXT opens its in-place editor holding what it says (TEXTEDIT);
// the MTEXT editor keeps the codes it has no control for, stacks `1/2 ` as it is typed
// (AutoStack) and sets a run's font from its Font list. The engine side (TEXTEDIT's prompts,
// Undo and Mode) is unit-tested in packages/engine (test/commands/textedit.test.ts), the codes
// kept in packages/text (test/mtext/write.test.ts) and on every corpus file in packages/testkit
// (export/export-text-edit.corpus.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity, MTextGeometry, TextGeometry } from '@triya/engine';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/**
 * The texts made in this test as they stand now: [type, value or contents, x, y], positions
 * less the 1,000,000 offset of the empty part of the plan used.
 */
const texts = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, [string, string, number, number]>();
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind !== 'TEXT' && g.kind !== 'MTEXT') return;
      const at = (g as TextGeometry | MTextGeometry).position;
      out.set(e.handle, [
        g.kind,
        g.kind === 'TEXT' ? (g as TextGeometry).value : (g as MTextGeometry).contents,
        Math.round((at.x - 1e6) * 1e3) / 1e3,
        Math.round((at.y - 1e6) * 1e3) / 1e3,
      ]);
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) if (out.has(u.after.handle)) put(u.after);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()];
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Opens the test drawing on an empty part of its plan; returns page coordinates of a point. */
async function open(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  const box = (await activeCanvas(page).boundingBox())!;
  // ZOOM Window fits 160 × 100 units about (80, 50) into the canvas.
  const k = Math.min(box.width / 160, box.height / 100);
  return (x, y) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
}

const SELECT = 'Select an annotation object or [Undo/Mode]:';

test('TEXT moves to a click elsewhere; a double click edits a TEXT in place', async ({ page }) => {
  test.setTimeout(120_000);
  const at = await open(page);
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000060', 'Specify height <2.5000>:');
  await type(page, '5', 'Specify rotation angle of text <0.00>:');
  await type(page, '', 'Enter text:');
  const line = page.getByRole('textbox', { name: 'Text' });
  await line.pressSequentially('First');
  // A click on the canvas places "First" and starts the next line there.
  const there = at(20, 30);
  await page.mouse.click(there.x, there.y);
  await expect(line).toHaveValue('');
  await page.keyboard.type('Moved');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(() => texts(page))
    .toEqual([
      ['TEXT', 'First', 20, 60],
      ['TEXT', 'Moved', 20, 30],
    ]);

  // A double click on "First" opens TEXT's editor on it, the value selected.
  const first = at(26, 62);
  await page.mouse.dblclick(first.x, first.y);
  await expect(prompt(page)).toHaveText('Enter text:');
  const edit = page.getByRole('textbox', { name: 'Text' });
  await expect(edit).toHaveValue('First');
  await page.screenshot({ path: 'test-results/text-edit/1-double-click-text.png' });
  await page.keyboard.type('Edited');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(SELECT);
  await type(page, '', 'Command:');
  await expect
    .poll(() => texts(page))
    .toEqual([
      ['TEXT', 'Edited', 20, 60],
      ['TEXT', 'Moved', 20, 30],
    ]);
});

test('MTEXT: AutoStack, the Font list, and editing that keeps codes', async ({ page }) => {
  test.setTimeout(120_000);
  const at = await open(page);
  // -MTEXT takes contents as written: paragraph and width codes the editor has no control for.
  await type(page, '-MTEXT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '1000140,1000040', 'Enter text:');
  await type(page, '\\pxqc;{\\W0.8;Narrow} title', 'Enter text:');
  await type(page, '', 'Command:');

  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  const toolbar = page.getByRole('toolbar', { name: 'Text Formatting' });
  // Centred (\pxqc) in the 120-wide box.
  const word = at(80, 78.5);
  await page.mouse.dblclick(word.x, word.y);
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText('Narrow title');
  // Typed at the end: a fraction stacks when the space after it is typed.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Gap 1/2 ');
  await expect(editor.locator('[data-stack]')).toHaveCount(1);
  await page.keyboard.type('in');
  // The last word in another font.
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowLeft');
  await toolbar.getByRole('combobox', { name: 'Font' }).selectOption('romans.shx');
  await page.screenshot({ path: 'test-results/text-edit/2-mtext-edit.png' });
  await editor.focus();
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText(SELECT);
  await type(page, '', 'Command:');
  await expect
    .poll(() => texts(page).then((t) => t.map((x) => x[1])))
    .toEqual(['\\pxqc;{\\W0.8;Narrow} title\\PGap \\S1#2; {\\Fromans.shx;in}']);
  await page.screenshot({ path: 'test-results/text-edit/3-after-edit.png' });
});

test('closing the editor unchanged leaves the MTEXT as it was', async ({ page }) => {
  test.setTimeout(120_000);
  const at = await open(page);
  await type(page, '-MTEXT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '1000140,1000040', 'Enter text:');
  // Written as AutoCAD does, not as the editor would write it: a no-op must keep it so.
  await type(page, '{\\C1;Red}{\\C1; again}', 'Enter text:');
  await type(page, '', 'Command:');
  const changes = () => page.evaluate(() => (window as unknown as Dev).triyaDev.changes().length);
  const before = await changes();
  const word = at(24, 78);
  await page.mouse.dblclick(word.x, word.y);
  await expect(page.getByRole('textbox', { name: 'Multiline text' })).toBeFocused();
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText(SELECT);
  await type(page, '', 'Command:');
  expect(await changes()).toBe(before);
});
