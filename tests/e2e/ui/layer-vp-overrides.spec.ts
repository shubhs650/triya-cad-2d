// M6-02 part 8: the Layer Properties Manager's VP columns in the layout viewport made current.
// viewport-overrides.dxf (self-authored, scripts/corpus/viewport-overrides.py) has Layout1 with
// four viewports on the same plan: WALLS red, PIPING blue. In paper space the VP cells are empty
// and VP Freeze counts the viewports freezing a layer; with the top-left viewport made current
// (a double click), VP Color turns WALLS green there only and VP Freeze hides PIPING there only,
// as the canvas shows; the filter menu's Viewport > Thaw thaws it again.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  activeCanvas,
  enterCommand,
  expectDrawn,
  expectShown,
  openWithPicker,
  viewOf,
} from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FILE = path.join(CORPUS, '../self-authored/viewport-overrides.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Rect = { x0: number; y0: number; x1: number; y1: number };
type Hue = 'red' | 'green' | 'blue';

/** Pixels of each hue in the CSS-pixel rectangles of the active canvas, from one screenshot. */
async function hues(page: Page, rects: readonly Rect[]): Promise<Record<Hue, number>[]> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, rects }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return rects.map((r) => {
        const out = { red: 0, green: 0, blue: 0 };
        const x = Math.round(Math.min(r.x0, r.x1));
        const y = Math.round(Math.min(r.y0, r.y1));
        const w = Math.round(Math.abs(r.x1 - r.x0));
        const h = Math.round(Math.abs(r.y1 - r.y0));
        const d = ctx.getImageData(x, y, w, h).data;
        for (let i = 0; i < d.length; i += 4) {
          const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
          if (R > 170 && G < 110 && B < 110) out.red++;
          else if (G > 140 && R < 110 && B < 130) out.green++;
          else if (B > 170 && R < 110 && G < 130) out.blue++;
        }
        return out;
      });
    },
    { b64: png, rects },
  );
}

test('VP Freeze and VP Color act in the layout viewport made current only (M6-02 part 8)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Layers' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Layers' });
  await expect(palette).toBeVisible();
  await page
    .getByRole('tablist', { name: 'Model and layouts' })
    .getByRole('tab', { name: 'Layout1' })
    .click();
  await expect(activeCanvas(page)).toHaveAttribute('aria-label', 'Layout Layout1');
  await expectDrawn(page, { timeout: 15_000 });
  const table = palette.getByRole('grid', { name: 'Layers of the drawing' });
  const row = (name: string) =>
    table.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });

  // Paper space: VP Freeze counts, the VP cells are empty.
  await expect(palette.getByRole('columnheader', { name: 'VP Color' })).toBeVisible();
  await expect(row('PIPING').locator('td.vp-freeze')).toHaveText('0 of 4');
  await expect(row('WALLS').locator('td.vpColor')).toHaveText('—');
  await expect(palette.getByRole('button', { name: 'VP Color WALLS' })).toHaveCount(0);

  // The top-left (plain) and bottom-left (clipped) viewports' frames, in paper millimetres
  // (centres 105,212 and 105,80; 180 x 120), as canvas pixels a little inside them.
  const view = await viewOf(page);
  const inside = (cx: number, cy: number): Rect => {
    const a = view.at(cx - 80, cy - 50);
    const b = view.at(cx + 80, cy + 50);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  };
  const topLeft = inside(105, 212);
  const bottomLeft = inside(105, 80);
  // Park the cursor on the sheet between the viewports (its crosshair is black, no hue counted).
  const gap = view.at(210, 146);
  const park = () => page.mouse.move(view.box.x + gap.x, view.box.y + gap.y);
  await park();
  const [before, beforeOther] = await hues(page, [topLeft, bottomLeft]);
  expect(before!.red).toBeGreaterThan(50);
  expect(before!.blue).toBeGreaterThan(50);
  expect(beforeOther!.red).toBeGreaterThan(50);

  // A double click in the top-left viewport makes it current: the VP cells are its.
  const centre = view.at(105, 212);
  await page.mouse.dblclick(view.box.x + centre.x, view.box.y + centre.y);
  await expect(activeCanvas(page)).not.toHaveAttribute('data-viewport', '');
  const vpColor = palette.getByRole('button', { name: 'VP Color WALLS' });
  await expect(vpColor).toHaveText('red');
  await expect(row('WALLS').locator('td.vpColor')).not.toHaveClass(/vp-overridden/);
  const vpFreeze = palette.getByRole('button', { name: 'VP Freeze PIPING' });
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'false');

  // VP Color: Select Color, green, overrides WALLS in this viewport only.
  await vpColor.click();
  const color = page.getByRole('dialog', { name: 'Select Color' });
  await expect(color.getByRole('button', { name: 'ByLayer' })).toBeDisabled();
  await color.getByRole('gridcell', { name: 'Index color 3', exact: true }).click();
  await color.getByRole('button', { name: 'OK' }).click();
  await expect(color).toHaveCount(0);
  await expect(vpColor).toHaveText('green');
  await expect(row('WALLS').locator('td.vpColor')).toHaveClass(/vp-overridden/);
  // The layer's own colour is unchanged.
  await expect(palette.getByRole('button', { name: 'Color WALLS', exact: true })).toHaveText('red');

  // VP Freeze: PIPING frozen in this viewport only.
  await vpFreeze.click();
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'true');

  await park();
  await expect
    .poll(async () => {
      const [here, there] = await hues(page, [topLeft, bottomLeft]);
      return { walls: here!.red, green: here!.green > 50, piping: here!.blue, other: there! };
    })
    .toMatchObject({ walls: 0, green: true, piping: 0 });
  const [, other] = await hues(page, [topLeft, bottomLeft]);
  // The other viewports keep the layers' own colours.
  expect(other!.red).toBeGreaterThan(50);
  expect(other!.blue).toBeGreaterThan(50);
  await vpColor.scrollIntoViewIfNeeded();
  await shot('vp-overrides.png');

  // The filter menu's Viewport > Thaw thaws All's layers in this viewport.
  await palette
    .getByRole('tree', { name: 'Layer filters' })
    .getByRole('treeitem', { name: 'All', exact: true })
    .click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Layer filter' });
  await menu.getByRole('menuitem', { name: 'Viewport', exact: true }).hover();
  await menu.getByRole('menuitem', { name: 'Thaw', exact: true }).click();
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'false');

  // Back in paper space the VP cells empty again; the count follows the viewport's freeze.
  await vpFreeze.click();
  await expect(vpFreeze).toHaveAttribute('aria-pressed', 'true');
  await enterCommand(page, 'PSPACE');
  await expect(activeCanvas(page)).toHaveAttribute('data-viewport', '');
  await expect(row('PIPING').locator('td.vp-freeze')).toHaveText('1 of 4');
  await expect(row('WALLS').locator('td.vpColor')).toHaveText('—');
});
