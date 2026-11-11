// M1-22 part 2: the navigation bar (PAN, ZOOM Extents/Window/Previous/All/In/Out, REGEN,
// named views) and the layout tabs, on sample_AC1018.dwg: three layouts, LIMMAX 12,9, model
// extents about (0, -566)–(1852, 111) (its text measured by its glyphs since M1-35 part 2,
// which matches the $EXTMIN/$EXTMAX AutoCAD saved), and a saved plan view `view_custom` centred at
// (65.70, 15.93). It was saved with model space centred at (1121.82, -261.37), 1100.22 units
// high (the `*Active` VPORT), and Layout1 centred at (7.62, 4), 8.99 high (its paper-space
// viewport). The status bar's coordinates are how the test reads the view.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  DWG,
  activeCanvas,
  expectShown,
  ink,
  openWithPicker,
  paperPixels,
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

const NAME = path.basename(DWG);

async function opened(page: Page) {
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, NAME);
  const box = (await activeCanvas(page).boundingBox())!;
  return { box, cx: Math.round(box.width / 2), cy: Math.round(box.height / 2) };
}

/** World units per CSS pixel at the current view. */
async function unit(page: Page, cx: number, cy: number): Promise<number> {
  const a = await worldAt(page, cx, cy);
  const b = await worldAt(page, cx + 100, cy);
  return (b.x - a.x) / 100;
}

/** The view is centred on the model extents' centre, about (926, -227), to two pixels. */
async function extentsCentred(page: Page, cx: number, cy: number): Promise<boolean> {
  const u = await unit(page, cx, cy);
  const c = await worldAt(page, cx, cy);
  return Math.abs(c.x - 926.09) < 2 * u + 1 && Math.abs(c.y + 227.47) < 2 * u + 1;
}

const nav = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Navigation' }).getByRole('button', { name, exact: true });

test.describe('navigation bar and layout tabs', () => {
  test.describe.configure({ timeout: 90_000 });

  // M1-22 part 3: AutoCAD reopens each space in the view it was saved in, not at the extents.
  test('opens Model and a layout in the views the drawing was saved in', async ({ page }) => {
    const { box, cx, cy } = await opened(page);
    let u = await unit(page, cx, cy);
    let c = await worldAt(page, cx, cy);
    expect(Math.abs(c.x - 1121.82)).toBeLessThan(2 * u);
    expect(Math.abs(c.y + 261.37)).toBeLessThan(2 * u);
    // The saved height fills the window's height; the width follows the window.
    expect(u * box.height).toBeCloseTo(1100.22, -1);

    const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
    await tabs.nth(1).click();
    await expect(page.getByTestId('space')).toHaveText('PAPER');
    u = await unit(page, cx, cy);
    c = await worldAt(page, cx, cy);
    expect(Math.abs(c.x - 7.62)).toBeLessThan(2 * u);
    expect(Math.abs(c.y - 4)).toBeLessThan(2 * u);
    expect(u * box.height).toBeCloseTo(8.99, 0);

    // Zoom Extents still frames the drawing: here the extents' centre, about (926, -227). The
    // text's glyph-measured extents may land a moment after the click (M2-37), so poll.
    await tabs.first().click();
    await nav(page, 'Zoom Extents').click();
    await expect.poll(() => extentsCentred(page, cx, cy)).toBe(true);
  });

  // M2-37: the renderer measures text by its glyphs a moment after the drawing first shows; a
  // Zoom Extents clicked before then frames the extents the drawing opened with (text guessed
  // without fonts: here 50 units too high), and zooms again to the measured ones when they come.
  // The status bar follows the view under a cursor that has not moved, so polling it sees that.
  test('Zoom Extents straight after opening frames the text as drawn', async ({ page }) => {
    const { cx, cy } = await opened(page);
    await nav(page, 'Zoom Extents').click();
    await expect.poll(() => extentsCentred(page, cx, cy)).toBe(true);
  });

  test('lists Model and the layouts in tab order and shows a layout on its paper', async ({
    page,
  }) => {
    await opened(page);
    const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
    await expect(tabs).toHaveText(['Model', 'Layout1', 'Layout2', 'MyLayout']);
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
    const modelWhite = await paperPixels(page);

    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('space')).toHaveText('PAPER');
    // The white sheet fills most of the window (model space has only its white lines).
    await expect
      .poll(() => paperPixels(page), { timeout: 15_000 })
      .toBeGreaterThan(Math.max(50_000, 3 * modelWhite));

    await tabs.first().click();
    await expect(page.getByTestId('space')).toHaveText('MODEL');
    await expect.poll(() => ink(page)).toBeGreaterThan(200);
  });

  test('Zoom Window fills the window with the box dragged out; Zoom Previous goes back', async ({
    page,
  }) => {
    const { box, cx, cy } = await opened(page);
    const start = await worldAt(page, cx, cy);
    const a = await worldAt(page, cx - 100, cy - 60);
    const b = await worldAt(page, cx + 20, cy + 40);

    await nav(page, 'Zoom Window').click();
    await expect(nav(page, 'Zoom Window')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(box.x + cx - 100, box.y + cy - 60);
    await page.mouse.down();
    await page.mouse.move(box.x + cx + 20, box.y + cy + 40, { steps: 5 });
    await page.mouse.up();
    await expect(nav(page, 'Zoom Window')).toHaveAttribute('aria-pressed', 'false');

    const u = await unit(page, cx, cy);
    const mid = await worldAt(page, cx, cy);
    expect(Math.abs(mid.x - (a.x + b.x) / 2)).toBeLessThan(2 * u);
    expect(Math.abs(mid.y - (a.y + b.y) / 2)).toBeLessThan(2 * u);
    // 120 px of the old view now spans the window's width (or 100 px its height).
    expect(u).toBeLessThan(Math.abs(b.x - a.x) / 120);

    await nav(page, 'Zoom Previous').click();
    const back = await worldAt(page, cx, cy);
    const u0 = await unit(page, cx, cy);
    expect(Math.abs(back.x - start.x)).toBeLessThan(2 * u0);
    expect(Math.abs(back.y - start.y)).toBeLessThan(2 * u0);
  });

  test('Zoom In and Out scale about the centre; Zoom All shows limits and extents', async ({
    page,
  }) => {
    const { cx, cy } = await opened(page);
    const u0 = await unit(page, cx, cy);
    await nav(page, 'Zoom In').click();
    expect((await unit(page, cx, cy)) / u0).toBeCloseTo(0.5, 2);
    await nav(page, 'Zoom Out').click();
    await nav(page, 'Zoom Out').click();
    expect((await unit(page, cx, cy)) / u0).toBeCloseTo(2, 2);

    await nav(page, 'Zoom All').click();
    const u = await unit(page, cx, cy);
    const centre = await worldAt(page, cx, cy);
    // The union of limits (0,0)–(12,9) and the extents is the extents here, so ZOOM All
    // centres on the extents' centre, about (926, -227).
    expect(Math.abs(centre.x - 926)).toBeLessThan(2 * u + 2);
    expect(Math.abs(centre.y + 227.5)).toBeLessThan(2 * u + 2);
  });

  test('PAN drags the drawing with the left button until Esc', async ({ page }) => {
    const { box, cx, cy } = await opened(page);
    const grab = await worldAt(page, cx, cy);
    const u = await unit(page, cx, cy);
    await nav(page, 'Pan').click();
    await page.mouse.move(box.x + cx, box.y + cy);
    await page.mouse.down();
    await page.mouse.move(box.x + cx - 70, box.y + cy + 30, { steps: 4 });
    await page.mouse.up();
    const moved = await worldAt(page, cx - 70, cy + 30);
    expect(Math.abs(moved.x - grab.x)).toBeLessThan(2 * u);
    expect(Math.abs(moved.y - grab.y)).toBeLessThan(2 * u);
    await page.keyboard.press('Escape');
    await expect(nav(page, 'Pan')).toHaveAttribute('aria-pressed', 'false');
  });

  test('restores the drawing’s saved view and a view saved with Save view', async ({ page }) => {
    const { cx, cy } = await opened(page);
    await nav(page, 'Views').click();
    const views = page.getByRole('group', { name: 'Named views' });
    await views.getByRole('button', { name: 'view_custom' }).click();
    const u = await unit(page, cx, cy);
    const c = await worldAt(page, cx, cy);
    expect(Math.abs(c.x - 65.698)).toBeLessThan(2 * u);
    expect(Math.abs(c.y - 15.93)).toBeLessThan(2 * u);

    await views.getByLabel('New view name').fill('Detail');
    await views.getByRole('button', { name: 'Save view' }).click();
    await nav(page, 'Zoom Extents').click();
    await views.getByRole('button', { name: 'Detail' }).click();
    const again = await worldAt(page, cx, cy);
    expect(Math.abs(again.x - c.x)).toBeLessThan(2 * u);
    expect(Math.abs(again.y - c.y)).toBeLessThan(2 * u);
  });

  test('Regen redraws the drawing in the same view', async ({ page }) => {
    const { cx, cy } = await opened(page);
    await nav(page, 'Zoom In').click();
    const before = await worldAt(page, cx, cy);
    const u = await unit(page, cx, cy);
    await nav(page, 'Regen').click();
    await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(200);
    const after = await worldAt(page, cx, cy);
    expect(Math.abs(after.x - before.x)).toBeLessThan(2 * u);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2 * u);
  });
});
