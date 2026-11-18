// M5-03 part 1: ATTDEF's Attribute Definition dialog in the app. The Mode check boxes grey what
// AutoCAD greys (Constant: Prompt, Verify, Preset; Multiple lines: Boundary width and the
// Align/Fit justifications); a pick button closes the dialog for the value and opens it again
// with it; OK with Specify on-screen asks the start point and draws the definition's tag; the
// next ATTDEF aligns below it; a block of them asks the values (verifying one), and ATTDISP ON
// shows the invisible attribute the reference carries, OFF hides them all. The commands
// are unit-tested in packages/engine/test/commands/attdef.test.ts.
import { expect, test, type Page } from '@playwright/test';
import type { AttdefGeometry, ChangeSet } from '@triya/engine';
import path from 'node:path';
import { DXF, activeCanvas, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const prompt = (page: Page) => page.getByTestId('command-prompt');
const O = 1e6;
const p = (x: number, y: number) => `${O + x},${O + y}`;

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

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

/** The attribute definitions this test made: tag, flags, height and insertion point. */
const made = (page: Page) =>
  page.evaluate(() => {
    const defs = new Map<string, AttdefGeometry>();
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) {
        if (a.entity.geom.kind === 'ATTDEF') defs.set(a.entity.handle, a.entity.geom);
      }
      for (const r of cs.entities?.removed ?? []) defs.delete(r.entity.handle);
    }
    return [...defs.values()].map((g) => ({
      tag: g.tag,
      flags: g.flags,
      height: g.height,
      x: Math.round(g.position.x - 1e6),
      y: Math.round((g.position.y - 1e6) * 1000) / 1000,
    }));
  });

const attmode = (page: Page): Promise<unknown> =>
  page.evaluate(() => {
    let v: unknown;
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const h of cs.header ?? []) if (h.name === '$ATTMODE') v = h.after;
    }
    return v;
  });

test('the Attribute Definition dialog defines attributes, ATTDISP shows invisible ones', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await expect(prompt(page)).toHaveText('Command:');
  const canvas = activeCanvas(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height + 60);
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, p(-10, -30), 'Specify opposite corner:');
  await type(page, p(70, 20), 'Command:');
  await enterCommand(page, 'RECTANG');
  await expect(prompt(page)).toHaveText(/^Specify first corner point/);
  await type(page, p(0, -20), /^Specify other corner point/);
  await type(page, p(60, 10), 'Command:');

  await enterCommand(page, 'ATTDEF');
  const dialog = page.getByRole('dialog', { name: 'Attribute Definition' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Lock position' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Specify on-screen' })).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: 'Align below previous attribute definition' }),
  ).toBeDisabled();
  await expect(dialog.getByLabel('Boundary width:')).toBeDisabled();

  // Constant greys Prompt, Verify and Preset; Multiple lines enables Boundary width and drops
  // Align and Fit.
  await dialog.getByRole('checkbox', { name: 'Constant' }).check();
  await expect(dialog.getByLabel('Prompt:')).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: 'Verify' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Constant' }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Multiple lines' }).check();
  await expect(dialog.getByLabel('Boundary width:')).toBeEnabled();
  await expect(dialog.getByLabel('Justification:').locator('option')).toHaveCount(13);
  await dialog.getByRole('checkbox', { name: 'Multiple lines' }).uncheck();

  await dialog.getByLabel('Tag:').fill('part_no');
  await dialog.getByLabel('Prompt:').fill('Part number');
  await dialog.getByLabel('Default:').fill('P-100');
  await dialog.getByRole('checkbox', { name: 'Verify' }).check();

  // Pick text height closes it for the height.
  await dialog.getByRole('button', { name: 'Pick text height' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText(/^Specify text height <[\d.]+>:$/);
  await type(page, '4', 'Attribute Definition:');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Text height:')).toHaveValue('4');
  await expect(dialog.getByLabel('Tag:')).toHaveValue('part_no');
  await shot(page, '1-attribute-definition');

  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Specify start point:');
  await type(page, p(5, 0), 'Command:');
  await expect
    .poll(async () => made(page))
    .toEqual([{ tag: 'PART_NO', flags: 4, height: 4, x: 5, y: 0 }]);

  // The next one aligns below it, invisible.
  await enterCommand(page, 'ATTDEF');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Tag:')).toHaveValue('');
  await dialog.getByLabel('Tag:').fill('MATERIAL');
  await dialog.getByLabel('Prompt:').fill('Material');
  await dialog.getByRole('checkbox', { name: 'Verify' }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Invisible' }).check();
  await dialog.getByRole('checkbox', { name: 'Align below previous attribute definition' }).check();
  await expect(dialog.getByLabel('Text height:')).toBeDisabled();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Command:');
  await expect
    .poll(async () => made(page))
    .toEqual([
      { tag: 'PART_NO', flags: 4, height: 4, x: 5, y: 0 },
      { tag: 'MATERIAL', flags: 1, height: 4, x: 5, y: -6.667 },
    ]);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85);
  await page.waitForTimeout(300);
  await shot(page, '2-two-definitions');

  // A block of the rectangle and both definitions, and a reference asking their values at the
  // command line (ATTDIA 0): MATERIAL is invisible, PART_NO asked again to verify it.
  await type(page, 'ATTDIA', /^Enter new value for ATTDIA <\d>:$/);
  await type(page, '0', 'Command:');
  await type(page, '-BLOCK', 'Enter block name or [?]:');
  await type(page, 'TAGGED', 'Specify insertion base point:');
  await type(page, p(0, -20), 'Select objects:');
  await type(page, 'C', 'Specify first corner:');
  await type(page, p(-1, -21), 'Specify opposite corner:');
  await type(page, p(61, 11), 'Select objects:');
  await type(page, '', 'Command:');
  await type(page, '-INSERT', /^Enter block name or \[\?\]/);
  await type(page, 'TAGGED', 'Specify insertion point or [Basepoint/Scale/X/Y/Z/Rotate]:');
  await type(page, p(0, -20), /^Enter X scale factor/);
  await type(page, '', 'Enter Y scale factor <use X scale factor>:');
  await type(page, '', /^Specify rotation angle <0[.0]*>:$/);
  await type(page, '', /^Part number <P-100>:$/);
  await type(page, 'P-207', /^Material/);
  await type(page, 'Steel', /^Part number <P-207>:$/);
  await type(page, '', 'Command:');
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.85);
  await page.waitForTimeout(300);
  await shot(page, '3-reference-material-hidden');

  // ATTDISP ON shows the invisible attribute; OFF hides them all.
  await enterCommand(page, 'ATTDISP');
  await expect(prompt(page)).toHaveText(
    /^Enter attribute visibility setting \[Normal\/ON\/OFF\] <(Normal|ON|OFF)>:$/,
  );
  await type(page, 'ON', 'Command:');
  await expect.poll(async () => attmode(page)).toBe(2);
  await page.waitForTimeout(300);
  await shot(page, '4-attdisp-on');
  await type(page, 'ATTDISP', /^Enter attribute visibility setting/);
  await type(page, 'OFF', 'Command:');
  await expect.poll(async () => attmode(page)).toBe(0);

  // Esc is Cancel: nothing changes.
  await enterCommand(page, 'ATTDEF');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
});
