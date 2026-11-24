// M9-05 part 4: a constraint bar's icons answer the cursor. Two lines on an empty part of the
// plan are made parallel and the lower one horizontal: the lower line's bar holds Parallel and
// Horizontal, the upper's Parallel. The cursor resting on the lower bar's Parallel icon
// highlights both lines (AutoCAD 2024 Help, "About Displaying and Verifying Geometric
// Constraints"); a right-click on it opens its shortcut menu, whose Delete deletes the
// constraint (U brings it back); Delete pressed on the Horizontal icon deletes that one; Hide
// hides the bar right-clicked, Hide All Constraints every bar, and Constraint Bar Settings opens
// Constraint Settings on its Geometric tab. The hit test and highlight are tested in
// packages/render/test/canvas2d-constraint-bars.test.ts, the delete in
// packages/engine/test/commands/constraint-bar.test.ts, the menu in
// apps/web/test/constraint-bar-menu.test.ts; this checks the canvas, the menu and the keys.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import {
  DXF,
  activeCanvas,
  expectDrawn,
  expectShown,
  gridOff,
  openWithPicker,
  viewOf,
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

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/**
 * Pixels of the constraints' and the selection's blue on the dark canvas in the CSS-pixel
 * rectangle between `a` and `b` of the active canvas.
 */
async function bluePixels(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Promise<number> {
  const png = (await activeCanvas(page).screenshot()).toString('base64');
  return page.evaluate(
    async ({ b64, x0, y0, w, h }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 2]! > 150 && d[i + 2]! - d[i]! > 70 && d[i + 1]! > d[i]!) n++;
      }
      return n;
    },
    {
      b64: png,
      x0: Math.round(Math.min(a.x, b.x)),
      y0: Math.round(Math.min(a.y, b.y)),
      w: Math.round(Math.abs(b.x - a.x)),
      h: Math.round(Math.abs(b.y - a.y)),
    },
  );
}

test("a constraint bar's icons highlight, delete and hide from the cursor", async ({ page }) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string) =>
    page.screenshot({ path: shots ? path.join(shots, name) : test.info().outputPath(name) });
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await gridOff(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and two lines 60 long.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  for (const y of [20, 60]) {
    await type(page, 'L', 'Specify first point:');
    await type(page, `1000020,${1000000 + y}`, 'Specify next point or [Undo]:');
    await type(page, `1000080,${1000000 + y}`, 'Specify next point or [Undo]:');
    await type(page, '', 'Command:');
  }
  await expectDrawn(page, { timeout: 15_000 });

  const view = await viewOf(page);
  const at = (x: number, y: number) => view.at(1000000 + x, 1000000 + y);
  const client = (p: { x: number; y: number }) => ({ x: view.box.x + p.x, y: view.box.y + p.y });
  const click = async (x: number, y: number) => {
    const p = client(at(x, y));
    await page.mouse.click(p.x, p.y);
  };
  /** The band under a line's middle, in screen pixels, where its bar sits. */
  const band = (y: number) => {
    const p = at(50, y);
    return bluePixels(page, { x: p.x - 40, y: p.y + 3 }, { x: p.x + 40, y: p.y + 40 });
  };
  /** The upper line itself, left of its bar: blue only while highlighted. */
  const upperLine = () => {
    const a = at(25, 60);
    const b = at(40, 60);
    return bluePixels(page, { x: a.x, y: a.y - 4 }, { x: b.x, y: b.y + 4 });
  };
  /**
   * The `n`th of `of` icons of the bar under the line at `y`, in client pixels: the bar sits 6
   * px under the line's middle, 20 px high, its 16 px icons 2 px apart (CONSTRAINT_BAR_PX).
   */
  const icon = (y: number, n: number, of: number) => {
    const p = at(50, y);
    return client({ x: p.x - (of * 18 + 2) / 2 + 2 + 8 + n * 18, y: p.y + 16 });
  };
  const park = () => page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);

  await type(page, 'GCPARALLEL', 'Select first object:');
  await click(50, 20);
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  await type(page, 'GCHORIZONTAL', /^Select an object or/);
  await click(30, 20);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  await park();
  await expect.poll(() => band(20), { timeout: 15_000 }).toBeGreaterThan(10);
  await expect.poll(() => band(60)).toBeGreaterThan(10);
  expect(await upperLine()).toBe(0);
  const twoIcons = await band(20);

  // The cursor on the lower bar's Parallel icon highlights both lines.
  const parallel = icon(20, 0, 2);
  await page.mouse.move(parallel.x, parallel.y);
  await expect.poll(upperLine).toBeGreaterThan(10);
  await shot('1-hover-parallel-icon.png');
  await park();
  await expect.poll(upperLine).toBe(0);

  // Its shortcut menu's Delete: the upper line's bar goes with the constraint; U brings it back.
  await page.mouse.move(parallel.x, parallel.y);
  await expect.poll(upperLine).toBeGreaterThan(10);
  await page.mouse.click(parallel.x, parallel.y, { button: 'right' });
  const menu = page.getByRole('menu', { name: 'Constraint bar' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Delete',
    'Hide',
    'Hide All Constraints',
    'Constraint Bar Settings...',
  ]);
  await shot('2-icon-shortcut-menu.png');
  await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await park();
  await expect.poll(() => band(60)).toBe(0);
  expect(await band(20)).toBeGreaterThan(10);
  await shot('3-parallel-deleted.png');
  await type(page, 'U', 'Command:');
  await expect.poll(() => band(60)).toBeGreaterThan(10);

  // Delete pressed with the cursor on the Horizontal icon: the lower bar keeps Parallel alone.
  // (U put Parallel back after Horizontal, so it is now the bar's second icon.)
  const horizontal = icon(20, 0, 2);
  await page.mouse.move(horizontal.x, horizontal.y);
  // Horizontal is the lower line's alone: the upper line is not highlighted, the lower is.
  await expect
    .poll(() => {
      const a = at(25, 20);
      const b = at(40, 20);
      return bluePixels(page, { x: a.x, y: a.y - 4 }, { x: b.x, y: b.y + 4 });
    })
    .toBeGreaterThan(10);
  expect(await upperLine()).toBe(0);
  await page.keyboard.press('Delete');
  await park();
  await expect.poll(() => band(20)).toBeLessThan(twoIcons);
  expect(await band(20)).toBeGreaterThan(10);
  await shot('4-horizontal-deleted-by-key.png');

  // Hide: the bar right-clicked goes, the other stays.
  const lowerOnly = icon(20, 0, 1);
  await page.mouse.move(lowerOnly.x, lowerOnly.y);
  await expect.poll(upperLine).toBeGreaterThan(10);
  await page.mouse.click(lowerOnly.x, lowerOnly.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Hide', exact: true }).click();
  await park();
  await expect.poll(() => band(20)).toBe(0);
  expect(await band(60)).toBeGreaterThan(10);

  // Hide All Constraints, from the upper bar's icon.
  const upperIcon = icon(60, 0, 1);
  await page.mouse.move(upperIcon.x, upperIcon.y);
  await expect.poll(upperLine).toBeGreaterThan(10);
  await page.mouse.click(upperIcon.x, upperIcon.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Hide All Constraints' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await park();
  await expect.poll(() => band(60)).toBe(0);

  // Show All again; Constraint Bar Settings opens Constraint Settings on the Geometric tab.
  await type(page, 'CONSTRAINTBAR', 'Select objects or [Showall/Hideall]:');
  await type(page, 'S', 'Command:');
  await expect.poll(() => band(60)).toBeGreaterThan(10);
  // The dialog shown last on its AutoConstrain tab, which CONSTRAINTSETTINGS would open on.
  await type(page, 'CONSTRAINTSETTINGS', 'Constraint Settings:');
  const dialog = page.getByRole('dialog', { name: 'Constraint Settings' });
  await dialog.getByRole('tab', { name: 'AutoConstrain' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await page.mouse.move(upperIcon.x, upperIcon.y);
  await expect.poll(upperLine).toBeGreaterThan(10);
  await page.mouse.click(upperIcon.x, upperIcon.y, { button: 'right' });
  await menu.getByRole('menuitem', { name: 'Constraint Bar Settings...' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Geometric' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shot('5-constraint-bar-settings.png');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt(page)).toHaveText('Command:');
});
