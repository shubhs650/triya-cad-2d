// M9-05 part 2: constraint bars. On an empty part of the plan two lines are made parallel: each
// shows its bar under its middle. The Parametric tab's Geometric > Hide All hides both; the lower
// line selected shows its bar while selected (CONSTRAINTBARDISPLAY 2); Show/Hide with the upper
// line, Show, brings that one back; Show All both; CONSTRAINTBARMODE 1 (Horizontal only) hides
// the Parallel icons; Manage > Delete Constraints removes the constraint and its bars. The bars'
// layout is tested in packages/engine/test/edit/constraint-bars.test.ts, their drawing in
// packages/render/test/canvas2d-constraint-bars.test.ts, the commands in
// packages/engine/test/commands/constraint-bar.test.ts; this checks the ribbon, the command line,
// the app's bar state and the canvas.
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
 * Pixels of the constraints' blue on the dark canvas (#5ab4ff, blended at its edges) in the
 * CSS-pixel rectangle between `a` and `b` of the active canvas.
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

test('constraint bars show, hide and go with their constraints', async ({ page }) => {
  test.setTimeout(150_000);
  const shots = process.env['TRIYA_SHOTS'];
  const shot = async (name: string, park = true) => {
    if (park) await page.mouse.move(view.box.x + 60, view.box.y + view.box.height - 40);
    await page.screenshot({
      path: shots ? path.join(shots, name) : test.info().outputPath(name),
    });
  };
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
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(view.box.x + p.x, view.box.y + p.y);
  };
  /** The band under a line's middle, in screen pixels, where its bar sits. */
  const band = (y: number) => {
    const p = at(50, y);
    return bluePixels(page, { x: p.x - 40, y: p.y + 3 }, { x: p.x + 40, y: p.y + 40 });
  };
  const lower = () => band(20);
  const upper = () => band(60);
  expect(await lower()).toBe(0);

  await type(page, 'GCPARALLEL', 'Select first object:');
  await click(50, 20);
  await click(50, 60);
  await expect(prompt(page)).toHaveText('Command:', { timeout: 15_000 });
  await expect.poll(lower, { timeout: 15_000 }).toBeGreaterThan(10);
  await expect.poll(upper).toBeGreaterThan(10);
  await shot('1-bars-after-parallel.png');

  // Parametric > Geometric > Hide All.
  const ribbon = page.getByRole('tablist', { name: 'Ribbon' });
  await ribbon.getByRole('tab', { name: 'Parametric', exact: true }).click();
  const geometric = page.getByRole('group', { name: 'Geometric' });
  await geometric.getByRole('button', { name: 'Hide All', exact: true }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect.poll(lower).toBe(0);
  await expect.poll(upper).toBe(0);
  await shot('2-hide-all.png');

  // Selected, the lower line shows its hidden bar (CONSTRAINTBARDISPLAY 2, initially set).
  await click(30, 20);
  await expect.poll(lower).toBeGreaterThan(10);
  expect(await upper()).toBe(0);
  await shot('3-shown-while-selected.png');
  await page.keyboard.press('Escape');
  await expect.poll(lower).toBe(0);

  // Geometric > Show/Hide: the upper line, Show (the default).
  await geometric.getByRole('button', { name: 'Show/Hide', exact: true }).click();
  await expect(prompt(page)).toHaveText('Select objects or [Showall/Hideall]:');
  await click(30, 60);
  await type(page, '', 'Enter an option [Show/Hide/Reset] <Show>:');
  await shot('4-show-hide-option.png', false);
  await type(page, '', 'Command:');
  await expect.poll(upper).toBeGreaterThan(10);
  expect(await lower()).toBe(0);
  await shot('5-upper-shown.png');

  // Show All; then CONSTRAINTBARMODE 1 (Horizontal only) leaves no Parallel icon to show.
  await geometric.getByRole('button', { name: 'Show All', exact: true }).click();
  await expect.poll(lower).toBeGreaterThan(10);
  await type(page, 'CONSTRAINTBARMODE', 'Enter new value for CONSTRAINTBARMODE <4095>:');
  await type(page, '1', 'Command:');
  await expect.poll(lower).toBe(0);
  await expect.poll(upper).toBe(0);
  await type(page, 'CONSTRAINTBARMODE', 'Enter new value for CONSTRAINTBARMODE <1>:');
  await type(page, '4095', 'Command:');
  await expect.poll(lower).toBeGreaterThan(10);

  // Manage > Delete Constraints: the lower line's constraint goes, and both bars with it.
  await page
    .getByRole('group', { name: 'Manage' })
    .getByRole('button', { name: 'Delete Constraints', exact: true })
    .click();
  await expect(prompt(page)).toHaveText('Select objects:');
  await click(30, 20);
  await type(page, '', 'Command:');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    '1 constraint removed.',
  );
  await expect.poll(lower).toBe(0);
  await expect.poll(upper).toBe(0);
  await shot('6-constraint-deleted.png');
});
