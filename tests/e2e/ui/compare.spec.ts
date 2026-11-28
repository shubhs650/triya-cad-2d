// M8-06: the Compare palette's scenario (PRD FR-Z3, DEC-092). One drawing is opened twice, as an
// original and its revision, and each is drawn on as it stands open (the compare reads open
// drawings with their unsaved edits): the original gets a line, a circle, a second line and a
// small circle; the revision the same line, the circle moved, the second line in red and a line
// where the small circle was. COMPARE opens the palette; Compare makes the compare drawing, a new
// tab, in which the list's rows zoom to the added (green), removed (red) and modified (amber, its
// previous version red) objects; the filters narrow the list and hide the rest of the drawing;
// Export DXF... saves it with its colours and Export PDF... plots them.
import { copyFileSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { pdfStrokeColors } from '../../../packages/testkit/src/pdf/read';
import {
  DOCKED_PALETTES,
  DXF,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
} from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Types each answer at the command line, waiting for `Command:` after the last. */
async function run(page: Page, ...answers: string[]): Promise<void> {
  for (const a of answers) await enterCommand(page, a);
  await expect(prompt(page)).toHaveText('Command:');
}

/** On the empty part of the plan the drawing tests use, 1,000,000 out. */
const at = (x: number, y: number) => `${1_000_000 + x},${1_000_000 + y}`;

/** Pixels of the canvas in the overlay's green (ACI 3), red (ACI 1) and amber (ACI 40). */
async function overlay(page: Page): Promise<{ green: number; red: number; amber: number }> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const out = { green: 0, red: 0, amber: 0 };
    // By hue, so that a line blended half into the dark canvas still counts.
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (g - Math.max(r, b) > 50) out.green++;
      else if (r - Math.max(g, b) > 50 && g < 0.45 * r) out.red++;
      else if (r > 100 && r - b > 50 && g > 0.55 * r && g < 0.9 * r) out.amber++;
    }
    return out;
  }, png);
}

test('compares an original with its revision: overlay, list, filters, export', async ({ page }) => {
  test.setTimeout(180_000);
  // Docked, the palette is beside the canvas, not over it.
  await page.setViewportSize(DOCKED_PALETTES);
  const original = test.info().outputPath('plan.dxf');
  const revision = test.info().outputPath('plan-rev-b.dxf');
  copyFileSync(DXF, original);
  copyFileSync(DXF, revision);
  await page.goto(app.url);
  await openWithPicker(page, original);
  await expectShown(page, 'plan.dxf');
  await gridOff(page);
  // New objects take the same handles in both, from the file's $HANDSEED, so they pair by handle.
  await run(page, 'LINE', at(0, 0), at(100, 0), '');
  await run(page, 'CIRCLE', at(50, 50), '10');
  await run(page, 'LINE', at(0, 100), at(100, 100), '');
  await run(page, 'CIRCLE', at(150, 50), '5');

  await openWithPicker(page, revision);
  await expectShown(page, 'plan-rev-b.dxf');
  await gridOff(page);
  await run(page, 'LINE', at(0, 0), at(100, 0), '');
  await run(page, 'CIRCLE', at(60, 50), '10');
  await run(page, 'CECOLOR', '1');
  await run(page, 'LINE', at(0, 100), at(100, 100), '');
  await run(page, 'CECOLOR', 'BYLAYER');
  await run(page, 'LINE', at(0, 150), at(100, 150), '');

  await enterCommand(page, 'COMPARE');
  const palette = page.getByRole('complementary', { name: 'Compare' });
  await expect(palette).toBeVisible();
  await expect(prompt(page)).toHaveText('Command:');
  // The revision is the drawing on screen until another is picked.
  await expect(palette.getByLabel('Revision:')).toHaveValue(/\d+/);
  await expect(palette.getByLabel('Revision:').locator('option:checked')).toHaveText(
    'plan-rev-b.dxf',
  );
  await palette.getByLabel('Original:').selectOption({ label: 'plan.dxf' });
  await palette.screenshot({ path: test.info().outputPath('1-compare-palette.png') });
  await palette.getByRole('button', { name: 'Compare', exact: true }).click();

  const name = 'Compare_plan_plan-rev-b.dxf';
  await expectShown(page, name);
  await expect(palette.locator('.compare-summary')).toContainText(
    `${name}: 1 added, 1 removed, 2 modified,`,
  );
  const list = palette.getByRole('table', { name: 'Differences' });
  const rows = list.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  // The revision picked stays picked with the compare drawing on screen.
  await expect(palette.getByLabel('Revision:').locator('option:checked')).toHaveText(
    'plan-rev-b.dxf',
  );
  await expect(rows.nth(0)).toContainText('Modified CIRCLE');
  await expect(rows.nth(0)).toContainText('Geometry');
  await expect(rows.nth(1)).toContainText('Modified LINE');
  await expect(rows.nth(1)).toContainText('Color');
  await expect(rows.nth(2)).toContainText('Removed CIRCLE');
  await expect(rows.nth(3)).toContainText('Added LINE');

  // Zoom to it: the compare drawing shows the moved circle amber, where it was red.
  await rows.nth(0).getByRole('button').click();
  await expectDrawn(page);
  await expect
    .poll(async () => (await overlay(page)).amber, { timeout: 15_000 })
    .toBeGreaterThan(50);
  expect((await overlay(page)).red).toBeGreaterThan(50);
  await page.screenshot({ path: test.info().outputPath('2-modified-circle.png') });
  await rows.nth(3).getByRole('button').click();
  await expect
    .poll(async () => (await overlay(page)).green, { timeout: 15_000 })
    .toBeGreaterThan(50);
  await rows.nth(2).getByRole('button').click();
  await expect.poll(async () => (await overlay(page)).red, { timeout: 15_000 }).toBeGreaterThan(20);

  // Only the additions and removals: the modified objects go from the list and the drawing.
  await palette.getByLabel('Modified').uncheck();
  await palette.getByLabel('Unchanged').uncheck();
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole('button').click();
  await expect
    .poll(async () => (await overlay(page)).green, { timeout: 15_000 })
    .toBeGreaterThan(50);
  await expect.poll(async () => (await overlay(page)).amber).toBe(0);
  await page.screenshot({ path: test.info().outputPath('3-filtered.png') });
  // By type: circles only.
  await palette.getByLabel('Type:').selectOption('CIRCLE');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('Removed CIRCLE');
  await palette.getByLabel('Type:').selectOption('');
  await palette.getByLabel('Modified').check();
  await palette.getByLabel('Unchanged').check();
  await expect(rows).toHaveCount(4);
  await run(page, 'ZOOM', 'W', at(-20, -20), at(180, 170));
  await expect
    .poll(async () => Object.values(await overlay(page)).every((n) => n > 50), { timeout: 15_000 })
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('4-overview.png') });

  // Export DXF...: the compare drawing saved (downloaded, without File System Access) as shown.
  await page.evaluate(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  const saving = page.waitForEvent('download');
  await palette.getByRole('button', { name: 'Export DXF...' }).click();
  const file = test.info().outputPath('compare.dxf');
  await (await saving).saveAs(file);
  const text = readFileSync(file, 'utf8');
  const colours = [...text.matchAll(/\r?\n *62\r?\n *(\d+)\r?\n/g)].map((m) => Number(m[1]));
  for (const aci of [1, 3, 8, 40]) expect(colours).toContain(aci);

  // Export PDF...: Save As PDF on the compare drawing, its colours plotted.
  await palette.getByRole('button', { name: 'Export PDF...' }).click();
  const d = page.getByRole('dialog', { name: 'Save As PDF' });
  await expect(d).toBeVisible();
  await d.getByLabel('Export').selectOption('extents');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Save' }).click(),
  ]);
  const strokes = await pdfStrokeColors(new Uint8Array(readFileSync((await download.path())!)));
  expect(strokes).toEqual(expect.arrayContaining(['#00ff00', '#ff0000', '#ffbf00']));
  await expect(prompt(page)).toHaveText('Command:');

  // COMPARECLOSE closes the palette; the View tab's Compare opens it again, the results kept.
  await run(page, 'COMPARECLOSE');
  await expect(palette).toBeHidden();
  await page.getByRole('tab', { name: 'View', exact: true }).click();
  await page.getByTestId('ribbon').getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(palette.getByRole('table', { name: 'Differences' }).locator('tbody tr')).toHaveCount(
    4,
  );
});
