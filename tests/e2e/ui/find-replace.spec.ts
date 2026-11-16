// M4-09 part 2: FIND's Find and Replace dialog in the app, as a drafter renames a part across a
// sheet's notes: List results shows each match, Find Next steps through them, Replace changes the
// one shown, Replace All the rest (whole words only, from More Options). The search and
// replacement rules are unit-tested in packages/engine/test/edit/find-text.test.ts and the
// scenarios in packages/engine/test/commands/find.test.ts; this checks that the dialog, the bus
// and the canvas carry them end to end.
import { expect, test, type Page } from '@playwright/test';
import type { ChangeSet, Entity } from '@triya/engine';
import { DXF, expectDrawn, expectShown, openWithPicker } from '../app/page';
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

/** The texts made in this test as they stand now, in the order made. */
const texts = (page: Page) =>
  page.evaluate(() => {
    const out = new Map<string, string>();
    const put = (e: Entity) => {
      const g = e.geom;
      if (g.kind === 'TEXT') out.set(e.handle, g.value);
      else if (g.kind === 'MTEXT') out.set(e.handle, g.contents);
    };
    for (const cs of (window as unknown as Dev).triyaDev.changes()) {
      for (const a of cs.entities?.added ?? []) put(a.entity);
      for (const u of cs.entities?.updated ?? []) if (out.has(u.after.handle)) put(u.after);
    }
    return [...out.values()];
  });

const prompt = (page: Page) => page.getByTestId('command-prompt');

async function type(page: Page, text: string, next: string | RegExp): Promise<void> {
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(prompt(page)).toHaveText(next);
}

test('Find and Replace lists, steps through and replaces text', async ({ page }) => {
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
  await page.mouse.move(20, 400);

  await type(page, 'DT', 'Specify start point of text or [Justify/Style]:');
  await type(page, '1000020,1000080', 'Specify height <2.5000>:');
  await type(page, '5', /Specify rotation angle of text/);
  await type(page, '', 'Enter text:');
  await type(page, 'HINGE H1', 'Enter text:');
  await type(page, 'HINGE H2', 'Enter text:');
  await type(page, 'HINGES TO SUIT', 'Enter text:');
  await type(page, '', 'Command:');
  await type(page, '-MTEXT', 'Specify first corner:');
  await type(
    page,
    '#1000020,1000040',
    'Specify opposite corner or [Height/Justify/Line spacing/Rotation/Style/Width/Columns]:',
  );
  await type(page, '#1000140,1000010', 'Enter text:');
  await type(page, 'FIT {\\LHINGE} H1\\PWITH SCREWS', 'Enter text:');
  await type(page, '', 'Command:');
  await expectDrawn(page, { timeout: 15_000 });

  await type(page, 'FIND', /Find and Replace/);
  const dialog = page.getByRole('dialog', { name: 'Find and Replace' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Find what:').fill('hinge h1');
  await dialog.getByLabel('Replace with:').fill('PIVOT P1');
  await dialog.getByLabel('List results').check();
  await dialog.getByRole('button', { name: 'Find', exact: true }).click();
  const rows = dialog.getByRole('row');
  await expect(rows).toHaveText([
    /Location\s*Object Type\s*Text/,
    /Model\s*Text\s*HINGE H1/,
    /Model\s*MText\s*FIT HINGE H1 WITH SCREWS/,
  ]);
  // The first is shown, so Find is now Find Next.
  await expect(dialog.getByRole('button', { name: 'Find Next' })).toBeVisible();
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('1-results.png') });

  await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(() => texts(page)).toContain('PIVOT P1');
  // On to the MTEXT, whose underline is kept.
  await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(() => texts(page)).toContain('FIT {\\LPIVOT P1}\\PWITH SCREWS');
  await expect(dialog.getByRole('status')).toHaveText(
    'Find and Replace has finished searching for the text.',
  );

  // Whole words only: HINGES stays.
  await dialog.getByLabel('Find what:').fill('hinge');
  await dialog.getByLabel('Replace with:').fill('PIVOT');
  await dialog.getByRole('button', { name: /More Options/ }).click();
  await dialog.getByLabel('Find whole words only').check();
  await dialog.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(rows).toHaveText([/Location/, /Model\s*Text\s*HINGE H2/]);
  await page.screenshot({ path: test.info().outputPath('2-more-options.png') });
  await dialog.getByRole('button', { name: 'Replace All' }).click();
  await expect(dialog.getByRole('status')).toHaveText('1 match was replaced.');
  await expect
    .poll(() => texts(page))
    .toEqual(['PIVOT P1', 'PIVOT H2', 'HINGES TO SUIT', 'FIT {\\LPIVOT P1}\\PWITH SCREWS']);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(prompt(page)).toHaveText('Command:');
  await expectDrawn(page, { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath('3-replaced.png') });

  // FIND is one command: one U takes back every replacement it made.
  await type(page, 'U', 'Command:');
  await expect
    .poll(() => texts(page))
    .toEqual(['HINGE H1', 'HINGE H2', 'HINGES TO SUIT', 'FIT {\\LHINGE} H1\\PWITH SCREWS']);
});
