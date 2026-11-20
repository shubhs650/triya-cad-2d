// M6-05: the Publish dialog's sheet list and output. A sheet renamed in place (F2, Enter keeps
// the name, Esc leaves it) bookmarks its page; a sheet left out does not publish; Publish
// Options' Multi-sheet file writes one PDF under the name given, its pages labelled with their
// layouts; Single-sheet file writes a PDF a sheet, several in one ZIP; "Include when adding
// sheets" decides which spaces the list opens with, for the session.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { pdfSummary } from '../../../packages/testkit/src/pdf/read';
import { DWG, enterCommand, expectShown, openWithPicker } from '../app/page';
import { startApp } from '../app/server';
import { unzip } from '../app/zip';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

async function openPublish(page: Page) {
  await enterCommand(page, 'PUBLISH');
  const d = page.getByRole('dialog', { name: 'Publish' });
  await expect(d).toBeVisible();
  return d;
}

const sheets = (d: Locator) => d.getByRole('table', { name: 'Sheets to publish' });

const bytesOf = async (download: Download) =>
  new Uint8Array(readFileSync((await download.path())!));

test('PUBLISH renames and leaves out sheets, and writes one PDF or a PDF a sheet (M6-05)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(app.url);
  await openWithPicker(page, DWG);
  await expectShown(page, path.basename(DWG));
  const tabs = page.getByRole('tablist', { name: 'Model and layouts' }).getByRole('tab');
  const spaces = (await tabs.allTextContents()).map((s) => s.trim());
  const layouts = spaces.slice(1);
  expect(layouts.length).toBeGreaterThan(0);
  const base = path.basename(DWG).replace(/\.[^.]+$/, '');

  let d = await openPublish(page);
  const rows = sheets(d).getByRole('checkbox');
  await expect(rows).toHaveCount(spaces.length);

  // Rename Sheet: F2 on the selected row; Esc leaves the name, Enter keeps the one typed.
  await rows.nth(1).focus();
  await page.keyboard.press('F2');
  const name = d.getByLabel('Sheet name');
  await expect(name).toHaveValue(`${base}-${layouts[0]}`);
  await name.fill('Dropped');
  await name.press('Escape');
  await expect(d).toBeVisible();
  await expect(rows.nth(1)).toHaveAccessibleName(`${base}-${layouts[0]}`);
  // A name another sheet has is refused (any case), and the box stays open for another.
  await d.getByRole('button', { name: 'Rename Sheet' }).click();
  await name.fill(`${base}-MODEL`);
  await name.press('Enter');
  await expect(d.getByRole('alert')).toHaveText(`A sheet named ${base}-MODEL is listed already.`);
  await name.fill('A-101 Ground floor');
  await name.press('Enter');
  await expect(rows.nth(1)).toHaveAccessibleName('A-101 Ground floor');
  await expect(d.getByRole('alert')).toHaveCount(0);

  // Model space left out; one multi-sheet PDF named in Publish Options.
  await rows.first().uncheck();
  await d.getByRole('button', { name: 'Publish Options…' }).click();
  const options = page.getByRole('dialog', { name: 'Publish Options' });
  await expect(options.getByLabel('Type')).toHaveValue('multi');
  await options.getByLabel('Multi-sheet file name').fill('Issue 3');
  await options.getByRole('button', { name: 'OK' }).click();
  await expect(options).toBeHidden();
  await expect(d).toBeVisible();
  const [multi] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Publish', exact: true }).click(),
  ]);
  await expect(d).toBeHidden();
  expect(multi.suggestedFilename()).toBe('Issue 3.pdf');
  const pdf = await pdfSummary(await bytesOf(multi));
  expect(pdf.pages).toBe(layouts.length);
  expect(pdf.labels).toEqual(layouts);
  expect(pdf.bookmarks).toEqual([
    'A-101 Ground floor',
    ...layouts.slice(1).map((l) => `${base}-${l}`),
  ]);

  // Include when adding sheets: Model tab off lists the layouts alone, the next time too; a PDF
  // a sheet then, with the PDF Options' bookmarks left out.
  d = await openPublish(page);
  await d.getByRole('checkbox', { name: 'Model tab' }).uncheck();
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(d).toBeHidden();
  d = await openPublish(page);
  await expect(d.getByRole('checkbox', { name: 'Model tab' })).not.toBeChecked();
  await expect(sheets(d).getByRole('checkbox')).toHaveCount(layouts.length);
  await d.getByRole('button', { name: 'Publish Options…' }).click();
  await options.getByLabel('Type').selectOption('single');
  await expect(options.getByLabel('Multi-sheet file name')).toBeDisabled();
  await options.getByRole('button', { name: 'OK' }).click();
  await d.getByRole('button', { name: 'PDF Options…' }).click();
  const pdfOptions = page.getByRole('dialog', { name: 'PDF Options' });
  await pdfOptions.getByRole('checkbox', { name: 'Create bookmarks' }).uncheck();
  await pdfOptions.getByRole('button', { name: 'OK' }).click();
  await expect(pdfOptions).toBeHidden();
  const [single] = await Promise.all([
    page.waitForEvent('download'),
    d.getByRole('button', { name: 'Publish', exact: true }).click(),
  ]);
  await expect(d).toBeHidden();
  const files =
    layouts.length > 1
      ? unzip(await bytesOf(single))
      : [{ name: single.suggestedFilename(), bytes: await bytesOf(single) }];
  if (layouts.length > 1) expect(single.suggestedFilename()).toBe(`${base}.zip`);
  expect(files.map((f) => f.name)).toEqual(layouts.map((l) => `${base}-${l}.pdf`));
  for (const [i, f] of files.entries()) {
    const one = await pdfSummary(f.bytes);
    expect(one.pages).toBe(1);
    expect(one.labels).toEqual([layouts[i]]);
    expect(one.bookmarks).toEqual([]);
  }
});
