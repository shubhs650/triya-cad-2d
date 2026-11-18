// M5-04 part 3: XCLIP at the command line, on the title-block test drawing
// (packages/testkit/fixtures/attributes/title-block.dxf): a rectangular clip hides the part of the
// title block outside it, OFF shows it whole again and ON clips it, generate Polyline draws the
// boundary, Delete removes the clip, and U takes the whole command back. The engine side is
// unit-tested in packages/engine/test/commands/xclip.test.ts and the save in
// packages/testkit/src/xref/xclip-command.test.ts. SHOTS=<dir> saves the PR's screenshots.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet } from '@triya/engine';
import { expectShown, ink, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const FILE = fileURLToPath(
  new URL('../../../packages/testkit/fixtures/attributes/title-block.dxf', import.meta.url),
);
const SHOTS = process.env['SHOTS'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  // Off the canvas, so Dynamic Input does not take the next point typed as relative.
  await page.mouse.move(640, 708);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The kinds of the entities the last change added. */
const lastAdded = (page: Page) =>
  page.evaluate(() => {
    const all = (window as unknown as Dev).triyaDev.changes();
    return (all.at(-1)?.entities?.added ?? []).map((p) => p.entity.geom.kind);
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

const OPTIONS = 'Enter clipping option [ON/OFF/Delete/generate Polyline/New boundary] <New>:';

/** XCLIP on everything in the drawing (the title block is its one reference), to the options. */
async function xclipAll(page: Page): Promise<void> {
  await type(page, 'XCLIP', 'Select objects:');
  await type(page, 'ALL', 'Select objects:');
  await type(page, '', OPTIONS);
}

test('XCLIP clips the title block, OFF and ON toggle it, Delete and U undo it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, FILE);
  await expectShown(page, path.basename(FILE));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '225,5', 'Specify opposite corner:');
  await type(page, '415,75', 'Command:');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(500);
  await page.waitForTimeout(300);
  const whole = await ink(page);
  await shot(page, '1-before');

  // New boundary, Rectangular: the right part of the title block. Its attributes are not
  // clipped (render/blocks.ts, M1-103).
  await xclipAll(page);
  await type(
    page,
    '',
    'Specify clipping boundary [Select polyline/Polygonal/Rectangular] <Rectangular>:',
  );
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'Outside mode - Objects outside boundary will be hidden.',
  );
  await type(page, '', 'Specify first corner:');
  await type(page, '300,10', 'Specify opposite corner:');
  await type(page, '410,70', 'Command:');
  await expect.poll(() => ink(page)).toBeLessThan(whole * 0.9);
  const clipped = await ink(page);
  await shot(page, '2-clipped');

  // OFF shows the whole block again; ON clips it.
  await xclipAll(page);
  await type(page, 'OFF', 'Command:');
  await expect.poll(() => ink(page)).toBeGreaterThan(clipped * 1.1);
  await shot(page, '3-clip-off');
  await xclipAll(page);
  await type(page, 'ON', 'Command:');
  await expect.poll(() => ink(page)).toBeLessThan(whole * 0.9);

  // generate Polyline draws the boundary where the reference stands.
  await xclipAll(page);
  await type(page, 'P', 'Command:');
  await expect.poll(() => lastAdded(page)).toEqual(['LWPOLYLINE']);
  await shot(page, '4-boundary-polyline');
  await type(page, 'U', 'Command:');

  // Delete removes the clip; U brings it back.
  await xclipAll(page);
  await type(page, 'D', 'Command:');
  await expect.poll(() => ink(page)).toBeGreaterThan(clipped * 1.1);
  await type(page, 'U', 'Command:');
  await expect.poll(() => ink(page)).toBeLessThan(whole * 0.9);
});
