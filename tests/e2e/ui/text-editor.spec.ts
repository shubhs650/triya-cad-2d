// M2-07: TEXT and MTEXT from the app, typed in place on the canvas. MTEXT's editor has
// AutoCAD's Text Formatting toolbar; what it makes is saved as MTEXT format codes, which the
// engine tests read back through acad-ts (export-text-commands.corpus.test.ts). This checks the
// editors carry the drafter's typing and formatting to the drawing's command engine.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MTextGeometry, TextGeometry } from '@triya/engine';
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

/** The TEXT and MTEXT entities added in this test, as [type, value or contents]. */
const texts = (page: Page) =>
  page.evaluate(() => {
    const out: [string, string][] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        const g = a.entity.geom;
        if (g.kind === 'TEXT') out.push(['TEXT', (g as TextGeometry).value]);
        if (g.kind === 'MTEXT') out.push(['MTEXT', (g as MTextGeometry).contents]);
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

async function open(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  // An empty part of the plan, 160 × 100 units from (1000000, 1000000).
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
}

test('TEXT is typed in place, one line after another', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000060', 'Specify height <2.5000>:');
  // The drawing's AUPREC is 2.
  await type(page, '5', 'Specify rotation angle of text <0.00>:');
  await type(page, '', 'Enter text:');
  const line = page.getByRole('textbox', { name: 'Text' });
  await expect(line).toBeFocused();
  await line.pressSequentially('First line');
  await line.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Text' })).toHaveValue('');
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect(page.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
  await expect
    .poll(() => texts(page))
    .toEqual([
      ['TEXT', 'First line'],
      ['TEXT', 'Second'],
    ]);
});

test('MTEXT editor formats, stacks and saves its contents as MTEXT codes', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '1000140,1000020', 'Enter text:');

  const toolbar = page.getByRole('toolbar', { name: 'Text Formatting' });
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  // The drawing's Standard style is txt.shx: an SHX font has no bold or italic.
  await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeDisabled();

  await page.keyboard.type('Note ');
  await page.keyboard.press('Control+u');
  await expect(toolbar.getByRole('button', { name: 'Underline' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.type('under');
  await page.keyboard.press('Control+u');
  await page.keyboard.type(' red');
  // Select " red" and make it red from the toolbar.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  await toolbar.getByRole('combobox', { name: 'Color' }).selectOption({ label: 'Red' });
  await editor.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Gap 1/2');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await toolbar.getByRole('button', { name: 'Stack' }).click();
  await expect(editor.locator('[data-stack]')).toHaveCount(1);
  await page.keyboard.press('Control+Enter');

  await expect(prompt(page)).toHaveText('Command:');
  await expect(editor).toHaveCount(0);
  await expect
    .poll(() => texts(page))
    .toEqual([['MTEXT', 'Note {\\Lunder}{\\C1; red}\\PGap \\S1/2;']]);
});

test('Esc in the MTEXT editor cancels the command and makes nothing', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '1000140,1000020', 'Enter text:');
  await page.keyboard.type('dropped');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await expect(page.getByRole('textbox', { name: 'Multiline text' })).toHaveCount(0);
  expect(await texts(page)).toEqual([]);
});
