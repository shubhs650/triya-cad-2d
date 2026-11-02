// M1-38 (with M1-37's drop): the user's font files. hatch_text_box_in_hole.dxf has an MTEXT in
// the Standard style, whose font is arial.ttf. Without it the text strokes with the bundled
// stand-in; once the user drops a TrueType file of that name, the text fills with it (the test
// font has only a few letters, so the rest fill as its .notdef box: white boxes over the
// magenta hatch behind the text, so far more ink weight than the stroked letters). The file
// stays on the device across a reload, and removing it in Settings brings the stand-in back.
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import { expectShown, inkWeight, openWithDrop, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DRAWING = path.join(CORPUS, 'ezdxf/examples_dxf/hatch_text_box_in_hole.dxf');
/** The ink weight the filled .notdef boxes add at least over the stroked stand-in. */
const FILLED = 400_000;

async function openDrawing(page: Page): Promise<number> {
  await openWithPicker(page, DRAWING);
  await expectShown(page, 'hatch_text_box_in_hole.dxf');
  return inkWeight(page);
}

test('a dropped TrueType file draws the style that names it, and stays after a reload', async ({
  page,
}) => {
  const font = test.info().outputPath('Arial.TTF');
  writeFileSync(font, fontBytes(testFont()));
  await page.goto(app.url);
  const standIn = await openDrawing(page);

  await openWithDrop(page, font);
  await expect(page.getByRole('status')).toHaveText(/Added TrueType font Arial\.TTF\./);
  await expect.poll(() => inkWeight(page), { timeout: 15_000 }).toBeGreaterThan(standIn + FILLED);

  await page.reload();
  await expect.poll(() => openDrawing(page), { timeout: 30_000 }).toBeGreaterThan(standIn + FILLED);

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('list', { name: 'Font files' })).toContainText('Arial.TTF');
  await settings.getByRole('button', { name: 'Remove Arial.TTF' }).click();
  await expect(settings.getByText('No font files added.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => inkWeight(page), { timeout: 15_000 }).toBeLessThan(standIn + FILLED / 4);
});

test('Settings adds font files with its picker and refuses a file that is not a font', async ({
  page,
}) => {
  const good = test.info().outputPath('arial.ttf');
  const bad = test.info().outputPath('notes.ttf');
  writeFileSync(good, fontBytes(testFont()));
  writeFileSync(bad, 'not a font');
  await page.goto(app.url);
  const standIn = await openDrawing(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByText('No font files added.')).toBeVisible();
  const pick = async (file: string) => {
    const chooser = page.waitForEvent('filechooser');
    await settings.getByRole('button', { name: 'Add font files…' }).click();
    await (await chooser).setFiles(file);
  };
  await pick(bad);
  await expect(settings.getByRole('alert')).toHaveText('notes.ttf is not a font Triya can read.');
  await pick(good);
  await expect(settings.getByRole('list', { name: 'Font files' })).toContainText('TrueType font');
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => inkWeight(page), { timeout: 15_000 }).toBeGreaterThan(standIn + FILLED);
});
