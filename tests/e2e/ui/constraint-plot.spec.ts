// M9-03 part 8: annotational constraints plot, dynamic ones do not, and CCONSTRAINTFORM is the
// Form new constraints take. On a part of the plan two lines are drawn (the metric drawing's
// DIMVARs size an annotational constraint's text and arrows 2.5 units); SETVAR
// CCONSTRAINTFORM 1 makes DCALIGNED's constraint on the first line annotational, DIMCONSTRAINT's
// Form back to Dynamic sets CCONSTRAINTFORM 0 and the second line's constraint is dynamic. The
// plot preview (monochrome, the display) inks the annotational constraint and not the dynamic
// one. Parts are unit-tested in packages/render/test/plot/job.test.ts and the Form in
// packages/engine/test/commands/dimensional-constraints.test.ts; this checks the app's variable,
// the worker's plot and the preview.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { DXF, expectDrawn, expectShown, gridOff, openWithPicker, viewOf } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Plot - / });
const preview = (page: Page) => page.getByRole('region', { name: /^Plot preview - / });
const sheet = (page: Page) => page.getByTestId('plot-preview-canvas');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * The plot preview of the display, monochrome: the dark pixels it draws on the sheet, after
 * `shot` (a screenshot's name, or none), then back to the drawing.
 */
async function previewInk(page: Page, shot?: (name: string) => Promise<void>, name = '') {
  // PLOT typed, not a click on the canvas first: a click on an empty part starts a selection window.
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.type('PLOT');
  await page.keyboard.press('Enter');
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText('Plot - Model');
  await d.getByLabel('Paper size').selectOption('ISO A4');
  await d.getByLabel('What to plot').selectOption('display');
  await d.getByLabel('Plot style table').selectOption('triya-monochrome.ctb');
  await d.getByLabel('Fit to paper').check();
  await d.getByLabel('Center the plot').check();
  await d.getByRole('button', { name: 'Preview…' }).click();
  const canvas = sheet(page);
  await expect(canvas).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
  const [x, y, width, height] = (await canvas.getAttribute('data-raster'))!.split(' ').map(Number);
  // Read through a copy: the preview's own canvas may not keep a 2D context to read.
  const dark = await canvas.evaluate(
    async (c: HTMLCanvasElement, r) => {
      const img = new Image();
      img.src = c.toDataURL('image/png');
      await img.decode();
      const copy = document.createElement('canvas');
      copy.width = img.width;
      copy.height = img.height;
      const ctx = copy.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(r.x, r.y, r.width, r.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! < 600) n++;
      return n;
    },
    { x: x!, y: y!, width: width!, height: height! },
  );
  if (shot) await shot(name);
  await preview(page).getByRole('button', { name: 'Close Preview Window' }).click();
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  return dark;
}

test('an annotational constraint plots, a dynamic one does not; CCONSTRAINTFORM sets the Form', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), two lines 60 long.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  for (const y of [30, 70]) {
    await type(page, 'L', 'Specify first point:');
    await type(page, `1000020,10000${y}`, 'Specify next point or [Undo]:');
    await type(page, `1000080,10000${y}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });
  const view = await viewOf(page);
  const click = async (x: number, y: number) => {
    const p = view.at(1000000 + x, 1000000 + y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  const lines = await previewInk(page, shot, '0-lines-preview.png');
  expect(lines).toBeGreaterThan(0);

  // CCONSTRAINTFORM 1: DCALIGNED's constraint on the lower line is annotational.
  await type(page, 'CCONSTRAINTFORM', /^Enter new value for CCONSTRAINTFORM <0>:/);
  await type(page, '1', 'Command:');
  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 30);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 45);
  await expect(prompt(page)).toHaveText('Dimension text <d1=60.0000>:');
  await type(page, '', 'Command:');

  // DIMCONSTRAINT's Form says Annotational, and Dynamic sets CCONSTRAINTFORM 0.
  await type(page, 'DIMCONSTRAINT', /^Select associative dimension to convert or/);
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Current settings: Constraint Form = Annotational',
  );
  await type(page, 'F', 'Enter constraint form [Annotational/Dynamic] <Annotational>:');
  await type(page, 'D', /^Select associative dimension to convert or/);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');
  await type(page, 'CCONSTRAINTFORM', /^Enter new value for CCONSTRAINTFORM <0>:/);
  await page.keyboard.press('Escape');
  await expect(prompt(page)).toHaveText('Command:');

  // The upper line's constraint is dynamic.
  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 70);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 85);
  await expect(prompt(page)).toHaveText('Dimension text <d2=60.0000>:');
  await type(page, '', 'Command:');
  await page.mouse.move(view.box.x + 40, view.box.y + view.box.height - 40);
  await shot('1-annotational-and-dynamic.png');

  // The preview inks the annotational constraint (its lines, arrows and `d1=60.0000`) only.
  const plotted = await previewInk(page, shot, '2-plot-preview.png');
  expect(plotted).toBeGreaterThan(lines + 50);

  // With the annotational constraint undone (U twice: the dynamic one, then it), only the dynamic
  // one is left and the preview inks the lines alone.
  await type(page, 'U', 'Command:');
  await type(page, 'U', 'Command:');
  await type(page, 'DCALIGNED', /^Specify first constraint point or/);
  await type(page, '', 'Select object:');
  await click(50, 70);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(50, 85);
  await expect(prompt(page)).toHaveText('Dimension text <d1=60.0000>:');
  await type(page, '', 'Command:');
  expect(await previewInk(page)).toBe(lines);
});
