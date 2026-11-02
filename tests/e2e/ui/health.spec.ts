// M1-70: the Health palette shows the drawing health report (M1-25) of the drawing on screen.
// sample_AC1018.dwg is an AutoCAD 2004 drawing in millimetres whose styles name TrueType fonts
// and two shape files, that attaches an image and a PDF, and that holds objects and entities
// Triya keeps without drawing (3D solids, meshes, table internals).
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DWG, DXF, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

async function open(page: Page, file: string) {
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
}

/** A card's summary count is the sum of its table's last column, and not zero. */
async function expectTotal(card: Locator) {
  const total = Number(/\((\d+)\)/.exec(await card.locator('summary').innerText())?.[1]);
  const counts = await card.locator('tbody tr td:last-child').allInnerTexts();
  expect(total).toBeGreaterThan(0);
  expect(counts.reduce((n, c) => n + Number(c), 0)).toBe(total);
}

const rail = (page: Page) =>
  page.getByRole('navigation', { name: 'Palettes' }).getByRole('button', { name: 'Health' });

test('lists the version, units, missing fonts, references and unknown objects', async ({
  page,
}) => {
  await open(page, DWG);
  await rail(page).click();
  const palette = page.getByRole('complementary', { name: 'Health' });
  await expect(palette).toBeVisible();

  const drawing = palette.getByRole('group', { name: 'Drawing' });
  await expect(drawing).toContainText('AutoCAD 2004 (AC1018)');
  await expect(drawing).toContainText('Inches');

  const fonts = palette.getByRole('group', { name: /^Missing fonts/ });
  const fontRows = fonts.getByRole('table', { name: 'Missing fonts' });
  await expect(fontRows.getByRole('rowheader', { name: 'consola.ttf' })).toBeVisible();
  await expect(fontRows.getByRole('row', { name: /ltypeshp\.shx/ })).toContainText('Not drawn');
  await expect(fontRows.getByRole('row', { name: /arial\.ttf/ })).toContainText('Standard');

  const refs = palette.getByRole('group', { name: /^References/ });
  await expect(refs).toContainText('.\\image.JPG');
  await expect(refs).toContainText('..\\pdf-definition.pdf');
  await expect(refs).toContainText('Not checked');

  // The totals move as acad-ts reads more of the file, so check they add up, not their value.
  const unknown = palette.getByRole('group', { name: /^Unknown objects/ });
  await expect(unknown).toContainText('TABLECONTENT');
  await expectTotal(unknown);

  const notDrawn = palette.getByRole('group', { name: /^Entities not drawn/ });
  await expect(notDrawn).toContainText('3DSOLID');
  await expectTotal(notDrawn);

  await expect(palette.getByRole('group', { name: /^Missing hatch patterns/ })).toContainText(
    'None',
  );
});

test('follows the drawing on screen and is keyboard operable', async ({ page }) => {
  await open(page, DWG);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await rail(page).focus();
  await page.keyboard.press('Enter');
  const palette = page.getByRole('complementary', { name: 'Health' });
  await expect(palette.getByRole('group', { name: 'Drawing' })).toContainText(
    'AutoCAD 2013 (AC1027)',
  );
  await page.getByRole('tab', { name: path.basename(DWG) }).click();
  await expect(palette.getByRole('group', { name: 'Drawing' })).toContainText('AC1018');

  // Each section folds from the keyboard.
  const summary = palette.getByRole('group', { name: /^Unknown objects/ }).locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(palette.getByRole('group', { name: /^Unknown objects/ })).not.toHaveAttribute(
    'open',
    '',
  );
  await page.keyboard.press('Enter');
  await expect(palette.getByRole('group', { name: /^Unknown objects/ })).toHaveAttribute(
    'open',
    '',
  );

  await palette.getByRole('button', { name: 'Close Health' }).press('Enter');
  await expect(palette).toBeHidden();
  await expect(rail(page)).toHaveAttribute('aria-expanded', 'false');
});
