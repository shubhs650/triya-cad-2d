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

/** The TEXT values as they stand now, after edits (TEXTEDIT). */
const values = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, string>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? [])
        if (a.entity.geom.kind === 'TEXT')
          out.set(a.entity.handle, (a.entity.geom as TextGeometry).value);
      for (const u of cs.entities?.updated ?? [])
        if (out.has(u.after.handle)) out.set(u.after.handle, (u.after.geom as TextGeometry).value);
    }
    return [...out.values()];
  });

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

/**
 * Keys as typed into the page with nothing in between: the engine cannot answer the first before
 * the last is in, as when a drafter types faster than the engine shows the next prompt.
 */
const typeAhead = (page: Page, keys: readonly string[]) =>
  page.evaluate((keys) => {
    for (const key of keys) {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
  }, keys);

// M4-20: AutoCAD keeps what is typed while TEXT's editor opens. Typed before the line editor was
// shown, keys were held by the command line and replayed there, not in the editor: the line lost
// its start, and its Enter, on an empty editor, ended TEXT, so the second Enter reached
// `Command:` and started TEXT again.
test('TEXT takes the keys typed before its line editor opens', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000060', 'Specify height <2.5000>:');
  await type(page, '5', 'Specify rotation angle of text <0.00>:');
  // Enter takes the default rotation; the line starts before the editor is shown.
  await typeAhead(page, ['Enter', ...'Triya']);
  const line = page.getByRole('textbox', { name: 'Text' });
  await expect(line).toBeFocused();
  await page.keyboard.type(' 2D');
  await expect(line).toHaveValue('Triya 2D');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect(page.getByRole('textbox', { name: 'Command' })).toHaveValue('');
  await expect.poll(() => texts(page)).toEqual([['TEXT', 'Triya 2D']]);

  // Lines and the Enter that ends TEXT all typed ahead, and a command after them.
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000040', 'Specify height <5.0000>:');
  await type(page, '', 'Specify rotation angle of text <0.00>:');
  await typeAhead(page, [
    'Enter',
    ...'Fast one',
    'Enter',
    ...'Twp',
    'Backspace',
    'o',
    'Enter',
    'Enter',
    ...'LINE',
    'Enter',
  ]);
  await expect(prompt(page)).toHaveText('Specify first point:');
  await expect(page.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
  await expect
    .poll(() => texts(page))
    .toEqual([
      ['TEXT', 'Triya 2D'],
      ['TEXT', 'Fast one'],
      ['TEXT', 'Two'],
    ]);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});

// M4-26: AutoCAD keeps what is typed while MTEXT's editor opens. Typed before the editor was
// shown, keys were held by the command line and replayed there: the contents typed after the
// opposite corner reached `Enter text:` at the command line, not the editor.
test('MTEXT takes the keys typed before its editor opens', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await page.keyboard.type('1000140,1000020');
  // The corner's Enter, then two paragraphs, a typo taken back and a tab, before the editor is
  // shown.
  await typeAhead(page, [
    'Enter',
    ...'Firts',
    'Backspace',
    'Backspace',
    ...'st',
    'Enter',
    'A',
    'Tab',
    'B',
  ]);
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();
  await page.keyboard.type('C');
  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect(page.getByRole('textbox', { name: 'Command' })).toHaveValue('');
  await expect.poll(() => texts(page)).toEqual([['MTEXT', 'First\\PA^IBC']]);

  // Esc typed ahead cancels the editor; what follows it was typed ahead of `Command:`.
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await page.keyboard.type('1000140,1000020');
  await typeAhead(page, ['Enter', ...'dropped', 'Escape', ...'LINE', 'Enter']);
  await expect(prompt(page)).toHaveText('Specify first point:');
  await expect(editor).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  expect(await texts(page)).toEqual([['MTEXT', 'First\\PA^IBC']]);
});

// M4-26: TEXTEDIT's line editor opens on the picked TEXT with its value selected; what is typed
// before it is shown replaces the value, as typed into it would. Held by the command line, the
// keys were replayed there instead and the editor kept the old value.
test('TEXTEDIT takes the keys typed before its line editor opens', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000060', 'Specify height <2.5000>:');
  await type(page, '5', 'Specify rotation angle of text <0.00>:');
  await type(page, '', 'Enter text:');
  await page.keyboard.type('Old');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');

  const SELECT = 'Select an annotation object or [Undo/Mode]:';
  await type(page, 'TEXTEDIT', SELECT);
  // Last picks the TEXT; its new value and the Enter that keeps it are typed before the editor is
  // shown.
  await page.keyboard.type('L');
  await typeAhead(page, ['Enter', ...'Nwe', 'Backspace', 'Backspace', ...'ew', 'Enter']);
  await expect(prompt(page)).toHaveText(SELECT);
  await expect(page.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
  await expect.poll(() => values(page)).toEqual(['New']);

  // Picked again, the keys go on from what is typed into the editor once it shows.
  await page.keyboard.type('L');
  await typeAhead(page, ['Enter', ...'Ne']);
  const line = page.getByRole('textbox', { name: 'Text' });
  await expect(line).toBeFocused();
  await page.keyboard.type('xt');
  await expect(line).toHaveValue('Next');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(SELECT);
  await expect.poll(() => values(page)).toEqual(['Next']);

  // Esc typed ahead cancels the edit; the keys after it reach the prompt that follows.
  await page.keyboard.type('L');
  await typeAhead(page, ['Enter', ...'Gone', 'Escape', ...'LINE', 'Enter']);
  await expect(prompt(page)).toHaveText('Specify first point:');
  await expect(page.getByRole('textbox', { name: 'Text' })).toHaveCount(0);
  await expect.poll(() => values(page)).toEqual(['Next']);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
});
