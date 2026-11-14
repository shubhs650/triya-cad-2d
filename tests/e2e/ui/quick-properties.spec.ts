// M2-35 part 16: the Quick Properties palette, as a drafter uses it (AutoCAD 2024 Help, "Quick
// Properties Palette"; "QPMODE"; "Quick Properties Tab (Drafting Settings Dialog Box)"). It is
// off at first (QPMODE −1); Ctrl+Shift+P or the status bar's QP button turns it on. A line
// picked at `Command:` shows it above and to the right of the cursor, collapsed to three rows
// until the pointer is over it: the line's Color, Layer, Linetype, Length and Angle. A choice
// made there is the Properties palette's edit, one change set. Esc clears the selection and
// the palette goes; with the Properties palette open it does not show. The rows and the quick
// sheet are unit-tested in packages/engine/test/properties/quick.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The colour of each line this test drew, as the change sets left it. */
const colours = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, unknown>();
    const put = (e: Entity) => {
      if (e.geom.kind === 'LINE') out.set(e.handle, e.color);
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) if (out.has(u.after.handle)) put(u.after);
    }
    return [...out.values()];
  });

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('shows the picked objects’ quick properties by the cursor', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line across it.
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000070,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000090,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(() => colours(page)).toEqual([{ kind: 'byLayer' }]);

  const quick = page.getByRole('dialog', { name: 'Quick Properties' });
  const button = page.getByRole('button', { name: 'QP', exact: true });
  const box = (await canvas.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // Off at first: a pick shows nothing.
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(at.x, at.y);
  await expect(quick).toBeHidden();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+Shift+P');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(at.x, at.y);
  await expect(quick).toBeVisible();
  await expect(quick.getByRole('combobox', { name: 'Objects selected' })).toHaveText('Line (1)');
  // Above and to the right of the cursor.
  const placed = (await quick.boundingBox())!;
  expect(placed.x).toBeGreaterThan(at.x);
  expect(placed.y + placed.height).toBeLessThan(at.y);

  // Collapsed to three rows until the pointer is over it.
  const rows = quick.getByRole('row');
  await expect(rows.filter({ visible: true })).toHaveCount(3);
  await shot(page, '1-line-picked');
  await quick.hover();
  await expect(rows).toHaveText([/^Color/, /^Layer/, /^Linetype/, /^Length\s*20\.0+$/, /^Angle/]);
  await expect(rows.filter({ visible: true })).toHaveCount(5);
  await shot(page, '2-expanded');

  await quick.getByRole('combobox', { name: 'Color' }).selectOption({ label: 'Red' });
  await expect.poll(() => colours(page)).toEqual([{ kind: 'aci', index: 1 }]);
  await expect(quick.getByRole('combobox', { name: 'Color' })).toHaveValue('aci:1');

  // Esc clears the selection, and the palette goes with it.
  await canvas.hover();
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();

  // The Properties palette open: no Quick Properties.
  const undocked = (await canvas.boundingBox())!.width;
  await page.keyboard.press('Control+1');
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await expect(palette).toBeVisible();
  // The click below is worked out from the canvas beside the docked palette: wait for the canvas
  // to take that size and draw at it (CI once clicked the undocked canvas's spot and missed).
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeLessThan(undocked);
  await expectDrawn(page, { timeout: 15_000 });
  const docked = (await canvas.boundingBox())!;
  await page.mouse.click(docked.x + docked.width / 2, docked.y + docked.height / 2);
  await expect(palette.getByRole('combobox', { name: 'Objects selected' })).toHaveText('Line (1)');
  await expect(quick).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+1');
  await expect(palette).toBeHidden();

  // QPMODE typed at the command line is the button's setting.
  await canvas.hover();
  await type(page, 'QPMODE', /^Enter new value for QPMODE <1>:/);
  await type(page, '0', 'Command:');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(at.x, at.y);
  await expect(quick).toBeHidden();
  await page.keyboard.press('Escape');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await canvas.hover();
  await page.mouse.click(at.x, at.y);
  await expect(quick).toBeVisible();
  // Its close button hides it until the selection changes.
  await quick.getByRole('button', { name: 'Close Quick Properties' }).click();
  await expect(quick).toBeHidden();

  // Static (QPLOCATION 1): top left of the drawing area, then where its title bar is dragged.
  await page.keyboard.press('Escape');
  await canvas.hover();
  await type(page, 'QPLOCATION', /^Enter new value for QPLOCATION <0>:/);
  await type(page, '1', 'Command:');
  await page.mouse.click(at.x, at.y);
  await expect(quick).toBeVisible();
  const area = (await page.locator('.canvas-area').boundingBox())!;
  const still = (await quick.boundingBox())!;
  expect([Math.round(still.x - area.x), Math.round(still.y - area.y)]).toEqual([8, 8]);
  const title = quick.getByRole('heading', { name: 'Quick Properties' });
  const t = (await title.boundingBox())!;
  await page.mouse.move(t.x + 10, t.y + 5);
  await page.mouse.down();
  await page.mouse.move(t.x + 110, t.y + 65, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const b = (await quick.boundingBox())!;
      return [Math.round(b.x - area.x), Math.round(b.y - area.y)];
    })
    .toEqual([108, 68]);
  await shot(page, '3-static-dragged');
});
