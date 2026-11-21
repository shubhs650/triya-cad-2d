// M6-07: the Layer Properties Manager's Plot Style and VP Plot Style columns. named-plot-styles.dxf
// (packages/testkit/fixtures/plot-styles, scripts/fixtures/named-plot-styles.py) plots by named
// plot styles: WALLS by Heavy, PIPING by Normal and by Light in Layout1's right viewport. Plot Style
// opens Select Plot Style to set a layer's plot style; with the left viewport made current, VP Plot
// Style overrides PIPING's there, marked, and the right viewport shows the file's own override. A
// colour-dependent drawing shows the colour's plot style, greyed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { activeCanvas, expectDrawn, expectShown, openWithPicker, viewOf } from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = fileURLToPath(
  new URL('../../../packages/testkit/fixtures/plot-styles/named-plot-styles.dxf', import.meta.url),
);
const COLOR_DEPENDENT = path.join(CORPUS, '../self-authored/viewport-overrides.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

async function openLayers(page: Page, file: string) {
  await page.goto(app.url);
  await openWithPicker(page, file);
  await expectShown(page, path.basename(file));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  const table = palette.getByRole('table', { name: 'Layers of the drawing' });
  const row = (name: string) =>
    table.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
  return { palette, row };
}

test('Plot Style and VP Plot Style set and override named plot styles (M6-07)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { palette, row } = await openLayers(page, FILE);
  const plotStyle = (name: string) =>
    palette.getByRole('button', { name: `Plot Style ${name}`, exact: true });
  await expect(
    palette.getByRole('columnheader', { name: 'Plot Style', exact: true }),
  ).toBeVisible();
  await expect(plotStyle('WALLS')).toHaveText('Heavy');
  await expect(plotStyle('PIPING')).toHaveText('Normal');

  // Plot Style: Select Plot Style lists the drawing's plot styles, Normal first.
  await plotStyle('PIPING').click();
  const dialog = page.getByRole('dialog', { name: 'Select Plot Style' });
  const list = dialog.getByRole('listbox', { name: 'Plot styles' });
  await expect(list.getByRole('option')).toHaveText(['Normal', 'Heavy', 'Light']);
  await expect(dialog).toContainText('Original: Normal');
  await list.selectOption({ label: 'Heavy' });
  await expect(dialog).toContainText('New: Heavy');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(plotStyle('PIPING')).toHaveText('Heavy');
  await page.screenshot({ path: test.info().outputPath('plot-style.png') });

  // Layout1: in paper space VP Plot Style is empty.
  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab', { name: 'Layout1' })
    .click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
  await expectDrawn(page, { timeout: 15_000 });
  await expect(palette.getByRole('columnheader', { name: 'VP Plot Style' })).toBeVisible();
  await expect(row('PIPING').locator('td.vpPlotStyle')).toHaveText('—');

  // The left viewport made current (centre 110,150 on the sheet): PIPING plots by its own Heavy.
  const view = await viewOf(page);
  const left = view.at(110, 150);
  await page.mouse.dblclick(view.box.x + left.x, view.box.y + left.y);
  await expect(activeCanvas(page)).not.toHaveAttribute('data-viewport', '');
  const vpPlotStyle = palette.getByRole('button', { name: 'VP Plot Style PIPING' });
  await expect(vpPlotStyle).toHaveText('Heavy');
  await expect(row('PIPING').locator('td.vpPlotStyle')).not.toHaveClass(/vp-overridden/);

  // VP Plot Style: Light in this viewport only, marked; the layer keeps Heavy.
  await vpPlotStyle.click();
  await expect(dialog).toContainText('Original: Heavy');
  await dialog.getByRole('listbox', { name: 'Plot styles' }).selectOption({ label: 'Light' });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(vpPlotStyle).toHaveText('Light');
  await expect(row('PIPING').locator('td.vpPlotStyle')).toHaveClass(/vp-overridden/);
  await expect(plotStyle('PIPING')).toHaveText('Heavy');
  await vpPlotStyle.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('vp-plot-style.png') });

  // Set back to the layer's own, the override goes.
  await vpPlotStyle.click();
  await dialog.getByRole('listbox', { name: 'Plot styles' }).selectOption({ label: 'Heavy' });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(row('PIPING').locator('td.vpPlotStyle')).not.toHaveClass(/vp-overridden/);

  // A click in the right viewport makes it current: the file's own override, Light, marked.
  const right = view.at(310, 150);
  await page.mouse.click(view.box.x + right.x, view.box.y + right.y);
  await expect(vpPlotStyle).toHaveText('Light');
  await expect(row('PIPING').locator('td.vpPlotStyle')).toHaveClass(/vp-overridden/);
  await expect(palette.getByRole('button', { name: 'VP Plot Style WALLS' })).toHaveText('Heavy');
});

test("a colour-dependent drawing shows the colour's plot style, greyed (M6-07)", async ({
  page,
}) => {
  const { palette } = await openLayers(page, COLOR_DEPENDENT);
  const walls = palette.getByRole('button', { name: 'Plot Style WALLS', exact: true });
  await expect(walls).toHaveText('Color_1');
  await expect(walls).toBeDisabled();
  await expect(palette.getByRole('button', { name: 'Plot Style PIPING', exact: true })).toHaveText(
    'Color_5',
  );
});
