// M2-06: the core edit commands from the app's command line, as a drafter runs them. A line is
// drawn on an empty part of the plan, then copied, moved, rotated, scaled and mirrored by typed
// points, picked with the cursor or a window at "Select objects", and the mirror images erased
// with a crossing window.
// The commands' prompts and geometry are unit-tested in packages/engine/test/commands; this
// checks that the app's bus, canvas and engine worker carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
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

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/**
 * The lines Triya drew in this test, as the change sets left them: each [x1, y1, x2, y2] less
 * the 1,000,000 offset of the empty part of the plan used, its ends in order, sorted.
 */
const lines = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, number[]>();
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind !== 'LINE') return;
      const ends = [g.start, g.end]
        .map((p) => [p.x - 1e6, p.y - 1e6].map((v) => Math.round(v * 1e6) / 1e6 + 0))
        .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
      out.set(e.handle, ends.flat());
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) if (out.has(u.after.handle)) put(u.after);
      for (const r of cs.entities?.removed ?? []) out.delete(r.entity.handle);
    }
    return [...out.values()].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('COPY, MOVE, ROTATE, SCALE, MIRROR and ERASE from the command line', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  /** A click at fractions of the canvas; its centre is (80, 50) of the window zoomed below. */
  const click = async (fx: number, fy: number) =>
    page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  const log = page.getByRole('log', { name: 'Recent command lines' });

  // An empty part of the plan, 160 × 100 units from (1000000, 1000000), and a line across its
  // centre.
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await type(page, 'L', 'Specify first point:');
  await type(page, '1000070,1000050', 'Specify next point or [Undo]:');
  await type(page, '1000090,1000050', 'Specify next point or [Undo]:');
  await type(page, '', 'Command:');
  await expect.poll(() => lines(page)).toEqual([[70, 50, 90, 50]]);

  // COPY: the line picked with the cursor, a base point, two copies, Enter.
  await type(page, 'CO', 'Select objects:');
  await click(0.5, 0.5);
  await expect(log).toContainText('1 found');
  await type(page, '', 'Specify base point or [Displacement/mOde] <Displacement>:');
  await expect(log).toContainText('Current settings:  Copy mode = Multiple');
  await type(page, '0,0', 'Specify second point or [Array] <use first point as displacement>:');
  await type(page, '0,20', 'Specify second point or [Array/Exit/Undo] <Exit>:');
  await type(page, '0,-20', 'Specify second point or [Array/Exit/Undo] <Exit>:');
  await type(page, '', 'Command:');
  await expect.poll(async () => (await lines(page)).length).toBe(3);

  // MOVE the middle line up by a displacement.
  await type(page, 'M', 'Select objects:');
  await click(0.5, 0.5);
  await type(page, '', 'Specify base point or [Displacement] <Displacement>:');
  await type(page, 'D', /^Specify displacement <[-\d.]+,[-\d.]+>:$/);
  await type(page, '0,5', 'Command:');

  // ROTATE the last line made (the lower copy) a quarter turn about its middle, then SCALE it.
  await type(page, 'RO', 'Select objects:');
  await page.keyboard.type('L');
  await type(page, '', 'Select objects:');
  await type(page, '', 'Specify base point:');
  await type(page, '1000080,1000030', /^Specify rotation angle or \[Copy\/Reference\] <0[.0]*>:$/);
  await type(page, '90', 'Command:');
  await type(page, 'SC', 'Select objects:');
  await page.keyboard.type('L');
  await type(page, '', 'Select objects:');
  await type(page, '', 'Specify base point:');
  await type(page, '1000080,1000030', /^Specify scale factor or \[Copy\/Reference\] <1[.0]*>:$/);
  await type(page, '2', 'Command:');

  // MIRROR the three, windowed with the cursor, about the vertical line x = 100; keep them.
  await type(page, 'MI', 'Select objects:');
  await click(0.3, 0.02);
  await click(0.7, 0.98);
  await expect(log).toContainText('3 found');
  await type(page, '', 'Specify first point of mirror line:');
  await type(page, '1000100,1000000', 'Specify second point of mirror line:');
  await type(page, '1000100,1000100', 'Erase source objects? [Yes/No] <No>:');
  await page.screenshot({ path: test.info().outputPath('mirror-prompt.png') });
  await type(page, '', 'Command:');
  const edited = [
    [70, 55, 90, 55],
    [70, 70, 90, 70],
    [80, 10, 80, 50],
    [110, 55, 130, 55],
    [110, 70, 130, 70],
    [120, 10, 120, 50],
  ];
  await expect.poll(() => lines(page)).toEqual(edited);
  await page.screenshot({ path: test.info().outputPath('edited.png') });

  // ERASE the mirror images with a crossing window (right to left) over them. (U in the app
  // waits for M2-23.)
  await type(page, 'E', 'Select objects:');
  await click(0.92, 0.95);
  await click(0.62, 0.05);
  await expect(log).toContainText('3 found');
  await type(page, '', 'Command:');
  await expect.poll(() => lines(page)).toEqual(edited.slice(0, 3));
  await page.screenshot({ path: test.info().outputPath('erased.png') });
});
