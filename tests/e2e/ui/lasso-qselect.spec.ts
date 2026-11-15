// M3-04 part 2: lasso selection and Quick Select on the canvas, as AutoCAD 2024's. A press in
// an empty place dragged and released draws a lasso: dragged left a crossing lasso (green,
// dashed), right a window lasso (blue), and Spacebar cycles Crossing, Window and Fence while the
// button is held, the command line saying which. QSELECT opens the Quick Select dialog, whose
// criteria pick objects by type and property; what it takes stays selected.
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
const history = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

/** Types a line at the command line and waits for the prompt that follows. */
async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('lasso selection and Quick Select', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };
  /** Presses at the first point and drags through the others; released by the caller. */
  const lasso = async (points: readonly (readonly [number, number])[]) => {
    const [first, ...rest] = points;
    const p = at(...first!);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (const q of rest) {
      const r = at(...q);
      await page.mouse.move(r.x, r.y, { steps: 4 });
    }
  };

  // An empty part of the plan: two lines across it and a circle between them.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  for (const y of [0.3, 0.7]) {
    await type(page, 'L', 'Specify first point:');
    await click(0.2, y);
    await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
    await click(0.4, y);
    await type(page, '', 'Command:');
  }
  await type(page, 'C', 'Specify center point for circle or [3P/2P/Ttr (tan tan radius)]:');
  await click(0.7, 0.5);
  await expect(prompt(page)).toHaveText(/^Specify radius of circle/);
  await type(page, '5', 'Command:');
  const [a, b, c] = (await added(page)) as [number, number, number];

  // A lasso dragged left starts as a crossing lasso; Spacebar makes it a window lasso, which
  // takes the top line it holds, not the bottom one it crosses.
  await lasso([
    [0.45, 0.2],
    [0.1, 0.2],
    [0.1, 0.5],
    [0.3, 0.75],
  ]);
  await expect(prompt(page)).toHaveText('Crossing Lasso Press Spacebar to cycle options');
  await page.keyboard.press(' ');
  await expect(prompt(page)).toHaveText('Window Lasso Press Spacebar to cycle options');
  await page.mouse.move(at(0.45, 0.5).x, at(0.45, 0.5).y, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => selected(page)).toEqual([a]);
  await expect(prompt(page)).toHaveText('Command:');
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);

  // At "Select objects", a fence lasso (Spacebar twice from crossing) takes what it crosses.
  await type(page, 'SELECT', 'Select objects:');
  await lasso([
    [0.3, 0.2],
    [0.25, 0.5],
    [0.3, 0.8],
  ]);
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await expect(prompt(page)).toHaveText('Fence Lasso Press Spacebar to cycle options');
  await page.mouse.up();
  await expect(history(page)).toContainText(
    'Fence Lasso  Press Spacebar to cycle options: 2 found',
  );
  await expect.poll(() => selected(page)).toEqual([a, b]);
  await type(page, '', 'Command:');

  // Quick Select: circles among the objects selected, then lines appended from the drawing.
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await selected(page)).length).toBeGreaterThan(3);
  await page.keyboard.type('QSELECT');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Quick Select' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Apply to:')).toHaveValue('selection');
  await dialog.getByLabel('Object type:').selectOption({ label: 'Circle' });
  await dialog.getByLabel('Properties:').selectOption({ label: 'Radius' });
  await dialog.getByLabel('Operator:').selectOption({ label: '= Equals' });
  await dialog.getByLabel('Value:').fill('5');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(history(page)).toContainText('1 item(s) selected.');
  await expect.poll(() => selected(page)).toEqual([c]);
});
