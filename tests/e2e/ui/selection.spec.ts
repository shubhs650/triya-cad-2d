// M2-03: selection on the canvas, as AutoCAD 2024 selects. At `Command:` a click picks the object
// under the pickbox (noun-verb pre-selection, PICKFIRST), Shift+click takes it out again, a
// window dragged left to right takes what lies wholly inside, one clicked right to left (a
// crossing window) what it crosses too, Ctrl+A everything, and Esc deselects. At SELECT's
// "Select objects" the same clicks build the set, and ZOOM Object takes the pre-selection.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, EntityId } from '@triya/engine';
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

test('picks, Shift, windows, crossing windows, Ctrl+A and Esc at Command:', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };

  // An empty part of the plan, far from the drawing, with two lines drawn across it.
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
    await click(0.8, y);
    await type(page, '', 'Command:');
  }
  const lines = await added(page);
  expect(lines).toHaveLength(2);
  const [a, b] = lines as [number, number];

  // A pick at Command: selects; Shift+click deselects.
  await click(0.5, 0.3);
  await expect.poll(() => selected(page)).toEqual([a]);
  await page.keyboard.down('Shift');
  await click(0.5, 0.3);
  await page.keyboard.up('Shift');
  await expect.poll(() => selected(page)).toEqual([]);

  // A window dragged left to right takes the line wholly inside it.
  const drag = async (from: [number, number], to: [number, number]) => {
    const p = at(...from);
    const q = at(...to);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
    await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up();
  };
  await drag([0.1, 0.2], [0.9, 0.4]);
  await expect.poll(() => selected(page)).toEqual([a]);
  await expect(prompt(page)).toHaveText('Command:');
  // One over half of each takes neither.
  await drag([0.1, 0.2], [0.5, 0.8]);
  await expect.poll(() => selected(page)).toEqual([a]);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);

  // Clicked right to left: a crossing window, taking both lines it crosses.
  await click(0.5, 0.8);
  await expect(prompt(page)).toHaveText('Specify opposite corner:');
  await click(0.4, 0.2);
  await expect.poll(() => selected(page)).toEqual([a, b].sort((x, y) => x - y));
  await page.keyboard.press('Escape');

  // Ctrl+A takes everything, the drawing's own objects too.
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await selected(page)).length).toBeGreaterThan(2);
  await page.keyboard.press('Escape');
  await expect.poll(() => selected(page)).toEqual([]);

  // SELECT builds its set from the same clicks; its set is then the Previous set.
  await type(page, 'SELECT', 'Select objects:');
  await click(0.5, 0.7);
  await expect(history(page)).toContainText('Select objects: 1 found');
  await expect.poll(() => selected(page)).toEqual([b]);
  await type(page, '', 'Command:');
  await expect.poll(() => selected(page)).toEqual([]);

  // ZOOM Object takes the pre-selection.
  await click(0.5, 0.3);
  await expect.poll(() => selected(page)).toEqual([a]);
  await type(page, 'Z', /Specify corner of window/);
  await type(page, 'O', 'Command:');
  await expect.poll(() => selected(page)).toEqual([]);
  // Line A now spans the window: a click near its left end, at mid-height, picks it.
  await click(0.03, 0.5);
  await expect.poll(() => selected(page)).toEqual([a]);
});
