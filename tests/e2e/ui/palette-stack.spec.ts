// M7-03: the dockable palette stack (UI_SPEC.md §4). Palettes open together as tabs of one
// stack docked right of the drawing area; tabs are reordered by dragging or with
// Ctrl+Shift+Page Up/Down; the stack docks left and is sized at its inner edge; the layout
// (tabs, front tab, side, width) comes back after a reload. Below 1366 px the stack slides over
// the drawing area instead of narrowing it, and Esc slides it away. Part 2: the stack floats
// (dragged off its dock by its tab strip), docks at the bottom (dropped at the drawing area's
// bottom edge), auto-hides to its tab strip, and holds the Command History palette (F2).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, enterCommand, expectShown, openWithPicker } from '../app/page';
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
const heightHandle = (page: Page) => page.getByRole('separator', { name: 'Palette height' });
const grip = (page: Page) => page.getByRole('button', { name: 'Move palettes' });

/** Picks `item` on the stack's Palette options menu. */
async function option(page: Page, item: string) {
  await page.getByRole('button', { name: 'Palette options' }).click();
  await page
    .getByRole('menu', { name: 'Palette options' })
    .getByText(item, { exact: true })
    .click();
  await expect(page.getByRole('menu', { name: 'Palette options' })).toHaveCount(0);
}

/** Screenshots for the PR when TRIYA_SHOTS names a folder. */
async function shot(page: Page, name: string) {
  const dir = process.env['TRIYA_SHOTS'];
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name) });
}

/** Drags the stack by its tab strip's grip to `to`. */
async function dragStack(page: Page, to: { x: number; y: number }) {
  const g = await box(page, grip(page));
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 20, g.y + g.height / 2 + 20, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  return async () => page.mouse.up();
}

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
    await option(page, 'Dock Left');
    await expect
      .poll(async () => (await box(page, stack(page))).x)
      .toBeLessThan((await box(page, activeCanvas(page))).x);
    await page.getByRole('button', { name: 'Palette options' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Dock Left' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Palette options' })).toBeFocused();

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

test.describe('floating, bottom dock and auto-hide (1600 px)', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test('floats off its dock, docks at the bottom, and keeps its place after a reload', async ({
    page,
  }) => {
    await page.goto(app.url);
    await open(page);
    const full = await box(page, activeCanvas(page));
    await rail(page, 'Properties').click();
    await rail(page, 'Layers').click();
    await expect
      .poll(async () => (await box(page, activeCanvas(page))).width)
      .toBeLessThan(full.width - 300);
    await shot(page, '1-docked-right.png');

    // Dragged by its tab strip, the stack floats where it is dropped; the drawing area gets its
    // width back.
    const drop = await dragStack(page, { x: 500, y: 300 });
    await shot(page, '2-floating-while-dragged.png');
    await drop();
    await expect(stack(page)).toHaveAttribute('data-floating', 'true');
    await expect.poll(async () => (await box(page, activeCanvas(page))).width).toBe(full.width);
    const floated = await box(page, stack(page));
    expect(floated.x).toBeGreaterThan(full.x);
    expect(floated.x + floated.width).toBeLessThan(full.x + full.width);
    await expect(tabs(page)).toHaveText(['Properties', 'Layers']);
    await expect(page.getByRole('complementary', { name: 'Layers' })).toBeVisible();

    // Its size: the width handle on its right edge and the height handle on its bottom edge.
    await heightHandle(page).focus();
    await page.keyboard.press('ArrowDown');
    await expect(heightHandle(page)).toHaveAttribute('aria-valuenow', '496');
    await handle(page).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '344');
    // Its grip moves it with the arrow keys too.
    await grip(page).focus();
    await page.keyboard.press('ArrowRight');
    const moved = await box(page, stack(page));
    expect(Math.round(moved.x - floated.x)).toBe(16);
    expect(Math.round(moved.width)).toBe(344);
    expect(Math.round(moved.height)).toBe(496);
    await shot(page, '3-floating.png');

    // The next session: floating at the same place, the same size.
    await page.reload();
    await open(page);
    await expect(stack(page)).toHaveAttribute('data-floating', 'true');
    const again = await box(page, stack(page));
    expect(Math.round(again.x)).toBe(Math.round(moved.x));
    expect(Math.round(again.y)).toBe(Math.round(moved.y));
    expect(Math.round(again.height)).toBe(496);

    // Dropped at the drawing area's bottom edge, it docks there: as wide as the drawing area,
    // which gives it its height.
    const area = await box(page, page.locator('.canvas-area'));
    const dock = await dragStack(page, { x: area.x + area.width / 2, y: area.y + area.height - 8 });
    await expect(page.locator('.palette-dock')).toHaveAttribute('data-dock-target', 'bottom');
    await shot(page, '4-dropping-at-the-bottom.png');
    await dock();
    await expect(stack(page)).toHaveAttribute('data-floating', 'false');
    await expect(heightHandle(page)).toHaveAttribute('aria-valuenow', '240');
    await expect(handle(page)).toHaveCount(0);
    await expect
      .poll(async () => (await box(page, activeCanvas(page))).height)
      .toBeLessThan(full.height - 200);
    const bottom = await box(page, stack(page));
    const canvas = await box(page, activeCanvas(page));
    expect(bottom.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    expect(Math.abs(bottom.width - canvas.width)).toBeLessThan(2);
    await heightHandle(page).focus();
    await page.keyboard.press('Shift+ArrowUp');
    await expect(heightHandle(page)).toHaveAttribute('aria-valuenow', '304');
    await shot(page, '5-docked-bottom.png');

    await page.reload();
    await open(page);
    await expect(heightHandle(page)).toHaveAttribute('aria-valuenow', '304');
    await expect(stack(page)).toHaveAttribute('data-floating', 'false');

    // The options menu floats it and docks it again from the keyboard.
    await option(page, 'Float');
    await expect(stack(page)).toHaveAttribute('data-floating', 'true');
    await option(page, 'Dock Right');
    await expect(stack(page)).toHaveAttribute('data-floating', 'false');
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '420');
  });

  test('auto-hides to its tab strip until the pointer rests on it', async ({ page }) => {
    await page.goto(app.url);
    await open(page);
    await rail(page, 'Layers').click();
    const layers = page.getByRole('complementary', { name: 'Layers' });
    await expect(layers).toBeVisible();
    const docked = await box(page, activeCanvas(page));

    await option(page, 'Auto-hide');
    // The pointer away from it, it collapses to its tab strip and gives the drawing area its
    // width back.
    await page.mouse.move(400, 400);
    await expect(layers).toBeHidden();
    await expect(tabs(page)).toHaveText(['Layers']);
    await expect
      .poll(async () => (await box(page, activeCanvas(page))).width)
      .toBeGreaterThan(docked.width + 300);
    const collapsed = await box(page, activeCanvas(page));
    await shot(page, '6-auto-hidden.png');

    // Resting on the strip, it opens over the drawing area, which keeps its size.
    const tab = await box(page, tabs(page).first());
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await expect(layers).toBeVisible();
    expect((await box(page, activeCanvas(page))).width).toBe(collapsed.width);
    await shot(page, '7-auto-hide-shown.png');
    await page.mouse.move(400, 400);
    await expect(layers).toBeHidden();

    // The keyboard: a focused tab opens it; Esc in it gives the focus back to the drawing.
    await tabs(page).first().focus();
    await expect(layers).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(layers).toBeHidden();

    // Kept after a reload; the menu turns it off.
    await page.reload();
    await open(page);
    await page.mouse.move(400, 400);
    await expect(tabs(page)).toHaveText(['Layers']);
    await expect(layers).toBeHidden();
    await tabs(page).first().focus();
    await expect(layers).toBeVisible();
    await page.getByRole('button', { name: 'Palette options' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Auto-hide' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByRole('menuitemcheckbox', { name: 'Auto-hide' }).click();
    await page.mouse.move(400, 400);
    await expect(layers).toBeVisible();
    await expect.poll(async () => (await box(page, activeCanvas(page))).width).toBe(docked.width);
  });

  test('F2 shows the command history as a palette of the stack', async ({ page }) => {
    await page.goto(app.url);
    await open(page);
    await enterCommand(page, 'LINE');
    await enterCommand(page, '1,1');
    await enterCommand(page, '3,1');
    await enterCommand(page, '');
    await rail(page, 'Properties').click();

    await page.keyboard.press('F2');
    const history = page.getByRole('complementary', { name: 'Command History' });
    await expect(history).toBeVisible();
    await expect(tabs(page)).toHaveText(['Properties', 'Command History']);
    const log = history.getByRole('log', { name: 'Command history' });
    await expect(log).toContainText('Command: LINE');
    await expect(log).toContainText('Specify first point: 1,1');
    // The command line keeps the keyboard: what is typed next goes on with the history.
    await expect(page.getByRole('textbox', { name: 'Command' })).toBeFocused();
    await enterCommand(page, 'CIRCLE');
    await expect(log).toContainText('Command: CIRCLE');
    await page.keyboard.press('Escape');
    await shot(page, '8-command-history.png');

    // The rail has it too; F2 closes it again, Properties coming back to the front.
    await expect(rail(page, 'Command History')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('F2');
    await expect(history).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
    await rail(page, 'Command History').click();
    await expect(history).toBeVisible();
    await page.getByRole('button', { name: 'Close Command History' }).click();
    await expect(history).toHaveCount(0);
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
