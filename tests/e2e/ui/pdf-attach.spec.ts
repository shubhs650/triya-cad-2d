// M5-04 part 8: PDFATTACH and its Attach PDF Underlay dialog, on the PDF underlay test drawing
// (packages/testkit/src/underlay/fixture.ts, unitless: a unit is the page's inch), its PDF not
// supplied: the dialog lists the drawing's PDF but no pages until Browse... picks the file, whose
// two pages it lists with their sizes; OK with page 1 asks the insertion point and the page draws
// there at once (its red square at 1-3 in); U takes it back. The References palette's Attach
// PDF... opens the same dialog, which now lists the supplied file's pages. The engine side is
// unit-tested in packages/engine/test/commands/pdf-attach.test.ts and the save in
// packages/testkit/src/underlay/pdf-attach.test.ts. SHOTS=<dir> saves the PR's screenshots.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { colourAt, expectShown, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/underlay');
const DXF = path.join(FIXTURES, 'pdf-underlay.dxf');
const PDF = path.join(FIXTURES, 'pdf-underlay.pdf');
const SHOTS = process.env['SHOTS'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Off the canvas, so Dynamic Input does not take the next point typed as relative. */
const park = (page: Page) => page.mouse.move(640, 708);

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await park(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

type Rgb = readonly number[];
const isRed = ([r, g, b]: Rgb) => r! > 200 && g! < 60 && b! < 60;
/** Not red: the canvas, or the page's paper left clear. */
const notRed = (c: Rgb) => !isRed(c);

test('PDFATTACH attaches a picked PDF page through the Attach PDF Underlay dialog', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, 'pdf-underlay.dxf');
  // The drawing's pages and the space right of them, where the new page goes.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'W', /^Specify first corner/);
  await type(page, '-2,-2', /^Specify opposite corner/);
  await type(page, '42,14', 'Command:');
  const v = await viewOf(page);
  const colour = (x: number, y: number) => colourAt(page, v.at(x, y));
  const poll = (x: number, y: number, ok: (c: Rgb) => boolean) =>
    expect.poll(async () => ok(await colour(x, y)), { timeout: 30_000 }).toBe(true);
  await poll(32, 2, notRed);

  await page.keyboard.type('PDFATTACH');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Attach PDF Underlay' });
  await expect(dialog).toBeVisible();
  // The drawing's PDF is listed, its pages unknown until the file is picked; OK waits.
  const name = dialog.getByLabel('Name:');
  await expect(name.locator('option')).toHaveText(['pdf-underlay']);
  const pages = dialog.getByLabel('Select one or more pages:');
  await expect(dialog.getByText(/was not found: Browse\.\.\. to it/)).toBeVisible();
  await expect(pages.locator('option')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Browse...' }).click();
  await (await chooser).setFiles(PDF);
  await expect(pages.locator('option')).toHaveText(['Page 1 (8.5 x 11)', 'Page 2 (11 x 8.5)']);
  await expect(pages).toHaveValues(['1']);
  await expect(dialog.getByLabel('Path type:')).toHaveValue('none');
  await dialog.getByRole('button', { name: 'Show Details' }).click();
  await expect(dialog.getByTestId('pdf-attach-found')).toHaveText('Picked this session');
  await expect(dialog.getByTestId('pdf-attach-path')).toHaveText('pdf-underlay.pdf');
  await shot(page, '1-attach-pdf-dialog');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify insertion point:');
  await park(page);
  await type(page, '30,0', 'Command:');

  // Page 1 at 30,0, scale 1: its red square at (31, 1)–(33, 3).
  await poll(32, 2, isRed);
  await shot(page, '2-attached');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // One undo step.
  await type(page, 'U', 'Command:');
  await poll(32, 2, notRed);

  // The References palette's Attach PDF... opens the dialog too, the supplied file's pages listed.
  await type(page, 'XREF', 'Command:');
  await page.getByRole('button', { name: 'Attach PDF...' }).click();
  await expect(dialog).toBeVisible();
  await expect(pages.locator('option')).toHaveCount(2);
  await pages.selectOption(['1', '2']);
  await shot(page, '3-references-attach-pdf-two-pages');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});
