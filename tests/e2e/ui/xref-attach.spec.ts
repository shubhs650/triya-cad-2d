// M5-04 part 6: XATTACH and its Attach External Reference dialog, on the raster image test drawing
// (packages/testkit/src/raster/fixture.ts, unitless, no xrefs): Browse... picks the xref set's
// grandchild (packages/testkit/src/xref/fixture.ts: a 40 × 40 magenta square with its diagonals,
// INSBASE at its centre), Block Unit shows its units, Overlay is chosen and OK asks the insertion
// point; the drawing loads at once and draws there, the References palette lists it Loaded as an
// Overlay, and U takes the xref and its content back in one step. The palette's Attach DWG...
// opens the same dialog. The engine side is unit-tested in
// packages/engine/test/commands/xref-attach.test.ts and the save in
// packages/testkit/src/xref/xref-attach.test.ts. SHOTS=<dir> saves the PR's screenshots.
// M5-04 part 12: -XREF Attach attaches a drawing named at the command line, found among the
// drawings open, and `~` at Overlay's file name opens the dialog on Overlay (engine side in
// packages/engine/test/commands/xref-dash-attach.test.ts, the app's lookup in
// apps/web/test/xref-files.test.ts).
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectShown, ink, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const ROOT = path.join(import.meta.dirname, '../../../packages/testkit/fixtures');
const HOST = path.join(ROOT, 'raster/raster-images.dxf');
const GRANDCHILD = path.join(ROOT, 'xref/xref-grandchild.dxf');
const SHOTS = process.env['SHOTS'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');

/** Off the canvas, so Dynamic Input does not take the next point typed as relative. */
const park = (page: Page) => page.mouse.move(640, 708);

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await park(page);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

/** The References palette's rows as name, type and status. */
async function rows(page: Page): Promise<string[]> {
  const table = page.getByRole('table', { name: 'References of the drawing' });
  return table
    .locator('tbody tr')
    .evaluateAll((trs) =>
      trs.map((tr) => [...tr.children].map((td) => td.textContent?.trim()).join(' | ')),
    );
}

test('XATTACH overlays a picked drawing through the Attach External Reference dialog', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, HOST);
  await expectShown(page, 'raster-images.dxf');
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'W', /^Specify first corner/);
  await type(page, '-10,-10', /^Specify opposite corner/);
  await type(page, '100,60', 'Command:');
  await page.waitForTimeout(500);
  const before = await ink(page);

  await page.keyboard.type('XA');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Attach External Reference' });
  await expect(dialog).toBeVisible();
  // No xrefs yet: the dialog opens on Browse..., which picks the drawing.
  await expect(dialog.getByRole('button', { name: 'Browse...' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Browse...' }).click();
  await (await chooser).setFiles(GRANDCHILD);
  await expect(dialog.getByLabel('Name:')).toHaveValue('xref-grandchild');
  await expect(dialog.getByTestId('xref-attach-path')).toHaveText('xref-grandchild.dxf');
  await expect(dialog.getByTestId('xref-attach-unit')).toHaveText('Unitless');
  await expect(dialog.getByTestId('xref-attach-factor')).toHaveText('1');
  await dialog.getByRole('radio', { name: 'Overlay' }).check();
  await dialog.getByRole('button', { name: 'Show Details' }).click();
  await expect(dialog.getByTestId('xref-attach-saved')).toHaveText('xref-grandchild.dxf');
  await expect(
    dialog.getByRole('group', { name: 'Insertion point' }).getByLabel('Specify On-screen'),
  ).toBeChecked();
  await shot(page, '1-attach-external-reference');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();

  // Loaded before the point is asked: the square drags with the cursor.
  await expect(prompt(page)).toHaveText(/^Specify insertion point or \[Scale\/X\/Y\/Z\/Rotate\]/);
  await park(page);
  await type(page, '60,20', 'Command:');
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(before + 300);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await shot(page, '2-overlaid');

  await type(page, 'XREF', 'Command:');
  await expect.poll(() => rows(page)).toContainEqual(expect.stringMatching(/^xref-grandchild \|/));
  const row = (await rows(page)).find((r) => r.startsWith('xref-grandchild'))!;
  expect(row).toContain('Loaded');
  expect(row).toContain('Overlay');
  await shot(page, '3-references-loaded');

  // One undo step takes the xref and what it drew back.
  await park(page);
  await type(page, 'U', 'Command:');
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeLessThan(before + 100);
  await expect
    .poll(() => rows(page))
    .not.toContainEqual(expect.stringMatching(/^xref-grandchild \|/));

  // The palette's Attach DWG... opens the dialog too.
  await page.getByRole('button', { name: 'Attach DWG...' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});

test('-XREF Attach attaches a drawing open in another tab, named at the command line', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, GRANDCHILD);
  await expectShown(page, 'xref-grandchild.dxf');
  await openWithPicker(page, HOST);
  await expectShown(page, 'raster-images.dxf');
  await type(page, 'Z', /^Specify corner of window/);
  await type(page, 'W', /^Specify first corner/);
  await type(page, '-10,-10', /^Specify opposite corner/);
  await type(page, '100,60', 'Command:');
  await page.waitForTimeout(500);
  const before = await ink(page);

  // ~ at the file name opens the Attach External Reference dialog, on Overlay for Overlay.
  await type(page, '-XREF', /^Enter an option/);
  await type(page, 'O', 'Enter name of file to overlay:');
  await page.keyboard.type('~');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Attach External Reference' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Overlay' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');

  await type(
    page,
    '-XREF',
    'Enter an option [?/Bind/Detach/Path/pathType/Unload/Reload/Overlay/Attach] <Attach>:',
  );
  await type(page, '', 'Enter name of file to attach:');
  await shot(page, '1-dash-xref-attach');
  await type(page, 'xref-grandchild', /^Specify insertion point or \[Scale\/X\/Y\/Z\/Rotate\]/);
  await park(page);
  await type(page, '60,20', /^Enter X scale factor/);
  await type(page, '', /^Enter Y scale factor/);
  await type(page, '', /^Specify rotation angle/);
  await type(page, '', 'Command:');
  await expect.poll(() => ink(page), { timeout: 30_000 }).toBeGreaterThan(before + 300);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await shot(page, '2-dash-xref-attached');

  await type(page, 'XREF', 'Command:');
  await expect.poll(() => rows(page)).toContainEqual(expect.stringMatching(/^xref-grandchild \|/));
  const row = (await rows(page)).find((r) => r.startsWith('xref-grandchild'))!;
  expect(row).toContain('Loaded');
  expect(row).toContain('Attach');

  // A file the app does not hold is not found; Enter alone attaches the last again.
  await type(page, '-XREF', /^Enter an option/);
  await type(page, 'A', 'Enter name of file to attach <xref-grandchild.dxf>:');
  await type(page, 'elevation', 'Command:');
  await expect(page.getByRole('log', { name: 'Recent command lines' })).toContainText(
    'File "elevation" not found.',
  );
  await expect(prompt(page)).toHaveText('Command:');
});
