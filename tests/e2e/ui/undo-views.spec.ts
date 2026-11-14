// M2-47 part 4: undoable views. A ZOOM or PAN, typed, from the navigation bar or with the wheel,
// is an undo step, as in AutoCAD; UNDO Control Combine (Yes by default) makes consecutive ones a
// single step, and No keeps each its own.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DXF, activeCanvas, expectShown, openWithPicker, worldAt } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true });
const nav = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Navigation' }).getByRole('button', { name, exact: true });

async function open(page: Page): Promise<void> {
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
}

/** The view shown: the world point at the canvas's centre and the drawing units per 100 px. */
async function view(page: Page): Promise<{ x: number; y: number; per100: number }> {
  const box = (await activeCanvas(page).boundingBox())!;
  const cx = Math.round(box.width / 2);
  const cy = Math.round(box.height / 2);
  const c = await worldAt(page, cx, cy);
  const r = await worldAt(page, cx + 100, cy);
  return { x: c.x, y: c.y, per100: r.x - c.x };
}

/** Waits until the view shown is `v` (the status bar shows four decimals). */
async function expectView(page: Page, v: { x: number; y: number; per100: number }) {
  const near = (a: number, b: number) => Math.abs(a - b) <= 2e-3 + 1e-4 * Math.abs(b);
  await expect
    .poll(async () => {
      const now = await view(page);
      return near(now.x, v.x) && near(now.y, v.y) && near(now.per100, v.per100);
    })
    .toBe(true);
}

async function type(page: Page, ...lines: string[]): Promise<void> {
  for (const text of lines) {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  }
  await expect(prompt(page)).toHaveText('Command:');
}

/** Rolls the wheel over the canvas `ticks` times, zooming in about a point off its centre. */
async function wheel(page: Page, ticks: number): Promise<void> {
  const box = (await activeCanvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
  for (let i = 0; i < ticks; i += 1) await page.mouse.wheel(0, -100);
}

test('ZOOM, the wheel and the navigation bar in a row are one undo step: Ctrl+Z takes them all back, Ctrl+Y brings them again', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page);
  const opened = await view(page);
  await type(page, 'Z', '2X');
  await wheel(page, 6);
  await nav(page, 'Zoom Out').click();
  const zoomed = await view(page);
  expect(zoomed.per100).toBeLessThan(opened.per100 / 2);
  await expect(undoButton(page)).toHaveAttribute('title', 'Undo ZOOM (Ctrl+Z)');

  await page.getByLabel('Command', { exact: true }).focus();
  await page.keyboard.press('Control+z');
  await expectView(page, opened);
  await expect(undoButton(page)).toBeDisabled();

  await page.keyboard.press('Control+y');
  await expectView(page, zoomed);
});

test('a zoom after a LINE is undone first, then the LINE; -PAN after it joins the zoom', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page);
  const opened = await view(page);
  await type(page, 'L', '0,0', '@100<0', '');
  await wheel(page, 2);
  await page.getByLabel('Command', { exact: true }).focus();
  await type(page, '-PAN', '0,0', '10,0');
  await expect(undoButton(page)).toHaveAttribute('title', 'Undo PAN (Ctrl+Z)');
  await page.keyboard.press('Control+z');
  await expectView(page, opened);
  await expect(undoButton(page)).toHaveAttribute('title', 'Undo LINE (Ctrl+Z)');
});

test('UNDO Control Combine No keeps each ZOOM a step of its own', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  const opened = await view(page);
  await type(page, 'UNDO', 'C', 'C', 'N');
  await type(page, 'Z', '2X');
  const once = await view(page);
  await type(page, 'Z', '2X');
  await type(page, 'U');
  await expectView(page, once);
  await type(page, 'U');
  await expectView(page, opened);
});
