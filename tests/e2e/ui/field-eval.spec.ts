// M4-10 part 3: fields as the app opens a drawing (FIELDEVAL) and shows them (FIELDDISPLAY).
// mtext_complex_inline_codes.dxf has MTEXTs showing a Filename field (`%fn6`, the name with its
// extension); opened from a copy named Renamed.dxf, each shows the new name, without leaving the
// drawing with unsaved changes or an undo step. A field is drawn on a grey background, which
// FIELDDISPLAY 0 takes away. The evaluation, the events and the shading are unit-tested in
// packages/engine (test/edit/field-eval.test.ts) and packages/render (test/text-tessellate.test.ts,
// test/canvas2d-text.test.ts); this checks the app carries them end to end.
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, MTextGeometry } from '@triya/engine';
import { DXF, activeCanvas, expectDrawn, expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

const FIELDS = path.join(CORPUS, 'ezdxf/examples_dxf/mtext_complex_inline_codes.dxf');

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

type Dev = { triyaDev: { changes(): readonly ChangeSet[] } };

/** The Filename fields' values in the MTEXTs the app's changes updated. */
const fileNames = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const u of cs.entities?.updated ?? []) {
        const g = u.after.geom as MTextGeometry;
        if (g.kind === 'MTEXT') out.push(...(g.field?.children ?? []).map((c) => c.value ?? ''));
      }
    }
    return out;
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('a Filename field shows the name the drawing was opened under', async ({ page }) => {
  test.setTimeout(120_000);
  const renamed = test.info().outputPath('Renamed.dxf');
  copyFileSync(FIELDS, renamed);
  await page.goto(app.url);
  await openWithPicker(page, renamed);
  await expectShown(page, 'Renamed.dxf');
  await expect.poll(() => fileNames(page)).toContain('Renamed.dxf');
  const values = await fileNames(page);
  expect(values.length).toBeGreaterThan(0);
  expect(new Set(values)).toEqual(new Set(['Renamed.dxf']));
  // Opening is no edit: no unsaved changes, nothing to undo.
  const tab = page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab', {
    name: 'Renamed.dxf',
  });
  await expect(tab).not.toHaveAttribute('data-dirty', 'true');
  await type(page, 'U', 'Command:');
  await expect(page.getByText('Nothing to undo').last()).toBeAttached();
  await page.mouse.move(300, 450);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('0-opened-renamed.png') });
});

test('fields are shaded grey on screen until FIELDDISPLAY is 0', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DXF);
  await expectShown(page, path.basename(DXF));
  await type(
    page,
    'Z',
    'Specify corner of window, enter a scale factor (nX or nXP), or [All/Center/Dynamic/Extents/Previous/Scale/Window/Object] <real time>:',
  );
  await type(page, '1000000,1000000', 'Specify opposite corner:');
  await type(page, '1000160,1000100', 'Command:');
  await page.keyboard.type('FIELD');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Field' });
  await dialog.getByLabel('Field category:').selectOption({ label: 'Document' });
  await dialog.getByLabel('Field names:').selectOption({ label: 'Filename' });
  await dialog.getByLabel('Filename only').check();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(prompt(page)).toHaveText('Specify start point or [Height/Justify]:');
  await type(page, 'H', /Specify height/);
  await type(page, '6', 'Specify start point or [Height/Justify]:');
  await type(page, '1000020,1000050', 'Command:');
  // Away from the navigation bar, whose menu opens on hover.
  await page.mouse.move(300, 450);
  await expectDrawn(page, { timeout: 15_000 });
  const canvas = activeCanvas(page);
  const shaded = await canvas.screenshot();
  await page.screenshot({ path: test.info().outputPath('1-field-shaded.png') });

  await type(page, 'FIELDDISPLAY', 'Enter new value for FIELDDISPLAY <1>:');
  await type(page, '0', 'Command:');
  await page.mouse.move(300, 450);
  await expect.poll(async () => (await canvas.screenshot()).equals(shaded)).toBe(false);
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('2-fielddisplay-0.png') });

  await type(page, 'FIELDDISPLAY', 'Enter new value for FIELDDISPLAY <0>:');
  await type(page, '1', 'Command:');
  await page.mouse.move(300, 450);
  await expect.poll(async () => (await canvas.screenshot()).equals(shaded)).toBe(true);
});
