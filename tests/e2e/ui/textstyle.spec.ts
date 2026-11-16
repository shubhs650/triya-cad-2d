// M4-04 part 1: STYLE's Text Style dialog in the app. The acadsharp AC1032 sample has the text
// styles Standard (current), Annotative, custom_text_style and MyTextStyle, all TrueType, and a
// shape file's nameless one the list leaves out. A TEXT is placed in Standard; ST opens the
// dialog on it. MyTextStyle is made Bold with Apply; New... makes style1 from the fields shown,
// given romans.shx (Font Style greys, Use Big Font and Vertical wake), Set Current makes it
// current and F2 renames it; Standard's font is changed to italicc.shx and Close asks to save the change, Yes
// applying it before the dialog closes, which redraws the TEXT. -STYLE's `?` lists what was
// written, the shortcut menu's Delete refuses Standard, and U takes everything back as one step.
// What each action writes is unit-tested in packages/engine/test/commands/textstyle.test.ts.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { activeCanvas, enterCommand, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const FILE = path.join(CORPUS, 'acadsharp/sample_AC1032_ascii.dxf');
const O = 1e6;

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const p = (x: number, y: number) => `${O + x},${O + y}`;

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (!dir) return;
  await page.addStyleTag({ content: '.nav-bar { display: none !important; }' });
  // The canvas draws on the next frames.
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test('the Text Style dialog applies, makes, renames and deletes text styles', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, p(-2, -4), 'Specify opposite corner:');
  await type(page, p(24, 8), 'Command:');
  await type(page, 'TEXT', /^Specify start point of text/);
  await type(page, p(0, 0), /^Specify height/);
  await type(page, '2', /^Specify rotation angle of text/);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Triya 2D');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await shot(page, '1-before');

  await enterCommand(page, 'ST');
  const dialog = page.getByRole('dialog', { name: 'Text Style' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('textstyle-current')).toHaveText('Standard');
  const list = dialog.getByRole('listbox', { name: 'Styles:' });
  await expect(list.getByRole('option')).toHaveText([
    /Annotative/,
    'custom_text_style',
    'MyTextStyle',
    /Standard/,
  ]);
  await expect(list.getByRole('option', { name: /Standard/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const font = dialog.getByLabel('Font Name:');
  await expect(font).toHaveValue('arial.ttf');
  await expect(dialog.getByLabel('Font Style:')).toBeEnabled();
  await expect(dialog.getByLabel('Use Big Font')).toBeDisabled();
  await expect(dialog.getByLabel('Vertical')).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: 'Annotative' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await shot(page, '2-dialog');

  // MyTextStyle made Bold, 0.8 wide: Apply.
  await list.getByRole('option', { name: 'MyTextStyle' }).click();
  await dialog.getByLabel('Font Style:').selectOption('Bold');
  await dialog.getByLabel('Width Factor:').fill('0.8');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await expect(list.getByRole('option', { name: 'MyTextStyle' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByLabel('Font Style:')).toHaveValue('Bold');
  await expect(dialog.getByLabel('Width Factor:')).toHaveValue('0.8');

  // New...: style1 from the fields shown, then an SHX font, Set Current, and F2.
  await dialog.getByRole('button', { name: 'New...' }).click();
  const named = page.getByRole('dialog', { name: 'New Text Style' });
  await expect(named.getByLabel('Style Name:')).toHaveValue('style1');
  await named.getByRole('button', { name: 'OK' }).click();
  await expect(list.getByRole('option', { name: 'style1' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(dialog.getByLabel('Font Style:')).toHaveValue('Bold');
  await font.selectOption('romans.shx');
  await expect(dialog.getByLabel('Font Style:')).toBeDisabled();
  await expect(dialog.getByLabel('Use Big Font')).toBeEnabled();
  await expect(dialog.getByLabel('Vertical')).toBeEnabled();
  await dialog.getByLabel('Height:').fill('0');
  await dialog.getByLabel('Width Factor:').fill('0');
  await expect(dialog.getByRole('status')).toHaveText('Width factor must be between 0.01 and 100.');
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await dialog.getByLabel('Width Factor:').fill('1');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(font).toHaveValue('romans.shx');
  await dialog.getByRole('button', { name: 'Set Current' }).click();
  await expect(dialog.getByTestId('textstyle-current')).toHaveText('style1');
  await list.press('F2');
  const rename = list.getByRole('textbox', { name: 'New name' });
  await rename.fill('Notes');
  await rename.press('Enter');
  await expect(dialog.getByTestId('textstyle-current')).toHaveText('Notes');

  // Standard's font changed, then Close: the question, and Yes applies before closing.
  await list.getByRole('option', { name: /Standard/ }).click();
  await font.selectOption('italicc.shx');
  await dialog.getByLabel('Oblique Angle:').fill('15');
  await shot(page, '3-standard-modified');
  await dialog.getByRole('button', { name: 'Close' }).click();
  const save = page.getByRole('dialog', { name: 'Text Style - Apply Changes' });
  await expect(save).toContainText('The current style has been modified.');
  await save.getByRole('button', { name: 'Yes' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await shot(page, '4-after');

  await type(page, '-STYLE', 'Enter name of text style or [?] <Notes>:');
  await type(page, '?', 'Enter text style(s) to list <*>:');
  await type(page, 'Standard', 'Enter name of text style or [?] <Notes>:');
  const history = page.getByRole('log', { name: 'Recent command lines' });
  await expect(history).toContainText('Obliquing angle: 15');
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // Standard cannot be deleted; Esc closes, U takes everything back.
  await enterCommand(page, 'STYLE');
  await expect(dialog.getByTestId('textstyle-current')).toHaveText('Notes');
  await list.getByRole('option', { name: /Standard/ }).click();
  await expect(font).toHaveValue('italicc.shx');
  await expect(dialog.getByLabel('Oblique Angle:')).toHaveValue('15');
  await list.getByRole('option', { name: /Standard/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Standard cannot be deleted.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await type(page, 'U', 'Command:');
  await enterCommand(page, 'STYLE');
  await expect(dialog.getByTestId('textstyle-current')).toHaveText('Standard');
  await expect(list.getByRole('option', { name: 'Notes' })).toHaveCount(0);
  await expect(font).toHaveValue('arial.ttf');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
