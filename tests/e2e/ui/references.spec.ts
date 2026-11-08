// M1-21: the References palette, and the ways an xref's file is found besides dropping it
// alone: the palette's folder picker, several files dropped at once (the nested grandchild
// answered from the same drop), and a dropped folder kept on this device, which resolves the
// drawing's references without asking when it is opened again, in a later session too. The
// thread-authored set is packages/testkit/src/xref/fixture.ts.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectShown, ink, openWithDrop, openWithPicker } from '../app/page';
import { startApp } from '../app/server';

const FIXTURES = path.join(import.meta.dirname, '../../../packages/testkit/fixtures/xref');
const SET = ['xref-child-tb.dxf', 'xref-grandchild.dxf', 'xref-stamp.png'];

let app: { url: string; close(): Promise<void> };
test.beforeAll(async () => {
  app = await startApp();
});
test.afterAll(async () => {
  await app.close();
});

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open drawings' }).getByRole('tab');
const alert = (page: Page) => page.getByRole('button', { name: /references? not found/ });

/** The palette's rows as name, status, type, indented by depth. */
async function rows(page: Page): Promise<string[]> {
  const table = page.getByRole('table', { name: 'References of the drawing' });
  return table.locator('tbody tr').evaluateAll((trs) =>
    trs.map((tr) => {
      const [name, ...cells] = [...tr.children].map((c) => c.textContent);
      const depth = Math.round(
        (parseFloat((tr.children[0] as HTMLElement).style.paddingLeft) - 6) / 16,
      );
      return `${'  '.repeat(depth)}${name} | ${cells.slice(0, 2).join(' | ')}`;
    }),
  );
}

const LOADED = [
  'xref-child-tb | Loaded | Attach',
  '  xref-grandchild | Loaded | Attach',
  '  xref-stamp | Loaded | Image',
  'xref-child-ovl | Loaded | Overlay',
  '  xref-grandchild | Loaded | Attach',
  '  xref-stamp | Loaded | Image',
];

const showReferences = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Palettes' })
    .getByRole('button', { name: 'References' })
    .click();

async function openParent(page: Page): Promise<void> {
  await openWithPicker(page, path.join(FIXTURES, 'xref-parent.dxf'));
  await expectShown(page, 'xref-parent.dxf');
}

test('lists the references and finds them in a picked folder', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openParent(page);
  await expect(alert(page)).toHaveText('2 references not found');
  await alert(page).click();
  const palette = page.getByRole('complementary', { name: 'References' });
  await expect(palette).toBeVisible();
  expect(await rows(page)).toEqual([
    'xref-child-tb | Not found | Attach',
    'xref-child-ovl | Not found | Overlay',
  ]);
  await expect(palette.getByRole('rowheader', { name: 'xref-child-tb' })).toBeVisible();
  const border = await ink(page);

  // The folder holds the parent too: a folder's files answer references, none opens.
  await palette.getByLabel('Reference folder').setInputFiles(FIXTURES);
  await expect.poll(() => rows(page), { timeout: 30_000 }).toEqual(LOADED);
  await expect(alert(page)).toHaveCount(0);
  await expect(palette.getByRole('status')).toHaveText('Every reference is found.');
  await expect(tabs(page)).toHaveCount(1);
  await expect.poll(() => ink(page), { timeout: 15_000 }).toBeGreaterThan(border + 3000);
});

test('loads a title block and its nested xref dropped together', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(app.url);
  await openParent(page);
  await openWithDrop(
    page,
    SET.map((f) => path.join(FIXTURES, f)),
  );
  await showReferences(page);
  await expect.poll(() => rows(page), { timeout: 30_000 }).toEqual(LOADED);
  await expect(tabs(page)).toHaveCount(1);
});

/**
 * Drops a folder, as Chromium gives one: a file system handle. The page's origin-private file
 * system stands in for the user's disk (its handles are real ones the browser lets the page
 * read, so they can be kept in IndexedDB).
 */
async function dropFolder(page: Page): Promise<void> {
  const files = SET.map((name) => ({
    name,
    bytes: [...readFileSync(path.join(FIXTURES, name))],
  }));
  await page.evaluate(async (files) => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('sheets', { create: true });
    for (const f of files) {
      const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
      await w.write(new Uint8Array(f.bytes));
      await w.close();
    }
    const item = {
      kind: 'file',
      getAsFile: () => null,
      webkitGetAsEntry: () => null,
      getAsFileSystemHandle: async () => dir,
    };
    const dataTransfer = { types: ['Files'], items: [item], files: [] };
    const target = document.querySelector('[data-testid="app"]')!;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
      target.dispatchEvent(e);
    }
  }, files);
}

test('keeps a dropped folder and finds the references in it again, after a reload too', async ({
  playwright,
  launchOptions,
}) => {
  test.setTimeout(120_000);
  // A profile on disk, as a user's is: a test context is off the record, and its Chromium
  // closes when a page reads a kept origin-private handle back from IndexedDB after a reload.
  const profile = mkdtempSync(path.join(tmpdir(), 'triya-references-'));
  const context = await playwright.chromium.launchPersistentContext(profile, launchOptions);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(app.url);
    await openParent(page);
    await dropFolder(page);
    await expect(alert(page)).toHaveCount(0, { timeout: 30_000 });
    await expect(tabs(page)).toHaveCount(1);

    // Closed and opened again: found without a drop.
    await page.getByRole('button', { name: 'Close xref-parent.dxf' }).click();
    await expect(tabs(page)).toHaveCount(0);
    await openParent(page);
    await showReferences(page);
    await expect.poll(() => rows(page), { timeout: 30_000 }).toEqual(LOADED);

    // A later session.
    await page.reload();
    await openParent(page);
    await showReferences(page);
    await expect.poll(() => rows(page), { timeout: 30_000 }).toEqual(LOADED);
    await expect(alert(page)).toHaveCount(0);
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
