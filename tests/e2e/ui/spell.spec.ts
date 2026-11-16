// M4-09 part 4: SPELL's Check Spelling dialog in the app, as a drafter checks a sheet's notes:
// Select text objects limits the check, Start finds a word with the bundled en_US dictionary
// and suggests the right one, Change All corrects it everywhere, Add to Dictionary keeps a
// word in the user's custom dictionary (shown in Dictionaries...), and Settings... chooses what
// is ignored. The word rules are unit-tested in packages/engine/test/edit/spelling.test.ts and
// the scenarios in packages/engine/test/commands/spell.test.ts; this checks that the dialog, the
// dictionary in the engine worker and the canvas carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import { DXF, expectDrawn, expectShown, openWithPicker } from '../app/page';
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

/** The texts made in this test as they stand now, in the order made. */
const texts = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, string>();
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind === 'TEXT') out.set(e.handle, g.value);
      else if (g.kind === 'MTEXT') out.set(e.handle, g.contents);
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) if (out.has(u.after.handle)) put(u.after);
    }
    return [...out.values()];
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Check Spelling finds, corrects and learns words', async ({ page }) => {
  test.setTimeout(120_000);
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
  await page.mouse.move(20, 400);

  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000080', 'Specify height <2.5000>:');
  await type(page, '5', /Specify rotation angle of text/);
  await type(page, '', 'Enter text:');
  await type(page, 'FIRE DOOOR', 'Enter text:');
  await type(page, 'SEE NOTT', 'Enter text:');
  await type(page, '', 'Command:');
  await type(page, '-MTEXT', 'Specify first corner:');
  await type(
    page,
    '#1000020,1000040',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '#1000140,1000010', 'Enter text:');
  await type(page, '{\\LDOOOR} FRAME', 'Enter text:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  await type(page, 'SPELL', /Check Spelling/);
  const dialog = page.getByRole('dialog', { name: 'Check Spelling' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Where to check:')).toHaveValue('drawing');
  await expect(dialog.getByLabel('Main dictionary:')).toHaveValue('American English');
  // Only the notes made here: a window around them.
  await dialog.getByRole('button', { name: 'Select text objects' }).click();
  await expect(prompt(page)).toHaveText('Select objects:');
  await type(page, 'W', 'Specify first corner:');
  await type(page, '#1000000,1000000', 'Specify opposite corner:');
  await type(page, '#1000160,1000100', /Select objects:/);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Where to check:')).toHaveValue('selection');

  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog.getByLabel('Not in dictionary:')).toHaveValue('DOOOR');
  await expect(dialog.getByLabel('Suggestion list')).toContainText('DOOR');
  await dialog.getByLabel('Suggestions:', { exact: true }).fill('DOOR');
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('1-not-in-dictionary.png') });

  await dialog.getByRole('button', { name: 'Change All' }).click();
  await expect(dialog.getByLabel('Not in dictionary:')).toHaveValue('NOTT');
  await expect.poll(() => texts(page)).toEqual(['FIRE DOOR', 'SEE NOTT', '{\\LDOOR} FRAME']);
  await dialog.getByRole('button', { name: 'Add to Dictionary' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Spelling check complete.');
  await page.screenshot({ path: test.info().outputPath('2-complete.png') });

  // The word added is in the custom dictionary.
  await dialog.getByRole('button', { name: 'Dictionaries...' }).click();
  const dictionaries = page.getByRole('dialog', { name: 'Dictionaries' });
  await expect(dictionaries.getByLabel('Custom dictionary words')).toContainText('NOTT');
  // A word added here, deleted, and a word list imported.
  await dictionaries.getByLabel('Content:').fill('TRIYA');
  await dictionaries.getByRole('button', { name: 'Add', exact: true }).click();
  const list = dictionaries.getByLabel('Custom dictionary words');
  await expect(list).toContainText('TRIYA');
  await list.selectOption('TRIYA');
  await dictionaries.getByRole('button', { name: 'Delete' }).click();
  await expect(list).not.toContainText('TRIYA');
  await dictionaries.getByLabel('Import words').setInputFiles({
    name: 'words.cus',
    mimeType: 'text/plain',
    buffer: Buffer.from('ASTM\nANSI\n'),
  });
  await expect(list).toContainText('ASTM');
  await page.screenshot({ path: test.info().outputPath('3-dictionaries.png') });
  await dictionaries.getByRole('button', { name: 'Close' }).click();
  await expect(dictionaries).toBeHidden();

  // Undo takes back Add to Dictionary: NOTT is shown again.
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(dialog.getByLabel('Not in dictionary:')).toHaveValue('NOTT');

  // Settings: words in uppercase ignored, the check finds nothing.
  await dialog.getByRole('button', { name: 'Settings...' }).click();
  const settings = page.getByRole('dialog', { name: 'Check Spelling Settings' });
  await expect(settings.getByLabel('Dimension text')).toBeChecked();
  await settings.getByLabel('Ignore words in uppercase').check();
  await page.screenshot({ path: test.info().outputPath('4-settings.png') });
  await settings.getByRole('button', { name: 'OK' }).click();
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Spelling check complete.');

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  // SPELL is one command: one U takes back every change it made.
  await type(page, 'U', 'Command:');
  await expect.poll(() => texts(page)).toEqual(['FIRE DOOOR', 'SEE NOTT', '{\\LDOOOR} FRAME']);
});
