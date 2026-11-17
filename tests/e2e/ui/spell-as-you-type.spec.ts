// M4-17: spell checking as you type in the in-place text editors, as a drafter types a sheet's
// notes: a word in neither dictionary is underlined once typed past, a right-click on it lists
// the bundled en_US dictionary's suggestions and picking one corrects it, Ignore All and Add to
// Dictionary take a word's underline away (the added word joining SPELL's custom dictionary),
// and the MTEXT toolbar's Spell Check button turns the check off and on. The word rules are
// unit-tested in apps/web/test/spell-check.test.ts; this checks that the editors, the spelling
// worker and the menu carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
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

/** The texts made in this test as they stand now, in the order made. */
const texts = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind === 'TEXT') out.push(g.value);
      else if (g.kind === 'MTEXT') out.push(g.contents);
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes())
      for (const a of cs.entities?.added ?? []) put(a.entity);
    return out;
  });

/** The words MTEXT's editor underlines (its CSS highlight's ranges). */
const highlighted = (page: Page) =>
  page.evaluate(() =>
    [...(CSS.highlights.get('triya-spelling') ?? [])].map((r) => (r as Range).toString()),
  );

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

test('TEXT underlines a misspelled word and a right-click corrects it', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000060', 'Specify height <2.5000>:');
  await type(page, '5', /Specify rotation angle of text/);
  await type(page, '', 'Enter text:');
  const line = page.getByRole('textbox', { name: 'Text' });
  await expect(line).toBeFocused();
  const underlined = page.locator('.text-line-spelling .spell-error');

  // The word being typed waits; typed past, it is underlined.
  await page.keyboard.type('SEE DIMENSON');
  await expect(underlined).toHaveCount(0);
  await page.keyboard.type(' NOTTE');
  await expect(underlined).toHaveText(['DIMENSON']);

  // The copy under the input takes no pointer events: the right-click lands on the input.
  const word = (await underlined.first().boundingBox())!;
  await page.mouse.click(word.x + word.width / 2, word.y + word.height / 2, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Spelling: DIMENSON' });
  await expect(menu.getByRole('menuitem', { name: 'DIMENSION', exact: true })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'DIMENSION', exact: true }).click();
  await expect(line).toHaveValue('SEE DIMENSION NOTTE');
  await expect(line).toBeFocused();
  // The caret left NOTTE: it is checked now.
  await expect(underlined).toHaveText(['NOTTE']);

  // From the keyboard: Shift+F10 with the caret in the word, then Ignore All.
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+F10');
  const notte = page.getByRole('menu', { name: 'Spelling: NOTTE' });
  await expect(notte).toBeVisible();
  // The menu takes the keys once it has focused its first item: an ArrowUp before then is lost.
  await expect(notte.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: 'Ignore All' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(underlined).toHaveCount(0);
  await expect(line).toBeFocused();

  await page.keyboard.press('Enter');
  await type(page, '', 'Command:');
  await expect.poll(() => texts(page)).toEqual(['SEE DIMENSION NOTTE']);
});

test('the spelling menu takes keys typed before its suggestions are in', async ({ page }) => {
  // A drafter's Shift+F10, Up, Enter comes faster than the spelling worker's suggestions
  // (found by M4-19's CI): the menu holds the focus from the moment it opens, so Up reaches
  // Ignore All instead of the text line, and the suggestions arriving later leave it there.
  test.setTimeout(120_000);
  await open(page);
  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000060', 'Specify height <2.5000>:');
  await type(page, '5', /Specify rotation angle of text/);
  await type(page, '', 'Enter text:');
  const line = page.getByRole('textbox', { name: 'Text' });
  await expect(line).toBeFocused();
  const underlined = page.locator('.text-line-spelling .spell-error');
  await page.keyboard.type('SEE NOTTE ');
  await expect(underlined).toHaveText(['NOTTE']);

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ArrowUp');
  const ignoreAll = page.getByRole('menuitem', { name: 'Ignore All' });
  await expect(ignoreAll).toBeFocused();
  // The suggestions come in under it.
  await expect(page.getByRole('menuitem', { name: 'NOTE', exact: true })).toBeVisible();
  await expect(ignoreAll).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(underlined).toHaveCount(0);
  await expect(line).toHaveValue('SEE NOTTE ');
  await expect(line).toBeFocused();
});

test('MTEXT underlines misspelled words, learns words and turns the check off', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  await type(page, 'MT', 'Specify first corner:');
  await type(
    page,
    '1000020,1000080',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '1000140,1000020', 'Enter text:');
  const editor = page.getByRole('textbox', { name: 'Multiline text' });
  await expect(editor).toBeFocused();

  await page.keyboard.type('Fire dooor to ');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Triya spec ');
  await expect.poll(() => highlighted(page)).toEqual(['dooor', 'Triya']);

  // A right-click on the first: its suggestions, one picked.
  const box = await page.evaluate(() => {
    const r = [...CSS.highlights.get('triya-spelling')!][0] as Range;
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Spelling: dooor' });
  await menu.getByRole('menuitem', { name: 'door', exact: true }).click();
  await expect(editor).toContainText('Fire door to');
  await expect.poll(() => highlighted(page)).toEqual(['Triya']);

  // Add to Dictionary from the keyboard: the word joins SPELL's custom dictionary.
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+ArrowLeft');
  await page.keyboard.press('Control+ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+F10');
  await page
    .getByRole('menu', { name: 'Spelling: Triya' })
    .getByRole('menuitem', { name: 'Add to Dictionary' })
    .click();
  await expect.poll(() => highlighted(page)).toEqual([]);

  // The Spell Check button turns the check off and on.
  const toolbar = page.getByRole('toolbar', { name: 'Text Formatting' });
  const spell = toolbar.getByRole('button', { name: 'Spell Check' });
  await expect(spell).toHaveAttribute('aria-pressed', 'true');
  await editor.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('wrng ');
  await expect.poll(() => highlighted(page)).toEqual(['wrng']);
  await spell.click();
  await expect(spell).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => highlighted(page)).toEqual([]);
  await spell.click();
  await expect.poll(() => highlighted(page)).toEqual(['wrng']);

  await page.keyboard.press('Control+Enter');
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(() => highlighted(page)).toEqual([]);
  await expect.poll(() => texts(page)).toEqual(['Fire door to \\PTriya spec wrng ']);

  // SPELL's Dictionaries dialog lists the word added in the editor.
  await type(page, 'SPELL', /Check Spelling/);
  await page.getByRole('button', { name: 'Dictionaries...' }).click();
  await expect(page.getByRole('dialog', { name: 'Dictionaries' })).toContainText('Triya');
});
