// M3-04: the selection polygon and fence modes on the canvas, as AutoCAD 2024 draws them. At
// "Select objects", WP and CP ask for a polygon point by point, drawn closed back to its first
// point as a window (blue, solid) or a crossing (green, dashed); F asks for a fence, its lines
// dashed and open. Enter ends each, taking what lies inside, what it crosses, or what its lines
// cross; Undo takes a point back.
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

test('Fence, WPolygon and CPolygon at "Select objects"', async ({ page }) => {
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

  // An empty part of the plan, with three lines drawn across it.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  for (const y of [0.3, 0.5, 0.7]) {
    await type(page, 'L', 'Specify first point:');
    await click(0.2, y);
    await expect(prompt(page)).toHaveText('Specify next point or [Undo]:');
    await click(0.8, y);
    await type(page, '', 'Command:');
  }
  const lines = await added(page);
  expect(lines).toHaveLength(3);
  const [a, b, c] = lines as [number, number, number];

  await type(page, 'SELECT', 'Select objects:');

  // A fence down through the top two lines; a point taken back with Undo.
  await type(page, 'F', 'Specify first fence point:');
  await click(0.5, 0.2);
  await expect(prompt(page)).toHaveText('Specify next fence point or [Undo]:');
  await click(0.6, 0.9);
  await type(page, 'U', 'Specify next fence point or [Undo]:');
  await click(0.5, 0.55);
  const fenceEnd = at(0.6, 0.6);
  await page.mouse.move(fenceEnd.x, fenceEnd.y, { steps: 3 });
  await type(page, '', 'Select objects:');
  await expect(history(page)).toContainText('Specify next fence point or [Undo]: 2 found');
  await expect.poll(() => selected(page)).toEqual([a, b]);

  // Remove mode, then a crossing polygon over the middle line's centre takes it out again.
  await type(page, 'R', 'Remove objects:');
  await type(page, 'CP', 'First polygon point:');
  for (const [x, y] of [
    [0.45, 0.45],
    [0.55, 0.45],
    [0.55, 0.6],
  ] as const) {
    await click(x, y);
    await expect(prompt(page)).toHaveText('Specify endpoint of line or [Undo]:');
  }
  const corner = at(0.45, 0.6);
  await page.mouse.move(corner.x, corner.y, { steps: 3 });
  await type(page, '', 'Remove objects:');
  await expect(history(page)).toContainText(
    'Specify endpoint of line or [Undo]: 1 removed, 1 total',
  );
  await expect.poll(() => selected(page)).toEqual([a]);

  // Back to adding: a window polygon round the bottom line takes it, not the middle one it
  // only crosses.
  await type(page, 'A', 'Select objects:');
  await type(page, 'WP', 'First polygon point:');
  for (const [x, y] of [
    [0.1, 0.45],
    [0.9, 0.6],
    [0.9, 0.8],
    [0.1, 0.8],
  ] as const) {
    await click(x, y);
    await expect(prompt(page)).toHaveText('Specify endpoint of line or [Undo]:');
  }
  await type(page, '', 'Select objects:');
  await expect(history(page)).toContainText('Specify endpoint of line or [Undo]: 1 found, 2 total');
  await expect.poll(() => selected(page)).toEqual([a, c]);
  await type(page, '', 'Command:');
});
