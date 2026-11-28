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
  // TrueType fonts draw with the bundled default stand-in (M1-72).
  await expect(fontRows.getByRole('row', { name: /arial\.ttf/ })).toContainText('oet-simplex');

  const refs = palette.getByRole('group', { name: /^References/ });
  await expect(refs).toContainText('.\\image.JPG');
  await expect(refs).toContainText('..\\pdf-definition.pdf');
  // Looked for as the References palette looks (M8-07 part 2): neither file was given.
  await expect(refs).toContainText('Not found');
  await expect(refs.locator('summary')).toHaveText('References (2)');

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

  // References... shows the References palette, where the files are given.
  await refs.getByRole('button', { name: 'References…' }).click();
  await expect(page.getByRole('complementary', { name: 'References' })).toBeVisible();
});

test('follows the drawing on screen and is keyboard operable', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as { longTasks?: number[] };
    w.longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.longTasks!.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
  await open(page, DWG);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await rail(page).focus();
  await page.keyboard.press('Enter');
  const palette = page.getByRole('complementary', { name: 'Health' });
  await expect(palette.getByRole('group', { name: 'Drawing' })).toContainText(
    'AutoCAD 2013 (AC1027)',
  );
  // M2-63: the switch updates the palette without freezing the page. It took one 7–8 s task
  // when the chrome's props held the file's bytes (React's dev prop logging walked each byte).
  await page.evaluate(() => void ((window as { longTasks?: number[] }).longTasks = []));
  await page.getByRole('tab', { name: path.basename(DWG) }).click();
  await expect(palette.getByRole('group', { name: 'Drawing' })).toContainText('AC1018');
  const longTasks = await page.evaluate(
    () =>
      new Promise<number[]>((done) =>
        setTimeout(() => done((window as { longTasks?: number[] }).longTasks!), 500),
      ),
  );
  expect(Math.max(0, ...longTasks)).toBeLessThan(200);

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
