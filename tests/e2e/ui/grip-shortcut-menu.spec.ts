// M3-05 part 5: the grip modes' right-click menu and the grip colours in the app. A line drawn on
// an empty part of the plan and picked at `Command:` shows its grips in GRIPCOLOR; Settings'
// Grip Colors dialog (AutoCAD's Options > Selection > Grip Colors) sets it, as GRIPCOLOR typed
// does. With a grip hot, a right-click on the canvas lists AutoCAD's grip options; Reference is
// greyed outside ROTATE and SCALE, a mode chosen there goes to it, Exit ends and Properties opens
// the Properties palette. The rules are unit-tested in packages/engine
// (grip-shortcut-menu.test.ts, setvar.test.ts), packages/render (drag.test.ts) and apps/web
// (system-variables.test.ts, preferences.test.ts).
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import path from 'node:path';

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

/** How many pixels around a point `match` their colour. */
async function pixels(
  page: Page,
  x: number,
  y: number,
  match: 'blue' | 'green',
  r = 3,
): Promise<number> {
  const png = await page.screenshot({ clip: { x: x - r, y: y - r, width: 2 * r, height: 2 * r } });
  return page.evaluate(
    async ([b64, kind]) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
        // GRIPCOLOR's initial ACI 150 (0, 127, 255); ACI 3 green (0, 255, 0).
        if (kind === 'blue' ? r < 40 && g > 100 && g < 160 && b > 220 : r < 40 && g > 220 && b < 40)
          n++;
      }
      return n;
    },
    [png.toString('base64'), match] as const,
  );
}

test('the grip right-click menu and the Grip Colors dialog', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  // ZOOM Window fits 160 × 100 units about (80, 50) into the canvas.
  const k = Math.min(box.width / 160, box.height / 100);
  const at = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - 80) * k,
    y: box.y + box.height / 2 - (y - 50) * k,
  });
  const click = async (x: number, y: number, button?: 'right') => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y, button ? { button } : undefined);
  };
  const shot = (name: string) => page.screenshot({ path: test.info().outputPath(name) });
  const menu = page.getByRole('menu', { name: 'Grip options' });

  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'LINE', 'Specify first point:');
  await type(page, '1000050,1000040', /^Specify next point/);
  await type(page, '1000090,1000040', /^Specify next point/);
  await type(page, '', 'Command:');
  // Running object snaps would pull the clicks below onto the line's own points; off.
  await page.keyboard.press('F3');
  await click(60, 40);
  const start = at(50, 40);
  // Away from the grips so none takes GRIPHOVER's colour.
  await page.mouse.move(at(70, 70).x, at(70, 70).y);
  await expect.poll(() => pixels(page, start.x, start.y, 'blue')).toBeGreaterThan(4);
  await shot('1-grips-before.png');

  // Settings > Grip Colors...: the unselected grips Green.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Grip Colors...' }).click();
  const colors = page.getByRole('dialog', { name: 'Grip Colors' });
  await expect(colors.getByLabel('Unselected grip color:', { exact: true })).toHaveValue('150');
  await expect(colors.getByLabel('Selected grip color:', { exact: true })).toHaveValue('12');
  await expect(colors.getByLabel('Hover grip color:', { exact: true })).toHaveValue('11');
  await expect(colors.getByLabel('Grip contour color:', { exact: true })).toHaveValue('251');
  await expect(colors.getByLabel('Unselected grip color:', { exact: true })).toContainText(
    'Color 150',
  );
  await colors.getByLabel('Unselected grip color:', { exact: true }).selectOption('3');
  await shot('2-grip-colors-dialog.png');
  await colors.getByRole('button', { name: 'OK' }).click();
  await expect(colors).toBeHidden();
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
  await expect.poll(() => pixels(page, start.x, start.y, 'green')).toBeGreaterThan(4);
  expect(await pixels(page, start.x, start.y, 'blue')).toBe(0);
  await shot('3-grips-green.png');

  // The midpoint grip hot, then a right-click: AutoCAD's grip options.
  await click(70, 40);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await click(75, 55, 'right');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Enter',
    'Move',
    'Mirror',
    'Rotate',
    'Scale',
    'Stretch',
    'Base Point',
    'Copy',
    'Reference',
    'Undo',
    'Properties',
    'Exit',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Reference' })).toBeDisabled();
  await shot('4-grip-right-click-menu.png');
  await menu.getByRole('menuitem', { name: 'Rotate' }).click();
  await expect(menu).toBeHidden();
  await expect(prompt(page)).toHaveText(
    'Specify rotation angle or [Base point/Copy/Undo/Reference/eXit]:',
  );
  await click(75, 55, 'right');
  await expect(menu.getByRole('menuitem', { name: 'Reference' })).toBeEnabled();
  // Esc closes the menu and leaves the prompt as it was.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(prompt(page)).toHaveText(
    'Specify rotation angle or [Base point/Copy/Undo/Reference/eXit]:',
  );
  await click(75, 55, 'right');
  await menu.getByRole('menuitem', { name: 'Exit' }).click();
  await expect(prompt(page)).toHaveText('Command:');

  // Properties: grip editing ends and the palette opens on the line, still selected.
  await click(70, 40);
  await expect(prompt(page)).toHaveText('Specify stretch point or [Base point/Copy/Undo/eXit]:');
  await click(75, 55, 'right');
  await menu.getByRole('menuitem', { name: 'Properties' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  const palette = page.getByRole('complementary', { name: 'Properties' });
  await expect(palette).toBeVisible();
  await shot('5-properties-from-grip-menu.png');

  // GRIPCOLOR typed shows the colour Settings set.
  await page.locator('#command-input').click();
  await type(page, 'GRIPCOLOR', 'Enter new value for GRIPCOLOR <3>:');
  await type(page, '150', 'Command:');
});
