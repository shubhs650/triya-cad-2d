// M9-03 part 13: dimensional constraints in a layout's viewports. sample_AC1018.dwg's MyLayout
// has one floating viewport showing model space on most of the sheet. Worked in through it
// (a double click), two lines are drawn and DCALIGNED puts a dynamic constraint on the upper
// one: it shows, in the constraint blue, while the viewport is current and not in paper space
// (AutoCAD keeps dynamic constraints for editing and never plots them). CCONSTRAINTFORM 1 makes
// the lower line's constraint annotational: it shows through the viewport in paper space too,
// and the layout's plot preview inks it. Drawing, picks and plot parts are unit-tested in
// packages/render/test/canvas2d-viewport-constraints.test.ts and
// packages/render/test/plot/job.test.ts; this checks the app, the worker and the preview.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectInputsRead,
  expectShown,
  openWithPicker,
  worldAt,
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
/** The viewport the canvas works in (its handle), '' in paper space. */
const viewport = (page: Page) => activeCanvas(page).getAttribute('data-viewport');
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Plot - / });
const preview = (page: Page) => page.getByRole('region', { name: /^Plot preview - / });

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Pixels in `r` (CSS pixels of the active canvas) that are the constraints' blue (`blue`), or
 * dark ink on the paper (otherwise).
 */
async function pixels(page: Page, r: Rect, blue: boolean): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, r, blue }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(r.x, r.y, r.w, r.h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [red, green, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
        if (blue ? b > 150 && b - red > 70 && green > red : red + green + b < 300) n++;
      }
      return n;
    },
    { b64: png, r, blue },
  );
}

/** The layout's plot preview, monochrome: the dark pixels it draws on the sheet. */
async function previewInk(page: Page, shot?: () => Promise<void>): Promise<number> {
  await expect(prompt(page)).toHaveText('Command:');
  await enterCommand(page, 'PLOT');
  const d = dialog(page);
  await expect(d.getByRole('heading')).toHaveText('Plot - MyLayout');
  await expect(d.getByLabel('What to plot')).toHaveValue('layout');
  await d.getByLabel('Plot style table').selectOption('triya-monochrome.ctb');
  await d.getByRole('button', { name: 'Preview…' }).click();
  const canvas = page.getByTestId('plot-preview-canvas');
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
      const px = ctx.getImageData(r.x, r.y, r.width, r.height).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i]! + px[i + 1]! + px[i + 2]! < 600) n++;
      return n;
    },
    { x: x!, y: y!, width: width!, height: height! },
  );
  if (shot) await shot();
  await preview(page).getByRole('button', { name: 'Close Preview Window' }).click();
  await expect(d).toBeVisible();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  return dark;
}

test("constraints show through a layout's viewport: dynamic while it is current, annotational always and plotted", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) => {
    await page.screenshot({ path: shots ? path.join(shots, name) : test.info().outputPath(name) });
  };
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  await tabs.nth(3).click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout MyLayout');
  await expectDrawn(page, { timeout: 15_000 });

  // Into the viewport: model space's coordinates at a point inside its frame, and its unit.
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = { x: Math.round(box.width * 0.3), y: Math.round(box.height * 0.4) };
  await page.mouse.dblclick(box.x + at.x, box.y + at.y);
  await expect.poll(() => viewport(page)).not.toBe('');
  await page.mouse.move(box.x + at.x + 20, box.y + at.y + 20);
  const origin = await worldAt(page, at.x, at.y);
  const right = await worldAt(page, at.x + 100, at.y);
  const unit = (right.x - origin.x) / 100;
  expect(unit).toBeGreaterThan(0);
  /** Model point `dx`, `dy` CSS pixels right and down of `at`. */
  const model = (dx: number, dy: number) => `${origin.x + dx * unit},${origin.y - dy * unit}`;
  const click = (dx: number, dy: number) => page.mouse.click(box.x + at.x + dx, box.y + at.y + dy);

  // Two lines 160 px long, 120 px apart.
  for (const dy of [0, 120]) {
    await enterCommand(page, 'LINE');
    await enterCommand(page, model(0, dy));
    await enterCommand(page, model(160, dy));
    await enterCommand(page, '');
    await expectInputsRead(page);
  }
  await expect(prompt(page)).toHaveText('Command:');
  /** Where a constraint 40 px above the line `dy` down is drawn. */
  const above = (dy: number): Rect => ({
    x: Math.round(at.x - 10),
    y: Math.round(at.y + dy - 60),
    w: 180,
    h: 50,
  });

  // The upper line's constraint, dynamic: blue while the viewport is current.
  await enterCommand(page, 'DCALIGNED');
  await expect(prompt(page)).toHaveText(/^Specify first constraint point or/);
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText('Select object:');
  await click(80, 0);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(80, -40);
  await expect(prompt(page)).toHaveText(/^Dimension text <d1=/);
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText('Command:');
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await expect.poll(() => pixels(page, above(0), true), { timeout: 15_000 }).toBeGreaterThan(40);
  await shot('1-dynamic-in-current-viewport.png');

  // In paper space it is not drawn.
  await enterCommand(page, 'PSPACE');
  await expect.poll(() => viewport(page)).toBe('');
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await expect.poll(() => pixels(page, above(0), true), { timeout: 15_000 }).toBe(0);
  const before = await pixels(page, above(120), false);
  const plotBefore = await previewInk(page);

  // The lower line's, annotational (CCONSTRAINTFORM 1): drawn in paper space too, and plotted.
  await enterCommand(page, 'MSPACE');
  await expect.poll(() => viewport(page)).not.toBe('');
  await enterCommand(page, 'CCONSTRAINTFORM');
  await enterCommand(page, '1');
  await enterCommand(page, 'DCALIGNED');
  await expect(prompt(page)).toHaveText(/^Specify first constraint point or/);
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText('Select object:');
  await click(80, 120);
  await expect(prompt(page)).toHaveText('Specify dimension line location:', { timeout: 15_000 });
  await click(80, 80);
  await expect(prompt(page)).toHaveText(/^Dimension text <d2=/);
  await enterCommand(page, '');
  await expect(prompt(page)).toHaveText('Command:');
  await enterCommand(page, 'PSPACE');
  await expect.poll(() => viewport(page)).toBe('');
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await expect
    .poll(() => pixels(page, above(120), false), { timeout: 15_000 })
    .toBeGreaterThan(before + 40);
  await shot('2-annotational-in-paper-space.png');
  const plotAfter = await previewInk(page, () => shot('3-layout-plot-preview.png'));
  expect(plotAfter).toBeGreaterThan(plotBefore + 40);
});
