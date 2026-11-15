// M3-04 part 7: selection cycling as a drafter uses it (AutoCAD 2024 Help, "To Select
// Overlapping or Close Objects", "Selection Cycling Tab (Drafting Settings Dialog Box)",
// "Object Selection Filters Dialog Box"). Shift+Space over overlapping objects lights up the
// next of them, and the click there takes that one (with the Selection list on too, it takes it
// without asking). The Drafting Settings dialog's Selection Cycling tab turns cycling on, and
// sets where the Selection list opens and whether it has its title bar; with cycling on, the
// badge shows by the cursor over overlapping objects. FILTER's Select… lists the drawing's
// layers to choose from, and opens Select Color for Color.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, EntityId } from '@triya/engine';
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

interface DevHooks {
  changes(): readonly ChangeSet[];
  selection(): readonly EntityId[];
}

type Dev = { triyaDev: DevHooks };

const selected = (page: Page) =>
  page.evaluate(() => [...(window as unknown as Dev).triyaDev.selection()].sort((a, b) => a - b));
const added = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as Dev).triyaDev
      .changes()
      .flatMap((cs) => (cs.entities?.added ?? []).map((a) => a.entity.id)),
  );
const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** Pixels in the selection colour (#4DA3FF and its glow) in a square of the page around a point. */
async function lit(page: Page, p: { x: number; y: number }, r = 6): Promise<number> {
  const png = await page.screenshot({
    clip: { x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r },
  });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i]!, d[i + 1]!, d[i + 2]!];
      if (B > 150 && B - R > 80 && G > R) n++;
    }
    return n;
  }, png.toString('base64'));
}

/** Types a line at the command line and waits for the prompt that follows. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Shift+Space, the badge, the Selection Cycling tab and FILTER’s Select…', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const move = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.move(p.x, p.y);
  };
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  const line = async (x0: number, y0: number, x1: number, y1: number) => {
    await type(page, 'L', 'Specify first point:');
    await click(x0, y0);
    await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
    await click(x1, y1);
    await type(page, '', 'Command:');
  };

  // An empty part of the plan, running object snaps off: two lines crossing away from their
  // midpoints (a selected line's grip there would take the pick).
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.press('F3');
  await line(0.2, 0.3, 0.6, 0.3);
  await line(0.45, 0.1, 0.45, 0.6);
  const [h, v] = (await added(page)) as [number, number];
  const badge = page.getByTestId('cycling-badge');
  const list = page.getByRole('dialog', { name: 'Selection' });

  // Cycling off: no badge, and a click where they cross takes the nearest.
  await move(0.45, 0.3);
  await expect(badge).toBeHidden();
  await click(0.45, 0.3);
  await expect.poll(async () => (await selected(page)).length).toBe(1);
  const nearest = (await selected(page))[0]!;
  expect([h, v]).toContain(nearest);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);

  // Shift+Space there lights up the other; the click takes it, and the command line stays.
  // Each line is looked at away from the crossing: the horizontal at 0.3, the vertical at 0.5.
  const litLine = async () => {
    const onH = (await lit(page, at(0.3, 0.3))) > 0;
    const onV = (await lit(page, at(0.45, 0.5))) > 0;
    return onH === onV ? 'both or none' : onH ? h : v;
  };
  await move(0.45, 0.32);
  await move(0.45, 0.3);
  await expect.poll(litLine).toBe(nearest);
  await page.keyboard.press('Shift+Space');
  await expect.poll(litLine).toBe(nearest === h ? v : h);
  await shot(page, '1-shift-space-lights-the-other');
  await click(0.45, 0.3);
  await expect.poll(() => selected(page)).toEqual([nearest === h ? v : h]);
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('Escape');
  // Twice is round again to the nearest.
  await move(0.45, 0.32);
  await move(0.45, 0.3);
  await page.keyboard.press('Shift+Space');
  await page.keyboard.press('Shift+Space');
  await click(0.45, 0.3);
  await expect.poll(() => selected(page)).toEqual([nearest]);
  await page.keyboard.press('Escape');

  // The Selection Cycling tab: cycling on, the list bottom right of the pick, 40 pixels away.
  await type(page, 'DSETTINGS', 'Drafting Settings:');
  const settings = page.getByRole('dialog', { name: 'Drafting Settings' });
  await settings.getByRole('tab', { name: 'Selection Cycling' }).click();
  const quadrant = settings.getByRole('combobox', { name: 'Quadrant' });
  await expect(quadrant).toBeDisabled();
  await settings.getByLabel('Allow selection cycling (Ctrl+W)').check();
  await expect(settings.getByLabel('Display selection cycling list box')).toBeChecked();
  await quadrant.selectOption({ label: 'Bottom-right' });
  await settings.getByRole('textbox', { name: 'Distance in pixels' }).fill('40');
  await shot(page, '2-selection-cycling-tab');
  await settings.getByRole('button', { name: 'OK' }).click();
  await expect(settings).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expect(page.getByRole('button', { name: 'SC', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The badge by the cursor over the crossing, and not over one line alone.
  await move(0.45, 0.32);
  await move(0.45, 0.3);
  await expect(badge).toBeVisible();
  await shot(page, '3-overlap-badge');
  await move(0.3, 0.3);
  await expect(badge).toBeHidden();

  // A click there opens the list bottom right of it, 40 pixels away, with its title bar.
  const pick = at(0.45, 0.3);
  await click(0.45, 0.3);
  await expect(list).toBeVisible();
  const placed = (await list.boundingBox())!;
  expect(Math.round(placed.x)).toBe(Math.round(pick.x + 40));
  expect(Math.round(placed.y)).toBe(Math.round(pick.y + 40));
  await expect(list.getByText('Selection', { exact: true })).toBeVisible();
  await shot(page, '4-list-bottom-right');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();

  // Shift+Space with the list on: the click takes the object lit up, the list not asked.
  await move(0.45, 0.32);
  await move(0.45, 0.3);
  await page.keyboard.press('Shift+Space');
  await click(0.45, 0.3);
  await expect.poll(() => selected(page)).toEqual([nearest === h ? v : h]);
  await expect(list).toBeHidden();
  await page.keyboard.press('Escape');

  // Show title bar off: the list without it.
  await type(page, 'DSETTINGS', 'Drafting Settings:');
  await expect(settings.getByRole('tab', { name: 'Selection Cycling' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await settings.getByLabel('Show title bar').uncheck();
  await settings.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await click(0.45, 0.3);
  await expect(list).toBeVisible();
  await expect(list.getByText('Selection', { exact: true })).toHaveCount(0);
  await list.getByRole('button').first().click();
  await expect.poll(async () => (await selected(page)).length).toBe(1);
  await page.keyboard.press('Escape');

  // FILTER's Select…: Layer lists the drawing's layers; Color opens Select Color.
  await move(0.9, 0.9);
  await type(page, 'FILTER', 'Object Selection Filters:');
  const filter = page.getByRole('dialog', { name: 'Object Selection Filters' });
  const select = filter.getByRole('button', { name: 'Select...' });
  await expect(select).toBeDisabled();
  await filter.getByLabel('Select Filter').selectOption({ label: 'Layer' });
  await select.click();
  const layers = page.getByRole('dialog', { name: 'Select Layer(s)' });
  await expect(layers).toBeVisible();
  await layers.getByRole('listbox').selectOption('0');
  await shot(page, '5-filter-select-layers');
  await layers.getByRole('button', { name: 'OK' }).click();
  await expect(layers).toBeHidden();
  await expect(filter.getByLabel('X value')).toHaveValue('0');
  await filter.getByLabel('Select Filter').selectOption({ label: 'Color' });
  await select.click();
  const color = page.getByRole('dialog', { name: 'Select Color' });
  await expect(color).toBeVisible();
  await color.getByRole('textbox', { name: 'Color' }).fill('3');
  await color.getByRole('button', { name: 'OK' }).click();
  await expect(color).toBeHidden();
  await expect(filter.getByLabel('X value')).toHaveValue('3');
  await filter.getByRole('button', { name: 'Cancel' }).click();
  await expect(prompt(page)).toHaveText('Command:');
});
