// M5-02 part 6: REFEDIT of an xref in the app. The thread-authored xref set (M1-21): the parent
// attaches the title block xref-child-tb.dxf at (230, 10) and overlays it at (20, 150). With the
// title block's file dropped, -REFEDIT on the attachment carries its objects out, a line drawn
// joins them, and REFCLOSE Save writes the edits to the title block's file: a dropped file has no
// handle the app may write, so it downloads under its own name, with one LINE more than it had.
// The overlay of the same file is reloaded from it. The commands are unit-tested in
// packages/engine/test/commands/refedit-xref.test.ts; the file written is audited in
// packages/testkit/src/xref/refedit-xref.test.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enterCommand, expectShown, ink, openWithDrop, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/xref');
const CHILD = path.join(FIXTURES, 'xref-child-tb.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const log = (page: Page) => page.getByRole('log', { name: 'Recent command lines' });

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** Screenshots for the PR, taken when TRIYA_SCREENSHOTS names a folder. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['TRIYA_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/** The LINE entities of a DXF's ENTITIES section. */
const lines = (dxf: string) => {
  const entities = dxf.slice(
    dxf.indexOf('ENTITIES'),
    dxf.indexOf('ENDSEC', dxf.indexOf('ENTITIES')),
  );
  return entities.match(/\n\s*0\r?\nLINE\r?\n/g)?.length ?? 0;
};

test("REFEDIT of an xref writes the edits to the xref's file", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, path.join(FIXTURES, 'xref-parent.dxf'));
  await expectShown(page, 'xref-parent.dxf');
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(500);
  await page.waitForTimeout(500);
  const border = await ink(page);
  await openWithDrop(page, CHILD);
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(border + 3000);
  await expect(prompt(page)).toHaveText('Command:');
  await shot(page, '1-before');

  // The attachment's frame, on its left side.
  await enterCommand(page, '-REFEDIT');
  await expect(prompt(page)).toHaveText('Select reference:');
  await type(page, '230,40', 'Enter object selection method [All/Nested] <All>:');
  await type(page, '', 'Display attribute definitions [Yes/No] <No>:');
  await type(page, '', 'Command:');
  await expect(log(page)).toContainText('objects in the working set.');
  await expect(page.getByRole('toolbar', { name: 'Edit Reference' })).toBeVisible();

  // A diagonal across the title block's left half.
  await enterCommand(page, 'LINE');
  await expect(prompt(page)).toHaveText('Specify first point:');
  await type(page, '230,10', /^Specify next point/);
  await type(page, '320,70', /^Specify next point/);
  await type(page, '', 'Command:');
  await shot(page, '2-editing');

  await enterCommand(page, 'REFCLOSE');
  await expect(prompt(page)).toHaveText('Enter option [Save/Discard reference changes] <Save>:');
  const [download] = await Promise.all([page.waitForEvent('download'), type(page, '', 'Command:')]);
  expect(download.suggestedFilename()).toBe('xref-child-tb.dxf');
  const written = info.outputPath('xref-child-tb.dxf');
  await download.saveAs(written);
  const dxf = readFileSync(written, 'latin1');
  expect(dxf).toMatch(/\$ACADVER\s+1\s+AC1032/);
  expect(lines(dxf)).toBe(lines(readFileSync(CHILD, 'latin1')) + 1);
  await expect(log(page)).toContainText(
    'Xref "xref-child-tb" saved: reference edits written to xref-child-tb.dxf.',
  );
  await expect(log(page)).toContainText(
    "xref-child-tb.dxf was downloaded: put it in place of the xref's file to keep the edits.",
  );
  await expect(page.getByRole('toolbar', { name: 'Edit Reference' })).toBeHidden();
  // The overlay of the same file shows the line too once it is reloaded from what was written.
  await page.waitForTimeout(1000);
  await shot(page, '3-saved');
});
