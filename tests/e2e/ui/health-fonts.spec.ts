// M1-38 part 3: the Health palette lists fonts the app could not use, and the fonts installed
// on this computer that a drawing's text draws with. It asks a book of the same fonts the
// renderers get, so a font the user's files or this computer serve is not listed as missing.
//
// hatch_text_box_in_hole.dxf's Standard style names arial.ttf. The Local Font Access API is
// stood in for as in installed-fonts.spec.ts, already granted, offering one "Arial".
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fontBytes, testFont } from '../../../packages/text/test/ttf/fonts';
import { expectShown, openWithPicker } from '../app/page';
import { CORPUS, startApp } from '../app/server';

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const DRAWING = path.join(CORPUS, 'ezdxf/examples_dxf/hatch_text_box_in_hole.dxf');
const SANS = Buffer.from(fontBytes(testFont())).toString('base64');
const JUNK = Buffer.from('not a font at all').toString('base64');

/** An installed "Arial" whose file is `b64`, with the permission already granted. */
async function installedArial(page: Page, b64: string): Promise<void> {
  await page.addInitScript((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const w = window as unknown as Record<string, unknown>;
    w.queryLocalFonts = () =>
      Promise.resolve([
        {
          family: 'Arial',
          fullName: 'Arial',
          postscriptName: 'ArialMT',
          style: 'Regular',
          blob: () => Promise.resolve(new Blob([bytes])),
        },
      ]);
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = ((d: PermissionDescriptor) =>
      (d.name as string) === 'local-fonts'
        ? Promise.resolve({ state: 'granted' })
        : query(d)) as typeof navigator.permissions.query;
  }, b64);
}

async function openHealth(page: Page): Promise<Locator> {
  await openWithPicker(page, DRAWING);
  await expectShown(page, path.basename(DRAWING));
  await page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'Health' })
    .click();
  const palette = page.getByRole('complementary', { name: 'Health' });
  await expect(palette).toBeVisible();
  return palette;
}

const missing = (palette: Locator) =>
  palette
    .getByRole('table', { name: 'Missing fonts' })
    .getByRole('rowheader', { name: 'arial.ttf' });

test('lists a kept font file that no longer reads as a font, with the styles naming it', async ({
  page,
}) => {
  await page.goto(app.url);
  // A file an earlier visit kept that does not parse now (the store refuses such a file when
  // it is added, so it is written to the device store directly).
  await page.evaluate(async (b64) => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('fonts', { create: true });
    const writable = await (
      await folder.getFileHandle('arial.ttf', { create: true })
    ).createWritable();
    await writable.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    await writable.close();
  }, JUNK);
  await page.reload();
  const palette = await openHealth(page);

  const card = palette.getByRole('group', { name: 'Font errors (1)' });
  const row = card
    .getByRole('table', { name: 'Font errors' })
    .getByRole('row', { name: /arial\.ttf/ });
  await expect(row).toContainText('Your fonts');
  await expect(row).toContainText('not a font Triya can read');
  await expect(row).toContainText('Standard');
  // It draws with the bundled stand-in, so it is missing too.
  await expect(missing(palette)).toBeVisible();
});

test('lists an installed face that does not parse', async ({ page }) => {
  await installedArial(page, JUNK);
  await page.goto(app.url);
  const palette = await openHealth(page);

  const card = palette.getByRole('group', { name: 'Font errors (1)' });
  const row = card
    .getByRole('table', { name: 'Font errors' })
    .getByRole('row', { name: /arial\.ttf/ });
  await expect(row).toContainText('This computer');
  await expect(row).toContainText('not a usable font');
  await expect(missing(palette)).toBeVisible();
});

test('lists the installed face a style draws with, and no longer as missing', async ({ page }) => {
  await installedArial(page, SANS);
  await page.goto(app.url);
  const palette = await openHealth(page);

  const card = palette.getByRole('group', { name: 'Fonts from this computer (1)' });
  const row = card
    .getByRole('table', { name: 'Fonts from this computer' })
    .getByRole('row', { name: /arial\.ttf/ });
  await expect(row).toContainText('Arial');
  await expect(row).toContainText('Standard');
  await expect(missing(palette)).toHaveCount(0);
  await expect(palette.getByRole('group', { name: 'Font errors (0)' })).toContainText('None');
});
