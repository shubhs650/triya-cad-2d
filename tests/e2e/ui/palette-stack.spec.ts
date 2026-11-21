// M7-03: the dockable palette stack (UI_SPEC.md §4). Palettes open together as tabs of one
// stack docked right of the drawing area; tabs are reordered by dragging or with
// Ctrl+Shift+Page Up/Down; the stack docks left and is sized at its inner edge; the layout
// (tabs, front tab, side, width) comes back after a reload. Below 1366 px the stack slides over
// the drawing area instead of narrowing it, and Esc slides it away.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

async function open(page: Page) {
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
}

const rail = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Palettes' }).getByRole('button', { name, exact: true });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open palettes' }).getByRole('tab');
const stack = (page: Page) => page.getByRole('region', { name: 'Palette stack' });
const handle = (page: Page) => page.getByRole('separator', { name: 'Palette width' });

async function box(page: Page, locator: ReturnType<typeof stack>) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not shown');
  return b;
}

test.describe('docked (1600 px)', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test('stacks palettes as tabs, reorders, docks left, sizes, and keeps the layout', async ({
    page,
  }) => {
    await page.goto(app.url);
    await open(page);
    const canvasWidth = (await box(page, activeCanvas(page))).width;

    await rail(page, 'Properties').click();
    await rail(page, 'Layers').click();
    // Both stay open: Layers in front, Properties behind it.
    await expect(tabs(page)).toHaveText(['Properties', 'Layers']);
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('complementary', { name: 'Layers' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
    await expect(rail(page, 'Layers')).toHaveAttribute('aria-expanded', 'true');
    // Docked, the stack takes its width from the drawing area.
    await expect
      .poll(async () => (await box(page, activeCanvas(page))).width)
      .toBeLessThan(canvasWidth - 300);

    // A tab behind comes to the front on a click, or with the arrow keys.
    await tabs(page).first().click();
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(tabs(page).nth(1)).toBeFocused();
    await expect(page.getByRole('complementary', { name: 'Layers' })).toBeVisible();

    // Ctrl+Shift+Page Up moves the focused tab; dragging moves it back.
    await page.keyboard.press('Control+Shift+PageUp');
    await expect(tabs(page)).toHaveText(['Layers', 'Properties']);
    const layers = await box(page, tabs(page).first());
    const properties = await box(page, tabs(page).nth(1));
    await page.mouse.move(layers.x + layers.width / 2, layers.y + layers.height / 2);
    await page.mouse.down();
    await page.mouse.move(properties.x + properties.width / 2, layers.y + 5, { steps: 4 });
    await page.mouse.move(properties.x + properties.width + 4, layers.y + 5, { steps: 4 });
    await page.mouse.up();
    await expect(tabs(page)).toHaveText(['Properties', 'Layers']);

    // A third palette joins after the front tab; its close button closes only it.
    await rail(page, 'Health').click();
    await expect(tabs(page)).toHaveText(['Properties', 'Layers', 'Health']);
    await page.getByRole('button', { name: 'Close Health' }).click();
    await expect(tabs(page)).toHaveText(['Properties', 'Layers']);
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');

    // Docked left, the stack is left of the drawing area.
    await page.getByRole('button', { name: 'Dock palettes left' }).click();
    await expect
      .poll(async () => (await box(page, stack(page))).x)
      .toBeLessThan((await box(page, activeCanvas(page))).x);
    await expect(page.getByRole('button', { name: 'Dock palettes right' })).toBeVisible();

    // The width handle: the arrow keys move the edge, the pointer drags it.
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '420');
    await handle(page).focus();
    await page.keyboard.press('ArrowRight');
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '436');
    const edge = await box(page, handle(page));
    await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + 64, edge.y + 200, { steps: 4 });
    await page.mouse.up();
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '500');
    await expect.poll(async () => Math.round((await box(page, stack(page))).width)).toBe(500);

    // The next session: the same tabs, front tab, side and width.
    await page.reload();
    await open(page);
    await expect(tabs(page)).toHaveText(['Properties', 'Layers']);
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('complementary', { name: 'Layers' })).toBeVisible();
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '500');
    await expect
      .poll(async () => (await box(page, stack(page))).x)
      .toBeLessThan((await box(page, activeCanvas(page))).x);

    // Closing the last tab closes the stack.
    await page.getByRole('button', { name: 'Close Layers' }).click();
    await page.getByRole('button', { name: 'Close Properties' }).click();
    await expect(stack(page)).toHaveCount(0);
  });
});

test.describe('slide-over (1280 px)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('slides over the drawing area and slides away on Esc', async ({ page }) => {
    await page.goto(app.url);
    await open(page);
    const before = await box(page, activeCanvas(page));

    await rail(page, 'Layers').click();
    await expect(page.getByRole('complementary', { name: 'Layers' })).toBeVisible();
    // The drawing area keeps its size: the stack is over it, beside the rail.
    const over = await box(page, stack(page));
    expect((await box(page, activeCanvas(page))).width).toBe(before.width);
    expect(over.x).toBeLessThan(before.x + before.width);

    await page.getByRole('tab', { name: 'Layers' }).focus();
    await page.keyboard.press('Escape');
    await expect(stack(page)).toHaveCount(0);
    await expect(rail(page, 'Layers')).toBeFocused();
    await expect(rail(page, 'Layers')).toHaveAttribute('aria-expanded', 'false');

    // Its tabs stay open: the rail brings it back.
    await rail(page, 'Properties').click();
    await expect(tabs(page)).toHaveText(['Layers', 'Properties']);
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  });
});
