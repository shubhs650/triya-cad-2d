// M2-26 part 3: the MTEXT editor's ruler tab types (AutoCAD's Tab Selection button cycles
// left, center, right and decimal), its right indent marker, the Paragraph dialog (Tab, Left
// Indent, Right Indent, Paragraph Alignment) and the editor laying text out at the paragraph's
// own tab stops, as the renderer does. The `\p` codes are unit-tested in packages/text
// (test/mtext/ruler.test.ts, parse.test.ts, layout.test.ts).
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MTextGeometry } from '@triya/engine';
import { DXF, expectShown, openWithPicker } from '../app/page';
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

/** The MTEXTs added in this test. */
const mtexts = (page: Page) =>
  page.evaluate(() => {
    const out: MTextGeometry[] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind === 'MTEXT') out.push(a.entity.geom as MTextGeometry);
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

/** Opens the test drawing on an empty part of its plan and starts an MTEXT 120 units wide. */
async function startMText(page: Page): Promise<void> {
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
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '1000140,1000020', 'Enter text:');
  await expect(page.getByRole('textbox', { name: 'Multiline text' })).toBeFocused();
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Text Formatting' });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Multiline text' });

/**
 * Where the `n`th occurrence of `char` starts in the editor, in text heights from its
 * paragraph's left edge (the editor is not turned: the MTEXT has no rotation).
 */
const charAt = (page: Page, char: string, n = 0) =>
  editor(page).evaluate(
    (root, [char, n]) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
        for (let i = 0; i < t.length; i++) {
          if (t.data[i] !== char || seen++ !== n) continue;
          const r = document.createRange();
          r.setStart(t, i);
          r.setEnd(t, i + 1);
          const para = t.parentElement!.closest('.mtext-para')!;
          return r.getBoundingClientRect().left - para.getBoundingClientRect().left;
        }
      }
      return NaN;
    },
    [char, n] as const,
  );

test('the ruler sets tab types and the right indent; the editor lays text at the stops', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await startMText(page);
  // Tab types a tab character, as in AutoCAD's editor, rather than leaving the editor.
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('12.5');
  await expect(editor(page)).toBeFocused();
  const ruler = page.getByRole('slider', { name: 'Ruler' });
  const box = (await ruler.boundingBox())!;
  // The ruler is as wide as the 120-unit box; the text is 2.5 units high.
  const unit = ((box.width - 2) / 120) * 2.5;
  const at = (heights: number) => box.x + 1 + heights * unit;
  // The default stop: every 4 heights.
  expect((await charAt(page, '1')) / unit).toBeCloseTo(4, 0);

  const tabType = page.getByRole('button', { name: /^Tab type/ });
  await expect(tabType).toHaveAccessibleName('Tab type: Left');
  for (const kind of ['Center', 'Right', 'Decimal']) {
    await tabType.click();
    await expect(tabType).toHaveAccessibleName(`Tab type: ${kind}`);
  }
  await page.mouse.click(at(12), box.y + box.height / 2);
  await expect(ruler).toHaveAttribute(
    'aria-valuetext',
    'First line 0, left 0, right 0, tabs decimal 12',
  );
  // The decimal point sits on the stop.
  await expect.poll(async () => (await charAt(page, '.')) / unit).toBeCloseTo(12, 0);

  // The right indent marker sits at the ruler's right end and drags in from there.
  const right = box.x + box.width - 2;
  await page.mouse.move(right, box.y + box.height - 3);
  await page.mouse.down();
  await page.mouse.move(right - 5 * unit, box.y + box.height - 3);
  await page.mouse.move(right - 10 * unit, box.y + box.height - 3);
  await page.mouse.up();
  await expect(ruler).toHaveAttribute('aria-valuetext', /, right (9\.\d|10(\.\d)?), tabs/);
  await expect(editor(page).locator('.mtext-para').first()).toHaveCSS('padding-right', /^[1-9]/);
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const [g] = await mtexts(page);
  expect(g!.contents).toMatch(/^\\pxr(9\.\d|10(\.\d)?),tD\.12;a\^I12\.5$/);
});

test('the Paragraph dialog sets tab stops, indents and the alignment', async ({ page }) => {
  test.setTimeout(90_000);
  await startMText(page);
  await page.keyboard.type('Qty');
  await page.keyboard.press('Tab');
  await page.keyboard.type('1,25');
  await toolbar(page).getByRole('button', { name: 'Paragraph' }).click();
  const dialog = page.getByRole('dialog', { name: 'Paragraph' });
  await expect(dialog).toBeVisible();
  const stops = dialog.getByRole('listbox', { name: 'Tab stops' });
  await expect(stops.getByRole('option')).toHaveCount(0);

  // A decimal stop at 10 with the comma style, then a right one at 20, modified to 24.
  const tabType = dialog.getByRole('radiogroup', { name: 'Tab type' });
  await tabType.getByRole('radio', { name: 'Decimal' }).check();
  await dialog.getByRole('combobox', { name: 'Specify decimal style' }).selectOption('Comma');
  await dialog.getByRole('spinbutton', { name: 'Tab position' }).fill('10');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await tabType.getByRole('radio', { name: 'Right' }).check();
  await dialog.getByRole('spinbutton', { name: 'Tab position' }).fill('20');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(stops.getByRole('option')).toHaveText(['Decimal 10', 'Right 20']);
  await stops.getByRole('option', { name: 'Right 20' }).click();
  await dialog.getByRole('spinbutton', { name: 'Tab position' }).fill('24');
  await dialog.getByRole('button', { name: 'Modify' }).click();
  await expect(stops.getByRole('option')).toHaveText(['Decimal 10', 'Right 24']);
  // A third stop added and removed again.
  await tabType.getByRole('radio', { name: 'Left' }).check();
  await dialog.getByRole('spinbutton', { name: 'Tab position' }).fill('30');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await stops.getByRole('option', { name: 'Left 30' }).click();
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(stops.getByRole('option')).toHaveText(['Decimal 10', 'Right 24']);

  // Left Indent's First line and Hanging are where the ruler's two markers are.
  await dialog.getByRole('spinbutton', { name: 'First line' }).fill('1');
  await dialog.getByRole('spinbutton', { name: 'Hanging' }).fill('3');
  await dialog.getByRole('spinbutton', { name: 'Right', exact: true }).fill('2');
  await dialog.getByRole('checkbox', { name: 'Paragraph Alignment' }).check();
  const alignment = dialog.getByRole('radiogroup', { name: 'Paragraph Alignment' });
  await alignment.getByRole('radio', { name: 'Justified' }).check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editor(page)).toBeFocused();

  const ruler = page.getByRole('slider', { name: 'Ruler' });
  await expect(ruler).toHaveAttribute(
    'aria-valuetext',
    'First line -2, left 3, right 2, tabs decimal 10 right 24',
  );
  const para = editor(page).locator('.mtext-para').first();
  await expect(para).toHaveCSS('text-align', 'justify');
  // The comma sits on the decimal stop.
  const unit = (((await ruler.boundingBox())!.width - 2) / 120) * 2.5;
  await expect.poll(async () => (await charAt(page, ',')) / unit).toBeCloseTo(10, 0);

  // The dialog opens again on what it set.
  await toolbar(page).getByRole('button', { name: 'Paragraph' }).click();
  await expect(stops.getByRole('option')).toHaveText(['Decimal 10', 'Right 24']);
  await expect(dialog.getByRole('spinbutton', { name: 'First line' })).toHaveValue('1');
  await expect(alignment.getByRole('radio', { name: 'Justified' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  const [g] = await mtexts(page);
  expect(g!.contents).toBe('\\pxi-2,l3,r2,tD,10,r24;\\pqj;Qty^I1,25');
});
